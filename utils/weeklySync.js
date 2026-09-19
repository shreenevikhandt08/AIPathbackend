const DailyPlan  = require("../models/DailyPlan");
const WeeklyPlan = require("../models/WeeklyPlan");
const { callLLM } = require("./llm");

function weekNumFromDayId(dayId) {
  const m = String(dayId).match(/Week\s*(\d+)/i);
  return m ? parseInt(m[1]) : null;
}

function classifyWeekType(dayDocs) {
  let iaCount = 0, auCount = 0, mockCount = 0, normalCount = 0;
  for (const doc of dayDocs) {
    for (const row of (doc.rows || [])) {
      const activity = String(row[2] || "").toLowerCase();
      if (/internal assessment|📝.*internal/i.test(activity)) iaCount++;
      else if (/au.*exam|university exam/i.test(activity))    auCount++;
      else if (/mock.*exam/i.test(activity))                  mockCount++;
      else if (/learning|stand-up|project implementation/i.test(activity)) normalCount++;
    }
  }
  if (auCount > 0)   return "AU";
  if (mockCount > 0) return "MOCK";
  if (iaCount > 0)   return "IA";
  return "NORMAL";
}

// ── Extract project milestone text directly from daily rows ───────────────────
// Works for BOTH normal days and IA exam days (which also run a project session).
// IA day rows contain "💻 PROJECT IMPLEMENTATION SESSION" with the milestone
// already written in them — we just pull it instead of putting "N/A".
function extractProjectMilestoneFromRows(dayDocs) {
  const parts = [];
  for (const doc of dayDocs) {
    for (const row of (doc.rows || [])) {
      const activity = String(row[2] || "").toLowerCase();
      const content  = String(row[3] || "");
      // Match the project session rows by keyword — covers both normal and IA days
      if (
        /project implementation|project session|💻 project/i.test(activity) &&
        content.trim().length > 0
      ) {
        // Pull the milestone line — it usually follows "Milestone target:" or is the first line
        const milestoneMatch =
          content.match(/[Mm]ilestone[:\s]+([^\n]+)/) ||
          content.match(/[Pp]roject being built[:\s]+([^\n]+)/) ||
          content.match(/▶\s*([^\n]{20,})/);       // first bullet ≥ 20 chars
        if (milestoneMatch) {
          const snippet = milestoneMatch[1].trim().slice(0, 150);
          if (snippet && !parts.includes(snippet)) parts.push(snippet);
        }
      }
    }
  }
  if (parts.length === 0) return null;
  // Return first unique part; deduplicate same milestone repeated across days
  return [...new Set(parts)].slice(0, 2).join(" → ");
}

// ── Extract DSA topics from daily rows ───────────────────────────────────────
function extractDsaFromRows(dayDocs) {
  const parts = [];
  for (const doc of dayDocs) {
    for (const row of (doc.rows || [])) {
      const activity = String(row[2] || "");
      const content  = String(row[3] || "");
      if (/dsa|coding practice/i.test(activity)) {
        const m = content.match(/DSA[^:]*:\s*["']?([^"\n]{10,})/i) ||
                  content.match(/▶[^▶]{0,10}["']([^"'\n]{10,})/);
        if (m) parts.push(m[1].trim().slice(0, 80));
      }
    }
  }
  return [...new Set(parts)].slice(0, 3).join(" | ") || null;
}

// ── Extract exam focus from daily rows ───────────────────────────────────────
function extractExamFocusFromRows(dayDocs) {
  const parts = [];
  for (const doc of dayDocs) {
    for (const row of (doc.rows || [])) {
      const activity = String(row[2] || "");
      const content  = String(row[3] || "");
      // IA / AU exam rows — grab subject + topic
      if (/internal assessment|📝.*assessment|📝.*internal|au.*exam/i.test(activity)) {
        const subj = content.match(/Subject[:\s]+([^\n]{5,})/i);
        const topic = content.match(/Topics covered[:\s]+([^\n]{5,})/i) ||
                      content.match(/focus[:\s]+([^\n]{5,})/i);
        if (subj) parts.push(subj[1].trim().slice(0, 100));
        if (topic) parts.push(topic[1].trim().slice(0, 100));
      }
      // Past questions row
      if (/past question|syllabus check/i.test(activity)) {
        const bullets = content.match(/▶[^\n]{10,}/g) || [];
        bullets.slice(0, 3).forEach(b => parts.push(b.replace(/^▶\s*/, "").trim().slice(0, 80)));
      }
    }
  }
  return [...new Set(parts)].slice(0, 5).join("\n") || null;
}

// ── Flatten all rows for a week into a readable text block ────────────────────
function flattenWeekRows(dayDocs) {
  const lines = [];
  for (const doc of dayDocs) {
    lines.push(`=== ${doc.dayId} ===`);
    for (const row of (doc.rows || [])) {
      const time     = row[1] || "";
      const activity = row[2] || "";
      const content  = row[3] || "";
      if (/break|lunch/i.test(activity)) continue;
      lines.push(`[${time}] ${activity}: ${content.slice(0, 300)}`);
    }
  }
  return lines.join("\n");
}

// ── Build the LLM prompt that summarises a week's daily rows ─────────────────
function buildWeeklySummaryPrompt(weekNum, flatContent, existingWeeklyRow, weekType, directProjectMilestone, directDsa, directExamFocus) {
  const examWeekNote = weekType !== "NORMAL"
    ? `\n⚠️ THIS IS A ${weekType} EXAM WEEK. The daily data includes exam sessions AND project sessions.\n` +
      `For "Project Milestone": extract EXACTLY what the project session rows say was built — do NOT write "N/A".\n` +
      `For "Exam Focus": extract the subject name(s) and topic(s) from the exam rows.\n`
    : "";

  const directHints = [];
  if (directProjectMilestone) directHints.push(`DIRECT PROJECT MILESTONE EXTRACTED FROM ROWS: "${directProjectMilestone}"`);
  if (directDsa)               directHints.push(`DIRECT DSA EXTRACTED FROM ROWS: "${directDsa}"`);
  else                         directHints.push(`NO DSA / Coding Practice in daily rows this week — do not invent DSA.`);
  if (directExamFocus)         directHints.push(`DIRECT EXAM FOCUS EXTRACTED FROM ROWS: "${directExamFocus}"`);

  const hintBlock = directHints.length > 0
    ? `\nDIRECT EXTRACTIONS (use these — do NOT override with "N/A"):\n${directHints.join("\n")}\n`
    : "";

  const existingHint = existingWeeklyRow
    ? `\nExisting weekly row for reference (may be stale — IGNORE its content, use daily data above):\n${JSON.stringify(existingWeeklyRow)}`
    : "";

  return `You are an academic schedule summariser.

Below is the ACTUAL daily schedule content for Week ${weekNum} across all working days (Mon–Fri).
Your job is to produce ONE accurate summary row for the weekly plan table.
${examWeekNote}
DAILY DATA FOR WEEK ${weekNum}:
${flatContent}
${hintBlock}${existingHint}

RULES:
1. Read the daily data above — do NOT invent or guess anything not present in it.
2. Subjects Covered: list every subject name that actually appears, with the specific topic taught. Format each as a separate bullet line beginning with "▶ SubjectName: Topic".
3. Project Milestone: REQUIRED — summarise the project task/implementation from the project session rows as bullet points beginning with "▶". Even on IA/AU/Mock exam days, a project session exists — name what was built. NEVER write "N/A" here.
4. DSA / Coding Practice: ONLY if daily rows contain a "Coding Practice" or DSA activity. If none, do NOT mention DSA at all (do not invent it).
5. System Design: ONLY if daily rows contain a System Design activity. If none, omit it.
6. Exam Focus: list the IA/AU question patterns or exam-prep items as bullet points beginning with "▶". If it was an IA or AU exam week, say so prominently with subject and topic.
7. Week label: "Week ${weekNum}" (add "\\n(IA Week)" / "(Mock Week)" / "(AU Week)" only if the daily data clearly shows exam days).
8. Do NOT write paragraphs or prose blocks. Keep each field as short bullet-style content with line breaks.

Return ONLY valid JSON — no markdown, no explanation:
{
  "weekLabel": "Week ${weekNum}",
  "days": "Day X-Y",
  "subjectsCovered": "▶ SubjectName: Topic\\n▶ SubjectName: Topic",
  "projectMilestone": "▶ Concrete summary of what was built",
  "examFocus": "▶ Exam prep item 1\\n▶ Exam prep item 2"
}`;
}

// ── Main export: called after any day-level change ────────────────────────────
async function syncWeeklyFromDaily(userId, weekNum) {
  try {
    const dayDocs = await DailyPlan.find({ userId, week: weekNum }).sort({ dayName: 1 });
    if (!dayDocs.length) {
      console.warn(`[weeklySync] No daily docs found for user=${userId} week=${weekNum}`);
      return null;
    }

    const flatContent = flattenWeekRows(dayDocs);
    if (!flatContent.trim()) return null;

    // ── Pre-extract facts directly from rows — avoids LLM hallucinating "N/A" ──
    const weekType              = classifyWeekType(dayDocs);
    const directProjectMilestone = extractProjectMilestoneFromRows(dayDocs);
    const directDsa              = extractDsaFromRows(dayDocs);
    const directExamFocus        = weekType !== "NORMAL" ? extractExamFocusFromRows(dayDocs) : null;

    let weeklyDoc = await WeeklyPlan.findOne({ userId, module: "weekly" });
    const existingRows = weeklyDoc?.rows || [];
    const existingWeekRow = existingRows.find(r =>
      String(r[0]).match(new RegExp(`^Week\\s*${weekNum}\\b`, "i"))
    );

    const prompt = buildWeeklySummaryPrompt(
      weekNum, flatContent, existingWeekRow,
      weekType, directProjectMilestone, directDsa, directExamFocus
    );
    const result = await callLLM(prompt, 800);

    if (!result || !result.subjectsCovered) {
      console.warn("[weeklySync] LLM returned unusable summary:", result);
      return null;
    }

    // ── Guard: if LLM still wrote "N/A" for projectMilestone, inject the direct value ──
    let projectMilestone = result.projectMilestone || "";
    if (!projectMilestone.trim() || /^n\/a$/i.test(projectMilestone.trim())) {
      projectMilestone = directProjectMilestone || existingWeekRow?.[3] || "Project session completed — see daily plan for details";
    }

    // ── Guard: same for examFocus on exam weeks ──
    let examFocus = result.examFocus || "";
    if (weekType !== "NORMAL" && (!examFocus.trim() || /^n\/a$/i.test(examFocus.trim()))) {
      examFocus = directExamFocus || existingWeekRow?.[4] || `${weekType} Exam Week — see daily plan for subject details`;
    }

    const newRow = [
      result.weekLabel       || `Week ${weekNum}`,
      result.days            || "",
      result.subjectsCovered || "",
      projectMilestone,
      examFocus,
    ];

    let updatedRows;
    const matchIdx = existingRows.findIndex(r =>
      String(r[0]).match(new RegExp(`^Week\\s*${weekNum}\\b`, "i"))
    );
    if (matchIdx !== -1) {
      updatedRows = existingRows.map((r, i) => (i === matchIdx ? newRow : r));
    } else {
      updatedRows = [...existingRows];
      const insertAt = updatedRows.findIndex(r => {
        const m = String(r[0]).match(/Week\s*(\d+)/i);
        return m && parseInt(m[1]) > weekNum;
      });
      if (insertAt === -1) updatedRows.push(newRow);
      else updatedRows.splice(insertAt, 0, newRow);
    }

    weeklyDoc = await WeeklyPlan.findOneAndUpdate(
      { userId, module: "weekly" },
      {
        $set: {
          userId,
          module: "weekly",
          title: weeklyDoc?.title || "Weekly Plan",
          columns: weeklyDoc?.columns || ["Week", "Days", "Subjects Covered", "Project Milestone", "Exam Focus"],
          rows: updatedRows,
          source: "daily-sync",
          lastSyncedAt: new Date(),
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    console.log(`[weeklySync] Week ${weekNum} (${weekType}) row updated — milestone: "${projectMilestone.slice(0, 60)}"`);
    return weeklyDoc;
  } catch (err) {
    console.error("[weeklySync] Failed:", err.message);
    return null;
  }
}

// ── Rebuild ALL weekly rows from daily data ───────────────────────────────────
async function rebuildWeeklyFromAllDaily(userId, existingWeeklyPlan) {
  try {
    const allDayDocs = await DailyPlan.find({ userId }).sort({ week: 1, dayName: 1 });
    if (!allDayDocs.length) return null;

    const weekNums = [...new Set(allDayDocs.map(d => d.week))].sort((a, b) => a - b);
    const existingRows = existingWeeklyPlan?.rows || [];
    const newRows = [];

    for (const weekNum of weekNums) {
      const weekDocs = allDayDocs.filter(d => d.week === weekNum);
      const flatContent = flattenWeekRows(weekDocs);
      if (!flatContent.trim()) continue;

      const weekType               = classifyWeekType(weekDocs);
      const directProjectMilestone = extractProjectMilestoneFromRows(weekDocs);
      const directDsa              = extractDsaFromRows(weekDocs);
      const directExamFocus        = weekType !== "NORMAL" ? extractExamFocusFromRows(weekDocs) : null;

      const existingWeekRow = existingRows.find(r =>
        String(r[0]).match(new RegExp(`^Week\\s*${weekNum}\\b`, "i"))
      );

      try {
        const prompt = buildWeeklySummaryPrompt(
          weekNum, flatContent, existingWeekRow,
          weekType, directProjectMilestone, directDsa, directExamFocus
        );
        const result = await callLLM(prompt, 800);

        if (result?.subjectsCovered) {
          let projectMilestone = result.projectMilestone || "";
          if (!projectMilestone.trim() || /^n\/a$/i.test(projectMilestone.trim())) {
            projectMilestone = directProjectMilestone || existingWeekRow?.[3] || "Project session completed — see daily plan";
          }
          let examFocus = result.examFocus || "";
          if (weekType !== "NORMAL" && (!examFocus.trim() || /^n\/a$/i.test(examFocus.trim()))) {
            examFocus = directExamFocus || existingWeekRow?.[4] || `${weekType} Exam Week`;
          }
          newRows.push([
            result.weekLabel || `Week ${weekNum}`,
            result.days      || existingWeekRow?.[1] || "",
            result.subjectsCovered || "",
            projectMilestone,
            examFocus,
          ]);
        } else {
          if (existingWeekRow) newRows.push(existingWeekRow);
        }
      } catch (e) {
        console.error(`[weeklySync] Week ${weekNum} summary failed:`, e.message);
        if (existingWeekRow) newRows.push(existingWeekRow);
      }
    }

    if (!newRows.length) return null;

    const updatedDoc = await WeeklyPlan.findOneAndUpdate(
      { userId, module: "weekly" },
      {
        $set: {
          userId,
          module: "weekly",
          title: existingWeeklyPlan?.title || "Weekly Plan",
          columns: existingWeeklyPlan?.columns || ["Week", "Days", "Subjects Covered", "Project Milestone", "Exam Focus"],
          rows: newRows,
          source: "daily-sync",
          lastSyncedAt: new Date(),
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    return updatedDoc;
  } catch (err) {
    console.error("[weeklySync] rebuildWeeklyFromAllDaily failed:", err.message);
    return null;
  }
}

module.exports = { syncWeeklyFromDaily, rebuildWeeklyFromAllDaily, weekNumFromDayId };