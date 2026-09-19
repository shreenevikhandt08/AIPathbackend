/**
 * Academic level → difficulty / curriculum guidance.
 * College: year 1–4 / semester 1–8.
 * SNS Academy (school): grades 1–12.
 * Campus dropdown drives Tech / Arts / School + departments.
 */

const { getCampusByName } = require("../data/snsCampuses");

const YEAR_FROM_SEM = { 1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 3, 7: 4, 8: 4 };
const SEMS_FOR_YEAR = { 1: [1, 2], 2: [3, 4], 3: [5, 6], 4: [7, 8] };

const BANDS = {
  y1: {
    key: "foundation",
    label: "Year 1 · Foundation",
    depth: 1,
    learnStyle: "concrete examples, definitions, tiny practice — no heavy theory dumps",
    sdFocus: "only Client → Logic/API → Store overview; users and simple data nouns",
    projectStyle: "notes, sketches, 1 tiny demo max — never a full production system",
    stress: "low",
  },
  y2: {
    key: "building",
    label: "Year 2 · Building blocks",
    depth: 2,
    learnStyle: "one concept + one worked example; light jargon with plain English first",
    sdFocus: "screens, basic APIs, stored fields, happy/failure path — still beginner SD",
    projectStyle: "small features in one file/module; guided steps",
    stress: "low-medium",
  },
  y3: {
    key: "applied",
    label: "Year 3 · Applied",
    depth: 3,
    learnStyle: "apply concept to the problem; short trade-offs allowed",
    sdFocus: "modules, auth basics, validation, simple scale awareness",
    projectStyle: "end-to-end mini slice with clear done-when",
    stress: "medium",
  },
  y4: {
    key: "placement",
    label: "Year 4 · Placement-ready",
    depth: 4,
    learnStyle: "interview-ready depth; why/when of choices; still one topic per day",
    sdFocus: "architecture choices, caching idea, scale, logging — tied to dream role",
    projectStyle: "demo-able slice + short design rationale (not PhD research)",
    stress: "medium — challenging but not PhD syllabus",
  },
  // School grades mapped into soft bands
  g_primary: {
    key: "school-primary",
    label: "School · Primary (1–5)",
    depth: 1,
    learnStyle: "very simple words, pictures, short activities — no coding jargon",
    sdFocus: "who uses it · what happens · draw boxes — play-level systems thinking",
    projectStyle: "drawings, short stories, tiny demos with adults helping",
    stress: "very low",
  },
  g_middle: {
    key: "school-middle",
    label: "School · Middle (6–8)",
    depth: 1,
    learnStyle: "plain English, one idea at a time, fun examples",
    sdFocus: "simple flow: input → process → output; no architecture interviews",
    projectStyle: "scratch-style / notes / simple slides — curiosity first",
    stress: "low",
  },
  g_secondary: {
    key: "school-secondary",
    label: "School · Secondary (9–10)",
    depth: 2,
    learnStyle: "school-level STEM / commerce clarity; still not college semester load",
    sdFocus: "problem → users → simple solution sketch",
    projectStyle: "small projects, science-fair style, light tools",
    stress: "low-medium",
  },
  g_senior: {
    key: "school-senior",
    label: "School · Senior secondary (11–12)",
    depth: 2,
    learnStyle: "board-exam friendly depth; intro college ideas only if needed",
    sdFocus: "light product thinking + simple Client → API → Store if CS stream",
    projectStyle: "mini projects suitable for Class 11–12 — not placement SDE grind",
    stress: "medium for school, never college final-year intensity",
  },
};

/**
 * Classroom pace paths — 4 learner types.
 * Mapped from skillLevel (1–5):
 *   1 → Slow · 2 → Steady · 3 → Average · 4–5 → Fast
 * Fast finishers get shorter CORE and more enrichment / like-based tasks.
 */
const LEARNER_PACES = {
  slow: {
    key: "slow",
    label: "Slow pace",
    shortLabel: "Slow",
    who: "Needs more time, loses focus easily, or finds new ideas hard at first",
    timeBoxMin: 60,
    timeBoxMax: 95,
    coreShare: 0.85,
    enrichmentShare: 0.15,
    stepCapDelta: -1,
    preferEasyLc: true,
    coreRule:
      "Do only the main checklist below. Skip extras. Take a 2-min break if focus drops, then return to the same step.",
    support: [
      "Re-read today's idea once out loud (or whisper).",
      "Copy one worked example; change only 1 number/name.",
      "2-min break if focus drops — then return to the same step (do not start a new topic).",
      "Ask faculty/peer ONE clarifying question before coding.",
    ],
    challenge: [
      "Only if main checklist is done: teach your example to a peer in 4 sentences.",
    ],
    homeworkRule: "Easy LC + short Apply (2 lines). Case skim OK. Cap night ~45–60 min.",
    betweenClassRule: "Break = rest only. No tasks. Interest/weakness work stays in Mini Build & Retro.",
  },
  steady: {
    key: "steady",
    label: "Steady pace",
    shortLabel: "Steady",
    who: "Builds confidence with smaller steps; slightly more time than average",
    timeBoxMin: 50,
    timeBoxMax: 80,
    coreShare: 0.75,
    enrichmentShare: 0.25,
    stepCapDelta: -0,
    preferEasyLc: true,
    coreRule:
      "Finish the main checklist. Use a support step if stuck. Add one light extra only if the checklist is solid.",
    support: [
      "Write a 3-bullet checklist before you start coding.",
      "If stuck >12 min: re-do the Learning example once, then continue.",
      "Pair a liked subject/hobby metaphor with today's concept (1 sentence).",
    ],
    challenge: [
      "Add one tiny Apply to your project (2 lines) after the main checklist.",
    ],
    homeworkRule: "Easy→Medium LC if ready; Apply 3 lines to career goal. Cap night ~50–65 min.",
    betweenClassRule: "Break = rest only. Optional quiet sit if pressured — no micro-tasks.",
  },
  average: {
    key: "average",
    label: "Average pace",
    shortLabel: "Average",
    who: "Follows the standard day path comfortably",
    timeBoxMin: 40,
    timeBoxMax: 70,
    coreShare: 0.65,
    enrichmentShare: 0.35,
    stepCapDelta: 0,
    preferEasyLc: false,
    coreRule:
      "Finish the main checklist. Use a support step only if stuck >10 min. Try one extra task if time remains.",
    support: [
      "If stuck >10 min: write what you tried, then ask for a hint (not the full answer).",
      "Check your notes from Learning before inventing a new approach.",
    ],
    challenge: [
      "Add one edge case or second example on the same topic.",
      "Write one peer question you could ask tomorrow in Speak & Solve.",
    ],
    homeworkRule: "Standard night path A→B→C (~45–70 min) tied to career goal.",
    betweenClassRule: "Break = rest only. Interest/weakness work is in Mini Build & Retrospective.",
  },
  fast: {
    key: "fast",
    label: "Fast pace",
    shortLabel: "Fast",
    who: "Finishes the main checklist early and still has focus/time left",
    timeBoxMin: 25,
    timeBoxMax: 50,
    coreShare: 0.45,
    enrichmentShare: 0.55,
    stepCapDelta: 1,
    preferEasyLc: false,
    coreRule:
      "Finish the main checklist in about the first half of the slot, then do the numbered Extra tasks below (in order). Help one peer for 5 min if asked.",
    support: [
      "Only if you discover a gap: fill the missing definition in 3 bullets, then continue Extra tasks.",
    ],
    challenge: [
      "Extra A: one harder variant of today's example OR a second Apply to the project (write it in notes).",
      "Extra B: write a 5-line cheat-sheet a slower peer could use tomorrow.",
      "Extra C (if DSA on): attempt the harder Option B / Medium after Easy is Accepted.",
      "Extra D: map today's topic → your target role in 4 bullets.",
    ],
    homeworkRule:
      "Same-pattern night LC + career Apply; after Apply, add 1 enrichment bullet toward your goal/outcome. Cap night ~40–55 min.",
    betweenClassRule:
      "Break = rest only. If you finish early in Learning/Project, use Extra tasks there — never on Break.",
  },
};

function resolveLearnerPace(skillLevel = 3) {
  const s = clampInt(skillLevel, 1, 5, 3);
  if (s <= 1) return LEARNER_PACES.slow;
  if (s === 2) return LEARNER_PACES.steady;
  if (s === 3) return LEARNER_PACES.average;
  return LEARNER_PACES.fast; // 4–5
}

/** Format concrete learner tasks (no vague CORE% jargon). */
function formatLearnerPaceBlock(profileOrSkill = 3, opts = {}) {
  const skill =
    typeof profileOrSkill === "object" && profileOrSkill
      ? profileOrSkill.skillLevel
      : profileOrSkill;
  const mine = resolveLearnerPace(skill);
  const showAll = opts.showAll !== false;
  const topic = softClipPace(opts.topic || "today's topic", 50);
  const mainMin = Math.max(
    10,
    Math.round(((mine.timeBoxMin + mine.timeBoxMax) / 2) * (mine.coreShare || 0.6))
  );
  const extraMin = Math.max(
    5,
    Math.round(((mine.timeBoxMin + mine.timeBoxMax) / 2) * (mine.enrichmentShare || 0.4))
  );

  const lines = [
    `▶ Your pace today: ${mine.label} (Skill ${clampInt(skill, 1, 5, 3)}/5) — plan ~${mine.timeBoxMin}–${mine.timeBoxMax} min for this slot`,
    `▶ Who this fits: ${mine.who}`,
    `▶ Task 1 — Main work (~${mainMin} min): Finish the checklist for "${topic}" until Done when is true. Write notes in your learning file.`,
    `▶ How to work: ${mine.coreRule}`,
  ];

  if (mine.key === "slow" || mine.key === "steady" || showAll) {
    lines.push(`▶ Task 2 — If you get stuck (do one):`);
    for (const s of (mine.support || []).slice(0, 2)) lines.push(`   · ${s}`);
  }

  if (mine.key === "fast" || mine.key === "average" || showAll) {
    lines.push(
      `▶ Task 3 — Extra after main work (~${extraMin} min) — do in order (stop when time ends):`
    );
    const extras =
      mine.key === "fast" || mine.key === "average"
        ? mine.challenge
        : LEARNER_PACES.fast.challenge;
    for (const c of (extras || []).slice(0, 3)) {
      lines.push(`   · ${String(c).replace(/\bCORE\b/g, "main checklist")} (topic: "${topic}")`);
    }
  }

  if (mine.betweenClassRule) {
    const bc = String(mine.betweenClassRule)
      .replace(/^Between classes:\s*/i, "")
      .replace(/^Break\s*=\s*/i, "Break = ");
    lines.push(`▶ Break: ${bc}`);
  }
  return lines;
}

/** One-line pace instruction for a schedule slot (Learning / Project / Coding). */
function formatPaceSlotLine(profileOrSkill = 3, slot = "learning") {
  const skill =
    typeof profileOrSkill === "object" && profileOrSkill
      ? profileOrSkill.skillLevel
      : profileOrSkill;
  const pace = resolveLearnerPace(skill);
  const tag = pace.shortLabel || pace.label;
  const box = `~${pace.timeBoxMin}–${pace.timeBoxMax} min`;
  if (slot === "project") {
    if (pace.key === "slow") {
      return `▶ Pace (${tag}): ${box}. One small artifact only. Follow the Do line; skip extras.`;
    }
    if (pace.key === "steady") {
      return `▶ Pace (${tag}): ${box}. Finish the Do line; add one extra only if that is solid.`;
    }
    if (pace.key === "fast") {
      return `▶ Pace (${tag}): ${box}. Ship the Do line in the first half, then one stretch (edge case or polish).`;
    }
    return `▶ Pace (${tag}): ${box}. Finish the Do line; one extra only if time remains.`;
  }
  if (slot === "coding") {
    if (pace.preferEasyLc) {
      return `▶ Pace (${tag}): Easy only. Stop after Accepted (or a logged attempt). Skip Medium.`;
    }
    if (pace.key === "fast") {
      return `▶ Pace (${tag}): Finish the named problem, then one extra Easy/Medium if time remains.`;
    }
    return `▶ Pace (${tag}): ${box}. One named problem + the 2-min Apply. No second platform.`;
  }
  if (pace.key === "slow") {
    return `▶ Pace (${tag}): ${box}. One idea. Copy the example; skip extras.`;
  }
  if (pace.key === "steady") {
    return `▶ Pace (${tag}): ${box}. Finish the example; one light extra only if solid.`;
  }
  if (pace.key === "fast") {
    return `▶ Pace (${tag}): ${box}. Finish the main idea, then one extra example of your own.`;
  }
  return `▶ Pace (${tag}): ${box}. Finish the checklist; extra only if time remains.`;
}

/** Stamp Slow / Steady / Average / Fast on one classroom schedule. */
function formatFourLearnerOverlay(profileOrSkill = 3) {
  const skill =
    typeof profileOrSkill === "object" && profileOrSkill
      ? profileOrSkill.skillLevel
      : profileOrSkill;
  const mine = resolveLearnerPace(skill);
  return [
    `▶ 4 learner paths (classroom) — you follow ${mine.shortLabel || mine.label}:`,
    `   · Slow: main checklist only; skip extras; 2-min break if focus drops.`,
    `   · Steady: finish the checklist; one light extra only if it is solid.`,
    `   · Average: checklist + one extra if time remains.`,
    `   · Fast: checklist in the first half, then Extra A→B; help a peer 5 min.`,
  ].join("\n");
}

function softClipPace(text, n = 80) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (t.length <= n) return t;
  const slice = t.slice(0, n);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > 20 ? slice.slice(0, lastSpace) : slice).trim().replace(/[.,;:]+$/g, "");
}

function clampInt(n, lo, hi, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

function inferStreamFromCollege(college = "", department = "") {
  const campus = getCampusByName(college);
  if (campus?.stream) return campus.stream;
  const hay = `${college} ${department}`.toLowerCase();
  if (!hay.trim()) return "tech";
  if (/academy|school|cbse|matriculation|class\s*\d/.test(hay)) return "school";
  if (/\barts?\b|science|bba|b\.?com|bcom|commerce/.test(hay)) return "arts";
  if (/tech|technology|engineering/.test(hay)) return "tech";
  return "tech";
}

function normalizeStream(raw) {
  return inferStreamFromCollege(String(raw || ""), "");
}

function bandForSchoolGrade(grade) {
  const g = clampInt(grade, 1, 12, 8);
  if (g <= 5) return BANDS.g_primary;
  if (g <= 8) return BANDS.g_middle;
  if (g <= 10) return BANDS.g_secondary;
  return BANDS.g_senior;
}

/**
 * Resolve academic profile from inputs / member object.
 */
function resolveAcademicProfile(inputs = {}, member = null) {
  const m = member && typeof member === "object" ? member : null;
  let parsedMeta = null;
  try {
    const raw = inputs._academicProfile;
    parsedMeta = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    parsedMeta = null;
  }

  const src = { ...(parsedMeta || {}), ...(m || {}) };
  const college = String(src.college || inputs.college || "").trim();
  const campus = getCampusByName(college);
  const department = String(src.department || inputs.department || "").trim();
  const stream = campus?.stream || inferStreamFromCollege(college, department);
  const isSchool = stream === "school" || campus?.kind === "school";
  const skillLevel = clampInt(src.skillLevel ?? inputs.skillLevel, 1, 5, 3);
  const learnerPace = resolveLearnerPace(skillLevel);

  if (isSchool) {
    const schoolGrade = clampInt(src.schoolGrade ?? inputs.schoolGrade, 1, 12, 10);
    const band = bandForSchoolGrade(schoolGrade);
    let depth = band.depth;
    if (learnerPace.key === "slow" || learnerPace.key === "steady") depth = Math.max(1, depth - 0);
    if (learnerPace.key === "fast") depth = Math.min(4, depth + 1);
    return {
      college,
      campusId: campus?.id || "sns-academy",
      kind: "school",
      stream: "school",
      schoolGrade,
      collegeYear: null,
      semester: null,
      department,
      skillLevel,
      learnerPace,
      band,
      depth,
      yearLabel: `Class ${schoolGrade}`,
      semesterLabel: "School (no semester)",
    };
  }

  let semester = clampInt(src.semester ?? inputs.semester, 1, 8, 0);
  let collegeYear = clampInt(src.collegeYear ?? src.year ?? inputs.collegeYear ?? inputs.year, 1, 4, 0);

  if (semester && !collegeYear) collegeYear = YEAR_FROM_SEM[semester] || 1;
  if (collegeYear && !semester) {
    const pair = SEMS_FOR_YEAR[collegeYear] || [1, 2];
    semester = pair[0];
  }
  if (!collegeYear && !semester) {
    collegeYear = skillLevel <= 2 ? 1 : skillLevel === 3 ? 2 : skillLevel === 4 ? 3 : 4;
    semester = SEMS_FOR_YEAR[collegeYear][0];
  }

  const bandKey = `y${collegeYear}`;
  const band = BANDS[bandKey] || BANDS.y2;
  let depth = band.depth;
  if (learnerPace.key === "slow") depth = Math.max(1, depth - 1);
  else if (learnerPace.key === "steady" || skillLevel <= 2) depth = Math.max(1, depth - 1);
  if (learnerPace.key === "fast") depth = Math.min(4, depth + 1);

  return {
    college,
    campusId: campus?.id || null,
    kind: "college",
    stream,
    schoolGrade: null,
    collegeYear,
    semester,
    department,
    skillLevel,
    learnerPace,
    band,
    depth,
    yearLabel: `Year ${collegeYear}`,
    semesterLabel: `Semester ${semester}`,
  };
}

function streamGuidance(stream) {
  if (stream === "school") {
    return {
      learningBias:
        "School path: age-appropriate language for the grade. No college placement grind. Prefer curiosity, experiments, short reading.",
      sdBias:
        "Systems thinking for kids/teens: who / what / how — drawings and simple flows only.",
      projectBias:
        "School projects, posters, demos, science-fair style. Never ask Class 6–10 for production apps.",
    };
  }
  if (stream === "arts") {
    return {
      learningBias:
        "Prefer research, writing, UX, product thinking, case analysis, light no-code/tools. Coding only if department needs it — keep optional and small.",
      sdBias:
        "System Design = journey maps, information architecture, simple service boxes — not distributed systems theory.",
      projectBias:
        "Deliverables: briefs, storyboards, canvases, short decks, Figma/wireframes, research notes. Avoid heavy backend builds.",
    };
  }
  return {
    learningBias:
      "Tech path OK: programming concepts, DSA warm-ups (level-matched), APIs, data — still one topic/day.",
    sdBias:
      "Classic beginner→placement System Design path, depth matched to year (not FAANG mega-scale on Day 1).",
    projectBias:
      "Small working code or clear tech notes using today's topic. Year 1 = tiny; Year 4 = demo-able slice.",
  };
}

function buildAcademicPromptBlock(inputs = {}, member = null) {
  const profile = resolveAcademicProfile(inputs, member);
  const stream = streamGuidance(profile.stream);
  const syllabusBits = [
    inputs?.syllabus,
    inputs?.dsaSyllabus,
    inputs?.systemDesign,
    inputs?.instructions,
  ]
    .map((x) => String(x || "").trim())
    .filter((x) => x.length >= 40);

  const hasSyllabus = syllabusBits.length > 0;
  const kindLabel =
    profile.kind === "school"
      ? "School (SNS Academy · up to Class 12)"
      : profile.stream === "arts"
        ? "Arts & Science college"
        : "Tech / Engineering college";
  const collegeLine = profile.college
    ? `Campus: ${profile.college} → ${kindLabel}.`
    : `Campus: (not set) → default Tech college.`;
  const deptLine = profile.department
    ? `Department / stream: ${profile.department}.`
    : "Department: (not set).";
  const levelLine =
    profile.kind === "school"
      ? `Class ${profile.schoolGrade} · band=${profile.band.label} · depth=${profile.depth}/4`
      : `${profile.yearLabel} · ${profile.semesterLabel} · band=${profile.band.label} · depth=${profile.depth}/4`;
  const syllabusSrc =
    inputs?._syllabusSource === "collegeSyllabusInput.txt"
      ? "from hands-on file collegeSyllabusInput.txt"
      : "from Subjects input / upload";

  return {
    profile,
    block:
      `ACADEMIC LEVEL (mandatory — calibrate difficulty):\n` +
      `- ${collegeLine}\n` +
      `- ${levelLine}\n` +
      `- ${deptLine}\n` +
      `- Self skill (1–5): ${profile.skillLevel} → Learner pace: ${profile.learnerPace?.label || resolveLearnerPace(profile.skillLevel).label}\n` +
      `- Pace rule: ${profile.learnerPace?.coreRule || resolveLearnerPace(profile.skillLevel).coreRule}\n` +
      `- Homework pace: ${profile.learnerPace?.homeworkRule || resolveLearnerPace(profile.skillLevel).homeworkRule}\n` +
      `- Stress target: ${profile.band.stress}\n` +
      `- Learning style: ${profile.band.learnStyle}\n` +
      `- System Design focus: ${profile.band.sdFocus}\n` +
      `- Project style: ${profile.band.projectStyle}\n` +
      `- DIFFERENTIATION: Always include CORE + SUPPORT (slow) + CHALLENGE (fast) so one classroom plan covers mixed speeds.\n` +
      `- Path bias — Learning: ${stream.learningBias}\n` +
      `- Path bias — SD: ${stream.sdBias}\n` +
      `- Path bias — Project: ${stream.projectBias}\n` +
      (hasSyllabus
        ? `- SYLLABUS (${syllabusSrc}): align topics to this campus + level.\n`
        : `- No syllabus text — still keep level-appropriate difficulty.\n`) +
      (inputs?._subjectPreferencesBlock
        ? `- ${String(inputs._subjectPreferencesBlock).replace(/\n/g, "\n  ")}\n` +
          `- Prefer LIKED subjects for Learning examples; give DISLIKED subjects lighter coverage only.\n`
        : ""),
  };
}

function academicHeaderLine(inputs = {}, member = null) {
  const p = resolveAcademicProfile(inputs, member);
  const dept = p.department ? ` · ${p.department}` : "";
  const collegeBit = p.college ? softCollege(p.college) + " · " : "";
  if (p.kind === "school") {
    return `${collegeBit}School · Class ${p.schoolGrade}${dept} · ${p.band.label}`;
  }
  const streamBit = p.stream === "arts" ? "Arts" : "Tech";
  return `${collegeBit}${streamBit} · Y${p.collegeYear} Sem${p.semester}${dept} · ${p.band.label}`;
}

function softCollege(name) {
  const t = String(name || "").replace(/\s+/g, " ").trim();
  return t.length > 28 ? `${t.slice(0, 26)}…` : t;
}

/**
 * Deterministic seed so Year/Sem (or school grade) + teammate index
 * never share the same LeetCode / case rotation as another cohort.
 */
function academicPickSeed(profile = {}, memberIdx = 0) {
  const m = Math.max(0, Number(memberIdx) || 0);
  if (profile?.kind === "school") {
    const g = Math.max(1, Number(profile.schoolGrade) || 10);
    return g * 13 + m * 29 + 5;
  }
  const y = Math.max(1, Number(profile.collegeYear) || 2);
  const s = Math.max(1, Number(profile.semester) || (y * 2 - 1));
  return y * 31 + s * 17 + m * 41 + 7;
}

/**
 * Preferred LeetCode difficulties for this academic band.
 * Year 1 → Easy-first · Year 4 → Medium/Hard-first.
 */
function leetcodeDifficultiesForProfile(profile = {}) {
  const depth = Math.max(1, Number(profile.depth) || Number(profile.band?.depth) || 2);
  const pace = profile.learnerPace || resolveLearnerPace(profile.skillLevel);
  if (pace?.preferEasyLc) return ["Easy"];
  if (profile.kind === "school") {
    if ((profile.schoolGrade || 10) <= 8) return ["Easy"];
    return ["Easy", "Medium"];
  }
  if (depth <= 1) return ["Easy"];
  if (depth === 2) return ["Easy", "Medium"];
  if (depth === 3) return ["Easy", "Medium"];
  return ["Medium", "Hard", "Easy"];
}

/** Filter + lightly reshuffle a LeetCode bank for this year/sem. */
function filterLeetCodeForProfile(list = [], profile = {}, memberIdx = 0) {
  const all = Array.isArray(list) ? list : [];
  if (!all.length) return [];
  const prefs = leetcodeDifficultiesForProfile(profile);
  const ranked = [];
  for (const d of prefs) {
    for (const p of all) {
      if (new RegExp(d, "i").test(String(p.difficulty || ""))) ranked.push(p);
    }
  }
  // Keep leftovers so we never run dry
  for (const p of all) {
    if (!ranked.includes(p)) ranked.push(p);
  }
  const seed = academicPickSeed(profile, memberIdx);
  if (seed % ranked.length === 0) return ranked;
  // Rotate so Year 2 Sem 3 does not start at the same problem as Year 1 Sem 1
  const rot = seed % ranked.length;
  return ranked.slice(rot).concat(ranked.slice(0, rot));
}

/** Rotate case-study bank so each year/sem/member starts on a different case. */
function rotateCaseBank(list = [], profile = {}, memberIdx = 0) {
  const all = Array.isArray(list) ? [...list] : [];
  if (!all.length) return [];
  const seed = academicPickSeed(profile, memberIdx);
  const rot = seed % all.length;
  return all.slice(rot).concat(all.slice(0, rot));
}

module.exports = {
  YEAR_FROM_SEM,
  SEMS_FOR_YEAR,
  LEARNER_PACES,
  resolveAcademicProfile,
  resolveLearnerPace,
  formatLearnerPaceBlock,
  formatPaceSlotLine,
  formatFourLearnerOverlay,
  buildAcademicPromptBlock,
  academicHeaderLine,
  streamGuidance,
  normalizeStream,
  inferStreamFromCollege,
  academicPickSeed,
  leetcodeDifficultiesForProfile,
  filterLeetCodeForProfile,
  rotateCaseBank,
};
