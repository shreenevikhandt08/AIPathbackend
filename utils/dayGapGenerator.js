/**
 * Gap-driven daily content — beginner-plain English.
 *
 * Order: read YOUR uploaded problem → learn one small topic → apply it
 * (notes first on Empathy days; code after basics + tech stack).
 */

const { callLLM } = require("./llm");
const {
  isNonCodeDtDay,
  isEmpathyDefineStage,
} = require("./dtPlaybookLookup");
const {
  formatAgentWorkbenchTask,
} = require("../data/agentWorkbenchBanks");
const { pickForDay, parseAssessmentConfig } = require("./assessmentPicker");
const {
  resolveAcademicProfile,
  academicPickSeed,
  filterLeetCodeForProfile,
  rotateCaseBank,
  formatFourLearnerOverlay,
} = require("./academicLevel");
const {
  isTechStackSuggestStep,
  needsTechStackConfirm,
  formatTechStackSuggestions,
  formatTechStackConfirm,
  suggestTechStack,
} = require("./techStackGuide");
const { buildSystemDesignLesson } = require("./systemDesignLesson");
const { formatFullPlacement, formatLightPlacement } = require("./placementDayTracks");
const { buildDaySlotMap, resolveDayWindow, timeSortKey } = require("./dayTimeSlots");
const {
  buildLearningLinkLines,
  skillTypeLabel,
  ebookHintsFromUploads,
} = require("./learningResources");
const { leetcodeUrl } = require("./leetcodeUrl");

function clip(text, n = 900) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function cleanProblem(raw) {
  return String(raw || "")
    .replace(/^\s*\[[^\]]+\]\s*/g, "") // strip [filename.txt]
    .replace(/\s+/g, " ")
    .trim();
}

function getProblemText(inputs, theme) {
  const raw =
    inputs?.problem ||
    inputs?.problemStatement ||
    theme?.project ||
    theme?.projectTask ||
    "";
  return cleanProblem(raw) || "the uploaded problem";
}

function subjectLine(theme) {
  return (theme?.subjects || [])
    .slice(0, 4)
    .map((s) => `${s.name}: ${s.topic || s.name}`)
    .join(" | ");
}

function isTechStackStep(dtStep) {
  return isTechStackSuggestStep(dtStep);
}

function isBasicsFirstDay(dtStep) {
  if (!isEmpathyDefineStage(dtStep)) return false;
  if (isTechStackStep(dtStep)) return false; // suggestions day — still research/notes
  const step = String(dtStep?.step || "");
  if (/Empathy Map|Process Flow|Pitch Among Peers/i.test(step)) return false;
  const day = Number(dtStep?.day || 0);
  return day > 0 ? day <= 5 : /Problem Identification|Similar Products|My Ideas|Audience|Focus/i.test(step);
}

/** Short friendly topic name — never paste a long playbook essay into the UI */
function shortLearnLabel(dtStep, gapTopic, subject = null) {
  // Uploaded syllabus subject must appear in Learning (weekly already shows it)
  if (subject?.name) {
    const topic = String(subject.topic || gapTopic || "fundamentals").trim();
    const label = `${subject.name}: ${topic}`;
    return label.length > 72 ? `${label.slice(0, 72)}…` : label;
  }
  if (dtStep?.step) return String(dtStep.step);
  const t = String(gapTopic || "Today's topic").trim();
  return t.length > 48 ? `${t.slice(0, 48)}…` : t;
}

/** True when student pasted/uploaded a real problem statement. */
function hasProblemUpload(inputs = {}) {
  const p = String(inputs.problem || inputs.problemStatement || "").trim();
  return p.length >= 40;
}

/** True when student uploaded syllabus / ebook / notes text. */
function hasAnyDocUpload(inputs = {}) {
  try {
    const { hasUploadedEbook } = require("./learningResources");
    return hasUploadedEbook(inputs) || hasProblemUpload(inputs);
  } catch {
    return hasProblemUpload(inputs);
  }
}

function problemNoun(inputs = {}) {
  return hasProblemUpload(inputs) ? "your uploaded problem" : "your project problem (write it in plain words if you have not pasted it yet)";
}
function softClip(text, n = 500) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (t.length <= n) return t;
  const sentence = (t.match(/^[^.!?]+[.!?]/) || [])[0];
  if (sentence && sentence.length >= 24 && sentence.length <= Math.max(n, Math.floor(n * 1.2))) {
    return sentence.trim();
  }
  const slice = t.slice(0, n);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = (lastSpace > Math.min(40, Math.floor(n * 0.4)) ? slice.slice(0, lastSpace) : slice)
    .trim()
    .replace(/[.,;:]+$/g, "");
  // Complete words only — never "pe…" / mid-cut stubs
  return cut || t.slice(0, Math.min(n, t.length));
}

/** One shared “tie this activity to the product” line for every slot. */
function projectConnectLine(problemQuote = "", how = "") {
  const p = softClip(problemQuote || "your project problem", 90);
  const h = softClip(how || "use today's idea as one decision or feature for this product", 120);
  return `▶ Connect to your product: "${p}" → ${h}`;
}

/** Subjects scheduled for this day (prefer day slice, else theme). */
function pickDaySubjects(daySlice, theme, max = 3) {
  const raw =
    (Array.isArray(daySlice?.allSubjects) && daySlice.allSubjects.length
      ? daySlice.allSubjects
      : theme?.subjects) || [];
  const out = [];
  const seen = new Set();
  for (const s of raw) {
    if (!s) continue;
    const key = String(s.name || s.code || "").toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    // Skip dedicated module tracks — Learning weaves college subjects + skills
    if (s.isDsaTrack || s.isSdTrack) continue;
    if (/^dsa$/i.test(key) || /^system design$/i.test(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= max) break;
  }
  // If everything was DSA/SD, still show primary so Learning is not empty
  if (!out.length && (daySlice?.primarySubject || theme?.subjects?.[0])) {
    out.push(daySlice?.primarySubject || theme.subjects[0]);
  }
  return out;
}

function subjectTopicLine(s) {
  if (!s) return "today's concept";
  const name = String(s.name || "Subject").trim();
  const topic = String(s.topic || s.unit || "fundamentals").trim();
  return `${name}: ${topic}`;
}

/** Must-learn concept hints from subject preferences (if any). */
function mustConceptsForSubject(s, inputs = {}) {
  const prefsRaw = inputs?._subjectPreferences || inputs?.subjectPreferences;
  let prefs = [];
  if (Array.isArray(prefsRaw)) prefs = prefsRaw;
  else if (typeof prefsRaw === "string") {
    try {
      prefs = JSON.parse(prefsRaw);
    } catch {
      prefs = [];
    }
  }
  if (!Array.isArray(prefs) || !prefs.length) return [];
  const name = String(s?.name || "").toLowerCase().trim();
  const code = String(s?.code || "").toLowerCase().trim();
  const hit = prefs.find(
    (p) =>
      String(p?.name || "").toLowerCase().trim() === name ||
      (code && String(p?.code || "").toLowerCase().trim() === code)
  );
  const needs =
    hit?.mustLearnConcepts ||
    hit?.mustLearn ||
    hit?.conceptsMust ||
    hit?.focusConcepts ||
    [];
  return (Array.isArray(needs) ? needs : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 3);
}

function omitConceptsForSubject(s, inputs = {}) {
  const prefsRaw = inputs?._subjectPreferences || inputs?.subjectPreferences;
  let prefs = [];
  if (Array.isArray(prefsRaw)) prefs = prefsRaw;
  else if (typeof prefsRaw === "string") {
    try {
      prefs = JSON.parse(prefsRaw);
    } catch {
      prefs = [];
    }
  }
  if (!Array.isArray(prefs) || !prefs.length) return [];
  const name = String(s?.name || "").toLowerCase().trim();
  const code = String(s?.code || "").toLowerCase().trim();
  const hit = prefs.find(
    (p) =>
      String(p?.name || "").toLowerCase().trim() === name ||
      (code && String(p?.code || "").toLowerCase().trim() === code)
  );
  const omit = hit?.omitConcepts || hit?.omit || [];
  return (Array.isArray(omit) ? omit : []).map((x) => String(x).trim()).filter(Boolean);
}

function subjectSkillLens(name = "") {
  const t = String(name).toLowerCase();
  if (/math|mathematics|algebra|calculus|stat|probability|quant|discrete|numerical/i.test(t)) {
    return "math";
  }
  if (/english|communica|soft skill|presentation|language|business english|verbal/i.test(t)) {
    return "communication";
  }
  if (/logic|reason|aptitude|analytic|critical think/i.test(t)) {
    return "logic";
  }
  if (/physics|chem|circuit|electron|signal/i.test(t)) {
    return "science";
  }
  return "domain";
}

/**
 * Learning slot: four short lines only — concept, why, outcome, links.
 * No practice essays, headings, or repeated meta.
 */
function buildMultiPurposeLearning({
  learnLabel,
  daySlice,
  theme,
  gap,
  inputs,
  problemQuote,
  dayIdx = 0,
  absDay = 0,
  deepen = false,
  whyStudy = "",
  link = "",
  learnLinkLines = [],
  paceLine = "",
}) {
  const subjects = pickDaySubjects(daySlice, theme, 2);
  const primary = subjects[0] || daySlice?.primarySubject || null;
  const secondary = subjects[1] || null;
  const problem = softClip(problemQuote || "your project", 70);
  const topic = softClip(learnLabel || primary?.topic || "today's concept", 55);

  const omitA = omitConceptsForSubject(primary, inputs).map((x) => x.toLowerCase());
  const mustA = mustConceptsForSubject(primary, inputs).filter(
    (c) => !omitA.some((o) => c.toLowerCase().includes(o) || o.includes(c.toLowerCase()))
  );
  const topicSafe = omitA.some((o) => String(primary?.topic || topic).toLowerCase().includes(o))
    ? (mustA[0] || "today's included concept")
    : (primary?.topic || gap?.subtopics?.[0] || topic);
  const conceptA = mustA[0] || softClip(topicSafe, 55);
  const conceptB =
    mustConceptsForSubject(secondary, inputs)[0] ||
    softClip(secondary?.topic || gap?.subtopics?.[1] || "", 45);

  const concept =
    deepen
      ? topic
      : secondary && conceptB
        ? `${conceptA} + ${conceptB}`
        : conceptA;

  const why = softClip(
    String(
      whyStudy ||
        (link
          ? `You need this so you can take the next step on "${problem}".`
          : `You need this to move "${problem}" forward today.`)
    ).replace(/^Why study this today:\s*/i, ""),
    140
  );

  const outcome = deepen
    ? `You can use "${topic}" in Project Build with one example of your own.`
    : `You can explain "${conceptA}" in simple words and show how it helps "${problem}".`;
  void dayIdx;

  const links = (Array.isArray(learnLinkLines) ? learnLinkLines : [])
    .map((l) => String(l || "").trim())
    .filter((l) => l && !/helpful links|how to watch/i.test(l))
    .slice(0, 2);

  void absDay;

  let fourPaths = "";
  try {
    fourPaths = formatFourLearnerOverlay(resolveAcademicProfile(inputs));
  } catch (_) {
    fourPaths = "";
  }

  const subLine = secondary
    ? `▶ Subjects woven: ${subjectTopicLine(primary)} · ${subjectTopicLine(secondary)}`
    : primary
      ? `▶ Subject: ${subjectTopicLine(primary)}`
      : null;
  const integ = `▶ Integration: concept + logic (1 example) + speak (explain out loud) + apply to "${problem}".`;

  return bullets([
    `▶ Concept: ${softClip(concept, 90)}`,
    subLine,
    `▶ Why: ${why}`,
    `▶ Outcome: ${outcome}`,
    integ,
    String(paceLine || "").trim() || null,
    fourPaths || null,
    links.length ? `▶ Links:` : null,
    ...links,
  ]);
}

/** Short PRD / SAD note by DT stage — docs without a long lecture. */
function docsHintForDtStep(dtStep) {
  const stage = String(dtStep?.stage || "").toLowerCase();
  if (/empathize|define/.test(stage)) {
    return "Docs: update PRD (problem, users, needs). SAD not yet.";
  }
  if (/plan/.test(stage)) {
    return "Docs: update PRD (features) and start SAD (modules + data flow).";
  }
  if (/prototype/.test(stage)) {
    return "Docs: update SAD (components, APIs, data) and keep PRD in sync.";
  }
  if (/evaluate/.test(stage)) {
    return "Docs: log test results in SAD; note what was proven in PRD.";
  }
  if (/pitch/.test(stage)) {
    return "Docs: polish PRD (value) and a 1-page SAD summary for the pitch.";
  }
  return "Docs: update PRD today; add SAD when architecture starts.";
}

function techDoForProject({ dtStep, learnLabel, problemQuote, task, nonCode, isOverviewDay }) {
  const step = dtStep?.step || learnLabel || "today's step";
  const stage = String(dtStep?.stage || "").toLowerCase();
  if (task) return task;
  if (/empathize|define/.test(stage) || nonCode || isOverviewDay) {
    return `Write/update PRD: who has the pain, what fails, and what better looks like for "${softClip(problemQuote, 50)}".`;
  }
  if (/plan/.test(stage)) {
    return `In PRD list 3 features; in SAD draw boxes + arrows for how "${softClip(learnLabel, 40)}" fits.`;
  }
  if (/prototype/.test(stage)) {
    return `Build one small module using "${softClip(learnLabel, 40)}" and note it in SAD.`;
  }
  if (/evaluate/.test(stage)) {
    return `Test one flow; write pass/fail + 1 fix in SAD.`;
  }
  if (/pitch/.test(stage)) {
    return `Write a 1-page PRD + SAD snapshot: problem, solution, architecture.`;
  }
  return `Apply "${step}" as one small technical change and record it in PRD/SAD.`;
}
function playbookPageLine(dtStep) {
  const { formatPlaybookPageRef } = require("./dtPlaybookLookup");
  return formatPlaybookPageRef(dtStep);
}

/** Exact playbook questions + page — fill once in DT Playbook (no parallel task). */
function playbookFillLines(dtStep) {
  const { formatPlaybookFillLines } = require("./dtPlaybookLookup");
  return formatPlaybookFillLines(dtStep);
}

/** Team mode only when 2+ named members are saved. Solo must never get team wording. */
function isTeamMode(inputs = {}) {
  if (inputs._isTeam === true || inputs._isTeam === "true" || inputs._isTeam === 1) return true;
  if (inputs._isTeam === false || inputs._isTeam === "false" || inputs._isTeam === 0) return false;
  try {
    const raw = inputs._teamMembers ?? inputs.teamMembers;
    const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(arr)) {
      return arr.filter((m) => m && String(m.name || "").trim()).length >= 2;
    }
  } catch (_) {}
  return false;
}

/**
 * Short, complete problem text for students.
 * Prefer one full sentence. Never leave a mid-cut like "…Traditional compliance meth…"
 */
function studentProblemGlance(text, max = 220, inputs = null) {
  let t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) {
    if (inputs && !hasProblemUpload(inputs)) {
      return "Write your problem in 2–3 plain sentences (who hurts, what breaks, what better looks like).";
    }
    return "Open your problem statement and read today's piece.";
  }
  t = t.replace(/^(in short:\s*)+/i, "").trim();

  const sentences = t.match(/[^.!?]+[.!?]+/g);
  if (sentences && sentences.length) {
    let out = sentences[0].trim();
    if (out.length <= Math.max(max, 280)) return out;
    return "In short: the problem is hard to manage with today's tools, and a better system is needed.";
  }

  if (t.length <= max) return t;
  return inputs && !hasProblemUpload(inputs)
    ? "In short: write the problem in your own words before you continue."
    : "In short: open your problem statement and write today's piece in your own words.";
}

/**
 * Complete finish plan (never a half sentence).
 * Returns { lines: string[] } for Learning / after-lunch reminders.
 */
function beginnerFinishPlan(dtStep, problemFull, gap, inputs = {}) {
  const step = String(dtStep?.step || "");
  const hasUp = hasProblemUpload(inputs);
  const quote = studentProblemGlance(
    problemFull || (hasUp ? "your problem" : ""),
    140,
    inputs
  );

  let lines;
  if (/Problem Identification/i.test(step)) {
    lines = [
      hasUp
        ? `Rewrite the uploaded problem in your own words (5–8 clear lines).`
        : `Write your problem in your own words (5–8 clear lines) — who hurts, what breaks, what better looks like.`,
      `List 3 assumptions. Mark each one: Known fact OR Guess to check later.`,
      `Save the file as notes/day-problem-rewrite.md`,
      hasUp
        ? `Done when: you can explain the problem in 60 seconds without reading the whole upload.`
        : `Done when: you can explain the problem in 60 seconds from your own notes.`,
    ];
  } else if (/Similar Products/i.test(step)) {
    lines = [
      `Find 2 real apps/tools that try to solve a similar pain.`,
      `For each app write: what it does well + what it misses for YOUR case.`,
      `Save as notes/day-similar-products.md`,
      `Done when: both apps are named and compared in your notes.`,
    ];
  } else if (/My Ideas/i.test(step)) {
    lines = [
      `Write 8 one-line ideas that could help (do not judge yet).`,
      `Star your favourite 2 ideas.`,
      `Save as notes/day-ideas.md`,
      `Done when: 8 ideas are written and 2 are starred.`,
    ];
  } else if (/Audience/i.test(step)) {
    lines = [
      `Describe ONE main user: name, job/role, and daily frustration.`,
      `Write what they do today instead of a good solution.`,
      `Save as notes/day-audience.md`,
      `Done when: a classmate can picture that user from your notes.`,
    ];
  } else if (/Focus/i.test(step)) {
    lines = [
      `Write one focus sentence: "[User] needs a way to [need] because [insight]".`,
      `Check it with "so what?" three times; rewrite if weak.`,
      `Save as notes/day-focus.md`,
      `Done when: the focus sentence fits in one line and feels specific.`,
    ];
  } else if (/Tech Stack/i.test(step)) {
    lines = [
      `Write 2–3 possible stacks (language + UI + storage) as SUGGESTIONS only.`,
      `Mark which one looks best for beginners on THIS project and why.`,
      `Save as notes/tech-stack-ideas.md (not a final lock).`,
      `Done when: ideas file exists — final confirm happens on the first coding day.`,
    ];
  } else if (/Process Flow/i.test(step)) {
    lines = [
      `Mode: ROUGH PAPER / SKETCH (not code). Draw 5–8 boxes for the journey the user follows TODAY.`,
      `Mark the exact step where things break or waste time.`,
      `Save as notes/day-process-flow.md (or a clear photo of the sketch).`,
      `Done when: the break step is clearly marked.`,
    ];
  } else if (/Empathy Map/i.test(step)) {
    lines = [
      `Mode: ROUGH PAPER / SKETCH or notes table — not an app. Fill Says / Thinks / Does / Feels.`,
      `Add 1 contradiction (Says vs Does) if you see one.`,
      `Save as notes/day-empathy-map.md`,
      `Done when: all 4 boxes have at least 2 bullets each.`,
    ];
  } else if (/Pitch Among Peers/i.test(step)) {
    lines = [
      `Prepare a 3-minute talk: problem → user → focus → tech suggestions (not final).`,
      `Present to a peer. Write down 2 questions they ask.`,
      `Save questions in notes/day-pitch-feedback.md`,
      `Done when: you presented once and logged 2 questions.`,
    ];
  } else if (gap?.implementGoal && !/assigned Problem Statement|Capture the artifact|playbook/i.test(gap.implementGoal)) {
    lines = [
      String(gap.implementGoal),
      `Save your work under the notes/ or project folder.`,
      `Done when: you can show the result to a classmate.`,
    ];
  } else {
    lines = [
      hasUp
        ? `Finish today's small notes or sketch for the problem you uploaded.`
        : `Finish today's small notes or sketch for your project problem.`,
      `Save your work with a clear file name.`,
      `Done when: you can show it to a classmate in 1 minute.`,
    ];
  }

  return {
    lines,
    block: bullets([
      `▶ Complete finish checklist:`,
      ...lines.map((l, i) => `▶ ${i + 1}) ${l}`),
      `▶ Problem you are working on: "${quote}"`,
    ]),
    shortLabel: lines[0],
  };
}

/** Back-compat single string for older callers */
function beginnerFinishGoal(dtStep, problemShort, gap) {
  return beginnerFinishPlan(dtStep, problemShort, gap).shortLabel;
}

function beginnerSteps(dtStep, problemShort, learnLabel, team = false) {
  const p = problemShort;
  const step = String(dtStep?.step || "");
  const checkStep = team
    ? `Step 4 (10 min) — Read your notes to a teammate. Ask: "Does this make sense?"`
    : `Step 4 (10 min) — Read your notes out loud (or record yourself). Fix anything unclear.`;
  const shareStep = team
    ? `Step 4 (5 min) — Show a teammate your notes; note 1 suggestion.`
    : `Step 4 (5 min) — Re-read your notes once. Fix 1 unclear line.`;

  if (/Problem Identification/i.test(step)) {
    return [
      `Step 1 — Keep your uploaded problem on screen. Highlight who / what / where.`,
      `Step 2 — In a notes file, rewrite the problem in your own words (5–8 clear lines) about: "${p}"`,
      `Step 3 — List 3 assumptions. Mark each Known fact or Guess.`,
      checkStep,
      `Step 5 — Save the file as notes/day-problem-rewrite.md`,
    ];
  }
  if (/Tech Stack/i.test(step)) {
    return [
      `Step 1 — Re-read your problem and focus notes.`,
      `Step 2 — List 2–3 stack options (language + UI + storage).`,
      `Step 3 — Mark the suggested best fit for beginners on this problem (not locked).`,
      `Step 4 — Write why you like it + one risk if you pick something else.`,
      `Step 5 — Save notes/tech-stack-ideas.md`,
    ];
  }
  if (isNonCodeDtDay(dtStep) || isBasicsFirstDay(dtStep)) {
    return [
      `Step 1 — Re-read today's piece of the problem: "${p}"`,
      `Step 2 — Do today's task for "${step || learnLabel}" (write in a notes file — not a full app yet).`,
      `Step 3 — Write your answers clearly in the notes file (use headings).`,
      shareStep,
      `Step 5 — Save the notes file in a folder named notes/`,
    ];
  }
  return [
    `Step 1 — Create or open one file for today's small piece of: "${p}"`,
    `Step 2 — Use what you learned ("${learnLabel}") in that file.`,
    `Step 3 — Run it once with a simple input. Fix 1 error.`,
    `Step 4 — Write 2 lines in README: what works now.`,
  ];
}

function buildGapPrompt({ dayName, dayKey, theme, inputs, globalDayIndex, daySlice, dtStep }) {
  const problem = clip(getProblemText(inputs, theme), 1200);
  const nonCode = isNonCodeDtDay(dtStep);
  const basics = isBasicsFirstDay(dtStep);
  const techDay = isTechStackStep(dtStep);
  const sub1 = daySlice?.primarySubject || theme.subjects?.[0] || { name: "Programming", topic: "fundamentals" };
  const dsa = daySlice?.dsaSubtopic || theme.dsa || "arrays";
  const window = resolveDayWindow(inputs || {});
  const team = isTeamMode(inputs || {});
  const { buildAcademicPromptBlock } = require("./academicLevel");
  const { block: academicBlock, profile: academic } = buildAcademicPromptBlock(inputs || {});
  const uploadClip = clip(
    [
      inputs?.dsaSyllabus,
      inputs?.systemDesign,
      inputs?.syllabus,
      inputs?.instructions,
    ]
      .filter(Boolean)
      .join("\n"),
    900
  );
  const hasEbook = Boolean(uploadClip && uploadClip.length >= 40);
  const lessonsBlock = String(inputs?._engineLessonsBlock || "").trim();

  const dtExact = dtStep?.stage && dtStep?.step
    ? `DT Playbook Stage "${dtStep.stage}" · Step "${dtStep.step}" (use these EXACT names — do not rename them)`
    : "Applied build day (no DT step rename)";

  const modeBlock = team
    ? `MODE FLAG: TEAM (2+ named members). Team standup / peer check allowed. Never invent extra people.\n` +
      `- Stand-Up heading may be "Team standup" or "Team check-in".\n`
    : `MODE FLAG: SOLO (one student). HARD RULES — no exceptions:\n` +
      `- Stand-Up MUST be personal only ("Personal standup" / "Personal check-in" / "Day 1 personal kickoff").\n` +
      `- FORBIDDEN words: team, teammates, classmate, peer review, "Team check-in", "Team standup", "each person", board update for a group.\n` +
      `- Write for ONE student only ("you / your"). Never invent a team meet.\n`;

  const langByYear =
    academic.collegeYear <= 1
      ? `- Short, clear English a Year-1 student can understand. Extra scaffolding OK.\n`
      : academic.collegeYear >= 4
        ? `- Clear English for a final-year student — not baby talk, not PhD jargon.\n`
        : `- Clear college English matched to Year ${academic.collegeYear}.\n`;

  const codeMode =
    academic.stream === "arts"
      ? `MODE: MOSTLY NOTES — prefer research/UX/writing; code only if department truly needs it, and keep tiny.\n`
      : techDay
        ? `MODE: TECH STACK SUGGESTIONS — explore options for the problem; recommend a best fit, but do NOT lock final stack.\n`
        : basics
          ? `MODE: BASICS — understanding + notes only — not a full product.\n`
          : nonCode
            ? `MODE: NOTES — documents/drawings only.\n`
            : academic.depth <= 1
              ? `MODE: LIGHT CODE/NOTES — tiny practice using today's learnTopic (Year-1 friendly).\n`
              : `MODE: CODE — confirm stack in notes/tech-stack.md; small working code using today's learnTopic on the problem (depth=${academic.depth}/4).\n`;

  return (
    `Plan ONE college day calibrated to the student's Year / Semester / Stream.\n` +
    (lessonsBlock ? `${lessonsBlock}\n` : "") +
    `LANGUAGE RULES (mandatory):\n` +
    langByYear +
    `- Complete sentences only. Never cut a sentence mid-word or mid-thought.\n` +
    `- If the uploaded problem is long, rewrite a SHORT plain summary (max 25 words) — do not paste a long unfinished quote.\n` +
    `- ONE learnTopic only for the whole day (can weave 2–3 college subjects into that same topic — multi-skill: concept + logic + speak + math). Do NOT dump many unrelated concepts.\n` +
    `- subtopics: at most 2 small parts of that SAME integrated topic (not separate subject silos).\n` +
    `- Learning slots stay short: Concept (what) + Why (one sentence) + Outcome (one sentence) + Links. No long paragraphs or practice essays.\n` +
    `- No jargon (never say: artifact, pipeline, playbook task, DT lens, BUILD HOOK).\n` +
    `- DT Playbook questions ONLY in Problem Lab. Other slots reference the step by name only.\n` +
    `- Never invent URLs; use verified links or Search: <query>.\n` +
    `- Never reuse a LeetCode number already used in this plan.\n` +
    modeBlock +
    academicBlock +
    `Day: ${dayName} | ${dayKey} | Week ${theme.week} | globalDayIndex=${globalDayIndex}\n` +
    `STUDENT TIMING (must match their Basics input): day runs ${window.startLabel}–${window.endLabel} IST (${window.spanLabel}). ` +
    `Do not invent a different college timetable.\n\n` +
    `CRITICAL UNIQUENESS: This day's learnTopic, problemSlice, workedExample, checkQuestion, implementGoal, steps, and codingProblems MUST be DIFFERENT from other days. Do not recycle the same example, same LeetCode pair, or same finish goal. Use globalDayIndex=${globalDayIndex} to pick a fresh angle on the uploaded problem.\n\n` +
    `UPLOADED PROBLEM (use for meaning; rewrite short for students):\n"""${problem}"""\n\n` +
    `Subjects available: ${subjectLine(theme) || "Programming basics"}\n` +
    `DSA hint (optional): ${academic.stream === "arts" || academic.depth <= 1 ? "NA or very light pattern warm-up only" : dsa}\n` +
    `${dtExact}\n` +
    (hasEbook
      ? `\nUPLOADED SYLLABUS / NOTES (use to pick Year/Sem-appropriate topics):\n"""${uploadClip}"""\n`
      : `\nEBOOK RULE: The student did NOT upload an ebook/notes file. ebookHint MUST be "" (empty). Do not invent pages or books.\n`) +
    `\nCONNECTIVITY CHAIN (must hold for this day):\n` +
    `1) problemSlice = a SHORT complete sentence (max 25 words) about ONE piece of the problem — never a truncated long paste.\n` +
    `2) knowledgeGap = what THIS Year/Sem student must learn NEXT (1 short sentence).\n` +
    `3) learnTopic = the ONE topic that fills that gap (max 6 words) — aligned to syllabus when uploaded.\n` +
    `4) linkToProblem = one sentence: how today's learning helps the problem.\n` +
    `5) implementGoal + steps = APPLY that same learnTopic at the correct depth (see ACADEMIC LEVEL). Do NOT invent a different unrelated project.\n` +
    `\nOrder: (1) review problem slice (2) learn the one topic (3) apply it.\n` +
    codeMode +
    `\nReturn ONLY JSON:\n` +
    `{\n` +
    `  "problemSlice": "short complete sentence (max 25 words) about one piece of the problem",\n` +
    `  "knowledgeGap": "what this Year/Sem student does not know yet (1 sentence)",\n` +
    `  "learnTopic": "ONE topic name (max 6 words)",\n` +
    `  "learnSubject": "${techDay ? "Design basics" : sub1.name}",\n` +
    `  "subtopics": ["part1", "part2"],\n` +
    `  "workedExample": "one small example using the problem domain at Year ${academic.collegeYear} level",\n` +
    `  "checkQuestion": "one check question at Year ${academic.collegeYear} difficulty",\n` +
    `  "linkToProblem": "how today's learning helps the problem (1 sentence)",\n` +
    `  "learnLinks": ["https://…", "https://www.youtube.com/watch?v=…"],\n` +
    `  "ebookHint": ${hasEbook ? `"page tip from the upload only"` : `""`},\n` +
    `  "dsaLink": "why coding practice helps today OR NA",\n` +
    `  "codingProblems": ["LeetCode #N — Name (Easy)", "Alternate"],\n` +
    `  "implementGoal": "what file/notes finishes today USING learnTopic (depth-matched)",\n` +
    `  "steps": ["Step 1 …", "Step 2 …", "Step 3 …", "Step 4 …"],\n` +
    `  "doneWhen": "how this Year/Sem student knows they finished"\n` +
    `}\n` +
    `Forbidden phrases: "assigned Problem Statement", "capture the artifact", "pipeline", "DT lens", "BUILD HOOK", "team check-in"${team ? "" : `, "teammate", "classmate", "peer"`}.`
  );
}

function techStackSuggestGap(theme, dtStep, globalDayIndex, problemFull, team = false) {
  const p = studentProblemGlance(problemFull || theme.project || "your uploaded problem", 140);
  const rec = suggestTechStack(problemFull, theme).recommended;
  return {
    problemSlice: `Choose beginner-friendly tools for this problem.`,
    knowledgeGap: "You have ideas but have not compared tool options for this problem yet.",
    learnTopic: "Tech Stack Suggestions",
    learnSubject: "Design basics",
    subtopics: ["language options", "best-fit suggestion"],
    workedExample: `Suggested best fit: ${rec.language} + ${rec.ui} — ${rec.why}`,
    checkQuestion: team
      ? "Which option can your team finish in 2 weeks without getting stuck?"
      : "Which option can you finish in 2 weeks without getting stuck?",
    linkToProblem: `Stack ideas now — final confirm when coding starts — for: "${p}"`,
    dsaLink: "NA — tools discussion day",
    codingProblems: ["LeetCode #1 — Two Sum (Easy)", "LeetCode #217 — Contains Duplicate (Easy)"],
    implementGoal: `Write notes/tech-stack-ideas.md with 2–3 options + suggested best fit (not locked)`,
    steps: beginnerSteps(dtStep, p, "Tech Stack Suggestions", team),
    doneWhen: "tech-stack-ideas.md exists; final lock happens on first coding day",
    _fallback: true,
    _dayIndex: globalDayIndex,
  };
}

function fallbackGap(theme, daySlice, dtStep, globalDayIndex, problemFull, team = false) {
  if (isTechStackStep(dtStep)) return techStackSuggestGap(theme, dtStep, globalDayIndex, problemFull, team);

  const sub = daySlice?.primarySubject || theme.subjects?.[0] || { name: "Programming", topic: "basics" };
  const p = studentProblemGlance(problemFull || theme.project || "your uploaded problem", 140);
  const basics = isBasicsFirstDay(dtStep);
  const nonCode = isNonCodeDtDay(dtStep);
  const learnTopic = shortLearnLabel(
    basics || nonCode ? dtStep : null,
    basics ? dtStep?.step : sub.topic || sub.name,
    basics || nonCode ? null : sub
  );
  const i = Math.max(0, Number(globalDayIndex) || 0);

  return {
    problemSlice: `Today's focus: ${p}`,
    knowledgeGap: basics
      ? "You cannot explain the problem clearly in your own words yet."
      : `You do not know enough about ${learnTopic} yet to take the next step.`,
    learnTopic,
    learnSubject: basics || nonCode ? "Design basics" : String(sub.name),
    subtopics: basics
      ? ["who has the problem", "what goes wrong"]
      : ["simple meaning", "one example"],
    workedExample: `Use one real example from your problem (names, places, or data) — not a random textbook example.`,
    checkQuestion: basics
      ? "Can you explain the problem in 60 seconds?"
      : `Where would "${learnTopic}" show up while solving your problem?`,
    linkToProblem: `Today's learning helps you take one clear step on your problem.`,
    dsaLink: basics || nonCode ? "NA — main work is understanding/notes" : String(theme.dsa || "practice pattern"),
    // Filled from RAG at pick time — do not invent LeetCode numbers here
    codingProblems: [],
    implementGoal: beginnerFinishGoal(dtStep, p, null),
    steps: beginnerSteps(dtStep, p, learnTopic, team),
    doneWhen: basics || nonCode
      ? "Notes file saved; you can explain today's piece in 60 seconds"
      : "Small code runs once with one test input",
    _fallback: true,
    _dayIndex: globalDayIndex,
  };
}

function applyPlaybookOverrides(gap, theme, daySlice, dtStep, globalDayIndex, problemFull, team = false) {
  const problem = problemFull || getProblemText({}, theme);
  // Suggestions day — soft content, never a forced lock
  if (isTechStackStep(dtStep)) {
    return {
      ...techStackSuggestGap(theme, dtStep, globalDayIndex, problem, team),
      ...gap,
      learnTopic: "Tech Stack Suggestions",
      subtopics: Array.isArray(gap.subtopics) ? gap.subtopics.slice(0, 2) : ["language options", "best-fit suggestion"],
      implementGoal:
        gap.implementGoal && !/tech-stack\.md(?!-ideas)/i.test(gap.implementGoal)
          ? gap.implementGoal
          : `Write notes/tech-stack-ideas.md with suggestions (confirm later when coding starts)`,
      _fallback: gap._fallback,
    };
  }

  const merged = { ...fallbackGap(theme, daySlice, dtStep, globalDayIndex, problem, team), ...gap };
  const p = studentProblemGlance(problem, 140);
  const sub = daySlice?.primarySubject || theme?.subjects?.[0] || null;
  if (Array.isArray(merged.subtopics)) merged.subtopics = merged.subtopics.slice(0, 2);
  merged.problemSlice = studentProblemGlance(merged.problemSlice || p, 140);

  // Always prefer short step names over long essays
  if (dtStep?.step && (isNonCodeDtDay(dtStep) || isBasicsFirstDay(dtStep))) {
    merged.learnTopic = shortLearnLabel(dtStep, merged.learnTopic, null);
    merged.learnSubject = "Design basics";
    merged.implementGoal = beginnerFinishGoal(dtStep, p, merged);
    merged.steps = beginnerSteps(dtStep, p, merged.learnTopic, team);
    merged.linkToProblem =
      merged.linkToProblem ||
      `This step helps you understand your problem.`;
    merged.dsaLink = "NA — main work is understanding/notes (coding is only a short warm-up)";
    if (!merged.problemSlice || /Advance "|Understand who/i.test(merged.problemSlice)) {
      merged.problemSlice = `Today's focus: ${p}`;
    }
  } else {
    merged.learnTopic = shortLearnLabel(null, merged.learnTopic, sub);
    if (sub?.name) merged.learnSubject = String(sub.name);
    merged.implementGoal = beginnerFinishGoal(dtStep, p, merged);
    if (!merged.linkToProblem) {
      merged.linkToProblem = `Use "${merged.learnTopic}" to move one step forward on: "${p}"`;
    }
  }
  return merged;
}

async function generateDayGapContent({
  dayName,
  dayKey,
  theme,
  inputs,
  globalDayIndex,
  daySlice,
  dtStep,
}) {
  // Every NEW day generation must carry engine lessons (past refine feedback)
  try {
    if (!String(inputs?._engineLessonsBlock || "").trim()) {
      const { attachEngineLessons } = require("./engineLessons");
      await attachEngineLessons(inputs || {}, "daily");
    }
  } catch (e) {
    console.warn("Engine lessons ensure-on-gap skipped:", e.message);
  }

  const problemFull = getProblemText(inputs, theme);
  const team = isTeamMode(inputs || {});

  let gap;
  if (isTechStackStep(dtStep)) {
    gap = applyPlaybookOverrides({}, theme, daySlice, dtStep, globalDayIndex, problemFull, team);
  } else {
    const prompt = buildGapPrompt({
      dayName,
      dayKey,
      theme,
      inputs,
      globalDayIndex,
      daySlice,
      dtStep,
    });
    try {
      const result = await callLLM(prompt, 900);
      if (result && result.learnTopic && result.implementGoal) {
        gap = applyPlaybookOverrides(
          { ...result, _fallback: false },
          theme,
          daySlice,
          dtStep,
          globalDayIndex,
          problemFull,
          team
        );
      } else {
        console.warn(`⚠️ Gap JSON incomplete for ${dayKey} — using structured fallback`);
        gap = applyPlaybookOverrides({}, theme, daySlice, dtStep, globalDayIndex, problemFull, team);
      }
    } catch (err) {
      console.warn(`⚠️ Gap LLM failed for ${dayKey}: ${err.message}`);
      gap = applyPlaybookOverrides({}, theme, daySlice, dtStep, globalDayIndex, problemFull, team);
    }
  }

  // Best website + YouTube for today's topic (web RAG) — year/sem calibrated
  try {
    const { resolveResourcesForTopic } = require("./learningResources");
    const { academicHeaderLine } = require("./academicLevel");
    const topic =
      gap.learnTopic ||
      daySlice?.learnTopic ||
      dtStep?.step ||
      theme?.project ||
      "programming basics";
    const extra = `${gap.learnSubject || ""} ${(gap.subtopics || []).join(" ")} ${dtStep?.whatToLearn || ""}`;
    const academicNote = academicHeaderLine(inputs || {});
    gap.learnResourcePack = await resolveResourcesForTopic(topic, extra, academicNote);
    if (inputs && typeof inputs === "object") {
      inputs._topicResourceCache = inputs._topicResourceCache || {};
      inputs._topicResourceCache[topic] = gap.learnResourcePack;
    }
  } catch (e) {
    console.warn(`Learning resource RAG skipped for ${dayKey}:`, e.message);
  }

  return gap;
}

function bullets(lines) {
  return lines.filter(Boolean).join("\n");
}

function codingPracticeBlock(gap, picks, daySlice, theme, dayIdx = 0, opts = {}) {
  const lc = picks?.leetcode;
  const alt =
    (gap.codingProblems && gap.codingProblems.find((p) => !lc || !String(p).includes(String(lc.lc)))) ||
    (gap.codingProblems && gap.codingProblems[1]) ||
    null;

  const primary = lc
    ? `LeetCode #${lc.lc} — ${lc.name} (${lc.difficulty})`
    : (gap.codingProblems && gap.codingProblems[0]) || null;

  const pattern = softClip(lc?.pattern || opts.pattern || "Hash Map", 40);
  const problemGlance = softClip(
    opts.problemQuote || gap?.problemSlice || "your project problem",
    110
  );
  const classTopic = softClip(
    opts.classTopic ||
      daySlice?.dsaSubtopic ||
      theme?.dsa ||
      (gap.dsaLink && !/^NA\b/i.test(String(gap.dsaLink)) ? gap.dsaLink : "") ||
      "",
    60
  );
  const dsaTopic = classTopic || pattern;

  const applyWarmup = buildLcProjectApply(pattern, problemGlance, classTopic);
  const solveUrl = lc ? leetcodeUrl(lc) : "";
  const paceLine = String(opts.paceLine || "").trim();

  return bullets([
    `▶ Coding Practice — ${dsaTopic}`,
    `▶ Purpose: train pattern “${pattern}” so you can reuse it on "${softClip(problemGlance, 55)}".`,
    classTopic && classTopic !== dsaTopic ? `▶ Class topic: ${classTopic}` : null,
    primary
      ? `▶ Solve: ${primary}${solveUrl ? ` — ${solveUrl}` : ""}`
      : `▶ Solve: one Easy problem on "${pattern}" — https://leetcode.com/problemset/`,
    alt ? `▶ Backup: ${alt}` : null,
    paceLine || null,
    `▶ Apply (2 min): ${applyWarmup}`,
    `▶ Done when: Accepted (or logged attempt) + 1 Apply line.`,
  ]);
}

function systemDesignBlock(theme, daySlice, nonCode, dayIdx = 0, opts = {}) {
  return buildSystemDesignLesson(theme, daySlice, {
    dayIdx,
    nonCode,
    dtStep: opts.dtStep || null,
    sdRagPack: opts.sdRagPack || opts.inputs?._systemDesignRagPack || null,
    sdLessonPack:
      opts.sdLessonPack ||
      opts.inputs?._systemDesignLessonPack ||
      null,
    inputs: opts.inputs || null,
  });
}

function placementBlock(company, gap, problemFull, dayIdx = 0) {
  return formatFullPlacement(company, dayIdx, problemFull || gap?.problemSlice || "");
}

function planTotalDays(inputs = {}) {
  const n =
    Number(inputs._numDays) ||
    Number(inputs.numDays) ||
    Number(inputs?.timing?.numDays) ||
    0;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function standupBlock({
  dayIdx = 0,
  absDay = 0,
  isLastDay = false,
  team = false,
  learnLabel = "",
  dtStepName = null,
  nonCode = false,
}) {
  const abs = Math.max(0, Number(absDay) || 0);
  const first = abs === 0;
  const topic = softClip(learnLabel || "today's topic", 55);
  const step = dtStepName ? `▶ DT step: ${dtStepName}` : null;

  if (team) {
    if (first) {
      return bullets([
        `▶ Heading: Day 1 team kickoff`,
        step,
        `▶ Focus today: ${topic}`,
        `▶ Structure (2 min/person): TODAY aim · one question for the team · STUCK (or "none")`,
        `▶ Done when: each person spoke TODAY + STUCK once.`,
      ]);
    }
    if (isLastDay) {
      return bullets([
        `▶ Heading: Final-day team standup`,
        step,
        `▶ Focus: wrap "${topic}" and close the plan cleanly`,
        `▶ Structure (2 min/person): what we shipped · what is still open · who owns the last fix`,
        `▶ Done when: one shared "shipped / open / owner" list is written.`,
      ]);
    }
    const teamPrompts = [
      `▶ Write: DONE (your part) · TODAY on "${topic}" · STUCK (if any)`,
      `▶ Write: one win from yesterday · today's handoff · who needs help`,
      `▶ Write: DONE · TODAY · STUCK`,
      `▶ Write: what the team shipped yesterday · your next small deliverable · STUCK`,
      `▶ Write: open question from yesterday · today's focus on "${topic}" · STUCK`,
    ];
    return bullets([
      `▶ Heading: Team standup — Day ${abs + 1}`,
      step,
      `▶ Focus: ${topic}`,
      `▶ Structure (2 min/person): DONE / TODAY / STUCK`,
      teamPrompts[Math.max(0, Number(dayIdx) || 0) % teamPrompts.length],
      `▶ Peer check: one teammate responds to your STUCK in 30 seconds (or "none").`,
    ]);
  }

  // Solo — never team meet / classmate board language
  if (first) {
      return bullets([
        `▶ Day 1 personal kickoff`,
        `▶ Purpose: set today's aim for "${topic}" before class work starts.`,
        step,
        `▶ Write: TODAY aim · one thing you want to understand by evening · STUCK (or "none")`,
      ]);
    }
    if (isLastDay) {
      return bullets([
        `▶ Final-day personal standup`,
        `▶ Purpose: close "${topic}" and finish what's open.`,
        step,
        `▶ Write: what you shipped this plan · what is still open · first close-out action today`,
      ]);
    }

  const soloPrompts = [
    `▶ Write: DONE yesterday · TODAY on "${topic}" · STUCK (if any)`,
    `▶ Write: one thing that clicked yesterday · what you will finish today · STUCK`,
    nonCode
      ? `▶ Write: which notes file you left open · today's research aim · STUCK`
      : `▶ Write: which file you touched last · today's code aim · STUCK`,
    `▶ Write: DONE yesterday · TODAY on "${topic}" · STUCK (or "none")`,
    `▶ Write: what still felt fuzzy yesterday · smallest win for today · STUCK`,
  ];
  return bullets([
    `▶ Stand-Up — Day ${abs + 1}`,
    `▶ Purpose: set today's aim for "${topic}" before class work starts.`,
    step,
    soloPrompts[Math.max(0, Number(dayIdx) || 0) % soloPrompts.length],
  ]);
}

function retroBlock(gap, nonCode, dayIdx = 0, endLabel = "", team = false, opts = {}) {
  const abs = Math.max(0, Number(opts.absDay != null ? opts.absDay : dayIdx) || 0);
  const first = abs === 0;
  const isLastDay = opts.isLastDay === true;
  const topic = softClip(gap.learnTopic || "today's topic", 55);
  const link = softClip(
    String(gap.linkToProblem || gap.problemSlice || "your problem").replace(/[.?!]+$/, ""),
    100
  );
  const nextTopic = opts.nextTopic || gap.nextLearnTopic || null;
  const inputs = opts.inputs || {};
  let interestBit = softClip(
    String(inputs.interest || "")
      .replace(/dislikes?\s*\/?\s*avoid[:\s].*/i, "")
      .split(/[,|;]/)[0] || "",
    40
  );
  let fearBit = softClip(
    String(inputs.dislikes || inputs.difficulties || "")
      .replace(/likes?\/?\s*activities?[:\s].*/i, "")
      .split(/[,|;]/)[0] || "",
    40
  );
  let outcomeTitle = "today's growth outcome";
  try {
    const { outcomeForDay } = require("./personaDevelopment");
    outcomeTitle = outcomeForDay(dayIdx)?.title || outcomeTitle;
  } catch (_) {}

  const strengthLine = interestBit
    ? `STRENGTH: Name one way your interest ("${interestBit}") helped you today.`
    : `STRENGTH: Name one skill you used well today (even a small one).`;
  const fearLine = fearBit
    ? `FEAR / WEAKNESS: Where did you take one tiny step past "${fearBit}" today? (or what will you try tomorrow?)`
    : `FEAR / WEAKNESS: What felt hard today, and what 1-minute action reduces that fear next time?`;

  if (isLastDay) {
    return bullets([
      `▶ Heading: Final retrospective — plan outcome`,
      `▶ Purpose of this plan: leave stronger on Attitude, Logic/Business, and Technical — applied to "${link}".`,
      `▶ 1) OUTCOME: What specific capability can you prove now that you could not on Day 1?`,
      `▶ 2) ${strengthLine}`,
      `▶ 3) ${fearLine}`,
      `▶ 4) ARTIFACT: Best file/demo from this plan + how it helps "${link}".`,
      `▶ 5) CARRY FORWARD: One habit to keep after this plan.`,
      team
        ? `▶ Team close: each person shares one win + one open item (no new work).`
        : `▶ Solo close: write answers in notes/final-retro.md.`,
      `▶ Done when: all 5 answers are written.`,
    ]);
  }

  if (first) {
    return bullets([
      `▶ Heading: Day 1 close — set the outcome bar`,
      `▶ Today's purpose: start "${topic}" so you can move "${link}" tomorrow.`,
      `▶ Spotlight outcome: ${outcomeTitle}`,
      `▶ 1) LEARNED: One idea about "${topic}" you can explain now.`,
      `▶ 2) ${strengthLine}`,
      `▶ 3) ${fearLine}`,
      `▶ 4) TOMORROW: ${
        nextTopic
          ? `Start with "${nextTopic}" — reopen today's notes first.`
          : `Reopen today's notes, then continue the next playbook step.`
      }`,
      team ? `▶ Optional team board: one win + one stuck (keep it short).` : null,
      `▶ Done when: all 4 answers are in your notebook.`,
    ]);
  }

  const learnedQ = [
    `What is the one idea about "${topic}" you can explain in plain words now?`,
    `What mistake did you almost make with "${topic}", and how did you catch it?`,
    `What example from your problem made "${topic}" click?`,
    `What is still fuzzy about "${topic}" after today?`,
    `If a friend asked about "${topic}", what 2 sentences would you say?`,
  ][Math.max(0, Number(dayIdx) || 0) % 5];

  const finishedQ = nonCode
    ? [
        `Which notes/sketch did you save that proves today's work?`,
        `What page shows today's DT Playbook progress?`,
        `Name the artifact you would show in 30 seconds.`,
        `What did you clarify in notes today?`,
        `Which Project Build checklist item is actually done?`,
      ][Math.max(0, Number(dayIdx) || 0) % 5]
    : [
        `Which file/function works now that did not this morning?`,
        `What small test proved today's code?`,
        `What error did you fix, and where?`,
        `What save message describes today's change?`,
        `Which Project Build step is truly finished?`,
      ][Math.max(0, Number(dayIdx) || 0) % 5];

  const nextHint = nextTopic
    ? `Tomorrow: "${nextTopic}" — reopen today's notes first.`
    : `Tomorrow continues the next step — reopen today's notes first.`;

  return bullets([
    `▶ Heading: Close Day ${abs + 1} — outcome check`,
    `▶ Purpose today: use "${topic}" to advance "${link}".`,
    `▶ Spotlight outcome: ${outcomeTitle}`,
    `▶ 1) LEARNED: ${learnedQ}`,
    `▶ 2) FINISHED: ${finishedQ}`,
    `▶ 3) ${strengthLine}`,
    `▶ 4) ${fearLine}`,
    `▶ 5) TOMORROW: ${nextHint}`,
    team ? `▶ Optional: one win + one stuck for the team board.` : null,
    `▶ Done when: all 5 answers are written (no repeats from earlier slots).`,
  ]);
}

/**
 * Speak & Solve — exactly 2 speak items per day:
 *   1) Practice question
 *   2) Product of the Day
 * Day 1 has no "last night's homework". Later days use the case assigned in last night's homework.
 */
function speakSolveBlock(gap, picks, learnLabel, problemShort, dayIdx = 0, opts = {}) {
  const inputs = opts.inputs || {};
  const dayKey = opts.dayKey || "";
  const absIdx = absoluteDayIndex(dayKey, dayIdx);
  const firstDay = absIdx === 0;
  const cfg = parseAssessmentConfig(inputs);
  const actor = resolveHomeworkActor(inputs, {
    member: opts.member,
    memberIdx: opts.memberIdx,
  });
  // Same case object that last night's homework assigned for THIS day (this year/sem/member)
  const tonightCase = firstDay ? null : ensureCaseForAbsDay(absIdx, inputs, cfg, actor);
  const problem = softClip(problemShort || opts.problemQuote || "your project problem", 110);

  const assessBit = softClip(
    String(actor.member?.assessment || inputs.assessment || "").trim(),
    70
  );

  const lines = [
    firstDay
      ? `▶ Speak & Solve`
      : `▶ Speak & Solve — use last night's case prep`,
    `▶ Purpose: explain clearly and connect ideas to "${problem}".`,
    assessBit ? `▶ From Assess: fold "${assessBit}" into your last sentence.` : null,
  ];

  if (!firstDay && tonightCase?.title) {
    lines.push(
      `▶ Case from last night's homework: "${tonightCase.title}"${tonightCase.theme ? ` [${tonightCase.theme}]` : ""}`,
      `▶ Case → product: Name ONE decision you will change in "${problem}" because of this case.`
    );
  }

  // 1) Practice question only
  if (picks?.pm) {
    const typeLabel = skillTypeLabel(picks.pm.skill);
    lines.push(
      `▶ 1) Practice question (${typeLabel})`,
      `   Question: ${picks.pm.text || picks.pm.label}`,
      `   Speak ~1 minute. Tie the answer to "${problem}" in your last sentence.`
    );
  } else {
    lines.push(
      `▶ 1) Practice question`,
      `   In ~1 minute, explain "${learnLabel}" using your problem (${problem}).`
    );
  }

  // 2) Product of the Day only — never a third question
  if (picks?.product) {
    lines.push(
      `▶ 2) Product of the Day`,
      `   Product: ${picks.product.name} (${picks.product.category})`,
      `   Speak ~90 seconds: ${picks.product.prompt}`,
      `   End with 1 lesson for YOUR product: "${problem}".`
    );
  } else {
    lines.push(
      `▶ 2) Product of the Day`,
      `   Pick any familiar product. Speak ~90 seconds: one strength, one weakness, one lesson for "${problem}".`
    );
  }

  lines.push(
    projectConnectLine(problem, "after speaking, write 1 line in notes/speak-day.md: what you will build differently")
  );

  return bullets(lines.filter((x) => x != null));
}

/** Refresh slot: optional light game OR rest — no purpose essay */
function refreshChoiceBlock(picks, problemQuote = "") {
  const game = picks?.game;
  const cs = picks?.caseStudy;
  const problem = softClip(problemQuote || "your project problem", 90);
  const lines = [
    `▶ Refresh (optional)`,
    `▶ Pick ONE: game, short case chat, or rest. No new homework.`,
    `▶ Option A — Game: ${game ? `${game.name} (${game.minutes || 10} min)` : "Hollywood (Tech Edition) (10 min)"}`,
    game?.how ? `   ${game.how}` : `   One student thinks of a tech title; others ask YES/NO only.`,
    `▶ Option B — Case: ${cs ? cs.title : "a short product story"} → 1 insight for "${problem}"`,
    `▶ Option C — Rest: water, stretch, quiet sit.`,
  ];
  return bullets(lines.filter((x) => x != null));
}

/** Break / Lunch — rest only. No purpose, no drills. */
function betweenClassBreakContent({ slotLabel = "Break" } = {}) {
  return bullets([
    `▶ ${slotLabel}`,
    `▶ Rest only — no task.`,
  ]);
}

/** Track homework IDs already assigned in this plan run — prevents night-to-night repeats. */
function ensureHomeworkUsed(inputs = {}) {
  if (!inputs._homeworkUsed || typeof inputs._homeworkUsed !== "object") {
    inputs._homeworkUsed = { lc: [], ex: [], agent: [], case: [], linkedin: [] };
  }
  const u = inputs._homeworkUsed;
  for (const k of ["lc", "ex", "agent", "case", "linkedin"]) {
    if (!Array.isArray(u[k])) u[k] = [];
  }
  // Seed from plan-wide used LeetCode so homework never reuses day picks
  if (Array.isArray(inputs._planUsedLc)) {
    for (const lc of inputs._planUsedLc) {
      const s = String(lc);
      if (s && !u.lc.map(String).includes(s)) u.lc.push(s);
    }
  }
  return u;
}

/** Resolve which student (year/sem/member) homework should be calibrated for. */
function resolveHomeworkActor(inputs = {}, opts = {}) {
  let members = [];
  try {
    const raw = inputs._teamMembers;
    members = typeof raw === "string" ? JSON.parse(raw) : Array.isArray(raw) ? raw : [];
  } catch {
    members = [];
  }
  const memberIdx = Math.max(
    0,
    Number(opts.memberIdx != null ? opts.memberIdx : inputs._memberIdx) || 0
  );
  const member =
    opts.member ||
    members[memberIdx] ||
    members[0] ||
    null;
  const profile = resolveAcademicProfile(inputs, member);
  const seed = academicPickSeed(profile, memberIdx);
  return { member, memberIdx, profile, seed, members };
}

function homeworkUsedBucket(inputs, actor) {
  const root = ensureHomeworkUsed(inputs);
  const key = `m${actor.memberIdx}:y${actor.profile.collegeYear || 0}:s${actor.profile.semester || 0}:g${actor.profile.schoolGrade || 0}`;
  if (!inputs._homeworkUsedByActor || typeof inputs._homeworkUsedByActor !== "object") {
    inputs._homeworkUsedByActor = {};
  }
  if (!inputs._homeworkUsedByActor[key]) {
    inputs._homeworkUsedByActor[key] = { lc: [], ex: [], agent: [], case: [], linkedin: [] };
  }
  const u = inputs._homeworkUsedByActor[key];
  for (const k of ["lc", "ex", "agent", "case", "linkedin"]) {
    if (!Array.isArray(u[k])) u[k] = [];
  }
  // Keep legacy root in sync for older callers
  root.lc = u.lc;
  root.ex = u.ex;
  root.agent = u.agent;
  root.case = u.case;
  root.linkedin = u.linkedin;
  return u;
}

function pickUnused(list, dayIdx, usedArr, idFn) {
  const n = Array.isArray(list) ? list.length : 0;
  if (!n) return null;
  const used = new Set((usedArr || []).map(String));
  const start = Math.max(0, Number(dayIdx) || 0) % n;
  for (let off = 0; off < n; off++) {
    const item = list[(start + off) % n];
    const id = String(idFn(item));
    if (!used.has(id)) {
      usedArr.push(id);
      return item;
    }
  }
  // Exhausted — start a new cycle, still advance by day so neighbours differ
  usedArr.length = 0;
  const item = list[start];
  usedArr.push(String(idFn(item)));
  return item;
}

function weekNumberFromKey(dayKey = "", dayIdx = 0) {
  const m = String(dayKey || "").match(/\bW(?:eek)?\s*(\d+)\b/i);
  if (m) return Math.max(1, Number(m[1]) || 1);
  return Math.floor(Math.max(0, Number(dayIdx) || 0) / 5) + 1;
}

/**
 * Absolute working-day index (0-based) from "Week N - Monday".
 * Prevents Week2 Monday looking like Week1 Monday when dayIdx was only 0–4.
 */
function absoluteDayIndex(dayKey = "", dayIdx = 0) {
  const week = weekNumberFromKey(dayKey, dayIdx);
  const dow = weekDayIndex(dayIdx, dayKey); // Mon=0…Fri=4
  const fromKey = (Math.max(1, week) - 1) * 5 + dow;
  const fromIdx = Math.max(0, Number(dayIdx) || 0);
  // Trust dayKey week when present — never collapse later weeks onto Mon–Fri 0–4
  if (/\bW(?:eek)?\s*\d+/i.test(String(dayKey || ""))) return fromKey;
  return Math.max(fromIdx, fromKey);
}

function pickTopicProblems(learnLabel, dayIdx, picksLc, usedLc = null, actor = null, ragPack = null) {
  const topic = String(learnLabel || "").toLowerCase();
  const words = topic.split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  const profile = actor?.profile || resolveAcademicProfile({});
  const seed = actor?.seed != null ? actor.seed : academicPickSeed(profile, actor?.memberIdx || 0);
  const ragLc = Array.isArray(ragPack?.leetcode) ? ragPack.leetcode : [];
  if (!ragLc.length && !picksLc?.lc) {
    return { easy: null, medium: null };
  }
  const bank = filterLeetCodeForProfile(ragLc.length ? ragLc : picksLc ? [picksLc] : [], profile, actor?.memberIdx || 0);
  if (!bank.length) {
    return {
      easy: picksLc?.lc
        ? {
            lc: picksLc.lc,
            name: picksLc.name,
            difficulty: picksLc.difficulty,
            pattern: picksLc.pattern,
            url: picksLc.url || leetcodeUrl(picksLc),
          }
        : null,
      medium: null,
    };
  }

  const score = (p) => {
    const hay = `${p.name} ${p.pattern}`.toLowerCase();
    let s = 0;
    for (const w of words) if (hay.includes(w)) s += 2;
    if (topic && hay.includes(topic.slice(0, 8))) s += 1;
    return s;
  };

  const ranked = [...bank].sort((a, b) => score(b) - score(a));
  const matched = ranked.filter((p) => score(p) > 0);
  const pool = matched.length >= 2 ? matched : ranked;
  const easy = pool.filter((p) => /easy/i.test(p.difficulty));
  const med = pool.filter((p) => /medium/i.test(p.difficulty));
  const hard = pool.filter((p) => /hard/i.test(p.difficulty));
  const i = Math.max(0, Number(dayIdx) || 0) + seed;

  let primary = null;
  if (Array.isArray(usedLc)) {
    const prefer =
      profile.depth >= 4
        ? (med.length ? med : pool)
        : profile.depth <= 1
          ? (easy.length ? easy : pool)
          : easy.length >= 2
            ? easy
            : pool;
    if (picksLc?.lc && !usedLc.map(String).includes(String(picksLc.lc))) {
      const hit = prefer.find((p) => String(p.lc) === String(picksLc.lc)) || picksLc;
      usedLc.push(String(hit.lc || hit.name));
      primary = hit;
    } else {
      primary = pickUnused(prefer, i, usedLc, (p) => p.lc || p.name);
    }
  } else if (picksLc && picksLc.lc) {
    primary = picksLc;
  } else {
    primary = easy[i % Math.max(easy.length, 1)] || pool[i % pool.length];
  }

  let secondary =
    (profile.depth >= 3 ? med : easy)[i % Math.max((profile.depth >= 3 ? med : easy).length, 1)] ||
    pool[(i + 3) % pool.length];
  if (profile.depth >= 4 && hard.length) {
    secondary = hard[i % hard.length] || secondary;
  }
  if (secondary && primary && String(secondary.lc) === String(primary.lc)) {
    secondary = pool[(i + 5) % pool.length];
  }

  const wrap = (p) =>
    p && {
      lc: p.lc,
      name: p.name,
      difficulty: p.difficulty,
      pattern: p.pattern,
      url: p.url || leetcodeUrl(p),
    };

  return { easy: wrap(primary), medium: wrap(secondary) };
}

/** Named Exercism exercises with track + slug (name shown to students) */
const EXERCISM_BANK = [
  { name: "Hello World", slug: "hello-world", track: "javascript" },
  { name: "Two Fer", slug: "two-fer", track: "javascript" },
  { name: "Leap", slug: "leap", track: "javascript" },
  { name: "Resistor Color", slug: "resistor-color", track: "javascript" },
  { name: "Rna Transcription", slug: "rna-transcription", track: "javascript" },
  { name: "Space Age", slug: "space-age", track: "javascript" },
  { name: "Pangram", slug: "pangram", track: "javascript" },
  { name: "Isogram", slug: "isogram", track: "javascript" },
  { name: "Hamming", slug: "hamming", track: "javascript" },
  { name: "Raindrops", slug: "raindrops", track: "javascript" },
];

function pickExercismExercise(dayIdx = 0, learnLabel = "", usedEx = null, actor = null) {
  const t = String(learnLabel || "").toLowerCase();
  let track = "javascript";
  if (/python|django|flask/.test(t)) track = "python";
  else if (/java\b/.test(t)) track = "java";
  const seed = actor?.seed != null ? actor.seed : 0;
  const idx = Math.max(0, Number(dayIdx) || 0) + seed;
  const ex = Array.isArray(usedEx)
    ? pickUnused(EXERCISM_BANK, idx, usedEx, (e) => e.slug)
    : EXERCISM_BANK[idx % EXERCISM_BANK.length];
  if (!ex) return null;
  const number = EXERCISM_BANK.findIndex((e) => e.slug === ex.slug) + 1;
  return {
    name: ex.name,
    number: number > 0 ? number : 1,
    url: `https://exercism.org/tracks/${track}/exercises/${ex.slug}`,
    track,
  };
}

/**
 * Weekly homework plan (every night):
 *   LeetCode — EVERY night (mapped to today's System Design concept)
 *   + one rotating task (Exercism / Agent / LinkedIn)
 *   + Case study review (prep for tomorrow Speak & Solve)
 */

/**
 * Map text → LeetCode pattern family.
 * RULE: homework / Coding Practice LC must connect to what they studied that day.
 * Never map unrelated words (e.g. "memoization") to cache/LRU.
 */
function mapTopicTextToLcPattern(text = "") {
  const t = String(text || "").toLowerCase();
  if (!t.trim()) return null;

  // DSA topics first (order matters — DP before cache so "memoization" ≠ LRU)
  if (/dynamic.?prog|\bdp\b|knapsack|kadane|memoization|tabulation/.test(t)) return "Dynamic Programming";
  if (/heap|priority.?queue|top.?k/.test(t)) return "Heap / Priority Queue";
  if (/linked.?list/.test(t) && !/lru|lfu|cache/.test(t)) return "Linked List";
  if (/interval|merge.?interval|meeting/.test(t)) return "Intervals";
  if (/queue|stack|deque|monotonic/.test(t)) return "Queue / Stack";
  if (/graph|bfs|dfs|union.?find|topo|island/.test(t)) return "Graphs";
  if (/tree|trie|bst|binary.?tree|hierarch|prefix.?tree/.test(t)) return "Trees";
  if (/binary.?search|sorted.?array/.test(t)) return "Binary Search";
  if (/sliding.?window|rate.?limit/.test(t)) return "Sliding Window";
  if (/two.?pointer|pair.?sum/.test(t)) return "Two Pointers";
  if (/sort|sorting|merge.?sort|quick.?sort/.test(t)) return "Sorting";
  if (/recursion|backtrack/.test(t)) return "Recursion / Backtracking";
  if (/string|anagram|palindrome|substr/.test(t)) return "Arrays & Hashing";
  if (/array|hash.?map|hashing|two.?sum|\bset\b|freq|hash\b/.test(t)) return "Arrays & Hashing";

  // Cache / SD only when the lesson text actually mentions caching
  if (/\blru\b|\blfu\b|cache|caching|cdn|\bredis\b|evict/.test(t)) {
    return "Hash Map + Doubly Linked List";
  }
  if (/async|message.?queue|event.?driven|stream|buffer/.test(t)) return "Queue / Stack";
  if (/friend.?graph|recommend|social.?network|cluster/.test(t)) return "Graphs";
  if (/auth|session|token|login|oauth/.test(t)) return "Hash Map";
  if (/api|endpoint|rest|key.?value|\bkv\b/.test(t)) return "Hash Map";
  return null;
}

/** @deprecated prefer resolveDayLcPattern */
function mapSdConceptToLcPattern(sdTitle = "", learnLabel = "") {
  return (
    mapTopicTextToLcPattern(`${learnLabel} ${sdTitle}`) ||
    mapTopicTextToLcPattern(learnLabel) ||
    mapTopicTextToLcPattern(sdTitle) ||
    "Arrays & Hashing"
  );
}

/**
 * Hard rule: LC pattern from what they actually learned TODAY.
 *
 * Priority when DSA module is ON:
 *   1) That day's DSA subtopic / unit
 *   2) Learning / subject topic
 *   — System Design is NOT used to pick the pattern (avoids random cache homework)
 *
 * When DSA is OFF:
 *   subject / learn label → SD title (only if it maps) → Arrays & Hashing
 */
function resolveDayLcPattern({
  dsaTopic = "",
  subjectTopic = "",
  learnLabel = "",
  sdTitle = "",
  fallbackPattern = "",
  dsaEnabled = true,
} = {}) {
  const dsa = String(dsaTopic || "").trim();
  const subject = String(subjectTopic || "").trim();
  const learn = String(learnLabel || "").trim();
  const sd = String(sdTitle || "").trim();
  const fallback = String(fallbackPattern || "").trim();

  if (dsaEnabled) {
    const dsaFirst = [dsa, `${dsa} ${learn}`, learn, subject, fallback];
    for (const c of dsaFirst) {
      const hit = mapTopicTextToLcPattern(c);
      if (hit) return hit;
    }
    // Still no keyword hit — keep a stable DSA default, never invent cache from SD
    return softClip(fallback || "Arrays & Hashing", 40);
  }

  // DSA off: connect to today's non-DSA learning (subject / SD) when explicit
  const sdPath = [learn, subject, sd, `${learn} ${sd}`, fallback];
  for (const c of sdPath) {
    const hit = mapTopicTextToLcPattern(c);
    if (hit) return hit;
  }
  return softClip(fallback || "Arrays & Hashing", 40);
}

function todaySdLessonTitle(dayIdx = 0, inputs = {}) {
  try {
    const { lessonForDay } = require("./systemDesignLesson");
    const pack =
      inputs?._systemDesignLessonPack ||
      inputs?._systemDesignRagPack?._lessonPack ||
      null;
    const lesson = lessonForDay(dayIdx, pack);
    return lesson?.title || "System Design";
  } catch (_) {
    return "System Design";
  }
}

function hwLeetCode(problem, sdMeta = null, projectMeta = null) {
  if (!problem) return null;
  const level = /medium/i.test(problem.difficulty)
    ? "Medium"
    : /hard/i.test(problem.difficulty)
      ? "Hard"
      : "Easy";
  const pattern = softClip(problem.pattern || sdMeta?.pattern || "problem solving", 40);
  const classTopic = softClip(
    sdMeta?.classTopic || projectMeta?.classTopic || projectMeta?.learnLabel || "",
    55
  );
  const dayLc = sdMeta?.dayLc || projectMeta?.dayLc || "";
  const dayName = softClip(sdMeta?.dayName || "", 40);
  const problemGlance = softClip(
    projectMeta?.problemQuote || projectMeta?.problem || "your project",
    90
  );
  const learnPart = classTopic || pattern || "today's learning";
  const projectHook = buildLcProjectApply(pattern, problemGlance, learnPart);

  return [
    `LeetCode`,
    `Purpose: continue today's class skill (“${learnPart}” / pattern “${pattern}”) on YOUR project — not a random puzzle.`,
    `Problem: #${problem.lc} — ${problem.name} (${level})`,
    `Link: ${leetcodeUrl(problem)}`,
    dayLc ? `Builds on Coding Practice #${dayLc}${dayName ? ` — ${dayName}` : ""}` : null,
    `Project: ${problemGlance}`,
    `Do: solve (or log attempt if stuck >25 min).`,
    `Apply: ${projectHook}`,
    `Done when: Accepted/logged + Apply note names where this pattern fits in the product.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Concrete "use this LC pattern on YOUR problem" step — bridges coding practice → project.
 * Keep wording short so beginners finish in 5–10 minutes.
 */
function buildLcProjectApply(pattern = "", problemQuote = "", sdTitle = "") {
  const p = String(pattern || "").toLowerCase();
  const problem = softClip(problemQuote || "your project", 60);
  const sd = softClip(sdTitle || "tonight's system design", 40);

  if (/lru|lfu|cache|hash.?map.*list|evict/i.test(p)) {
    return `Write 2 lines: what to cache in "${problem}", and when to delete it (link to ${sd}).`;
  }
  if (/sliding.?window|rate.?limit/i.test(p)) {
    return `Write 2 lines: one place in "${problem}" that needs a time window (and a guess for the size).`;
  }
  if (/queue|stack|deque|monotonic/i.test(p)) {
    return `Write 2 lines: one FIFO/LIFO flow in "${problem}" (jobs, alerts, undo) and name it.`;
  }
  if (/graph|bfs|dfs|union|topo/i.test(p)) {
    return `Sketch 4 nodes from "${problem}" + 1 edge type — 1 sentence on why search helps.`;
  }
  if (/tree|trie|bst|binary/i.test(p)) {
    return `Write 2 lines: one hierarchy in "${problem}" (folders/categories) and the first tree op you need.`;
  }
  if (/two.?pointer|array|sort|binary.?search/i.test(p)) {
    return `Write 2 lines: one list/field in "${problem}" where this search/filter helps.`;
  }
  if (/dp|dynamic|knapsack|memo/i.test(p)) {
    return `Write 2 lines: one "best choice" in "${problem}" (cost/score) where remembering past answers helps.`;
  }
  if (/heap|priority|median/i.test(p)) {
    return `Write 2 lines: one top-K / priority need in "${problem}" and the priority key.`;
  }
  if (/string|parse|hash.?map|hash map|hashing|key.?value/i.test(p)) {
    return `Write 2 lines: one lookup map for "${problem}" (key → value), e.g. id→record.`;
  }
  if (/linked.?list|pointer/i.test(p)) {
    return `Write 2 lines: one ordered list in "${problem}" (feed/steps) and one insert/delete case.`;
  }
  return `Write 3 short bullets: where "${pattern}" fits "${problem}", which file/feature next, one real test input.`;
}

function hwExercism(ex, problemQuote = "") {
  if (!ex) return null;
  const problem = softClip(problemQuote || "your project", 70);
  return [
    `Exercism`,
    `#${ex.number} — ${ex.name} (${ex.track})`,
    `Your product (in short): ${problem}`,
    `Link: ${ex.url}`,
    `Do this: Open → code → pass tests. Then write 1 line: which skill from this exercise helps "${problem}".`,
    `Done when: all tests pass AND that 1 line is in notes/exercism-apply.md.`,
  ].join("\n");
}

function hwLinkedInArticle(dayIdx, learnLabel, dayKey = "", usedLi = null, problemQuote = "") {
  const topic = softClip(learnLabel || "this week's learning", 50);
  const problem = softClip(problemQuote || "your project problem", 70);
  const d = weekDayIndex(dayIdx, dayKey); // Mon=0…Fri=4
  const week = weekNumberFromKey(dayKey, dayIdx);
  const variants = [
    {
      id: `w${week}-draft-${topic}`,
      lines: [
        `LinkedIn`,
        `Week ${week} draft — article on "${topic}"`,
        `Your problem (in short): ${problem}`,
        `Task: Write 8–12 lines with a clear title. Include 1 line on how "${topic}" helps "${problem}". Save in notes/linkedin-w${week}.md. Do not post yet.`,
        `Done when: draft has a title, 8–12 lines, and one takeaway unique to Week ${week} tied to your product.`,
      ],
    },
    {
      id: `w${week}-comment-${topic}`,
      lines: [
        `LinkedIn`,
        `Week ${week} — leave 2 thoughtful comments on posts about "${topic}"`,
        `Your problem (in short): ${problem}`,
        `Task: Find 2 real posts. Comment with one insight each that could help "${problem}" (not "great post"). Save links in notes/linkedin-w${week}-comments.md.`,
        `Done when: 2 comments are live and noted.`,
      ],
    },
    {
      id: `w${week}-publish-${topic}`,
      lines: [
        `LinkedIn`,
        `Week ${week} publish — article on "${topic}"`,
        `Your problem (in short): ${problem}`,
        `Task: Post from notes/linkedin-w${week}.md (or write fresh 8–12 lines). First line must mention what you are building for "${problem}". Leave 1 real comment on a peer post.`,
        `Done when: article is live, URL saved, and you left 1 comment.`,
      ],
    },
    {
      id: `w${week}-carousel-${topic}`,
      lines: [
        `LinkedIn`,
        `Week ${week} — outline a 5-slide carousel on "${topic}"`,
        `Your problem (in short): ${problem}`,
        `Task: Write 5 slide titles + 1 line each in notes/linkedin-w${week}-carousel.md. Slide 5 = how this helps "${problem}".`,
        `Done when: 5 slides are outlined with one takeaway for your product.`,
      ],
    },
  ];

  // Wed → draft/outline family · Fri → publish/comment family — always unique per week
  let pick;
  if (d === 2) pick = week % 2 === 1 ? variants[0] : variants[3];
  else if (d === 4) pick = week % 2 === 1 ? variants[2] : variants[1];
  else return null;

  if (Array.isArray(usedLi)) {
    if (usedLi.includes(pick.id)) {
      const alt = variants.find((v) => !usedLi.includes(v.id)) || pick;
      pick = alt;
    }
    usedLi.push(pick.id);
  }
  return pick.lines.join("\n");
}

/** Short product label only — never paste the full problem essay into agent tasks. */
function productGlanceForAgent(text = "", inputs = null) {
  const glance = studentProblemGlance(text, 70, inputs);
  const t = softClip(glance, 55);
  if (!t || /open your problem|write your problem|in short:/i.test(t)) return "your product";
  return t;
}

function hwAgentWorkbench(dayIdx, usedAgent = null, problemText = "", opts = {}) {
  const product = productGlanceForAgent(
    opts.problemQuote || problemText || "",
    opts.inputs || null
  );
  try {
    const { WORKBENCH_TASKS, pickWorkbenchByDifficulty, stripLinks } = require("../data/agentWorkbenchBanks");
    const rag = opts.ragTask || null;
    const ragSteps = Array.isArray(rag?.steps)
      ? rag.steps.map((s) => stripLinks(String(s))).filter((s) => s.length > 8)
      : String(rag?.buildSteps || "")
          .split(/\n|(?:\d+[.)]\s+)/)
          .map((s) => stripLinks(s).trim())
          .filter((s) => s.length > 8);
    const ragOk =
      rag &&
      rag.title &&
      String(rag.what || rag.buildSteps || "").trim().length > 40 &&
      ragSteps.length >= 3;

    let bank;
    if (ragOk) {
      bank = {
        title: rag.title,
        difficulty: rag.difficulty || "easy",
        problem: rag.problem || rag.what,
        what: rag.what,
        steps: ragSteps.slice(0, 5),
        success: rag.doneWhen || rag.success,
      };
      if (Array.isArray(usedAgent) && bank.title) usedAgent.push(String(bank.title));
    } else {
      bank = Array.isArray(usedAgent)
        ? pickUnused(WORKBENCH_TASKS, dayIdx, usedAgent, (t) => t.title)
        : pickWorkbenchByDifficulty(dayIdx);
      if (Array.isArray(usedAgent) && bank?.title) usedAgent.push(String(bank.title));
    }

    const title = stripLinks?.(bank?.title) || bank?.title || "Automation Agent";
    const level = /hard|diff/i.test(bank?.difficulty)
      ? "Hard"
      : /inter|med/i.test(bank?.difficulty)
        ? "Medium"
        : "Easy";
    // Keep FULL bank / RAG wording — do not softClip (that left tasks "unfulfilled")
    // and never splice the student's problem essay into the agent Problem line.
    const problem =
      stripLinks?.(bank?.problem) ||
      bank?.problem ||
      "Build one small agent that reads an input and writes a clear output file.";
    const what =
      stripLinks?.(bank?.what) ||
      bank?.what ||
      "Build and run one Agent Workbench workflow end-to-end.";
    const steps = Array.isArray(bank?.steps)
      ? bank.steps.map((s) => (stripLinks ? stripLinks(s) : String(s))).filter(Boolean).slice(0, 5)
      : [
          "Open Agent Workbench and create a new workflow for today's task.",
          "Add Manual Trigger, then the nodes needed for the problem.",
          "Run once and save the output file.",
        ];
    const done =
      stripLinks?.(bank?.success) ||
      bank?.success ||
      "Output file exists and shows a complete run.";

    return [
      `Agent Workbench`,
      `${title} (${level})`,
      `Product glance: ${product}`,
      `Problem: ${problem}`,
      `What to build: ${what}`,
      ...steps.map((s, i) => `Step ${i + 1}: ${s}`),
      `Done when: ${done}`,
      `Apply: 1 line — how this agent helps "${product}".`,
    ].join("\n");
  } catch (_) {
    return [
      `Agent Workbench`,
      `Event Logger Agent (Easy)`,
      `Product glance: ${product}`,
      `Problem: Save one event with a name, zone, and timestamp.`,
      `What to build: A small workflow that logs one event and writes a text file.`,
      `Step 1: Open Agent Workbench → create workflow Event-Logger-Day.`,
      `Step 2: Add Manual Trigger → fields: event, zone, timestamp.`,
      `Step 3: Save output to agent-log-day${Number(dayIdx) + 1}.txt and run once.`,
      `Done when: agent-log-day${Number(dayIdx) + 1}.txt shows event + zone + timestamp.`,
      `Apply: 1 line — how this agent helps "${product}".`,
    ].join("\n");
  }
}

function nextDayLabel(dayKey = "", dayIdx = 0) {
  const names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  const abs = absoluteDayIndex(dayKey, dayIdx);
  // Next working day label from absolute index (Fri → next week Monday)
  const nextAbs = abs + 1;
  const nextDow = nextAbs % 5;
  const nextWeek = Math.floor(nextAbs / 5) + 1;
  return { dayName: names[nextDow], week: nextWeek, abs: nextAbs };
}

/**
 * One shared case per absolute day — homework night N stores case for day N+1,
 * and Speak & Solve on day N+1 reads the same object.
 */
/**
 * One case per absolute day × academic actor (year/sem/member).
 * Homework night N stores case for day N+1; Speak & Solve reads the same object.
 */
function ensureCaseForAbsDay(absDay, inputs = {}, cfg = null, actorOrOpts = null) {
  const config = cfg || parseAssessmentConfig(inputs || {});
  const actor =
    actorOrOpts?.profile
      ? actorOrOpts
      : resolveHomeworkActor(inputs, actorOrOpts || {});
  if (!inputs._caseByAbsDay || typeof inputs._caseByAbsDay !== "object") {
    inputs._caseByAbsDay = {};
  }
  const absKey = String(Math.max(0, Number(absDay) || 0));
  const cacheKey = `${actor.memberIdx}:y${actor.profile.collegeYear || 0}:s${actor.profile.semester || 0}:g${actor.profile.schoolGrade || 0}:${absKey}`;
  if (inputs._caseByAbsDay[cacheKey]?.title) return inputs._caseByAbsDay[cacheKey];

  const used = homeworkUsedBucket(inputs, actor);
  const weekNum = Math.floor(Math.max(0, Number(absKey) || 0) / 5) + 1;
  const { pickCaseFromLibrary } = require("../data/caseStudyLibrary");
  const ragCases = config._assessmentRagPack?.cases;
  let caseListRaw = Array.isArray(ragCases) ? ragCases : [];
  // Prefer real library cases over empty RAG / placeholders
  if (!caseListRaw.length || caseListRaw.every((c) => /^Case study\s*\d+/i.test(String(c.title || "")))) {
    caseListRaw = [];
  }
  const caseList = caseListRaw.length
    ? rotateCaseBank(caseListRaw, actor.profile, actor.memberIdx)
    : [];

  let cs =
    pickForDay(Number(absKey), config, actor.memberIdx, actor.member || actor.profile).caseStudy ||
    null;
  const prefId = cs ? String(cs.id || cs.title) : "";
  if (prefId && used.case.includes(prefId)) cs = null;

  if (!cs) {
    const picked = caseList.length
      ? pickUnused(caseList, Number(absKey) + actor.seed, used.case, (c) => c.id || c.title)
      : null;
    if (picked) {
      cs = { id: picked.id, title: picked.title, theme: picked.theme, link: picked.link || null, what: picked.what, why: picked.why, lesson: picked.lesson };
    } else {
      const lib = pickCaseFromLibrary(Number(absKey), used.case, weekNum);
      used.case.push(String(lib.id));
      cs = lib;
    }
  } else if (prefId) {
    used.case.push(prefId);
  }

  const normalized = cs
    ? {
        id: cs.id || prefId || cacheKey,
        title: cs.title,
        theme: cs.theme || "Business / product",
        link: cs.link || null,
        what: cs.what || null,
        why: cs.why || null,
        lesson: cs.lesson || null,
        blurb: cs.blurb || null,
        memberIdx: actor.memberIdx,
      }
    : {
        id: `fallback-${cacheKey}`,
        title: `Case study ${Number(absKey) + 1}`,
        theme: "Business / product",
        link: null,
        memberIdx: actor.memberIdx,
      };

  inputs._caseByAbsDay[cacheKey] = normalized;
  return normalized;
}

/**
 * Homework case = EXACT case used in tomorrow's Speak & Solve (for this year/sem/member).
 */
function hwCaseStudyForTomorrow(dayIdx, inputs = {}, dayKey = "", actor = null) {
  const cfg = parseAssessmentConfig(inputs || {});
  const act = actor || resolveHomeworkActor(inputs);
  const absIdx = absoluteDayIndex(dayKey, dayIdx);
  const next = nextDayLabel(dayKey, absIdx);
  const cs = ensureCaseForAbsDay(next.abs, inputs, cfg, act);
  const problemQuote = studentProblemGlance(
    getProblemText(inputs || {}, {}),
    120,
    inputs || {}
  );

  const title = cs.title;
  const theme = cs.theme || "Business / product";
  const link = cs.link ? `Link: ${cs.link}` : null;

  return [
    `Case study`,
    `For ${next.dayName} Speak & Solve — Week ${next.week}`,
    `Case: ${title} [${theme}]`,
    cs.company ? `Company: ${cs.company}` : null,
    cs.what ? `What happened: ${softClip(cs.what, 140)}` : null,
    cs.why ? `Why it matters: ${softClip(cs.why, 120)}` : null,
    cs.lesson ? `Lesson: ${softClip(cs.lesson, 100)}` : null,
    link,
    `Your product (in short): ${problemQuote}`,
    `Do this (easy):`,
    `  1) Skim the case (5–8 min).`,
    `  2) Write 3 short lines: what happened / why it matters / 1 lesson for YOUR product.`,
    `  3) Apply: name ONE change you will make to "${softClip(problemQuote, 55)}" (feature, user, or risk).`,
    `Tomorrow: In Speak & Solve, say that 1 lesson + the product change (no reading full notes).`,
    `Done when: file homework-case-day${next.abs + 1}.md has case title on line 1 + 3 insights + Apply line.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Resolve Mon=0 … Fri=4 from day name (never trust global dayIdx alone). */
function weekDayIndex(dayIdx = 0, dayKey = "") {
  const s = String(dayKey || "");
  const full = s.match(/\b(Monday|Tuesday|Wednesday|Thursday|Friday)\b/i);
  const map = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4 };
  if (full) return map[full[1].toLowerCase()];
  // Also accept Week N - Mon / W1-Thu
  const short = s.match(/\b(Mon|Tue|Wed|Thu|Fri)\b/i);
  const shortMap = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4 };
  if (short) return shortMap[short[1].toLowerCase()];
  return Math.max(0, Number(dayIdx) || 0) % 5;
}

function homeworkBlock({
  picks, gap, learnLabel, agentNotes, sysContent, dayIdx, inputs, problemFirst,
  skipDsa = false, skipSd = false, skipBanks = false, dayKey = "",
  member = null, memberIdx = 0,
  daySlice = null, themeDsa = "",
}) {
  const topic = learnLabel || gap?.learnTopic || "today's topic";
  const d = weekDayIndex(dayIdx, dayKey);
  const absIdx = absoluteDayIndex(dayKey, dayIdx);
  const actor = resolveHomeworkActor(inputs || {}, { member, memberIdx });
  const used = homeworkUsedBucket(inputs || {}, actor);
  const problemQuote = studentProblemGlance(
    getProblemText(inputs || {}, { project: gap?.project || "" }),
    140,
    inputs || {}
  );

  const sdTitle =
    todaySdLessonTitle(absIdx, inputs || {}) ||
    (skipDsa ? "System Design building blocks" : "");

  // Day chain is the source of truth when Coding Practice already ran
  const dayChain =
    inputs?._dayLcByAbs && typeof inputs._dayLcByAbs === "object"
      ? inputs._dayLcByAbs[String(absIdx)] || inputs._dayLcByAbs[absIdx] || null
      : null;
  const dayTopicRec =
    inputs?._dayTopicByAbs && typeof inputs._dayTopicByAbs === "object"
      ? inputs._dayTopicByAbs[String(absIdx)] || inputs._dayTopicByAbs[absIdx] || null
      : null;

  // Priority: day chain → day topic record → daySlice DSA → theme DSA (never vague gap.dsaLink first)
  const classTopic =
    softClip(
      dayChain?.dsaTopic ||
        dayTopicRec?.dsaTopic ||
        daySlice?.dsaSubtopic ||
        themeDsa ||
        (gap?.dsaLink && !/^NA\b/i.test(String(gap.dsaLink)) ? String(gap.dsaLink) : "") ||
        (!skipDsa ? topic : "") ||
        topic,
      60
    ) || "today's topic";

  const subjectHint = softClip(
    dayTopicRec?.learnLabel || dayChain?.learnLabel || gap?.learnTopic || topic,
    60
  );

  const learnedPattern = resolveDayLcPattern({
    dsaTopic: classTopic,
    subjectTopic: subjectHint,
    learnLabel: topic,
    sdTitle: skipDsa ? sdTitle : "",
    fallbackPattern: dayChain?.pattern || dayTopicRec?.pattern || picks?.leetcode?.pattern || "",
    dsaEnabled: !skipDsa,
  });

  const chainPattern = softClip(dayChain?.pattern || dayTopicRec?.pattern || learnedPattern, 40);

  // Persist topic so team / regen / homework tab stay aligned
  if (!inputs._dayTopicByAbs || typeof inputs._dayTopicByAbs !== "object") {
    inputs._dayTopicByAbs = {};
  }
  inputs._dayTopicByAbs[String(absIdx)] = {
    ...(dayTopicRec || {}),
    dsaTopic: classTopic,
    learnLabel: subjectHint,
    pattern: chainPattern,
    dayLc: dayChain?.lc || dayTopicRec?.dayLc || picks?.leetcode?.lc || null,
    dayName: dayChain?.name || picks?.leetcode?.name || "",
  };

  const exercismDay = !skipDsa && d === 1;
  const leetCodeDay = skipDsa ? true : !exercismDay;
  const agentDay = !skipBanks && (d === 0 || d === 3);
  const linkedInDay = d === 2 || d === 4;

  const tasks = [];
  const fingerprints = [];

  if (leetCodeDay) {
    const { pickSdLeetCode, pickLcByPatternFamily, isCacheProblem } = require("../data/sdLeetCodeBank");
    const { leetcodeDifficultiesForProfile } = require("./academicLevel");
    const prefs = leetcodeDifficultiesForProfile(actor.profile);
    const ragPack = (inputs || {})._assessmentRagPack || null;
    const allowCache = /cache|lru|lfu/i.test(chainPattern);

    let prob = null;

    // Strongest link: continue same pattern as daytime Coding Practice
    if (chainPattern) {
      const nightPrefs =
        actor.profile.learnerPace?.preferEasyLc || actor.profile.depth <= 2
          ? ["Easy", "Medium"]
          : prefs;
      prob = pickLcByPatternFamily({
        dayIdx: absIdx + 17,
        pattern: chainPattern,
        usedLc: used.lc,
        difficultyPrefs: nightPrefs,
        ragPack,
        preferEasy: Boolean(actor.profile.learnerPace?.preferEasyLc) || actor.profile.depth <= 2,
        sdTitle: skipDsa ? sdTitle : "",
        learnLabel: classTopic,
        allowCacheFallback: allowCache,
      });
    }

    // If night pick equals day pick, keep it — that is the clearest connection
    if (
      !prob &&
      dayChain?.lc &&
      picks?.leetcode?.lc &&
      String(picks.leetcode.lc) === String(dayChain.lc)
    ) {
      prob = picks.leetcode;
      if (!used.lc.map(String).includes(String(prob.lc))) used.lc.push(String(prob.lc));
    }

    // DSA ON: never use SD/cache bank. DSA OFF: SD-linked only when lesson maps.
    if (!prob && skipDsa) {
      prob = pickSdLeetCode(absIdx, sdTitle, classTopic, used.lc, prefs, ragPack);
    }

    if (!prob) {
      const topicPick = pickTopicProblems(
        softClip(`${classTopic} ${subjectHint}`, 120),
        absIdx + 17,
        picks?.leetcode,
        used.lc,
        actor,
        ragPack
      );
      prob = topicPick?.easy || topicPick?.medium || null;
    }

    if (
      !prob &&
      picks?.leetcode?.lc &&
      !used.lc.map(String).includes(String(picks.leetcode.lc))
    ) {
      prob = picks.leetcode;
      used.lc.push(String(prob.lc));
    }
    if (!prob && picks?.leetcode?.lc) {
      prob = picks.leetcode;
    }

    if (prob && !allowCache && typeof isCacheProblem === "function" && isCacheProblem(prob)) {
      prob = pickLcByPatternFamily({
        dayIdx: absIdx + 31,
        pattern: chainPattern || "Arrays & Hashing",
        usedLc: used.lc,
        difficultyPrefs: prefs,
        ragPack,
        preferEasy: true,
        learnLabel: classTopic,
        allowCacheFallback: false,
      });
    }

    // Last resort on DSA days: reuse daytime problem so homework never disconnects
    if (!prob && dayChain?.lc) {
      prob = {
        lc: dayChain.lc,
        name: dayChain.name || `Problem ${dayChain.lc}`,
        difficulty: "Easy",
        pattern: dayChain.pattern || chainPattern,
        url: dayChain.url || leetcodeUrl({ lc: dayChain.lc, name: dayChain.name }),
      };
    }

    if (prob) {
      // Always normalize URL so Open link matches the named problem
      prob = {
        ...prob,
        url: leetcodeUrl(prob),
      };
      const pattern = softClip(prob.pattern || chainPattern || "problem solving", 40);
      const dayLc = dayChain?.lc || picks?.leetcode?.lc || "";
      const dayName = dayChain?.name || picks?.leetcode?.name || "";
      const why = softClip(
        dayLc
          ? `Tonight continues today's Coding Practice (#${dayLc}) on class topic “${classTopic}” — same pattern “${pattern}”.`
          : `Tonight practices what you studied today: “${classTopic}” — pattern “${pattern}”.`,
        160
      );
      const sdMeta = {
        title: classTopic,
        classTopic,
        pattern,
        dayLc,
        dayName,
        why,
      };
      const lc = hwLeetCode(prob, sdMeta, {
        problemQuote,
        learnLabel: topic,
        classTopic,
        dayLc,
      });
      if (lc) {
        tasks.push(lc);
        fingerprints.push(
          `lc:${prob.lc || prob.name}:y${actor.profile.collegeYear}:s${actor.profile.semester}:m${actor.memberIdx}`
        );
      }
    }
  } else if (exercismDay) {
    const ex = hwExercism(pickExercismExercise(absIdx, chainPattern || classTopic, used.ex, actor), problemQuote);
    if (ex) {
      tasks.push(ex);
      fingerprints.push(`ex:${ex.split("\n")[1] || absIdx}:m${actor.memberIdx}`);
    }
  }

  // 2) One light side task (never a second coding platform)
  if (agentDay) {
    let ragTask = null;
    try {
      const { getAgentRagTask } = require("./enrichAgentWorkbenchRag");
      ragTask = getAgentRagTask((inputs || {})._agentRagPack, absIdx);
    } catch (_) {}
    const ag = hwAgentWorkbench(absIdx + actor.seed, used.agent, problemQuote, {
      problemQuote,
      inputs,
      ragTask,
    });
    if (ag) {
      tasks.push(ag);
      fingerprints.push(`ag:${ag.split("\n")[1] || absIdx}:m${actor.memberIdx}`);
    }
  } else if (linkedInDay) {
    const li = hwLinkedInArticle(absIdx + actor.seed, topic, dayKey, used.linkedin, problemQuote);
    if (li) {
      tasks.push(li);
      fingerprints.push(`li:${li.split("\n")[1] || absIdx}:m${actor.memberIdx}`);
    }
  }

  // 3) Case for TOMORROW's Speak & Solve — unique per year/sem/member
  const cs = hwCaseStudyForTomorrow(dayIdx, inputs || {}, dayKey, actor);
  if (cs) {
    tasks.push(cs);
    fingerprints.push(`cs:${cs.split("\n")[2] || absIdx}:m${actor.memberIdx}`);
  }

  // Cap 3 — coding first, side task, case
  let paceLine = "";
  let paceKey = "average";
  try {
    const pace =
      actor.profile?.learnerPace ||
      require("./academicLevel").resolveLearnerPace(actor.profile?.skillLevel);
    paceKey = pace.key || "average";
    paceLine = `Pace: ${pace.label} — ${softClip(pace.homeworkRule || pace.coreRule || "", 90)}`;
  } catch (_) {
    paceLine = "";
  }

  let careerLines = [];
  try {
    const { buildCareerHomeworkBlock } = require("./personaDevelopment");
    careerLines = buildCareerHomeworkBlock(inputs || {}, actor.member).map((l) =>
      String(l).startsWith("▶") ? l : `▶ ${l}`
    );
  } catch (_) {
    careerLines = [];
  }

  const nightMins =
    paceKey === "slow"
      ? "~45–60 min"
      : paceKey === "steady"
        ? "~50–65 min"
        : paceKey === "fast"
          ? "~40–55 min"
          : "~45–70 min";

  const nightStory = [
    `Learned today: ${subjectHint || classTopic}${chainPattern ? ` · pattern ${chainPattern}` : ""}.`,
    `Objective: lock today's idea with practice that also serves your career goal.`,
    `Outcome: (1) 2-sentence recap of what you learned (2) 1 Apply line → your role/goal (3) tomorrow's Speak case is prepped.`,
    `Purpose tonight (${nightMins}): class → homework → tomorrow Speak.`,
    paceLine || null,
    ...careerLines.slice(0, 3),
    `Tasks (max 3): coding on today's pattern → side task (if any) → tomorrow's Speak case.`,
  ]
    .filter(Boolean)
    .join("\n");

  const body = [nightStory, ...tasks.filter(Boolean).slice(0, 3)].join("\n\n");

  const sigKey = `m${actor.memberIdx}`;
  const sig = fingerprints.join("|");
  if (inputs && sig) {
    if (!inputs._homeworkLastSigByActor || typeof inputs._homeworkLastSigByActor !== "object") {
      inputs._homeworkLastSigByActor = {};
    }
    const prev = inputs._homeworkLastSigByActor[sigKey] || "";
    if (prev === sig) {
      return `${body}\n\nCase study\nDay ${absIdx + 1} focus — write 1 new insight that you did NOT write on any earlier night.`;
    }
    inputs._homeworkLastSigByActor[sigKey] = sig;
    inputs._homeworkLastSig = sig;
  }

  // Issue 15: do not repeat "Tonight's Homework" inside content (row header already has it)
  return body;
}

function lightPlacementBlock(company, dayIdx = 0) {
  return formatLightPlacement(company, dayIdx);
}

function problemLabBlock(gap, learnLabel, problemQuote, link, dayIdx = 0, dtStep = null) {
  const step = dtStep?.step || "today's DT step";
  const page =
    dtStep?.page != null && Number.isFinite(Number(dtStep.page))
      ? `DT Playbook page ${dtStep.page}`
      : "today's DT Playbook page";
  return bullets([
    `▶ Concept: ${step} — write the problem answers`,
    `▶ Purpose: so Project Build has a clear, written problem (not guesses).`,
    `▶ Connect: Learning "${softClip(learnLabel, 50)}" + this write-up → Project.`,
    `▶ Do: Open ${page} and write answers in your own words (short, complete).`,
    `▶ ${docsHintForDtStep(dtStep)} Copy today's answers into the PRD.`,
    `▶ Outcome: ${page} is filled and the problem piece is clear.`,
  ]);
}

/**
 * Mini Build — persona development tool:
 * Attitude · Logical/Business · Technical + gentle dislike challenges + subject integration.
 */
function profileFocusBlock(dayIdx = 0, inputs = {}, learnLabel = "", dtStep = null, problemQuote = "") {
  try {
    const { buildPersonaMiniBuild, detectStudyMedium, parseDislikeFlags } = require("./personaDevelopment");
    const medium = detectStudyMedium(inputs);
    const flags = parseDislikeFlags(inputs);
    // Always use persona mini-build when medium/dislikes/difficulties present; else still use outcomes
    const subjectName =
      (Array.isArray(inputs._daySubjects) && inputs._daySubjects[0]) ||
      learnLabel ||
      "";
    const built = buildPersonaMiniBuild({
      dayIdx,
      inputs,
      learnLabel,
      subjectName,
      problemQuote,
      dtStep,
    });
    // Enrich with classic lenses when English-only and no strong persona flags
    if (!medium.preferNative && !flags.raw && !flags.avoidVideos) {
      const interest = softClip(inputs.interest || "", 120);
      const capability = softClip(inputs.capability || "", 120);
      const domain = softClip(inputs.domain || "", 80);
      const extra = [
        interest ? `▶ Interest lens: ${interest}` : null,
        capability ? `▶ Capability lens: ${capability}` : null,
        domain ? `▶ Domain lens: ${domain}` : null,
      ].filter(Boolean);
      if (extra.length) {
        return {
          activity: built.activity,
          content: `${built.content}\n${extra.join("\n")}`,
        };
      }
    }
    return { activity: built.activity, content: built.content };
  } catch (e) {
    console.warn("[profileFocusBlock] persona mini-build fallback:", e.message);
  }

  const interestRaw = String(inputs.interest || "");
  const capabilityRaw = String(inputs.capability || "");
  const domainRaw = String(inputs.domain || "");
  const goals = softClip(inputs.assessment || inputs.goals || inputs.outcome || "", 160);
  const interest = softClip(interestRaw, 120);
  const capability = softClip(capabilityRaw, 120);
  const domain = softClip(domainRaw, 80);
  const problem = softClip(problemQuote || "your uploaded problem", 140);
  const learn = learnLabel || "today's topic";
  const d = Math.max(0, Number(dayIdx) || 0);
  const { pickResourcesForTopic } = require("./learningResources");
  const themeKey = interest || domain || learn || "small product build";
  const refs = pickResourcesForTopic(themeKey, "beginner project practice");

  const isBeginner = /beginner|new to|learning fundamentals|weak at/i.test(capabilityRaw);
  const isAdvanced = /advanced|owns modules|end-to-end/i.test(capabilityRaw);
  const level = isBeginner ? "beginner" : isAdvanced ? "advanced" : "intermediate";

  const interestTask = (() => {
    const t = interestRaw.toLowerCase();
    if (/ui|design|figma|wireframe|front.?end|css|animation/.test(t)) {
      return level === "beginner"
        ? `Interest: paper-sketch the #1 screen for "${problem}" (labels + one CTA only)`
        : `Interest: build/mock one UI screen for "${problem}" with a clear primary action`;
    }
    if (/chat|bot|llm|ai|assistant|prompt|agent/.test(t)) {
      return `Interest: write 5 FAQs for "${problem}" and answer 2 of them (script or tiny bot)`;
    }
    if (/iot|sensor|hardware|embed/.test(t)) {
      return `Interest: list 3 sensor values for "${problem}" and show them in a tiny table (real or simulated)`;
    }
    if (/game|quiz|puzzle|playful|dsa|leet/.test(t)) {
      return `Interest: make a 5-question quiz OR 1 worked example that teaches a piece of "${problem}"`;
    }
    if (/data|chart|analy|dashboard/.test(t)) {
      return `Interest: one chart/table that answers a decision question for "${problem}"`;
    }
    if (/mobile|android|ios/.test(t)) {
      return `Interest: design the 30-second mobile job for "${problem}" (one screen + action)`;
    }
    if (/web|full.?stack/.test(t)) {
      return `Interest: ship a thin slice for "${problem}" (one form → one saved note/record)`;
    }
    return `Interest: write how "${interest || "your interest"}" appears inside "${problem}" (3 lines) + one tiny demo idea`;
  })();

  const capabilityTask = (() => {
    if (level === "beginner") {
      return `Capability: practise "${learn}" with one worked example at beginner level (no new tools today)`;
    }
    if (level === "advanced") {
      return `Capability: own one small module for "${problem}" that uses "${learn}" — define API/data + done check`;
    }
    if (/weak at\s*([^.\n]+)/i.test(capabilityRaw)) {
      const weak = capabilityRaw.match(/weak at\s*([^.\n]+)/i)?.[1]?.trim() || "your weak area";
      return `Capability: 20-min drill on weak area (${softClip(weak, 40)}) linked to "${learn}"`;
    }
    return `Capability: apply "${learn}" at your level (${level}) with one concrete example from "${problem}"`;
  })();

  const domainTask = (() => {
    const t = domainRaw.toLowerCase();
    if (/web|full.?stack|front/.test(t)) {
      return `Domain (Web): sketch or code one web flow step for "${problem}"`;
    }
    if (/mobile/.test(t)) {
      return `Domain (Mobile): one mobile wireframe step for "${problem}"`;
    }
    if (/ml|ai|machine/.test(t)) {
      return `Domain (ML/AI): define input → model/rule → output for one decision in "${problem}"`;
    }
    if (/data|analy/.test(t)) {
      return `Domain (Data): name 3 fields you would store for "${problem}" + why`;
    }
    if (/cloud|devops/.test(t)) {
      return `Domain (Cloud/DevOps): write the deploy/run checklist for today's mini piece`;
    }
    if (/iot|embed/.test(t)) {
      return `Domain (IoT): device → gateway → app path in 4 boxes for "${problem}"`;
    }
    if (/fintech|edtech|healthtech|cyber/.test(t)) {
      return `Domain: list 2 domain constraints (trust / compliance / UX) for "${problem}"`;
    }
    return `Domain (${domain || "your field"}): one domain-flavored artifact for "${problem}"`;
  })();

  const goalTask = goals
    ? `Goal: one action today that moves "${goals}" AND helps "${problem}"`
    : `Goal: write your outcome in one line, then one action that moves it today`;

  // Rotate focus so the week covers Interest → Capability → Domain → Goals, without dumping all every day
  const tracks = [
    { title: "Interest → problem demo", focus: "Interest", tasks: [interestTask, goalTask, `Link: note where "${learn}" shows up (notes/mini-build.md)`] },
    { title: "Capability drill on today's learning", focus: "Capability", tasks: [capabilityTask, interestTask, `Save: what got easier vs still stuck (3 lines)`] },
    { title: "Domain-shaped slice", focus: "Domain", tasks: [domainTask, goalTask, `Connect to DT Step "${dtStep?.step || learn}" in 2 bullets`] },
    { title: "Goal checkpoint build", focus: "Goals", tasks: [goalTask, capabilityTask, `Ship proof: demo OR notes/mini-build.md with before→after`] },
    { title: "Integrate interest + domain", focus: "Interest + Domain", tasks: [interestTask, domainTask, `Ship proof: notes/mini-build.md lists interest × domain × problem in 3 bullets`] },
  ];
  const pick = tracks[d % tracks.length];

  return {
    activity: "Mini Build",
    content: bullets([
      `▶ Mini Build (15–25 min) — extend / test Project Build`,
      `▶ Heading: ${pick.title}`,
      `▶ Scope: ONE small, completable sub-piece — not a copy of Project Build.`,
      `▶ Start from Project Build output today (file, sketch, or notes) and add ONE of:`,
      `▶ 1) ${pick.tasks[0]}`,
      `▶ 2) Smoke-test or peer-check that sub-piece (write pass/fail in 1 line)`,
      `▶ 3) Save as mini-build-day${d + 1}.md or a runnable snippet named mini-${d + 1}`,
      interest ? `▶ Interest lens: ${interest}` : null,
      capability ? `▶ Capability lens: ${capability}` : null,
      domain ? `▶ Domain lens: ${domain}` : null,
      `▶ Problem Statement (in short): ${problem}`,
      `▶ Today's Learning to reuse: ${learn}`,
      dtStep?.step
        ? `▶ Related DT Step: ${dtStep.step} (do not re-answer DT questions here — already done in Problem Lab).`
        : null,
      `▶ Done when: mini-build-day${d + 1}.md (or runnable file) exists AND names what it extends from Project Build.`,
    ]),
  };
}

function deepenLearnBlock(learnLabel, dayIdx = 0, gap = null) {
  const modes = [
    `▶ Same topic: ${learnLabel}`,
    `▶ One more small example in your problem domain.`,
    `▶ Answer the check question in writing.`,
  ];
  const extras = [
    `▶ Extra: write one "wrong idea" students often have about this topic.`,
    `▶ Extra: teach the topic in 4 spoken sentences (record or say aloud).`,
    `▶ Extra: draw boxes/arrows for where this topic sits in your project.`,
    `▶ Extra: list 2 terms you must not confuse (and why).`,
    `▶ Extra: write one question you still cannot answer yet.`,
  ];
  const refs = buildLearningLinkLines(learnLabel, gap || {}, {});
  return bullets([
    modes[0],
    modes[1],
    modes[2],
    extras[Math.max(0, dayIdx) % extras.length],
    ...refs,
  ]);
}

/**
 * Build a full continuous day — times from Basics → Timing inputs.
 * Plain English, exact DT Playbook stage/step names, learning links, homework.
 */
function truthySkip(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

function overlayMemberPersona(root = {}, member = null) {
  if (!member || typeof member !== "object") return root;
  const copy = { ...root };
  const take = (key) => {
    const v = member[key];
    if (v == null) return;
    const s = typeof v === "string" ? v.trim() : v;
    if (s === "" || s === false) return;
    copy[key] = s;
  };
  take("skillLevel");
  take("interest");
  take("capability");
  take("difficulties");
  take("dislikes");
  take("domain");
  take("assessment");
  take("studyMedium");
  take("leetcodeUsername");
  take("targetCompany");
  take("targetRole");
  take("college");
  take("collegeYear");
  take("semester");
  take("schoolGrade");
  take("department");
  return copy;
}

function buildGapDrivenDayRows(dayKey, gap, opts = {}) {
  const theme = opts.theme || {};
  const dtStep = opts.dtStep || null;
  const nonCode = isNonCodeDtDay(dtStep) || isBasicsFirstDay(dtStep) || isTechStackStep(dtStep);
  const problemFirst = nonCode; // Empathy / Pitch / basics / tech-suggest → problem-first day
  const dayIdx = opts.dayIdx || 0;
  const root = opts.inputs || {};
  if (!Array.isArray(root._planUsedLc)) root._planUsedLc = [];
  if (!Array.isArray(root._planUsedMotivation)) root._planUsedMotivation = [];
  const actor = resolveHomeworkActor(root, {
    member: opts.member,
    memberIdx: opts.memberIdx,
  });
  const inputs = overlayMemberPersona(root, actor.member);
  inputs._planUsedLc = root._planUsedLc;
  inputs._planUsedMotivation = root._planUsedMotivation;
  const cfg = parseAssessmentConfig(inputs);
  cfg._planUsedLc = inputs._planUsedLc;
  cfg._planUsedMotivation = inputs._planUsedMotivation;
  cfg._solvedLc = inputs._solvedLc;
  cfg._solvedLcByUser = inputs._solvedLcByUser;
  cfg.leetcodeUsername = inputs.leetcodeUsername;
  cfg.inputs = inputs;
  const picks = pickForDay(dayIdx, cfg, actor.memberIdx, actor.member || actor.profile);
  if (picks?._markLcUsed && !inputs._planUsedLc.map(String).includes(String(picks._markLcUsed))) {
    inputs._planUsedLc.push(String(picks._markLcUsed));
  }
  if (
    picks?._markMotivationUsed &&
    !inputs._planUsedMotivation.includes(picks._markMotivationUsed)
  ) {
    inputs._planUsedMotivation.push(picks._markMotivationUsed);
  }

  // Include toggles from Inputs — OFF means do not schedule that work
  const skipDsa = truthySkip(inputs._skipDsa);
  const skipSd = truthySkip(inputs._skipSystemDesign);
  const skipBanks = truthySkip(inputs._skipAssessmentBanks);

  // Agent Workbench only on coding days + bank ON
  const includeAgent =
    !problemFirst &&
    !skipBanks &&
    cfg.banks?.agentWorkbench !== false;
  // Mid slot: Problem Lab on notes/overview days; Coding Practice only when DSA is ON
  const absForMid = absoluteDayIndex(dayKey, dayIdx);
  const forceOverviewMid = absForMid === 0 || problemFirst;
  const includeMid = forceOverviewMid || !skipDsa;
  const includeSd = !skipSd;
  const company =
    opts.company ||
    inputs.targetCompany ||
    inputs.dreamCompany ||
    "";

  const weekDay = weekDayIndex(dayIdx, dayKey);
  // Afternoon: Placement EVERY weekday (Mon–Fri rotation). Mini Build Tue/Thu.
  const includePlacement = true;
  const includeMiniBuild = weekDay === 1 || weekDay === 3;

  const { window, slots } = buildDaySlotMap(inputs, {
    includeAgent,
    includeSd,
    includeMid,
    includeSpeak: true,
    includeHomework: true,
    problemFirst,
    includeGame: true,
    includePlacement,
    includeMiniBuild,
  });

  const problemFull = getProblemText(inputs, theme);
  const team = isTeamMode(inputs);
  const problemQuote = studentProblemGlance(problemFull, 160, inputs);
  const problemShort = studentProblemGlance(problemFull, 120, inputs);
  const daySlice = opts.daySlice || null;
  const subject = daySlice?.primarySubject || theme?.subjects?.[0] || null;
  const learnLabel = shortLearnLabel(
    isNonCodeDtDay(dtStep) || isBasicsFirstDay(dtStep) ? dtStep : null,
    gap.learnTopic,
    isNonCodeDtDay(dtStep) || isBasicsFirstDay(dtStep) ? null : subject
  );
  const finish = beginnerFinishPlan(dtStep, problemFull, gap, inputs);
  const absDay = absoluteDayIndex(dayKey, dayIdx);
  const isOverviewDay = absDay === 0 || isBasicsFirstDay(dtStep);

  // Single source of truth for day↔night: class topic + pattern (homework MUST read this)
  const dsaTopicSeed =
    daySlice?.dsaSubtopic ||
    theme?.dsa ||
    (gap.dsaLink && !/^NA\b/i.test(String(gap.dsaLink)) ? String(gap.dsaLink) : "") ||
    "";
  const patternSeed = resolveDayLcPattern({
    dsaTopic: dsaTopicSeed,
    subjectTopic: subject?.topic || subject?.name || gap.learnTopic || learnLabel || "",
    learnLabel,
    sdTitle: "",
    fallbackPattern: picks?.leetcode?.pattern || "",
    dsaEnabled: !skipDsa,
  });
  if (!inputs._dayTopicByAbs || typeof inputs._dayTopicByAbs !== "object") {
    inputs._dayTopicByAbs = {};
  }
  inputs._dayTopicByAbs[String(absDay)] = {
    dsaTopic: softClip(dsaTopicSeed || (!skipDsa ? patternSeed : learnLabel), 60),
    learnLabel: softClip(learnLabel, 60),
    pattern: softClip(patternSeed, 40),
    dayLc: null,
    dayName: "",
  };

  // RULE: daytime Coding Practice LC + tonight's homework share one pattern from TODAY's learning
  // (DSA / subject first — not a random rotation).
  let dayLcChain = null;
  if (!skipDsa && includeMid && !forceOverviewMid && !problemFirst) {
    try {
      const { pickLcByPatternFamily } = require("../data/sdLeetCodeBank");
      const { leetcodeDifficultiesForProfile } = require("./academicLevel");
      const sdTitleForChain = todaySdLessonTitle(absDay, inputs) || "";
      const dsaTopicForDay =
        daySlice?.dsaSubtopic ||
        theme?.dsa ||
        (gap.dsaLink && !/^NA\b/i.test(String(gap.dsaLink)) ? gap.dsaLink : "") ||
        "";
      const subjectTopicForDay =
        subject?.topic ||
        subject?.name ||
        gap.learnTopic ||
        learnLabel ||
        "";
      const patternForDay = resolveDayLcPattern({
        dsaTopic: dsaTopicForDay,
        subjectTopic: subjectTopicForDay,
        learnLabel,
        sdTitle: "", // DSA on: pattern from DSA/subject only — not SD (avoids cache when not taught)
        fallbackPattern: picks?.leetcode?.pattern || "",
        dsaEnabled: true,
      });
      const prefs = leetcodeDifficultiesForProfile(actor.profile);
      // Don't reuse tonight's used list yet — day pick goes into plan used
      const usedForDay = Array.isArray(inputs._planUsedLc) ? inputs._planUsedLc.slice() : [];
      // If assessment already reserved a number, allow replacing it with pattern-matched Easy
      if (picks?._markLcUsed) {
        const idx = usedForDay.map(String).indexOf(String(picks._markLcUsed));
        if (idx >= 0) usedForDay.splice(idx, 1);
      }
      const allowCache = /cache|lru|lfu/i.test(patternForDay);
      let dayProb = pickLcByPatternFamily({
        dayIdx: absDay,
        pattern: patternForDay,
        usedLc: usedForDay,
        difficultyPrefs: prefs,
        ragPack: inputs._assessmentRagPack || null,
        preferEasy: true,
        sdTitle: "",
        learnLabel: softClip(dsaTopicForDay || learnLabel, 60),
        allowCacheFallback: allowCache,
      });
      // Topic-token fallback when family pool is thin
      if (!dayProb || !dayProb.lc) {
        const topicPick = pickTopicProblems(
          `${dsaTopicForDay} ${learnLabel} ${subjectTopicForDay}`.trim(),
          absDay,
          picks?.leetcode,
          usedForDay,
          actor,
          inputs._assessmentRagPack || null
        );
        dayProb = topicPick?.easy || dayProb;
      }
      // Reject cache if today's DSA was not cache
      if (dayProb && !allowCache) {
        try {
          const { isCacheProblem } = require("../data/sdLeetCodeBank");
          if (isCacheProblem(dayProb)) {
            dayProb = pickLcByPatternFamily({
              dayIdx: absDay + 7,
              pattern: "Arrays & Hashing",
              usedLc: usedForDay,
              difficultyPrefs: prefs,
              ragPack: inputs._assessmentRagPack || null,
              preferEasy: true,
              learnLabel: dsaTopicForDay || learnLabel,
              allowCacheFallback: false,
            });
          }
        } catch (_) {}
      }
      if (dayProb) {
        const prevMark = picks._markLcUsed ? String(picks._markLcUsed) : null;
        picks.leetcode = {
          platform: "LeetCode",
          lc: dayProb.lc,
          name: dayProb.name,
          difficulty: dayProb.difficulty,
          pattern: dayProb.pattern || patternForDay,
          url: dayProb.url,
          label: `LeetCode #${dayProb.lc} — ${dayProb.name} (${dayProb.difficulty})`,
          source: dayProb.source || "day-chain",
        };
        picks._markLcUsed = String(dayProb.lc);
        if (!Array.isArray(inputs._planUsedLc)) inputs._planUsedLc = [];
        if (prevMark && prevMark !== String(dayProb.lc)) {
          inputs._planUsedLc = inputs._planUsedLc.map(String).filter((x) => x !== prevMark);
        }
        if (!inputs._planUsedLc.map(String).includes(String(dayProb.lc))) {
          inputs._planUsedLc.push(String(dayProb.lc));
        }
        dayLcChain = {
          lc: dayProb.lc,
          name: dayProb.name,
          pattern: softClip(dayProb.pattern || patternForDay, 40),
          sdTitle: sdTitleForChain,
          dsaTopic: softClip(dsaTopicForDay || patternForDay, 60),
          learnLabel: softClip(learnLabel, 60),
          problemQuote,
          url: dayProb.url || leetcodeUrl(dayProb),
        };
        if (!inputs._dayLcByAbs || typeof inputs._dayLcByAbs !== "object") {
          inputs._dayLcByAbs = {};
        }
        inputs._dayLcByAbs[String(absDay)] = dayLcChain;
        inputs._dayTopicByAbs[String(absDay)] = {
          dsaTopic: dayLcChain.dsaTopic,
          learnLabel: dayLcChain.learnLabel,
          pattern: dayLcChain.pattern,
          dayLc: dayLcChain.lc,
          dayName: dayLcChain.name,
        };
      }
    } catch (e) {
      console.warn("Day LC chain alignment skipped:", e.message);
    }
  }
  // Year-level + Slow / Steady / Average / Fast learner pace
  const academic = resolveAcademicProfile(inputs, actor.member);
  const depth = Math.max(1, Number(academic.depth) || 2);
  const { resolveLearnerPace, formatPaceSlotLine } = require("./academicLevel");
  const learnerPace = academic.learnerPace || resolveLearnerPace(academic.skillLevel);
  const paceLearnLine = formatPaceSlotLine(academic, "learning");
  const paceProjectLine = formatPaceSlotLine(academic, "project");
  const paceCodingLine = formatPaceSlotLine(academic, "coding");
  const link =
    gap.linkToProblem ||
    `Today's topic ("${learnLabel}") helps you take one clear step on ${
      hasProblemUpload(inputs) ? "your uploaded problem" : "your project problem"
    }.`;
  const whyStudy = `You need "${softClip(learnLabel, 50)}" to take the next step on "${softClip(problemQuote || "your project", 60)}".`;
  const stepsRaw = Array.isArray(gap.steps) && gap.steps.length
    ? gap.steps
    : beginnerSteps(dtStep, problemShort, learnLabel);
  // Day 1 / overview: max 3 sketch steps; Slow −1 / Fast +1
  const baseCap = isOverviewDay ? 3 : depth <= 1 ? 3 : depth === 2 ? 4 : 5;
  const stepCap = Math.max(2, Math.min(6, baseCap + (Number(learnerPace.stepCapDelta) || 0)));
  const steps = stepsRaw.slice(0, stepCap).map((s) => {
    const t = String(s || "");
    if (isOverviewDay && /code|implement|build the app|website|deploy/i.test(t) && !/sketch|notes|paper|draw/i.test(t)) {
      return t.replace(/code|implement/gi, "sketch / notes");
    }
    return t;
  });

  const { getAgentRagTask } = require("./enrichAgentWorkbenchRag");
  const ragTask = getAgentRagTask(inputs._agentRagPack, dayIdx);

  const suggestDay = isTechStackStep(dtStep);
  const confirmStack = !nonCode && needsTechStackConfirm(dtStep);

  const agentNotes = includeAgent
    ? formatAgentWorkbenchTask(
        null,
        cfg.agentWorkbenchNotes || "",
        problemQuote,
        ragTask,
        dayIdx,
        { projectMode: absDay >= 5, learnLabel, problemQuote }
      )
    : "";

  // Same jargons + exact questions as DT Playbook
  const pageBit =
    dtStep?.page != null && Number.isFinite(Number(dtStep.page))
      ? `DT Playbook page ${dtStep.page}`
      : "DT Playbook page";
  const slicePlain = studentProblemGlance(
    gap.problemSlice && !/From your upload|Today's focus:/i.test(String(gap.problemSlice))
      ? gap.problemSlice
      : problemQuote,
    140
  );
  // Issue 1: Problem Review = read/understand ONLY — no DT question list
  const psReviewBlock = bullets([
    `▶ Concept: ${dtStep?.step || "today's problem piece"}`,
    `▶ Purpose: understand the problem before you write answers or build.`,
    `▶ Connect: this piece drives Learning "${softClip(learnLabel, 40)}" and Project.`,
    `▶ Do: Read the problem + ${pageBit}. Do not write DT answers yet (that is Problem Lab).`,
    `▶ ${docsHintForDtStep(dtStep)}`,
    `▶ Outcome: you can say the problem in one sentence: ${slicePlain}`,
  ]);

  // Learning chapter transition
  const prevLearn = softClip(inputs._prevLearnLabel || "", 60);
  const learnTransition =
    prevLearn &&
    learnLabel &&
    String(prevLearn).toLowerCase() !== String(learnLabel).toLowerCase()
      ? `▶ Transition: You have finished "${prevLearn}". Today we move to "${learnLabel}" because it is the next concept needed for "${softClip(problemQuote, 70)}".`
      : null;
  inputs._prevLearnLabel = learnLabel;

  const learnLinkLines = buildLearningLinkLines(learnLabel, { ...gap, dayIdx }, inputs);

  const partsToday = (Array.isArray(gap.subtopics) ? gap.subtopics : [])
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .slice(0, 2);

  const partA = partsToday[0] || "simple meaning";
  const partB = partsToday[1] || "one example";
  void partA;
  void partB;

  // Multi-purpose Learning: weave day's subjects + communication + logic + math
  const learnBlock = buildMultiPurposeLearning({
    learnLabel,
    daySlice,
    theme,
    gap,
    inputs,
    problemQuote,
    dayIdx,
    absDay,
    deepen: false,
    learnTransition,
    paceLine: paceLearnLine,
    whyStudy,
    link,
    dtStep,
    isOverviewDay,
    learnLinkLines,
    suggestDay,
    problemFull,
  });

  const deepenBlock = buildMultiPurposeLearning({
    learnLabel,
    daySlice,
    theme,
    gap,
    inputs,
    problemQuote,
    dayIdx,
    absDay,
    deepen: true,
    paceLine: paceLearnLine,
    whyStudy,
    link,
    dtStep,
    isOverviewDay,
    learnLinkLines,
    problemFull,
  });

  // Exact DT Playbook jargon — Project applies learning; questions stay in Problem Lab only
  const dtStage = dtStep?.stage || null;
  const dtStepName = dtStep?.step || null;
  const totalDays = planTotalDays(inputs);
  const isLastPlanDay = totalDays != null ? absDay >= totalDays - 1 : false;

  // Forward-moving Project Build ladder (never same task 5 days in a row)
  const projectLadder = [
    `Write a 1-paragraph problem restatement for "${problemQuote}" and list 3 assumptions in project-day${absDay + 1}.md`,
    `Identify 2–3 similar existing products and note one gap each (use today's restatement)`,
    `Sketch 8 rough solution ideas (no filtering) that address today's gaps — photo or notes file`,
    `Write a 1-page user persona for the primary target user; reuse today's best idea as context`,
    `Write a single focus statement: "[User] needs a way to [need] because [insight]" — builds on today's persona`,
  ];
  const ladderTask = projectLadder[Math.max(0, dayIdx) % 5];
  const dtTaskOnly = dtStep?.realProjectTask
    ? softClip(dtStep.realProjectTask, 360)
    : ladderTask;
  // First plan day: never reference "yesterday"
  const yesterdayHint =
    absDay === 0 ? "" : softClip(inputs._prevProjectDone || "", 100);
  const projectTaskFinal =
    yesterdayHint &&
    dtTaskOnly &&
    yesterdayHint.replace(/\s+/g, " ").toLowerCase().slice(0, 80) ===
      String(dtTaskOnly).replace(/\s+/g, " ").toLowerCase().slice(0, 80)
      ? ladderTask
      : dtTaskOnly;
  const pageRef =
    dtStep?.page != null && Number.isFinite(Number(dtStep.page))
      ? `DT Playbook page ${dtStep.page}`
      : null;

  const workMode = isOverviewDay || nonCode
    ? `▶ Work mode: ROUGH PAPER / NOTES / SKETCH — produce today's project artifact (not a coded website or app today).`
    : depth <= 1
      ? `▶ Work mode: GUIDED CODE or notes — small steps only; ask before inventing features.`
      : `▶ Work mode: CODE in your editor (use the stack in notes/tech-stack.md).`;

  const techDo = techDoForProject({
    dtStep,
    learnLabel,
    problemQuote,
    task: projectTaskFinal ? softClip(projectTaskFinal, 140) : "",
    nonCode,
    isOverviewDay: isOverviewDay || absDay === 0,
  });
  const projectBlock = bullets([
    `▶ Concept: ${dtStepName || learnLabel} — apply it on the product`,
    `▶ Purpose: turn today's learning into a real PRD/SAD or code step.`,
    `▶ Connect: Problem + Learning "${softClip(learnLabel, 40)}" → this build.`,
    `▶ Do: ${softClip(techDo, 150)}`,
    paceProjectLine,
    `▶ ${docsHintForDtStep(dtStep)}`,
    `▶ Outcome: one update in PRD and/or SAD (and a small file/sketch if you code today).`,
  ]);
  void workMode;
  void dtStage;
  void confirmStack;
  void suggestDay;
  void pageRef;
  void whyStudy;
  void finish;
  void steps;
  void learnerPace;
  void stepCap;
  void team;
  inputs._prevProjectDone = projectTaskFinal || finish.shortLabel || dtStepName || learnLabel;

  const sdContent = systemDesignBlock(theme, daySlice, nonCode, dayIdx, {
    inputs,
    dtStep,
    sdRagPack: inputs._systemDesignRagPack || null,
    sdLessonPack: inputs._systemDesignLessonPack || null,
  });

  const midContent = forceOverviewMid || problemFirst
    ? problemLabBlock(gap, learnLabel, problemQuote, link, dayIdx, dtStep)
    : codingPracticeBlock(gap, picks, daySlice, theme, dayIdx, {
        problemQuote,
        sdTitle: dayLcChain?.sdTitle || todaySdLessonTitle(absDay, inputs),
        pattern: dayLcChain?.pattern || inputs._dayTopicByAbs?.[String(absDay)]?.pattern || picks?.leetcode?.pattern,
        classTopic:
          dayLcChain?.dsaTopic ||
          inputs._dayTopicByAbs?.[String(absDay)]?.dsaTopic ||
          daySlice?.dsaSubtopic ||
          theme?.dsa ||
          "",
        paceLine: paceCodingLine,
      });

  const breakContent = betweenClassBreakContent({ slotLabel: "Break" });

  const t = (key) => slots[key]?.time;
  const profileSlot = profileFocusBlock(dayIdx, inputs, learnLabel, dtStep, problemQuote);

  const standupContent = standupBlock({
    dayIdx,
    absDay,
    isLastDay: isLastPlanDay,
    team,
    learnLabel,
    dtStepName,
    nonCode,
  });

  const rows = [
    {
      time: t("standup"),
      activity: "Stand-Up",
      content: standupContent,
    },
    { time: t("problemReview"), activity: "Problem Review", content: psReviewBlock },
  ];

  // System Design comes right after reading the problem (beginner overview → continuing lessons)
  if (includeSd && slots.sysdesign) {
    rows.push({
      time: t("sysdesign"),
      activity: "System Design",
      content: sdContent,
    });
  }

  rows.push(
    { time: t("learning1"), activity: "Learning", content: learnBlock },
  );

  // Extra morning breaks (break2+) — break1 still sits after learning1 below when present
  Object.keys(slots)
    .filter((k) => /^break\d+$/.test(k) && k !== "break1")
    .sort((a, b) => Number(a.replace("break", "")) - Number(b.replace("break", "")))
    .forEach((key) => {
      if (slots[key]?.startMin != null && slots[key].startMin < (slots.lunch?.startMin ?? 99999)) {
        rows.push({
          time: t(key),
          activity: "Break",
          content: breakContent,
        });
      }
    });

  if (slots.break1) {
    rows.push({
      time: t("break1"),
      activity: "Break",
      content: breakContent,
    });
  }

  if (slots.mid) {
    rows.push({
      time: t("mid"),
      activity: problemFirst ? "Problem Lab" : "Coding Practice",
      content: midContent,
    });
  }

  if (slots.speak) {
    rows.push({
      time: t("speak"),
      activity: "Speak & Solve",
      content: speakSolveBlock(gap, picks, learnLabel, problemShort, dayIdx, {
        inputs,
        dayKey,
        member: actor.member,
        memberIdx: actor.memberIdx,
        problemQuote,
      }),
    });
  }

  rows.push(
    { time: t("learning2"), activity: "Learning", content: deepenBlock },
    {
      time: t("lunch"),
      activity: "Lunch",
      content: betweenClassBreakContent({ slotLabel: "Lunch" }),
    },
  );

  // Placement after lunch — not at end of day
  if (slots.placement) {
    rows.push({
      time: t("placement"),
      activity: "Placement Prep",
      content: problemFirst
        ? lightPlacementBlock(company, dayIdx)
        : placementBlock(company, gap, problemFull, dayIdx),
    });
  }

  rows.push({ time: t("project"), activity: "Project Build", content: projectBlock });

  if (slots.game) {
    const hasGame = Boolean(picks.game);
    rows.push({
      time: t("game"),
      activity: hasGame ? "Refresh Game" : "Break",
      content: hasGame ? refreshChoiceBlock(picks, problemQuote) : breakContent,
    });
  }

  if (includeAgent && slots.agent) {
    rows.push({
      time: t("agent"),
      activity: "Agent Workbench",
      content: typeof agentNotes === "string" && !/^▶ Agent/i.test(agentNotes)
        ? `▶ Agent Workbench\n▶ Heading: Today's automation task\n${agentNotes}`
        : agentNotes,
    });
  }

  if (slots.profileFocus) {
    rows.push({
      time: t("profileFocus"),
      activity: profileSlot.activity,
      content: profileSlot.content,
    });
  }

  // Afternoon manual breaks (keyed breakN with start after lunch)
  Object.keys(slots)
    .filter((k) => /^break\d+$/.test(k))
    .sort((a, b) => Number(a.replace("break", "")) - Number(b.replace("break", "")))
    .forEach((key) => {
      const sl = slots[key];
      if (!sl || sl.startMin == null) return;
      if (sl.startMin <= (slots.lunch?.endMin ?? 0)) return;
      // Avoid duplicating if already pushed as morning extra
      if (rows.some((r) => r.time === sl.time && r.activity === "Break")) return;
      rows.push({
        time: t(key),
        activity: "Break",
        content: breakContent,
      });
    });

  // RULE: Retrospective closes the class day (last timed activity)
  let nextTopic = null;
  try {
    const { getStepForPlanDay } = require("./dtPlaybookLookup");
    const activeStageKey = inputs?._activeDTStage || inputs?.activeDTStage || null;
    const nextStep = getStepForPlanDay(absDay + 1, activeStageKey, inputs);
    nextTopic = nextStep?.step || null;
  } catch (_) {}

  // Friday: fold weekly review into the same Retro slot so the timetable
  // doesn't grow a second column with the same clock time.
  let fridayReviewLines = [];
  if (weekDay === 4) {
    const weekN = Math.floor(absDay / 5) + 1;
    const sprintDemo =
      weekN === 2
        ? [
            `▶ Sprint Demo (Week 2): present your journey Problem → DT → Agent → System Design → LeetCode to a peer/mentor (8–10 min).`,
            `▶ Demo done when: peer/mentor logs 1 question + you list 1 follow-up fix.`,
          ]
        : [];
    fridayReviewLines = [
      `▶ Heading: End of Week ${weekN} review`,
      `▶ 1) What I shipped this week (list actual outputs/files)`,
      `▶ 2) What is incomplete and why`,
      `▶ 3) One thing I would do differently next week`,
      `▶ 4) Preview of Week ${weekN + 1} goals`,
      ...sprintDemo,
      `▶ Done when: weekly-review-w${weekN}.md has all 4 sections filled.`,
    ];
  }

  const retroContent = retroBlock(
    { ...gap, learnTopic: learnLabel, linkToProblem: link, problemSlice: gap.problemSlice },
    nonCode || isOverviewDay,
    dayIdx,
    window.endLabel,
    team,
    { nextTopic, absDay, isLastDay: isLastPlanDay, inputs }
  );
  rows.push({
    time: t("retro"),
    activity: weekDay === 4 ? "Weekly Review & Retro" : "Retrospective",
    content: fridayReviewLines.length
      ? bullets(fridayReviewLines) + "\n" + retroContent
      : retroContent,
  });

  // Homework lives in the Homework tab — stored on the day, not a class clock slot
  if (slots.homework) {
    rows.push({
      time: "Tonight",
      activity: "Tonight's Homework",
      content: homeworkBlock({
        picks,
        gap,
        learnLabel,
        agentNotes,
        sysContent: includeSd ? sdContent : "",
        dayIdx,
        dayKey,
        inputs,
        problemFirst,
        skipDsa,
        skipSd,
        skipBanks,
        member: actor.member,
        memberIdx: actor.memberIdx,
        daySlice,
        themeDsa: theme?.dsa || "",
      }),
    });
  }

  // Chronological order so multi-break slots land in the right place
  const tonight = rows.filter((r) => /^tonight$/i.test(String(r.time || "").trim()));
  const timed = rows
    .filter((r) => r.time && !/^tonight$/i.test(String(r.time || "").trim()))
    .sort((a, b) => timeSortKey(a.time) - timeSortKey(b.time));

  return [...timed, ...tonight]
    .filter((r) => r.time)
    .map((r) => [dayKey, r.time, r.activity, r.content]);
}

module.exports = {
  generateDayGapContent,
  buildGapDrivenDayRows,
  buildGapPrompt,
  fallbackGap,
  techStackSuggestGap,
  isTechStackStep,
  isBasicsFirstDay,
  applyPlaybookOverrides,
  getProblemText,
  beginnerFinishPlan,
  homeworkBlock,
  resolveHomeworkActor,
};
