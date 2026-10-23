const { DT_PLAYBOOK } = require("./dtPlaybookStructure");

/** Frontend DT_STAGES.key → playbook stage (+ optional first step name) */
const UI_STAGE_MAP = {
  empathize: { stage: "Empathize & Define", fromStep: "Problem Identification" },
  define:    { stage: "Empathize & Define", fromStep: "Focus" },
  // "ideate" key kept for saved plans; UI label is now "Plan"
  ideate:    { stage: "Plan",              fromStep: null },
  plan:      { stage: "Plan",              fromStep: null },
  prototype: { stage: "Prototype",         fromStep: null },
  // "test" key kept for saved plans; UI label is now "Evaluate"
  test:      { stage: "Evaluate",          fromStep: null },
  evaluate:  { stage: "Evaluate",          fromStep: null },
  // "implement" key kept for saved plans; UI label is now "Pitch & BMC"
  implement: { stage: "Pitch & BMC",       fromStep: null },
  pitch:     { stage: "Pitch & BMC",       fromStep: null },
};

function isEmpathyDefineStage(dtStep) {
  return Boolean(dtStep && String(dtStep.stage || "").includes("Empathize"));
}

function isPitchBmcStage(dtStep) {
  return Boolean(dtStep && String(dtStep.stage || "").includes("Pitch"));
}

function isEvaluateStage(dtStep) {
  return Boolean(dtStep && String(dtStep.stage || "").includes("Evaluate"));
}

/** True when Project Build must be research/docs — not subject-code implementation */
function isNonCodeDtDay(dtStep) {
  return isEmpathyDefineStage(dtStep) || isPitchBmcStage(dtStep);
}

function flattenPlaybookSteps() {
  const flat = [];
  for (const week of DT_PLAYBOOK) {
    for (const step of week.steps) {
      flat.push({
        weekNumber: week.week,
        stage: week.stage,
        stageGoal: week.goal,
        ...step,
      });
    }
  }
  return flat;
}

/**
 * Absolute working-day index (1-based) where a UI stage begins in the playbook.
 * Falls back to day 1 if unknown.
 */
function getWorkingDayOffsetForStage(activeStageKey) {
  const map = UI_STAGE_MAP[String(activeStageKey || "").toLowerCase()];
  if (!map) return 1;
  const flat = flattenPlaybookSteps();
  let idx = flat.findIndex((s) => s.stage === map.stage);
  if (idx === -1) return 1;
  if (map.fromStep) {
    const mid = flat.findIndex(
      (s) => s.stage === map.stage && String(s.step).toLowerCase().includes(String(map.fromStep).toLowerCase())
    );
    if (mid !== -1) idx = mid;
  }
  return idx + 1; // 1-based
}

/**
 * Resolve a step by absolute program day number (1-indexed working days).
 */
function getStepByWorkingDayIndex(workingDayIndex) {
  const flat = flattenPlaybookSteps();
  if (workingDayIndex < 1 || workingDayIndex > flat.length) return null;
  return flat[workingDayIndex - 1];
}

function resolveStageOverride(globalDayIndex0Based, activeStageKey, productPlanOrInputs) {
  const planDay = Number(globalDayIndex0Based || 0) + 1;
  let plan = productPlanOrInputs;
  let fallback = activeStageKey;
  if (plan && typeof plan === "object" && !Array.isArray(plan)) {
    if (!fallback) fallback = plan._activeDTStage || plan.activeDTStage;
    plan = plan._productStagePlan || plan.productStagePlan || null;
  }
  let rows = plan;
  if (typeof rows === "string") {
    try {
      rows = JSON.parse(rows);
    } catch {
      rows = [];
    }
  }
  if (!Array.isArray(rows) || !rows.length) {
    return { stageKey: fallback, into: Number(globalDayIndex0Based || 0), goal: "", hit: null };
  }
  const hit = rows.find((r) => {
    const from = Math.max(1, Number(r.fromDay) || 1);
    const to = Math.max(from, Number(r.toDay) || from);
    const key = String(r.stageKey || r.stage || "").toLowerCase();
    return key && planDay >= from && planDay <= to;
  });
  if (!hit) {
    return { stageKey: fallback, into: Number(globalDayIndex0Based || 0), goal: "", hit: null };
  }
  const from = Math.max(1, Number(hit.fromDay) || 1);
  return {
    stageKey: String(hit.stageKey || hit.stage || fallback).toLowerCase(),
    into: Math.max(0, planDay - from),
    goal: String(hit.goal || hit.note || "").trim(),
    hit,
  };
}

/**
 * Parse _dtPlaybookMap — per-day Stage/Step overrides from the FE.
 * Shapes supported:
 *   [{ day: 1, stage, step, whatToLearn, realProjectTask, discussionPrompt, ... }]
 *   { "1": { stage, step, ... }, "2": { ... } }
 *   { days: [ ... ] }
 * Never ignore this for a generic empathize-only plan when present.
 */
function parseDtPlaybookMap(inputs = {}) {
  const raw =
    inputs?._dtPlaybookMap ??
    inputs?.dtPlaybookMap ??
    null;
  if (raw == null || raw === "") return null;
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;

  const byDay = {};
  const push = (dayNum, row) => {
    const d = Math.max(1, Number(dayNum) || 0);
    if (!d || !row || typeof row !== "object") return;
    byDay[String(d)] = row;
  };

  if (Array.isArray(parsed)) {
    parsed.forEach((row, i) => {
      const day =
        row.day ??
        row.dayIndex ??
        row.planDay ??
        row.dayNumber ??
        row.n ??
        i + 1;
      push(day, row);
    });
  } else if (Array.isArray(parsed.days)) {
    parsed.days.forEach((row, i) => {
      const day = row?.day ?? row?.dayIndex ?? row?.planDay ?? i + 1;
      push(day, row);
    });
  } else {
    Object.entries(parsed).forEach(([k, row]) => {
      if (k === "days" || k === "meta") return;
      if (/^\d+$/.test(String(k))) push(k, row);
    });
  }

  return Object.keys(byDay).length ? byDay : null;
}

function stepFromMapRow(row, globalDayIndex0Based, fallbackStep = null) {
  if (!row || typeof row !== "object") return null;
  const stage =
    String(row.stage || row.stageName || row.dtStage || "").trim() ||
    (fallbackStep && fallbackStep.stage) ||
    "";
  const stepName =
    String(row.step || row.stepName || row.title || "").trim() ||
    (fallbackStep && fallbackStep.step) ||
    "";
  if (!stage && !stepName && !fallbackStep) return null;

  // If only a stageKey is provided, resolve via playbook offset for that stage
  const stageKey = String(row.stageKey || row.stage_key || "").trim().toLowerCase();
  if (stageKey && !stepName) {
    const offset = getWorkingDayOffsetForStage(stageKey);
    const into = Math.max(0, Number(row.intoDay ?? row.dayInStage ?? 0));
    const fromMap = getStepByWorkingDayIndex(offset + into);
    if (fromMap) {
      return {
        ...fromMap,
        planDayNumber: Number(globalDayIndex0Based || 0) + 1,
        playbookWorkingDay: offset + into,
        activeStageKey: stageKey,
        stageOffset: offset,
        productGoal: String(row.goal || row.note || "").trim(),
        fromDtPlaybookMap: true,
        whatToLearn: String(row.whatToLearn || fromMap.whatToLearn || "").trim(),
        realProjectTask: String(row.realProjectTask || fromMap.realProjectTask || "").trim(),
        discussionPrompt: String(row.discussionPrompt || fromMap.discussionPrompt || "").trim(),
      };
    }
  }

  let base = fallbackStep || {};
  if (stepName) {
    const named = flattenPlaybookSteps().find(
      (s) => String(s.step).toLowerCase() === stepName.toLowerCase()
    );
    if (named && named.step !== base.step) base = { ...base, ...named };
  }
  return {
    ...base,
    weekNumber: Number(row.weekNumber || row.week || base.weekNumber) || base.weekNumber || 1,
    stage: stage || base.stage || "Build",
    stageGoal: String(row.stageGoal || row.goal || base.stageGoal || "").trim(),
    step: stepName || base.step || "Applied build",
    whatToLearn: String(row.whatToLearn || row.learn || base.whatToLearn || "").trim(),
    realProjectTask: String(
      row.realProjectTask || row.task || base.realProjectTask || ""
    ).trim(),
    discussionPrompt: String(
      row.discussionPrompt || row.discussion || base.discussionPrompt || ""
    ).trim(),
    dsaConcept: row.dsaConcept != null ? row.dsaConcept : base.dsaConcept,
    page: row.page != null ? row.page : base.page,
    planDayNumber: Number(globalDayIndex0Based || 0) + 1,
    playbookWorkingDay: Number(row.playbookWorkingDay || base.playbookWorkingDay) || null,
    activeStageKey: stageKey || base.activeStageKey || null,
    productGoal: String(row.goal || row.note || base.productGoal || "").trim(),
    fromDtPlaybookMap: true,
  };
}

/**
 * Resolve DT step for a plan day.
 * Priority: _dtPlaybookMap (per day) → _productStagePlan / stage block → playbook walk.
 */
function getStepForPlanDay(globalDayIndex0Based, activeStageKey, productPlanOrInputs) {
  const inputs =
    productPlanOrInputs && typeof productPlanOrInputs === "object"
      ? productPlanOrInputs
      : {};
  const planDay = Number(globalDayIndex0Based || 0) + 1;

  // 1) Explicit per-day map wins — do not fall back to empathize-only generic
  const map = parseDtPlaybookMap(inputs);
  if (map) {
    const row = map[String(planDay)] || map[String(globalDayIndex0Based)] || null;
    if (row) {
      // Use playbook walk as soft fallback for missing fields only
      const override = resolveStageOverride(globalDayIndex0Based, activeStageKey, inputs);
      const offset = getWorkingDayOffsetForStage(override.stageKey || activeStageKey);
      const workingDayIndex = offset + Number(override.into || 0);
      const fallback = getStepByWorkingDayIndex(workingDayIndex);
      const fromMap = stepFromMapRow(row, globalDayIndex0Based, fallback);
      if (fromMap) return fromMap;
    }
  }

  // 2) Existing product-stage plan / active stage walk
  const override = resolveStageOverride(globalDayIndex0Based, activeStageKey, inputs);
  const offset = getWorkingDayOffsetForStage(override.stageKey);
  const workingDayIndex = offset + Number(override.into || 0);
  const step = getStepByWorkingDayIndex(workingDayIndex);
  if (!step) return null;

  // Attach productStageBlock text as stageGoal hint when present and goal empty
  let productGoal = override.goal || "";
  if (!productGoal && inputs._productStageBlock) {
    const block = String(inputs._productStageBlock || "").trim();
    if (block) productGoal = block.slice(0, 240);
  }

  return {
    ...step,
    planDayNumber: planDay,
    playbookWorkingDay: workingDayIndex,
    activeStageKey: override.stageKey || null,
    stageOffset: offset,
    productGoal,
  };
}

function getStepByWeekAndDay(weekNumber, dayOfWeek) {
  const week = DT_PLAYBOOK.find((w) => w.week === weekNumber);
  if (!week) return null;
  const step = week.steps.find((s) => s.day === dayOfWeek);
  if (!step) return null;
  return { weekNumber: week.week, stage: week.stage, stageGoal: week.goal, ...step };
}

function buildDailyPrompt({ studentName, problemStatement, workingDayIndex }) {
  const resolved = getStepByWorkingDayIndex(workingDayIndex);

  if (!resolved) {
    return {
      error: true,
      message: `No DT Playbook step exists for working day ${workingDayIndex}. Program has ${flattenPlaybookSteps().length} defined steps total.`,
    };
  }

  const isEmpathyStage = resolved.stage === "Empathize & Define";
  const dsaLine =
    resolved.dsaConcept === "NA"
      ? "Do NOT include a DSA topic today. This stage has no algorithmic fit — say so explicitly if asked."
      : `DSA concept to connect today: ${resolved.dsaConcept}. Tie it to today's task, don't teach it in isolation.`;

  const discussionInstruction = isEmpathyStage
    ? `This is an EMPATHY-stage day. Do not let the student fill a template mechanically. ` +
      `Open with the discussion question below and require the student to answer it in their own words ` +
      `BEFORE giving them the task. Discussion question: "${resolved.discussionPrompt}"`
    : `This is a ${resolved.stage} stage day — build on the discussion/insight already captured in Week 1, don't re-litigate the problem.`;

  const prompt = `
You are generating Day ${workingDayIndex} of the SNS DT Playbook plan for ${studentName}.

CONTEXT (do not deviate from this — it is the only valid stage for today):
- Week ${resolved.weekNumber}: ${resolved.stage}
- Stage goal: ${resolved.stageGoal}
- Today's step: "${resolved.step}"
${resolved.page != null ? `- DT Playbook page: ${resolved.page} — students must TAKE AND FILL / ANSWER the questions on this exact page (same jargon as the playbook — do not invent a parallel task)` : ""}
- Student's Problem Statement: ${problemStatement}

WHAT TO LEARN TODAY (exact playbook jargon — use this wording):
${resolved.whatToLearn}

REAL PROJECT TASK (exact playbook jargon — fill this on the DT Playbook page):
${resolved.realProjectTask}

DISCUSSION PROMPT (exact playbook question — answer on the DT Playbook page):
${resolved.discussionPrompt || "(none for this step)"}

${discussionInstruction}

${dsaLine}

OUTPUT RULES:
- Only output content for THIS step. Never mention or preview later DT Playbook stages.
- Never invent a DT Playbook step that isn't listed above.
- Use exact playbook jargon: Stage, Step, What to Learn, Real Project Task, Discussion Prompt, Problem Statement, DT Playbook page.
- Tell students: "DT Playbook page N — take and fill this / answer the questions" using the EXACT questions above (do not rephrase into a different homework).
- Never say "hardcopy". Never print Year/Semester labels like "Level: Year 4 · Semester 7" in student-facing text.
- Ground every instruction in the student's actual Problem Statement text — reference it directly, don't stay generic.
- A student reading this should know exactly: which DT Playbook page to fill, what to learn, what to write today, and (if applicable) how it connects to DSA.
`.trim();

  return { error: false, resolved, prompt };
}

/**
 * Short page pointer only (prefer formatPlaybookFillLines so exact questions appear).
 */
function formatPlaybookPageRef(dtStep) {
  if (!dtStep?.step) return null;
  const page = dtStep.page != null ? Number(dtStep.page) : null;
  const pageBit =
    page && Number.isFinite(page)
      ? `DT Playbook page ${page}`
      : "DT Playbook page";
  return `▶ ${pageBit} — "${dtStep.step}"${dtStep.stage ? ` · ${dtStep.stage}` : ""}`;
}

/**
 * Full block: page + exact DT Playbook questions (same wording as the book).
 */
function formatPlaybookFillLines(dtStep) {
  if (!dtStep?.step) return [];
  const { getExactPlaybookQuestions } = require("./dtPlaybookStructure");
  const page = dtStep.page != null ? Number(dtStep.page) : null;
  const pageBit =
    page && Number.isFinite(page)
      ? `DT Playbook page ${page}`
      : "DT Playbook page";
  const what = String(dtStep.whatToLearn || "").trim();
  const discuss = String(dtStep.discussionPrompt || "").trim();
  const task = String(dtStep.realProjectTask || "").trim();
  const questions = getExactPlaybookQuestions(dtStep);

  const lines = [
    `▶ ${pageBit} — "${dtStep.step}"${dtStep.stage ? ` · ${dtStep.stage}` : ""}`,
    `▶ Answer these exact DT Playbook questions (write the same answers in your DT Playbook — do not invent different ones):`,
  ];
  questions.forEach((q, i) => {
    lines.push(`▶ Q${i + 1}) ${q}`);
  });
  if (what) lines.push(`▶ What to Learn: ${what}`);
  if (discuss && !questions.includes(discuss)) {
    lines.push(`▶ Discussion Prompt: ${discuss}`);
  }
  if (task && !questions.includes(task)) {
    lines.push(`▶ Real Project Task: ${task}`);
  }
  return lines.filter(Boolean);
}

module.exports = {
  getStepByWorkingDayIndex,
  getStepByWeekAndDay,
  getStepForPlanDay,
  getWorkingDayOffsetForStage,
  flattenPlaybookSteps,
  parseDtPlaybookMap,
  stepFromMapRow,
  UI_STAGE_MAP,
  buildDailyPrompt,
  formatPlaybookPageRef,
  formatPlaybookFillLines,
  isEmpathyDefineStage,
  isPitchBmcStage,
  isEvaluateStage,
  isNonCodeDtDay,
};
