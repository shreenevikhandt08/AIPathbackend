/**
 * Rebuild each normal college day onto a continuous 08:45–04:30 skeleton.
 * Fixes LLM partial JSON (2–3 rows) that left time gaps and dropped Project Build.
 */

const { formatAgentWorkbenchTask } = require("../data/agentWorkbenchBanks");
const { ensureProjectPipeline, sanitizeLearningContent } = require("./connectivityEnforcer");
const { isNonCodeDtDay } = require("./dtPlaybookLookup");

function contentStr(c) {
  if (Array.isArray(c)) return c.filter((x) => typeof x === "string" && x.trim()).join("\n");
  return String(c || "");
}

function neatTitle(raw) {
  const a = String(raw || "").toLowerCase();
  if (/standup|stand[\s-]?up/.test(a)) return "Stand-Up";
  if (/lunch/.test(a)) return "Lunch";
  if (/refresh|game/.test(a)) return "Refresh Game";
  if (/placement/.test(a)) return "Placement Prep";
  if (/retro/.test(a)) return "Retrospective";
  if (/mini build|interest build|side build|peer review|capability|interests?|goals?|domain/.test(a)) {
    return "Mini Build";
  }
  if (/agent/.test(a)) return "Agent Workbench";
  if (/speak/.test(a)) return "Speak & Solve";
  if (/coding|dsa|leetcode/.test(a)) return "Coding Practice";
  if (/system design|framing|architecture/.test(a)) return "System Design";
  if (/project push/.test(a)) return "Project Push";
  if (/project|dt playbook|implement/.test(a)) return "Project Build";
  if (/learning|concept|subject/.test(a)) return "Learning";
  if (/homework|tonight/.test(a)) return "Tonight's Homework";
  if (/break/.test(a)) return "Break";
  return String(raw || "Activity").replace(/^[\s\p{Emoji_Presentation}\p{Extended_Pictographic}]+/gu, "").trim() || "Activity";
}

function timeSortKey(t) {
  try {
    return require("./dayTimeSlots").timeSortKey(t);
  } catch (_) {
    const m = String(t || "").match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!m) return 9999;
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const ap = (m[3] || "").toUpperCase();
    if (ap === "PM" && h < 12) h += 12;
    else if (ap === "AM" && h === 12) h = 0;
    else if (!ap && h >= 1 && h <= 7) h += 12;
    return h * 60 + min;
  }
}

function classify(activity) {
  const a = String(activity || "").toLowerCase();
  if (/holiday|vacation|study holiday/.test(a)) return "holiday";
  if (/exam|assessment|move to exam|pre-exam|post-exam/.test(a)) return "exam";
  if (/standup|stand[\s-]?up/.test(a)) return "standup";
  if (/lunch/.test(a)) return "lunch";
  if (/refresh|game/.test(a)) return "game";
  if (/short break|break|hydrate|stretch/.test(a) && !/lunch/.test(a)) return "break";
  if (/agent workbench|agent/.test(a)) return "agent";
  if (/placement/.test(a)) return "placement";
  if (/project push|micro-push/.test(a)) return "push";
  if (/peer review|peer knowledge|board update/.test(a)) return "peer";
  if (/capability|interests?|goals?|outcomes?|domain/.test(a)) return "profile";
  if (/retro|retrospective/.test(a)) return "retro";
  if (/homework|tonight/.test(a)) return "homework";
  if (/speak|3c|aptitude/.test(a)) return "speak";
  if (/coding practice|dsa|leetcode|problem solving/.test(a)) return "coding";
  if (/system design|integration|framing|architecture/.test(a)) return "sysdesign";
  if (/product speak/.test(a)) return "product";
  if (/dt playbook|project build|project work|implement|prototype|project/.test(a)) return "project";
  if (/learning|concept|subject|📚|📖/.test(a)) return "learning";
  return "other";
}

function isSpecialDay(rows) {
  return rows.some((r) => {
    const k = classify(r.activity);
    return k === "holiday" || k === "exam";
  });
}

function pickContent(bucket, fallback) {
  const text = contentStr(bucket);
  if (text.trim().length >= 40) return text.trim();
  return fallback;
}

function defaultProjectContent(theme, dtStep) {
  const row = ["", "", "Project Build", ""];
  const filled = ensureProjectPipeline(row, theme || {}, dtStep || null);
  return contentStr(filled[3]);
}

function defaultSysDesign(theme, nonCode, dayIdx = 0) {
  try {
    const { buildSystemDesignLesson } = require("./systemDesignLesson");
    return buildSystemDesignLesson(theme, null, { dayIdx, nonCode });
  } catch (_) {
    return (
      `▶ Main concept today: Basic System Shape (big picture)\n` +
      `▶ What it means\n` +
      `   - System design = planning the main parts of an app before deep coding.\n` +
      `▶ Main parts\n` +
      `   - User / Client\n` +
      `   - Logic / API\n` +
      `   - Data store\n` +
      `▶ Draw this\n` +
      `   - 3 boxes + arrows. Label each box in 3 words.\n` +
      (nonCode
        ? `▶ Do now: copy the subheadings into notes and fill 1 line under each.\n`
        : `▶ Do now: draw the sketch for YOUR project (boxes + arrows only).\n`) +
      `▶ Done when: you can say the main concept + each subheading in plain words (about 60 seconds).`
    );
  }
}

/**
 * Canonical continuous slots for a normal self-learning day.
 * Agent Workbench is always included (n8n-style) unless opts.includeAgent === false.
 */
function buildCanonicalDay(existingRows, opts = {}) {
  const theme = opts.theme || {};
  const dtStep = opts.dtStep || null;
  const nonCode = isNonCodeDtDay(dtStep);
  const includeAgent = opts.includeAgent !== false;
  const dayIdx = opts.dayIdx || 0;
  const agentNotes = opts.agentNotes || "";
  const hasCompany = Boolean(opts.hasCompany);
  const company = opts.company || "target company";

  const buckets = {};
  for (const r of existingRows || []) {
    const key = classify(r.activity);
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(contentStr(r.content));
  }
  const take = (key) => (buckets[key] || []).join("\n").trim();

  const agentContent = formatAgentWorkbenchTask(null, agentNotes, theme?.project || "", null, dayIdx);

  const learningTopic =
    (theme.subjects || []).map((s) => s.topic || s.name || s).filter(Boolean)[0] ||
    "today's concept";
  const learningA =
    pickContent(take("learning"), null) ||
    `▶ Concept: ${learningTopic}\n` +
    `▶ Why: You need this to move your project forward today.\n` +
    `▶ Outcome: You can explain it in simple words and give one example.\n` +
    `▶ Links:`;

  // Split learning content if two learning blocks existed
  const learningParts = (buckets.learning || []).filter(Boolean);
  const learning1 = sanitizeLearningContent(learningParts[0] || learningA);
  const learning2 = sanitizeLearningContent(
    learningParts[1] ||
      `▶ Concept: ${learningTopic}\n` +
        `▶ Why: So you can use it in Project Build this afternoon.\n` +
        `▶ Outcome: You can reuse one example in the project.`
  );

  const projectContent =
    pickContent(take("project"), null) || defaultProjectContent(theme, dtStep);

  const codingContent =
    pickContent(take("coding"), null) ||
    `▶ DSA: ${theme.dsa || "today's pattern"} — explain + 1 traced example.\n` +
    `▶ Coding Practice: 1 NEW problem on any language the team chose — log title + language.\n` +
    `▶ Link: where this pattern appears in today's project / DT Playbook step.`;

  // Prefer the student's Basics → Timing window when available
  let slotTimes = null;
  try {
    const { buildDaySlotMap } = require("./dayTimeSlots");
    const map = buildDaySlotMap(opts.inputs || {}, { includeAgent, problemFirst: false, includeGame: true });
    slotTimes = map.slots;
  } catch (_) {
    slotTimes = null;
  }
  const tt = (key, fallback) => (slotTimes && slotTimes[key]?.time) || fallback;
  const dow = Math.max(0, Number(dayIdx) || 0) % 5;
  // Placement Mon/Wed/Fri · Mini Build Tue/Thu (never both every afternoon)
  const wantPlacement = dow === 0 || dow === 2 || dow === 4;
  const wantMini = dow === 1 || dow === 3;

  const slots = [
    {
      time: tt("standup", "09:00 – 09:15 IST"),
      activity: "Stand-Up",
      content:
        pickContent(take("standup"), null) ||
        `▶ Write: DONE / TODAY / STUCK.\n` +
        (dtStep?.step ? `▶ DT Playbook Step today: ${dtStep.step}.\n` : "") +
        `▶ Focus: ${theme.project || "today's milestone"}.`,
    },
    {
      time: tt("learning1", "09:15 – 10:30 IST"),
      activity: "Learning",
      content: learning1,
    },
    {
      time: tt("break1", "10:30 – 10:45 IST"),
      activity: "Break",
      content: pickContent(take("break"), null) || `▶ Break\n▶ Rest only — no task.`,
    },
    {
      time: tt("mid", "10:45 – 11:30 IST"),
      activity: "Coding Practice",
      content: codingContent,
    },
    {
      time: tt("speak", "11:30 – 11:45 IST"),
      activity: "Speak & Solve",
      content:
        pickContent(take("speak"), null) ||
        `▶ Speak & Solve — only 2 items today:\n` +
        `▶ 1) Practice question: explain today's concept in ~1 minute.\n` +
        `▶ 2) Product of the Day: speak ~90 seconds, end with 1 lesson for your problem.`,
    },
    {
      time: tt("learning2", "11:45 – 12:30 IST"),
      activity: "Learning",
      content: learning2,
    },
    {
      time: tt("lunch", "12:30 – 13:15 IST"),
      activity: "Lunch",
      content: pickContent(take("lunch"), null) || `▶ Lunch\n▶ Rest only — no task.`,
    },
  ];

  if (wantPlacement) {
    slots.push({
      time: tt("placement", "1:15 PM – 1:30 PM IST"),
      activity: hasCompany || take("placement") ? "Placement Prep" : "Project Push",
      content:
        pickContent(take("placement"), null) ||
        pickContent(take("push"), null) ||
        (hasCompany
          ? `▶ Short placement action for ${company}: careers glance OR LinkedIn note OR STAR about TODAY's work.\n▶ Tracker: 1 cell. Stop.`
          : `▶ Push the next unfinished Project Build step only — no new task dump.`),
    });
  }

  slots.push(
    {
      time: tt("project", "1:30 PM – 2:45 PM IST"),
      activity: "Project Build",
      content: projectContent,
    },
    {
      time: tt("game", "2:45 PM – 2:55 PM IST"),
      activity: buckets.game?.length ? "Refresh Game" : "Break",
      content:
        pickContent(take("game"), null) ||
        pickContent(take("break"), null) ||
        `▶ Short refresh — stretch / hydrate only.`,
    }
  );

  if (includeAgent) {
    slots.push({
      time: tt("agent", "2:55 PM – 3:15 PM IST"),
      activity: "Agent Workbench",
      content: pickContent(take("agent"), null) || agentContent,
    });
    slots.push({
      time: tt("sysdesign", "3:15 PM – 3:45 PM IST"),
      activity: "System Design",
      content: pickContent(take("sysdesign"), null) || defaultSysDesign(theme, nonCode, dayIdx),
    });
  } else {
    slots.push({
      time: tt("sysdesign", "2:55 PM – 3:45 PM IST"),
      activity: "System Design",
      content: pickContent(take("sysdesign"), null) || defaultSysDesign(theme, nonCode, dayIdx),
    });
  }

  const endLabel = slotTimes?.retro?.time?.split("–")?.[1]?.replace(/\s*IST/, "").trim() || "18:00";

  if (wantMini) {
    slots.push({
      time: tt("profileFocus", "3:45 PM – 4:05 PM IST"),
      activity: "Mini Build",
      content:
        pickContent(take("profile"), null) ||
        pickContent(take("peer"), null) ||
        `▶ Mini Build\n` +
        `▶ Heading: Map your interest onto today's problem\n` +
        `▶ Build one tiny demo that links your interest to the Problem Statement.`,
    });
  }

  slots.push(
    {
      time: tt("retro", "4:05 PM – 4:30 PM IST"),
      activity: "Retrospective",
      content:
        pickContent(take("retro"), null) ||
        `▶ LEARNED / FINISHED / LINKED / TOMORROW (1 line each).\n` +
        `▶ Class day closes at ${endLabel} IST.`,
    },
    {
      time: "Tonight",
      activity: "Tonight's Homework",
      content:
        pickContent(take("homework"), null) ||
        `Tonight's Homework\n\n` +
        `LeetCode\n` +
        `#1 — Two Sum (Easy)\n` +
        `Pattern: Arrays & Hashing\n` +
        `Link: https://leetcode.com/problems/two-sum/\n` +
        `Task: Open the link, code your solution, run tests.\n` +
        `Done when: LeetCode shows Accepted for "Two Sum".\n\n` +
        `Agent Workbench\n` +
        `City Weather Note Agent (Easy)\n` +
        `Problem statement: Save city, temperature, and condition for one city.\n` +
        `Task: Open Agent Workbench, build this agent, run it once.\n` +
        `Done when: weather-day.txt shows city + temperature + condition.\n\n` +
        `Case study\n` +
        `For Tuesday Speak & Solve — review tonight\n` +
        `Case: Ford Motor Company: Supply Chain Strategy [Supply Chain]\n` +
        `Task: Read/skim the case. Write 3 insights.\n` +
        `Done when: 3 insights written and you can speak ~90 seconds.`,
    }
  );

  // Product Speak is never a separate slot (handled inside Speak & Solve upstream)

  return slots.map((s) => ({
    time: s.time,
    activity: neatTitle(s.activity),
    content: contentStr(s.content),
  }));
}

/**
 * Enforce continuous skeleton on object rows for one day.
 */
function enforceObjectDayContinuity(rows, opts = {}) {
  if (!Array.isArray(rows) || !rows.length) {
    return buildCanonicalDay([], opts);
  }
  if (isSpecialDay(rows)) {
    // Still sort exam/holiday content; don't force skeleton
    return [...rows].sort((a, b) => timeSortKey(a.time) - timeSortKey(b.time));
  }

  // If day already has ≥10 rows spanning morning→04:30 and has Project Build, only patch holes
  const hasProject = rows.some((r) => classify(r.activity) === "project");
  const startsOk = rows.some((r) => timeSortKey(r.time) <= timeSortKey("08:45 – 09:00 IST") + 5);
  const endsOk = rows.some((r) => /04:0[0-9]|04:3[0-9]/.test(String(r.time || "")));
  const thin = rows.length < 10 || !hasProject || !startsOk || !endsOk;

  if (thin) {
    return buildCanonicalDay(rows, opts);
  }

  // Dense day: still guarantee Project + Agent + continuous close via rebuild (merge content)
  return buildCanonicalDay(rows, opts);
}

/**
 * Array rows [dayKey, time, activity, content] → continuous days.
 */
function enforceArrayContinuity(allRows, optsFactory) {
  if (!Array.isArray(allRows) || !allRows.length) return allRows;

  const groups = [];
  let cur = null;
  for (const row of allRows) {
    if (!Array.isArray(row)) continue;
    const dayKey = row[0];
    if (!cur || cur.dayKey !== dayKey) {
      cur = { dayKey, rows: [] };
      groups.push(cur);
    }
    cur.rows.push({
      time: row[1],
      activity: row[2],
      content: contentStr(row[3]),
    });
  }

  const out = [];
  groups.forEach((g, dayIdx) => {
    const opts = typeof optsFactory === "function" ? optsFactory(g.dayKey, dayIdx, g.rows) : { ...(optsFactory || {}), dayIdx };
    const fixed = enforceObjectDayContinuity(g.rows, opts);
    fixed.forEach((r) => out.push([g.dayKey, r.time, r.activity, r.content]));
  });
  return out;
}

module.exports = {
  buildCanonicalDay,
  enforceObjectDayContinuity,
  enforceArrayContinuity,
  classify,
};
