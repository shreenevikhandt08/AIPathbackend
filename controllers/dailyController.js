const express    = require("express");
const DailyPlan  = require("../models/DailyPlan");
const BasePlan   = require("../models/BasePlan");
const { verifyToken } = require("../middleware/auth");
const axios      = require("axios");
const { buildDailyDayPrompt } = require("../utils/dailyPrompt");
const { callLLM } = require("../utils/llm");
const { syncWeeklyFromDaily, weekNumFromDayId } = require("../utils/weeklySync");
const { syncHomeworkFromDailyPlan } = require("./homeworkController");
const { enforceDayConnectivity } = require("../utils/connectivityEnforcer");
const { getStepForPlanDay } = require("../utils/dtPlaybookLookup");

// Content cells now come back from the LLM as an array of bullet strings
// (more reliable than trusting the model to place literal "\n" inside a
// single JSON string). Join them here so every downstream consumer keeps
// working with plain strings, unchanged.
function normalizeRows(rows) {
  if (!Array.isArray(rows)) return rows;
  return rows.map((r) => {
    if (!Array.isArray(r)) return r;
    const content = r[3];
    if (Array.isArray(content)) {
      return [r[0], r[1], r[2], content.filter((l) => typeof l === "string" && l.trim()).join("\n")];
    }
    return r;
  });
}

function isFormatOnlyRequest(feedback) {
  if (!feedback || !feedback.trim()) return false;
  const lower = feedback.toLowerCase();
  const formatKeywords = ["bullet","bullets","point","points","bulleted","list format",
    "in points","as points","use points","make points","format","reformat","restructure",
    "formatting","para","paragraph","short lines","concise","compact","clean up format"];
  const contentKeywords = ["add","remove","change topic","different subject","replace",
    "new topic","swap","skip","include","exclude","more detail","less detail","extend","shorten content"];
  return formatKeywords.some(k => lower.includes(k)) && !contentKeywords.some(k => lower.includes(k));
}

function parseDayKey(raw) {
  const m = String(raw).match(/Week\s*(\d+)\s*[-–]\s*(\w+)(?:\s*\((\d{2})-(\d{2})-(\d{4})\))?/i);
  if (!m) return null;
  const date = m[3] ? `${m[5]}-${m[4]}-${m[3]}` : null;
  return { week: parseInt(m[1]), dayName: m[2], date };
}

function groupRowsByDay(rows) {
  const map = {};
  rows.forEach(row => {
    const dayKey = row[0];
    if (!map[dayKey]) {
      const parsed = parseDayKey(dayKey);
      map[dayKey] = { week: parsed?.week || 1, dayName: parsed?.dayName || "Monday", date: parsed?.date || null, rows: [] };
    }
    map[dayKey].rows.push(row);
  });
  return map;
}

// ── Parse ▶ bullet points from a content string ───────────────────────────────
// Returns an array of strings — one per bullet.
function parseBullets(content) {
  if (!content) return [];
  return content
    .split("\n")
    .map(l => l.replace(/^[\s▶•\-*]+/, "").trim())
    .filter(l => l.length > 3);
}

// ── Compute readiness % for a week from sub-task checkboxes ──────────────────
// Returns { pct, completedCount, totalCount }
async function computeWeekReadiness(userId, weekNum) {
  // Bug 5 fix: query by dayId prefix so leave-pushed days (whose physical
  // calendar week differs from their plan week number) are still included.
  const dayIdPrefix = new RegExp(`^Week\s*${weekNum}\s*[-–]`, "i");
  const docs = await DailyPlan.find({ userId, dayId: dayIdPrefix });
  let total = 0, done = 0;
  for (const doc of docs) {
    if (doc.dayName === "Friday") continue; // don't count assessment day itself
    for (let ri = 0; ri < (doc.rows || []).length; ri++) {
      const content  = String(doc.rows[ri]?.[3] || "");
      const bullets  = parseBullets(content);
      if (bullets.length === 0) continue;
      total += bullets.length;
      // Count how many bullets for this row are marked done
      const doneSubs = (doc.subTaskDoneRows || []).filter(
        s => s.rowIndex === ri
      );
      done += Math.min(doneSubs.length, bullets.length);
    }
  }
  const pct = total === 0 ? 100 : Math.round((done / total) * 100);
  return { pct, completedCount: done, totalCount: total };
}

async function collectWeekCoverage(userId, weekNum) {
  const dayIdPrefix = new RegExp(`^Week\\s*${weekNum}\\s*[-–]`, "i");
  const docs = await DailyPlan.find({ userId, dayId: dayIdPrefix }).sort({ dayName: 1 });
  const coverage = [];
  for (const doc of docs) {
    if (doc.dayName === "Friday") continue;
    for (let ri = 0; ri < (doc.rows || []).length; ri++) {
      const activity = String(doc.rows[ri]?.[2] || "");
      const content  = String(doc.rows[ri]?.[3] || "");
      if (/break|lunch/i.test(activity)) continue;
      const bullets = parseBullets(content);
      if (bullets.length > 0) {
        coverage.push({ dayId: doc.dayId, dayName: doc.dayName, rowIndex: ri, activity, bullets });
      }
    }
  }
  return coverage;
}


async function buildAssessmentRows(userId, weekNum, mode, facultyPortions, fridayDoc) {
  const coverage  = await collectWeekCoverage(userId, weekNum);
  const readiness = await computeWeekReadiness(userId, weekNum);

  // ── Determine what scope goes into the assessment ─────────────────────────
  let scopeLines = "";
  let warningMessage = null;

  if (mode === "faculty_override" && facultyPortions && facultyPortions.length > 0) {
    // Case 2 — use exactly what the faculty chose
    scopeLines = facultyPortions
      .map(fp => `Subject: ${fp.subject}\nPortions: ${(fp.portions || []).join(", ")}`)
      .join("\n\n");
  } else {
    // Case 1 & 3 — derive from actual coverage
    // Bug 4 fix: load the actual Mon–Thu DailyPlan docs so we can read their
    // real subTaskDoneRows instead of the always-empty placeholder.
    const dayIdPrefix = new RegExp(`^Week\s*${weekNum}\s*[-–]`, "i");
    const weekDocs = await DailyPlan.find({ userId, dayId: dayIdPrefix });
    // Build a lookup: docDayId → subTaskDoneRows[]
    const doneSubsByDoc = {};
    for (const doc of weekDocs) {
      doneSubsByDoc[doc.dayId] = doc.subTaskDoneRows || [];
    }

    // Group by activity type → subject blocks, filtering to completed bullets
    // when any sub-task checkboxes have been used for that day.
    const subjectMap = {};
    for (const item of coverage) {
      const key = item.activity.replace(/[^a-z ]/gi, "").trim();
      if (!subjectMap[key]) subjectMap[key] = [];

      const docDoneSubs = doneSubsByDoc[item.dayId] || [];
      const anyChecked  = docDoneSubs.some(s => s.rowIndex === item.rowIndex);

      let bulletsToInclude;
      if (anyChecked) {
        // Sub-task checkboxes have been used — include only completed bullets.
        const doneSet = new Set(
          docDoneSubs
            .filter(s => s.rowIndex === item.rowIndex)
            .map(s => s.subIndex)
        );
        bulletsToInclude = item.bullets.filter((_, bi) => doneSet.has(bi));
      } else {
        // No checkboxes used yet — include all bullets (first-time generation).
        bulletsToInclude = item.bullets;
      }

      subjectMap[key].push(...bulletsToInclude.slice(0, 4));
    }
    scopeLines = Object.entries(subjectMap)
      .map(([activity, bullets]) => `${activity}:\n${bullets.map(b => `  • ${b}`).join("\n")}`)
      .join("\n\n");

    // Case 3 — readiness warning
    const threshold = fridayDoc?.assessmentConfig?.readinessThreshold ?? 70;
    if (readiness.pct < threshold) {
      warningMessage =
        `⚠️ Readiness Warning: Only ${readiness.pct}% of tasks completed this week ` +
        `(${readiness.completedCount}/${readiness.totalCount} sub-tasks). ` +
        `Consider narrowing the assessment scope to topics that were fully covered. ` +
        `Threshold is ${threshold}%.`;
    }
  }

  // ── Prompt LLM to generate assessment rows ────────────────────────────────
  const fridayDayId = fridayDoc?.dayId || `Week ${weekNum} - Friday`;

  const prompt = `You are designing a Friday Weekly Assessment Day schedule for engineering students.
This replaces the normal Friday review with a structured assessment tied to what was actually covered Mon–Thu this week.

WEEK ${weekNum} — SCOPE FOR ASSESSMENT:
${scopeLines || "Full week content as taught in Mon–Thu sessions"}

${mode === "faculty_override" ? "⚠️ FACULTY OVERRIDE — assess ONLY the portions listed above. Nothing else." : ""}
${warningMessage ? `⚠️ LOW READINESS NOTE (${readiness.pct}% complete) — narrow the assessment to the most-covered topics only.` : ""}

ASSESSMENT DAY FORMAT — generate EXACTLY 9 rows in this order:

ROW 1 — 08:45–09:00 — Weekly Assessment Stand-Up (15 min)
  Content: brief recap of what was covered Mon–Thu this week; assessment format explanation; calm the room.

ROW 2 — 09:00–10:30 — Written Assessment — Theory (90 min)
  Content: 4–6 specific theory questions drawn from the scope above. Format each as:
    Q1. [Subject — Topic]: [Exact question text] (X marks)
  Cover short-answer, definition, and explain-with-example types.

ROW 3 — 10:30–10:45 — Short Break

ROW 4 — 10:45–11:45 — Coding Assessment (60 min)
  Content: 1–2 coding problems directly using DSA / project concepts from this week's scope.
  State the problem clearly (input, output, constraints).

ROW 5 — 11:45–12:15 — Project Demo / Progress Check (30 min)
  Content: each team does a 3-min live demo of what was built this week; faculty asks 1 question per team.

ROW 6 — 12:15–01:00 — Lunch Break

ROW 7 — 01:00–02:00 — Answer Discussion + Doubt Clearing (60 min)
  Content: go through each written question answer on the board; clarify common mistakes; log recurring doubts.

ROW 8 — 02:00–03:30 — Targeted Revision — Weak Areas (90 min)
  Content: based on the assessment results, faculty identifies the 2–3 weakest topics and does focused re-teaching.
  List which topics are most likely to need re-teaching based on the scope above.

ROW 9 — 03:30–04:30 — Week Wrap-Up + Next Week Preview (60 min)
  Content: assessment score recording; feedback to each student; next week's topics preview; motivation close.

Return ONLY valid JSON — no markdown, no explanation:
{"rows":[
  ["${fridayDayId}","08:45 – 09:00 IST","🎯 Assessment Stand-Up","<content>"],
  ["${fridayDayId}","09:00 – 10:30 IST","📝 Written Assessment — Theory","<content>"],
  ["${fridayDayId}","10:30 – 10:45 IST","☕ Short Break","<content>"],
  ["${fridayDayId}","10:45 – 11:45 IST","💻 Coding Assessment","<content>"],
  ["${fridayDayId}","11:45 – 12:15 IST","🖥️ Project Demo / Progress Check","<content>"],
  ["${fridayDayId}","12:15 – 01:00 IST","🍽️ Lunch Break","<content>"],
  ["${fridayDayId}","01:00 – 02:00 IST","💬 Answer Discussion + Doubt Clearing","<content>"],
  ["${fridayDayId}","02:00 – 03:30 IST","🔁 Targeted Revision — Weak Areas","<content>"],
  ["${fridayDayId}","03:30 – 04:30 IST","🔄 Week Wrap-Up + Next Week Preview","<content>"]
]}

CRITICAL:
- Column 1 always "${fridayDayId}".
- ALL content as bullet points with ▶ prefix. NO paragraphs.
- Questions must be specific and tied to the scope — NOT generic.
- Return EXACTLY 9 rows.`;

  const result = await callLLM(prompt, 1800);
  if (!result?.rows) throw new Error("Assessment generation returned no rows");

  return { rows: result.rows, readiness, warningMessage };
}

async function regenerateSingleDay(dayId, context) {
 function extractDayName(dayId) {
  const match = String(dayId).match(
    /Week\s*\d+\s*-\s*(Monday|Tuesday|Wednesday|Thursday|Friday)/i
  );

  return match ? match[1] : "Monday";
}
 const dayName = extractDayName(dayId);

  const theme = {
    week: context.week || 1,
    subjects: context.subjects || [],
    dsa: context.theme?.dsa || "",
    systemDesign: context.theme?.systemDesign || "",
    project: context.theme?.project || "",
    projectTask: context.theme?.project || "",
    tech: context.theme?.tech || "",
    cumulativeKnowledge:
      context.theme?.cumulativeKnowledge || ""
  };

  let inputs = {
    ...(context.inputs || {}),
    _activeDTStage: context.activeDTStage || context._activeDTStage || context.inputs?._activeDTStage,
  };
  try {
    const { ensureSyllabusFromHandsOnFile } = require("../utils/loadCollegeSyllabusInput");
    inputs = await ensureSyllabusFromHandsOnFile(inputs);
  } catch (_) {
    /* optional */
  }

  // Persist regeneration feedback as GLOBAL engine lessons (survives logout / other users)
  try {
    const { recordFeedbackLessons, attachEngineLessons } = require("../utils/engineLessons");
    const surface = context.surface || "daily";
    if (context.feedback && String(context.feedback).trim().length >= 8) {
      await recordFeedbackLessons(context.feedback, {
        surface,
        userId: context.userId || null,
      });
    }
    await attachEngineLessons(inputs, surface === "homework" ? "daily" : surface);
  } catch (e) {
    console.warn("Engine lessons attach skipped:", e.message);
  }

  const globalDayIndex = Number(context.globalDayIndex || context.dayIndex || 0);
  const activeStageKey = inputs._activeDTStage || null;
  const dtStep = getStepForPlanDay(globalDayIndex, activeStageKey, inputs);

  const { generateDayGapContent, buildGapDrivenDayRows } = require("../utils/dayGapGenerator");
  const problemForDay = [inputs.problem || theme.project || "", context.feedback || ""]
    .filter(Boolean)
    .join("\n\nFaculty note: ");

  // RAG from uploaded questions PDF (+ web fallback) for banks / agent on single-day regen
  try {
    const { parseAssessmentConfig } = require("../utils/assessmentPicker");
    const cfg = parseAssessmentConfig(inputs);
    const questionsText = String(inputs?.questions || "").trim();
    const skipBanks =
      inputs?._skipAssessmentBanks === true ||
      inputs?._skipAssessmentBanks === "true";

    if (!skipBanks) {
      const { enrichAssessmentBanksRag } = require("../utils/enrichAssessmentBanksRag");
      const pack = await enrichAssessmentBanksRag(questionsText, {
        numDays: Math.max(5, globalDayIndex + 1),
        teamSize: Math.max(1, Number(inputs?.teamSize || 1) || 1),
        problemText: problemForDay || questionsText,
        dsaText: String(inputs?.dsaSyllabus || inputs?.dsa || "").trim(),
        sdText: String(inputs?.systemDesign || "").trim(),
      });
      inputs._assessmentRagPack = pack;
      if (pack?.agentTasks?.length) {
        inputs._agentRagPack = {
          tasks: pack.agentTasks,
          sources: pack.sources || ["rag"],
          mode: pack.mode || "rag",
        };
      }
      if (
        !inputs._agentRagPack &&
        cfg.banks?.agentWorkbench !== false &&
        (problemForDay.trim() || questionsText.length >= 40)
      ) {
        const { enrichAgentWorkbenchRag } = require("../utils/enrichAgentWorkbenchRag");
        inputs._agentRagPack = await enrichAgentWorkbenchRag(
          problemForDay || questionsText,
          Math.max(1, globalDayIndex + 1)
        );
      }
    }
  } catch (e) {
    console.warn("Bank / Agent RAG on day regen skipped:", e.message);
  }

  // Fresh System Design RAG curriculum + starter pack on day regen
  try {
    const skipSd =
      inputs?._skipSystemDesign === true ||
      inputs?._skipSystemDesign === "true" ||
      inputs?._skipSystemDesign === 1;
    if (!skipSd) {
      const { enrichSystemDesignRag } = require("../utils/enrichSystemDesignRag");
      const { enrichSystemDesignCurriculumRag } = require("../utils/enrichSystemDesignCurriculumRag");
      const syllabusHint = String(theme?.systemDesign || inputs?.systemDesign || "").trim();
      inputs._systemDesignLessonPack = await enrichSystemDesignCurriculumRag({
        numDays: Math.max(5, globalDayIndex + 1),
        syllabusHint,
        projectHint: problemForDay,
        uploadText: String(inputs?.systemDesign || inputs?.syllabus || syllabusHint || "").trim(),
        inputs,
      });
      inputs._systemDesignRagPack = await enrichSystemDesignRag({
        syllabusHint,
        projectHint: problemForDay,
        count: 2,
      });
    }
  } catch (e) {
    console.warn("System Design RAG on day regen skipped:", e.message);
  }

  const gap = await generateDayGapContent({
    dayName,
    dayKey: dayId,
    theme,
    inputs: {
      ...inputs,
      problem: problemForDay,
    },
    globalDayIndex,
    daySlice: (() => {
      try {
        const { presliceWeekContent } = require("../utils/dailyPlanGenerator");
        const slices = presliceWeekContent(theme, Math.max(0, globalDayIndex - (globalDayIndex % 5)));
        return slices[globalDayIndex % 5] || null;
      } catch (_) {
        return null;
      }
    })(),
    dtStep,
  });

  const dayRows = buildGapDrivenDayRows(dayId, gap, {
    theme,
    dtStep,
    dayIdx: globalDayIndex,
    daySlice: (() => {
      try {
        const { presliceWeekContent } = require("../utils/dailyPlanGenerator");
        const slices = presliceWeekContent(theme, Math.max(0, globalDayIndex - (globalDayIndex % 5)));
        return slices[globalDayIndex % 5] || null;
      } catch (_) {
        return null;
      }
    })(),
    inputs,
  });
  return enforceDayConnectivity(normalizeRows(dayRows), { theme, dtStep });
}

function groupRowsByDay(rows) {
  const map = {};
  rows.forEach(row => {
    const dayKey = row[0];
    if (!map[dayKey]) {
      const parsed = parseDayKey(dayKey);
      map[dayKey]  = { week: parsed?.week || 1, dayName: parsed?.dayName || "Monday", date: parsed?.date || null, rows: [] };
    }
    map[dayKey].rows.push(row);
  });
  return map;
}

function parseDayKey(raw) {
  // Real format from server.js: "Week 4 - Wednesday (11-06-2026)" — DD-MM-YYYY
  const m = String(raw).match(/Week\s*(\d+)\s*[-–]\s*(\w+)(?:\s*\((\d{2})-(\d{2})-(\d{4})\))?/i);
  if (!m) return null;
  const date = m[3] ? `${m[5]}-${m[4]}-${m[3]}` : null; // normalize to YYYY-MM-DD for storage
  return { week: parseInt(m[1]), dayName: m[2], date };
}

// POST /sync
async function syncPlan(req, res) {
  try {
    const { plan } = req.body;
    if (!plan?.rows) return res.status(400).json({ success: false, error: "plan.rows required" });

    const byDay = groupRowsByDay(plan.rows);
    const ops = Object.entries(byDay).map(([dayId, { week, dayName, date, rows }]) => ({
      updateOne: {
        filter: { userId: req.user.id, dayId },
        update: {
          // Always refresh rows (old $setOnInsert left stale homework forever)
          $set: { userId: req.user.id, dayId, week, dayName, date, rows },
          $setOnInsert: { locked: false, completed: false, doneRows: [], subTaskDoneRows: [] },
        },
        upsert: true,
      },
    }));

    await DailyPlan.bulkWrite(ops);

    // Exact replace: remove days not in this plan (prevents leftover weeks from
    // a previous longer calendar / another individual's generate on same account).
    const syncedDayIds = Object.keys(byDay);
    await DailyPlan.deleteMany({
      userId: req.user.id,
      dayId: { $nin: syncedDayIds },
    });

    // Separate HomeworkNight collection — first-class module, not only daily rows
    syncHomeworkFromDailyPlan(req.user.id, plan, "sync-from-daily").catch((err) =>
      console.error("[syncPlan] homework sync error:", err.message)
    );

    // Keep weekly collection aligned with the latest daily rows
    const weeks = [...new Set(Object.values(byDay).map((d) => d.week))];
    for (const w of weeks) {
      syncWeeklyFromDaily(req.user.id, w).catch((err) =>
        console.error("[syncPlan] weekly sync error:", err.message)
      );
    }

    try {
      // Routine day-row sync is silent — Maintain Logs tracks versions & meaningful edits only
    } catch (_) {}

    res.json({ success: true, daysSynced: ops.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/** GET /plan — assemble full daily schedule (incl. homework rows) from DB */
async function getPlan(req, res) {
  try {
    const docs = await DailyPlan.find({ userId: req.user.id }).sort({ week: 1, dayId: 1 });
    if (docs.length) {
      const rows = [];
      for (const doc of docs) {
        for (const r of doc.rows || []) {
          if (Array.isArray(r) && r.length) rows.push(r);
        }
      }
      if (rows.length) {
        return res.json({
          success: true,
          plan: { module: "daily", rows },
          source: "daily",
          dayCount: docs.length,
        });
      }
    }

    const base = await BasePlan.findOne({ userId: req.user.id }).lean();
    if (base?.plan?.rows?.length) {
      return res.json({
        success: true,
        plan: base.plan,
        source: "base",
        dayCount: null,
      });
    }

    return res.json({ success: true, plan: null, source: null });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// GET /status
async function getStatus(req, res) {
  try {
    const days = await DailyPlan.find({ userId: req.user.id })
      .select("dayId week dayName date locked completed")
      .sort({ week: 1, dayName: 1 });
    res.json({ success: true, days });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// POST /lock
async function lockDay(req, res) {
  try {
    const { dayId } = req.body;
    const updated = await DailyPlan.findOneAndUpdate(
      { userId: req.user.id, dayId },
      { locked: true, completed: true },
      { new: true }
    );
    if (!updated) return res.status(404).json({ success: false, error: "Day not found — sync plan first" });
    res.json({ success: true, day: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// POST /unlock
async function unlockDay(req, res) {
  try {
    const { dayId } = req.body;
    const updated = await DailyPlan.findOneAndUpdate(
      { userId: req.user.id, dayId },
      { locked: false },
      { new: true }
    );
    if (!updated) return res.status(404).json({ success: false, error: "Day not found" });
    res.json({ success: true, day: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// POST /regenerate
async function regenerateDay(req, res) {
  try {
    const { dayId, context: ctxIn = {}, rows: currentRows } = req.body;
    if (!dayId) return res.status(400).json({ success: false, error: "dayId is required" });

    let context = { ...ctxIn };

    let existing = await DailyPlan.findOne({ userId: req.user.id, dayId });

    // Auto-create if missing (so no separate sync is required)
    if (!existing) {
      const parsed = parseDayKey(dayId) || { week: 1, dayName: "Monday", date: null };
      existing = await DailyPlan.create({
        userId: req.user.id,
        dayId,
        week: parsed.week,
        dayName: parsed.dayName,
        date: parsed.date,
        rows: currentRows || [],
        locked: false,
        completed: false,
        doneRows: [],
      });
    }

    if (existing.locked) {
      return res.status(400).json({ success: false, error: "Day is locked (completed) – unlock first to regenerate" });
    }

    // Use the existing rows as the base for refinement
    const baseRows = existing.rows.length ? existing.rows : (currentRows || []);

    // If there are no rows at all, we cannot refine – fallback to a fresh generation?
    if (!baseRows.length) {
      return res.status(400).json({ success: false, error: "No rows to regenerate – please sync first" });
    }

    // Get feedback from context (or empty)
    const feedback = context.feedback || "";
    const fbLower = String(feedback).toLowerCase();
    const surface =
      /homework|tonight/.test(fbLower) ? "homework" : "daily";

    // Harvest LeetCode numbers already used across this user's daily plans
    // so single-day regen never reassigns them (Issue 3).
    try {
      const allDays = await DailyPlan.find({ userId: req.user.id }).select("rows dayId").lean();
      const usedLc = new Set();
      for (const d of allDays || []) {
        if (String(d.dayId) === String(dayId)) continue; // allow replacing today's pick
        for (const r of d.rows || []) {
          const content = Array.isArray(r)
            ? String(r[3] || "")
            : String(r?.content || "");
          const re = /LeetCode\s*#\s*(\d+)/gi;
          let m;
          while ((m = re.exec(content))) usedLc.add(String(m[1]));
        }
      }
      context = {
        ...context,
        feedback,
        userId: req.user?.id || req.user?._id || null,
        surface,
        inputs: {
          ...(context.inputs || {}),
          _planUsedLc: [...usedLc],
        },
      };
    } catch (e) {
      console.warn("Harvest used LC skipped:", e.message);
      context = {
        ...context,
        feedback,
        userId: req.user?.id || req.user?._id || null,
        surface,
      };
    }

    let newRows = await regenerateSingleDay(dayId, context);
    let testingReport = null;
    try {
      const { runPlanTestingEngine } = require("../utils/planTestingEngine");
      const tested = await runPlanTestingEngine(newRows, context.inputs || {});
      newRows = tested.rows;
      testingReport = tested.report;
    } catch (e) {
      console.warn("[regenerateDay] testing engine skipped:", e.message);
    }

    // Update the document
    const updated = await DailyPlan.findOneAndUpdate(
      { userId: req.user.id, dayId },
      { rows: newRows },
      { new: true }
    );

    try {
      const { audit } = require("../utils/auditLog");
      let memberName = String(
        req.body?.memberName || req.body?.name || context?.memberName || ""
      ).trim();
      let memberKey = String(req.body?.memberKey || "").trim();
      if (!memberName) {
        try {
          const PlanVersion = require("../models/PlanVersion");
          const latest = await PlanVersion.findOne({ userId: req.user.id })
            .sort({ version: -1 })
            .select("memberName memberKey")
            .lean();
          memberName = String(latest?.memberName || "").trim();
          if (!memberKey) memberKey = String(latest?.memberKey || "").trim();
        } catch (_) {}
      }
      if (!memberName) memberName = "Solo";
      if (!memberKey) {
        memberKey = memberName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") || "default";
      }
      audit(req, {
        entity: "daily",
        action: "daily.regenerate",
        summary: feedback
          ? `${memberName} · Day regenerated — ${dayId} — ${String(feedback).slice(0, 80)}`
          : `${memberName} · Day regenerated — ${dayId}`,
        meta: {
          dayId,
          surface,
          memberName,
          memberKey,
          changeType: "Day Regenerated",
          differenceSummary: `Regenerated day ${dayId}`,
          hasFeedback: Boolean(feedback && String(feedback).trim()),
          testingScore: testingReport?.score,
          linksRepaired: testingReport?.links?.replaced,
        },
      });
    } catch (_) {}

    res.json({ success: true, day: updated, testingReport });
  } catch (err) {
    console.error("Regeneration error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

// POST /toggle-row
async function toggleRow(req, res) {
  try {
    const { dayId, rowIndex, done } = req.body;
    if (!dayId || rowIndex === undefined)
      return res.status(400).json({ success: false, error: "dayId and rowIndex are required" });

    let existing = await DailyPlan.findOne({ userId: req.user.id, dayId });
    if (!existing) {
      const parsed = parseDayKey(dayId) || { week: 1, dayName: "Monday", date: null };
      existing = await DailyPlan.create({
        userId: req.user.id, dayId, week: parsed.week, dayName: parsed.dayName,
        date: parsed.date, rows: [], locked: false, completed: false, doneRows: [],
      });
    }

    const doneRows = new Set(existing.doneRows || []);
    if (done) doneRows.add(rowIndex); else doneRows.delete(rowIndex);

    const updated = await DailyPlan.findOneAndUpdate(
      { userId: req.user.id, dayId },
      { doneRows: Array.from(doneRows) },
      { new: true }
    );
    res.json({ success: true, doneRows: updated.doneRows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}
async function toggleSubTask(req, res) {
  try {
    const { dayId, rowIndex, subIndex, done } = req.body;
    if (!dayId || rowIndex === undefined || subIndex === undefined)
      return res.status(400).json({ success: false, error: "dayId, rowIndex and subIndex are required" });

    let existing = await DailyPlan.findOne({ userId: req.user.id, dayId });
    if (!existing) {
      const parsed = parseDayKey(dayId) || { week: 1, dayName: "Monday", date: null };
      existing = await DailyPlan.create({
        userId: req.user.id, dayId, week: parsed.week, dayName: parsed.dayName,
        date: parsed.date, rows: [], locked: false, completed: false, doneRows: [], subTaskDoneRows: [],
      });
    }

    const current = (existing.subTaskDoneRows || []).filter(
      s => !(s.rowIndex === rowIndex && s.subIndex === subIndex)
    );
    if (done) current.push({ rowIndex, subIndex });

    const updated = await DailyPlan.findOneAndUpdate(
      { userId: req.user.id, dayId },
      { subTaskDoneRows: current },
      { new: true }
    );

    // Return readiness pct for the week so the UI can update the indicator live
    const weekNum = existing.week || weekNumFromDayId(dayId);
    const readiness = weekNum ? await computeWeekReadiness(req.user.id, weekNum) : null;

    res.json({ success: true, subTaskDoneRows: updated.subTaskDoneRows, readiness });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}
async function getWeekReadiness(req, res) {
  try {
    const weekNum = parseInt(req.params.weekNum);
    if (isNaN(weekNum)) return res.status(400).json({ success: false, error: "Invalid weekNum" });
    const readiness = await computeWeekReadiness(req.user.id, weekNum);
    res.json({ success: true, weekNum, ...readiness });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}
async function buildAssessment(req, res) {
  try {
    const {
      weekNum,
      mode = "auto",
      facultyPortions = [],
      readinessThreshold = 70,
      facultyNote = "",
    } = req.body;

    if (!weekNum) return res.status(400).json({ success: false, error: "weekNum is required" });

    // Find or create the Friday doc for this week
    const fridayDayId = await (async () => {
      const docs = await DailyPlan.find({ userId: req.user.id, week: weekNum, dayName: "Friday" });
      return docs[0]?.dayId || `Week ${weekNum} - Friday`;
    })();

    let fridayDoc = await DailyPlan.findOne({ userId: req.user.id, dayId: fridayDayId });

    if (!fridayDoc) {
      fridayDoc = await DailyPlan.create({
        userId: req.user.id,
        dayId: fridayDayId,
        week: weekNum,
        dayName: "Friday",
        date: null,
        rows: [],
        locked: false,
        completed: false,
        doneRows: [],
        subTaskDoneRows: [],
      });
    }

    // Build the assessment
    const { rows, readiness, warningMessage } = await buildAssessmentRows(
      req.user.id, weekNum, mode, facultyPortions, fridayDoc
    );

    // Check readiness threshold for Case 3
    const isWarning = readiness.pct < readinessThreshold;

    // Persist the assessment config + rows into the Friday doc
    const assessmentConfig = {
      mode,
      facultyPortions,
      readinessThreshold,
      lastReadinessPct: readiness.pct,
      readinessWarningIssued: isWarning,
      assessmentRows: rows,
      weekNum,
      facultyNote,
      lastUpdatedAt: new Date(),
    };

    const updated = await DailyPlan.findOneAndUpdate(
      { userId: req.user.id, dayId: fridayDayId },
      { rows, assessmentConfig },
      { new: true, upsert: true }
    );

    // Non-blocking weekly sync
    syncWeeklyFromDaily(req.user.id, weekNum).catch(err =>
      console.error("[buildAssessment] weekly sync error:", err.message)
    );

    res.json({
      success: true,
      day: updated,
      readiness,
      warningMessage: isWarning ? (warningMessage || `⚠️ Only ${readiness.pct}% of tasks completed this week — consider narrowing the assessment scope.`) : null,
      mode,
    });
  } catch (err) {
    console.error("Assessment build error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}
// GET /done-rows/:dayId
async function getDoneRows(req, res) {
  try {
    const existing = await DailyPlan.findOne({ userId: req.user.id, dayId: req.params.dayId });
    const subTaskDoneRows = existing?.subTaskDoneRows || [];
    const subTaskKeys = subTaskDoneRows.map((s) => `${s.rowIndex}-${s.subIndex}`);
    res.json({
      success: true,
      doneRows: existing?.doneRows || [],
      subTaskDoneRows,
      subTaskKeys,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}
async function getAssessment(req, res) {
  try {
    const weekNum = parseInt(req.params.weekNum);
    if (isNaN(weekNum)) return res.status(400).json({ success: false, error: "Invalid weekNum" });

    const fridayDoc = await DailyPlan.findOne({ userId: req.user.id, week: weekNum, dayName: "Friday" });
    const readiness = await computeWeekReadiness(req.user.id, weekNum);

    res.json({
      success: true,
      weekNum,
      fridayDoc: fridayDoc || null,
      assessmentConfig: fridayDoc?.assessmentConfig || null,
      readiness,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = {
  syncPlan,
  getPlan,
  getStatus,
  lockDay,
  unlockDay,
  regenerateDay,
  toggleRow,
  getDoneRows,
  toggleSubTask,
  getWeekReadiness,
  buildAssessment,
  getAssessment,
};
