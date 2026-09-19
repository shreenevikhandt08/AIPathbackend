const { callLLM }             = require("./llm");
const {
  getStepForPlanDay,
  isNonCodeDtDay,
  isEmpathyDefineStage,
  isPitchBmcStage,
  isEvaluateStage,
} = require("./dtPlaybookLookup");
const { buildAssessmentPromptBlock } = require("./assessmentPicker");
const { buildAcademicPromptBlock } = require("./academicLevel");
const { enforceDayConnectivity } = require("./connectivityEnforcer");
function buildDailyDayPrompt(dayName, theme, inputs, examAnalysis, focusOverride, dayKey, globalDayIndex = 0, daySlice = null) {
  const resolvedDayKey = dayKey || `Week ${theme.week} - ${dayName}`;
  // Map UI "Current Stage" → playbook day so the schedule is stage-precise.
  const activeStageKey = inputs?._activeDTStage || inputs?.activeDTStage || null;
  const dtStep = getStepForPlanDay(globalDayIndex, activeStageKey, inputs);
  const nonCodeDt = isNonCodeDtDay(dtStep);
  const empathyDay = isEmpathyDefineStage(dtStep);
  const pitchDay = isPitchBmcStage(dtStep);
  const evaluateDay = isEvaluateStage(dtStep);

  // Dream / target company from solo or team profile (if provided)
  let inputsCompany = "";
  if (inputs?.targetCompany) inputsCompany = String(inputs.targetCompany).trim();
  if (!inputsCompany && inputs?.dreamCompany) inputsCompany = String(inputs.dreamCompany).trim();
  if (!inputsCompany && inputs?._teamMembers) {
    try {
      const members = typeof inputs._teamMembers === "string"
        ? JSON.parse(inputs._teamMembers)
        : inputs._teamMembers;
      if (Array.isArray(members)) {
        const hit = members.find(m => m && String(m.targetCompany || "").trim());
        if (hit) inputsCompany = String(hit.targetCompany).trim();
      }
    } catch (_) { /* ignore bad JSON */ }
  }
  const inputsHasCompany = Boolean(inputsCompany);
  const assessment = buildAssessmentPromptBlock(globalDayIndex, inputs || {});
  const academic = buildAcademicPromptBlock(inputs || {});
  const skipBanks =
    inputs?._skipAssessmentBanks === true ||
    inputs?._skipAssessmentBanks === "true";

  let isTeam = false;
  try {
    if (inputs?._isTeam === true || inputs?._isTeam === "true" || inputs?._isTeam === 1) isTeam = true;
    else if (inputs?._isTeam === false || inputs?._isTeam === "false" || inputs?._isTeam === 0) isTeam = false;
    else {
      const raw = inputs?._teamMembers ?? inputs?.teamMembers;
      const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (Array.isArray(arr)) isTeam = arr.filter((m) => m && String(m.name || "").trim()).length >= 2;
    }
  } catch (_) {}

  const slice = daySlice || {
    primarySubject:   theme.subjects[0],
    allSubjects:      theme.subjects.slice(0, 4),
    allSubjectsCount: Math.min(theme.subjects.length, 4),
    dsaSubtopic:      theme.dsa,
    subjectPhase:     { label: "Introduction & Core Definition", activity: "faculty-led explanation, students take notes in their own words" },
    sdPhase:          { label: "Concept & Motivation", activity: "why this problem exists — a real failure scenario, discussed as a class" },
    activityType:     "speaking",
    codingPlatform:   "HackerRank",
    codingDifficulty: "Easy",
    brainstorm:       "Which topic from today's subjects is most likely in the IA exam?",
    dayGuide:         DAY_CONTENT[dayName] || DAY_CONTENT["Monday"],
    variant:          DAY_TASK_VARIANTS[globalDayIndex % DAY_TASK_VARIANTS.length],
  };

  const guide        = slice.dayGuide;
  const todaySubjects = slice.allSubjects;
  const todayCount   = todaySubjects.length;

  const subjectLines = todaySubjects.map((s, idx) => {
    const focus = getExamFocus(s.name, s.topic, examAnalysis);
    return `  ${idx === 0 ? "★ PRIMARY" : `  Topic ${idx + 1}`} — ${s.name}: ${focus}`;
  }).join("\n");

  const sub1 = todaySubjects[0];
  const sub2 = todaySubjects[1] || todaySubjects[0];
  const sub3 = todaySubjects[2] || todaySubjects[0];
  const sub4 = todaySubjects[3] || todaySubjects[0];

  return (
    `You are designing a REALISTIC one-day college schedule for ENGINEERING STUDENTS (IST, college hours 08:45–04:30 only).\n\n` +
    (String(inputs?._engineLessonsBlock || "").trim()
      ? `${String(inputs._engineLessonsBlock).trim()}\n\n`
      : "") +
    (isTeam
      ? `MODE = TEAM. Team check-in / named split work allowed. Never invent extra people.\n`
      : `MODE = SOLO (one student). HARD RULES: never write team, teammates, classmate, peer review, "Team check-in", "each person", or group board updates. Stand-Up = PERSONAL check-in only (DONE / TODAY / STUCK).\n`) +
    `DAY: ${dayName} | Week ${theme.week} | Day ${globalDayIndex + 1}` +
    (dtStep
      ? ` | DT STAGE LOCKED: ${dtStep.stage} → "${dtStep.step}" (playbook day ${dtStep.playbookWorkingDay})`
      : ` | DT STAGE: applied build (playbook complete from selected stage)`) +
    `\n\n` +
    (activeStageKey
      ? `USER-SELECTED DT STAGE KEY: "${activeStageKey}" — today's Project Build / Stand-Up MUST follow the DT step above. Do not drift to another stage.\n\n`
      : "") +
    `KEY RULES:\n` +
    `0. Obey ENGINE QUALITY LESSONS above — never repeat past refine mistakes.\n` +
    `1. Cover ONLY the ${todayCount} topic${todayCount === 1 ? "" : "s"} listed below for today — no more, no fewer.\n` +
    `2. REALISTIC timing: each subject gets 40–45 min of proper teaching. NO time gaps between rows — ` +
    `each row's end time MUST equal the next row's start time (continuous 08:45→04:30).\n` +
    `3. ALL tasks WITHIN college hours (08:45–04:30). ZERO after-college tasks, ZERO "in your free time" bullets.\n` +
    `4. DAILY CODING PRACTICE: 1 problem on ${slice.codingPlatform} (${slice.codingDifficulty}) — done IN class.\n` +
    (nonCodeDt
      ? `5. DT RESEARCH DAY (${empathyDay ? "Empathize & Define" : "Pitch & BMC"}): Academic Learning still happens, ` +
        `but ROW 8 (Project/DT block) is RESEARCH / ARTIFACT work — NO syllabus-feature coding, NO inventing a full product solution. ` +
        `BUILD HOOKs point to today's DT artifact (notes/map/canvas), not a code file.\n` +
        `6. ONE CONNECTED DT PIPELINE: Discussion → playbook task → captured artifact → peer share.\n` +
        `7. LESS IS MORE: every Learning bullet ends with a BUILD HOOK naming the DT research output it feeds today.\n`
      : `5. LEARN → IMPLEMENT (NON-NEGOTIABLE): whatever is taught in Learning / DSA today MUST be the ONLY ` +
        `thing built in Project Build. Afternoon System Design CONTINUES that same artifact — never a second unrelated project.\n` +
        `6. ONE CONNECTED PIPELINE: Project Build is a single chain Step A → Step B → Step C (each step needs the previous). ` +
        `FORBIDDEN: dumping disconnected tasks that do not use today's taught concepts.\n` +
        `7. LESS IS MORE: every Learning bullet ends with a BUILD HOOK naming the exact file/function/screen built later today.\n`) +
    `8. NO REPETITION ACROSS THE WEEK: if a subject topic repeats from an earlier day this week, today's ` +
    `session must teach it from a genuinely different angle (see TODAY'S ANGLE below) with a different ` +
    `example and a different activity — never regenerate the same explanation students already had.\n\n` +
    `TODAY'S TOPICS:\n${subjectLines}\n\n` +
    `DSA Topic today: ${slice.dsaSubtopic}\n` +
    `System Design today: ${theme.systemDesign}\n` +
    `Project milestone: ${theme.project}\n` +
    `Tech stack: ${theme.tech}\n` +
    `Coding platform: ${slice.codingPlatform} — ${slice.codingDifficulty}\n` +
    (focusOverride ? `\nUSER CHANGE: ${focusOverride}\n` : "") +
    academic.block +
    `\nLEARNER PACE LOCK (must appear in Learning, Project Build, and Coding Practice):\n` +
    `- Pace: ${academic.profile?.learnerPace?.label || "Average"} (skill ${academic.profile?.skillLevel || 3}/5).\n` +
    `- Rule: ${academic.profile?.learnerPace?.coreRule || "Finish the main checklist; extras only if time remains."}\n` +
    `- Slow/Steady: Easy coding only, fewer steps. Fast: finish core then one extra.\n` +
    (skipBanks
      ? `\nASSESSMENT BANKS: OFF — still use the student's Assess text (goals, strengths, likes) in Speak & Solve and Mini Build.\n`
      : assessment.block) +
    `\nGENERATE EXACTLY 13 ROWS in this order:\n\n` +
    `ROW 1 — 08:45–09:00 — Daily Stand-Up + DT Activation (15 min)\n` +
    `  Content (ALL of these bullets — fold Morning Activation INTO stand-up):\n` +
    `  ▶ DT ACTIVATION (3–4 min): 60-sec calm breath OR 1 DT mindset prompt — ` +
    `"What would a curious designer notice about today's problem that an engineer might skip?" ` +
    (isTeam ? `Everyone answers in one line.\n` : `Answer in one line (solo).\n`) +
    (dtStep
      ? `  ▶ DT LENS TODAY: Week ${dtStep.weekNumber} · ${dtStep.stage} → "${dtStep.step}" — stage goal: ${dtStep.stageGoal}\n` +
        `  ▶ PROBLEM GLANCE (2 min): read/skim the problem statement through that lens only — one sentence insight.\n`
      : `  ▶ DT LENS TODAY: applied build mindset — name one user pain from the problem statement in one sentence.\n`) +
    `  ▶ MICRO-TEACH / TALK (2–3 min): share ONE useful tip — tool shortcut, soft skill, career, debugging habit, or a 60-sec concept.\n` +
    (globalDayIndex === 0
      ? isTeam
        ? `  ▶ Day 1 TEAM KICKOFF: introduce the project in plain language — "${theme.project}" — who it's for and what success looks like.\n` +
          `  ▶ Ground rule: we ONLY build what we have learnt today.\n` +
          `  ▶ Each person: name + one thing you want to learn.\n`
        : `  ▶ Day 1 PERSONAL KICKOFF: introduce the project in plain language — "${theme.project}" — who it's for and what success looks like.\n` +
          `  ▶ Ground rule: ONLY build what you learn today. No team meet. No "yesterday".\n` +
          `  ▶ Write: TODAY aim · one thing you want to understand by evening · STUCK (or "none").\n`
      : isTeam
        ? `  ▶ Heading: Team check-in\n` +
          `  ▶ Board: Done / Today / Blocked (1 line each).\n` +
          `  ▶ ${guide.standupFocus}\n` +
          `  ▶ Today's build hook preview: ${todaySubjects.map(s => s.name).join(", ")} → Project Build pipeline.\n`
        : `  ▶ Heading: Personal check-in\n` +
          `  ▶ Write: DONE · TODAY · STUCK (1 line each).\n` +
          `  ▶ ${guide.standupFocus}\n` +
          `  ▶ Today's focus preview: ${todaySubjects.map(s => s.name).join(", ")}.\n`) +
    `  ▶ Motivation boost line (read aloud once).\n` +
    `\nROW 2 — 09:00–10:30 — Learning (90 min, 45 min per subject)\n` +
    `  TODAY'S ANGLE for both subjects: "${slice.subjectPhase.label}" (${slice.subjectPhase.activity}). ` +
    `Even if this topic was also taught earlier this week, today's session must use THIS angle — do not repeat an earlier day's framing or examples.\n` +
    `  DEEP TOPIC RULE (mandatory): do NOT write vague bullets like "study the topic". For each subject name:\n` +
    `    • 2–4 SPECIFIC sub-topics / concepts inside the week topic\n` +
    `    • 1 worked example or diagram instruction per sub-topic\n` +
    `    • 1 check question the student must answer before Project Build\n` +
    `  CORE SUBJECT → PROJECT CONNECTIVITY (mandatory for EVERY academic subject today):\n` +
    (nonCodeDt
      ? `    After teaching each subject, add exactly these bullets:\n` +
        `    • PROJECT LINK: how today's concept clarifies a user pain / process in "${theme.project}"\n` +
        `    • APPLY: 1 insight written into today's DT research artifact (NOT code)\n` +
        `    • PROVE: 1-line "This concept helps us understand ___ about the problem because …"\n` +
        `  First 45 min — ${sub1.name}: "${sub1.topic}"\n` +
        `    ▶ Teach it through today's angle (${slice.subjectPhase.label}) — 1 concrete example\n` +
        `    ▶ Sub-topics today (name them): …\n` +
        `    ▶ PROJECT LINK + APPLY + PROVE (research hooks — see rule above)\n` +
        `    ▶ BUILD HOOK (mandatory): "In today's DT block you will use ${sub1.topic} to ___ (named research output)."\n` +
        `    ▶ End: student writes 1 sentence: concept → problem insight\n` +
        `  Next 45 min — ${sub2.name}: "${getExamFocus(sub2.name, sub2.topic, examAnalysis)}"\n` +
        `    ▶ Teach it through today's angle (${slice.subjectPhase.label}) — 1 concrete example\n` +
        `    ▶ Sub-topics today (name them): …\n` +
        `    ▶ PROJECT LINK + APPLY + PROVE\n` +
        `    ▶ BUILD HOOK (mandatory): next DT research step that uses this concept\n` +
        `    ▶ End: ${slice.subjectPhase.activity}\n`
      : `    After teaching each subject, add exactly these bullets:\n` +
        `    • PROJECT LINK: name the exact screen/file/flow in "${theme.project}" where today's concept appears\n` +
        `    • APPLY: 1 concrete change the student will make in Project Build using this concept\n` +
        `    • PROVE: 1-line check ("I used X in Y because …")\n` +
        `  First 45 min — ${sub1.name}: "${sub1.topic}"\n` +
        `    ▶ Teach it through today's angle (${slice.subjectPhase.label}) — 1 concrete example, not a repeat of an earlier day\n` +
        `    ▶ Sub-topics today (name them): …\n` +
        `    ▶ PROJECT LINK + APPLY + PROVE (see rule above)\n` +
        `    ▶ BUILD HOOK (mandatory): "In Project Build today you will use ${sub1.topic} to ___ (name the exact function/file/screen)."\n` +
        `    ▶ End: student writes 1 sentence: concept → where it appears in today's build\n` +
        `  Next 45 min — ${sub2.name}: "${getExamFocus(sub2.name, sub2.topic, examAnalysis)}"\n` +
        `    ▶ Teach it through today's angle (${slice.subjectPhase.label}) — 1 concrete example, not a repeat of an earlier day\n` +
        `    ▶ Sub-topics today (name them): …\n` +
        `    ▶ PROJECT LINK + APPLY + PROVE (see rule above)\n` +
        `    ▶ BUILD HOOK (mandatory): "In Project Build today you will use this to ___ (exact next step that depends on the previous hook)."\n` +
        `    ▶ End: ${slice.subjectPhase.activity}\n`) +
    ((inputs?.syllabus || "").trim()
      ? `  SUPPORTING / CORE SUBJECT SYLLABUS (user uploaded — these ARE real Learning topics, not optional fluff):\n` +
        `  Weave SPECIFIC syllabus topic names into Learning bullets and PROJECT LINK lines:\n` +
        `  ${(inputs.syllabus || "").trim().slice(0, 1500)}\n`
      : "") +
    `\nROW 3 — 10:30–10:45 — Short Break\n` +
    `  ▶ Stand up, hydrate, stretch. Do NOT start next topic early.\n` +
    `\nROW 4 — 10:45–11:30 — DSA + Coding Practice (45 min)\n` +
    (dtStep && (dtStep.dsaConcept === "NA" || nonCodeDt)
      ? `  ⚠️ ${nonCodeDt ? "DT research day — " : ""}No forced algorithm-to-feature DSA today` +
        (dtStep.dsaConcept === "NA" ? ` — playbook marks DSA as NA for "${dtStep.step}".` : ".") +
        ` Do NOT invent an algorithmic project hook.\n` +
        `  Coding Practice (25 min): ${slice.codingPlatform} — ${slice.codingDifficulty} [NEW PROBLEM — never repeat] — skill practice ONLY, not today's project feature.\n` +
        `  ▶ LANGUAGE: you can use any language (Python / Java / JavaScript / C / C++ / Go / etc.).\n` +
        `  ▶ ${guide.newProblemHint || "Pick a NEW unsolved problem on today's platform."}\n` +
        `  ▶ Give 2–3 REAL, NAMED ${slice.codingPlatform} problems — student picks ONE.\n` +
        `    ▶ Process: read → pseudocode on paper → code (team's language) → submit → check\n` +
        `    ▶ Log: Date | Platform | Problem Title | Language used | Topic | Result | Minutes\n` +
        `  Remaining 20 min: continue today's DT Playbook research task (see ROW 8) — notes / discussion, not feature coding.\n`
      : `  DSA (25 min): "${slice.dsaSubtopic}"\n` +
        `    ▶ Explain the exact NEW concept for today (not yesterday's angle) with pseudocode, traced through 1 small example by hand\n` +
        `    ▶ Break the topic into 2–3 named sub-topics; teach only today's sub-topic thoroughly\n` +
        `    ▶ BUILD HOOK (mandatory): name the exact place in TODAY's Project Build pipeline where this DSA pattern is applied (not "sometime this week")\n` +
        `  Coding Practice (20 min): ${slice.codingPlatform} — ${slice.codingDifficulty} [NEW PROBLEM EVERY DAY]\n` +
        `    ▶ LANGUAGE RULE: you can solve in any language you know / the team chose.\n` +
        (assessment.picks.leetcode
          ? `    ▶ MANDATORY problem today: ${assessment.picks.leetcode.label} (${assessment.picks.leetcode.pattern})\n` +
            `    ▶ Do NOT substitute a different LeetCode problem. Log this exact title + language used.\n`
          : `    ▶ ${guide.newProblemHint || "Search for a NEW unsolved problem tagged to today's DSA topic."}\n` +
            `    ▶ ${guide.codingType || "Solve 1 NEW problem — never reuse an earlier day's title."}\n` +
            `    ▶ Give 2–3 REAL, NAMED ${slice.codingPlatform} problems tagged "${slice.dsaSubtopic.split("—")[0].trim()}" that were NOT suggested earlier this week — NEVER just write the difficulty word alone. Format: Problem Name (${slice.codingPlatform} · difficulty) — 1 line why it fits. Student picks ONE.\n`) +
        `    ▶ Process: read → pseudocode on paper → code (any language) → submit → check\n` +
        `    ▶ Log: Date | Platform | Problem Title | Language | DSA Tag | Result | Minutes\n`) +
    `\nROW 5 — 11:30–11:45 — 🎤 Speak & Solve (15 min)\n` +
    (assessment.picks.pm
      ? `  3C / PRODUCT ASSESSMENT ROUND (from Assessment Content bank):\n` +
        `  ▶ Question: ${assessment.picks.pm.text}\n` +
        `  ▶ Category: ${assessment.picks.pm.category} · Skill lens: ${assessment.picks.pm.skill}\n` +
        `  ▶ 1 student answers out loud (3–4 min structure: assumptions → approach → conclusion)\n` +
        `  ▶ Peers: 1 clarifying question + 1 line feedback on clarity\n`
      : slice.activityType === "speaking"
      ? `  COMMUNICATION ROUND — tied to today's DSA/System Design:\n` +
        `  ▶ 1 student (rotate who each day) stands and explains "${slice.dsaSubtopic}" OR "${theme.systemDesign}" out loud to the group, 60-90 seconds, no notes\n` +
        `  ▶ Rest of the group: 1 clarifying question + 1 line of feedback on clarity (not correctness)\n` +
        `  ▶ Faculty gives 1 tip on technical speaking (pace, filler words, structure — intro/body/close)\n`
      : `  APTITUDE ROUND — quantitative/logical reasoning, placement-style:\n` +
        `  ▶ 2 aptitude problems (time-speed-distance, permutations/combinations, series, or logical puzzles) — pick a type that naturally echoes today's DSA topic "${slice.dsaSubtopic}" if there's a clean link (e.g. counting/combinatorics for a search/sort topic), otherwise standard placement-prep difficulty\n` +
        `  ▶ Students solve individually (8 min), then 1 student explains their approach out loud (this ties back to communication too)\n` +
        `  ▶ Faculty gives the fast mental-math shortcut for this problem type\n`) +
    `\nROW 6 — 11:45–12:30 — Learning  (45 min)\n` +
    (todayCount > 2
      ? `  First half — ${sub3.name}: "${sub3.topic}"\n` +
        `    ▶ Teach it through today's angle (${slice.subjectPhase.label}) — 1 concrete example\n` +
        (nonCodeDt
          ? `    ▶ BUILD HOOK: how this concept feeds today's DT research artifact (not code)\n` +
            `    ▶ PROJECT LINK + APPLY + PROVE (research form)\n`
          : `    ▶ BUILD HOOK: exact extension step in afternoon System Design that uses this concept\n` +
            `    ▶ PROJECT LINK + APPLY + PROVE\n`) +
        `  Second half — ${sub4.name}: "${getExamFocus(sub4.name, sub4.topic, examAnalysis)}"\n` +
        `    ▶ Teach it through today's angle (${slice.subjectPhase.label}) — 1 concrete example\n` +
        (nonCodeDt
          ? `    ▶ BUILD HOOK: which user/process insight this concept validates for "${theme.project}"\n`
          : `    ▶ BUILD HOOK: how this concept validates or connects the morning build\n`)
      : nonCodeDt
        ? `  Only 2 subjects today — deepen morning BUILD HOOKS into clearer problem insights (no new unrelated topics).\n`
        : `  Only 2 subjects today — deepen the SAME two BUILD HOOKS from ROW 2 (no new unrelated topics). ` +
          `Each example must map to a named step in today's Project Build pipeline.\n`) +
    `\nROW 7 — 12:30–01:15 — Lunch Break\n` +
    `  ▶ Lunch (12:30–01:15 IST). No studying for first 30 min.\n` +
    `\nROW 8 — 01:15–02:15 — ${dtStep ? `DT PLAYBOOK: ${dtStep.stage.toUpperCase()} — ${dtStep.step}` : "PROJECT BUILD SPRINT"} (60 min)\n` +
    (nonCodeDt
      ? `⚠️ DT RESEARCH / ARTIFACT PIPELINE — NO syllabus-feature coding today:\n` +
        `  Project: ${theme.project}\n` +
        `  Week milestone: ${theme.projectTask}\n` +
        `  Locked step: Week ${dtStep.weekNumber} ${dtStep.stage} → "${dtStep.step}"\n` +
        `  Stage goal: ${dtStep.stageGoal}\n` +
        `  Real task: ${dtStep.realProjectTask}\n` +
        `  Learn focus: ${dtStep.whatToLearn}\n\n` +
        `  ── CONNECTED DT PIPELINE (mandatory shape of ROW 8) ──\n` +
        `  ▶ PIPELINE GOAL (1 line): the single research/pitch artifact finished by 02:15.\n` +
        `  ▶ Step A (10 min) — Discussion: "${dtStep.discussionPrompt}" — write the answer in own words.\n` +
        `  ▶ Step B (25 min) — Do the real project task above, grounded in the student's problem statement.\n` +
        `  ▶ Step C (15 min) — Capture the artifact (persona / empathy map / competitor table / tech-stack decision / BMC / pitch notes).\n` +
        `  ▶ Step D (5 min) — Peer share: 2 insights + 1 open question.\n` +
        `  ▶ Step E (5 min) — Save to project /dt-notes (docs only).\n` +
        `  FORBIDDEN: implementing morning subject topics as code features; inventing a full solution; skipping discussion.\n` +
        (/tech\s*stack/i.test(String(dtStep.step || ""))
          ? `  TECH STACK SESSION (mandatory today): decide language + UI + storage for THIS problem statement.\n` +
            `  ▶ Language: you can choose any (Python/Java/JS/C/C++/Go/…) — team skill + fit for the problem.\n` +
            `  ▶ Write decisions into /dt-notes/tech-stack.md — later build weeks MUST follow this stack.\n`
          : "") +
        (empathyDay
          ? `  STAGE RULE: Empathize & Define — understand the problem; NO solutioning / NO deploy.\n`
          : `  STAGE RULE: Pitch & BMC — business wrap-up artifacts, not a coding sprint.\n`)
      : `⚠️ LEARN → IMPLEMENT CHAIN (this is the point of the day):\n` +
        `  Morning taught: ${sub1.name} ("${sub1.topic}"), ${sub2.name} ("${sub2.topic}"), DSA ("${slice.dsaSubtopic}").\n` +
        `  Project: ${theme.project}\n` +
        `  Week milestone: ${theme.projectTask}\n` +
        `  Known concepts fence: ${theme.cumulativeKnowledge || "subjects taught so far"}\n` +
        `  Do NOT invent databases/APIs/auth/frameworks unless they appear in the known-concepts fence.\n\n` +
        `  ── CONNECTED PIPELINE (mandatory shape of ROW 8 content) ──\n` +
        `  Output EXACTLY this chain — each step MUST name which morning concept it uses and MUST depend on the previous step:\n` +
        `  ▶ PIPELINE GOAL (1 line): the single feature/artifact finished by 02:15 today.\n` +
        `  ▶ Step A (15 min) — IMPLEMENT "${sub1.topic}": open/create [file] → write [exact piece] → prove it works with [1 input].\n` +
        `  ▶ Step B (15 min) — IMPLEMENT "${sub2.topic}" ON TOP OF Step A (not a separate mini-project): change/add [exact piece] that consumes Step A's output.\n` +
        `  ▶ Step C (15 min) — APPLY DSA "${slice.dsaSubtopic}" (or continue DT task) INSIDE the same feature: [exact algorithm/structure change].\n` +
        `  ▶ Step D (10 min) — RUN end-to-end once; fix 1 break; write Done-when criterion.\n` +
        `  ▶ Step E (5 min) — git add . && git commit -m "feat(week${theme.week}): [pipeline goal]" && git push\n` +
        `  LANGUAGE: implement in the team's chosen stack from Empathy "Tech Stack Choice" (you can use any language).\n` +
        `  FORBIDDEN in ROW 8: parallel unrelated tasks; "also do wireframes + schema + API + UI" unless ALL of those are required by TODAY's taught concepts and form one pipeline.\n\n` +
        (dtStep
          ? `  📍 DT LENS (keep focus — do not restart the whole DT cycle): Week ${dtStep.weekNumber} ${dtStep.stage} → "${dtStep.step}"\n` +
            `  Stage goal: ${dtStep.stageGoal}\n` +
            `  Fold the DT step INTO the pipeline above (usually Step A framing or Step C), grounded in: "${theme.project}"\n` +
            `  Real task hint: ${dtStep.realProjectTask}\n` +
            (evaluateDay
              ? `  Evaluate day: prefer usability / interview / observation tasks from the playbook inside the pipeline.\n`
              : `  Do not re-do Empathize/Define from scratch — extend yesterday's artifact.\n`) +
            `  ⚠️ Output ONLY this DT step's lens inside the pipeline — no bundling every DT stage.\n`
          : `  ✅ DT Playbook complete — APPLIED BUILD only. Extend the existing solution; do not restart Empathize/Define.\n` +
            `  Tech layer today from "${theme.tech}": name which ONE layer the pipeline touches.\n`)
    ) +
    `\n  📘 OPTIONAL — Extra Concept Beyond Syllabus: only if the pipeline truly needs one tiny concept outside the fence; ` +
    `otherwise OMIT. Format: "Extra Concept (~15 min): <name> — why needed for Step ___".\n` +
    `\nROW 9 — ${assessment.picks.game ? "02:15–02:25 — Refresh Game (10 min)" : "02:15–02:25 — Short Break (10 min)"}\n` +
    (assessment.picks.game
      ? `  ▶ Game: ${assessment.picks.game.name}\n  ▶ How: ${assessment.picks.game.how}\n` +
        `  ▶ Purpose: refresh + speak under light pressure.\n`
      : `  ▶ NO refresh game today (games only plays 2–3 random days per week).\n` +
        `  ▶ Stand, hydrate, stretch. Do NOT start new ${nonCodeDt ? "research" : "coding"}.\n`) +
    (assessment.picks.product
      ? `  (Product Speak may sit near Speak & Solve earlier; if needed, 90-sec prompt: ${assessment.picks.product.name} — ${assessment.picks.product.prompt})\n`
      : "") +
    (assessment.picks.agentWorkbench
      ? `\nROW 9b — 02:25–02:45 — SNS Agent Workbench (20 min) [n8n-style]\n` +
        `  ▶ Concrete automation/agent BUILD task (triggers → nodes → actions) — NOT "browse the tool".\n` +
        `  ▶ Use today's assigned workbench project from assessment (webhook, cron digest, CSV clean, alert threshold, LLM draft, etc.).\n` +
        `  ▶ Done when the workflow runs once and is named/saved; 1-line link to the problem statement.\n`
      : "") +
    `\nROW 10 — ${assessment.picks.agentWorkbench ? "02:45–03:25" : "02:25–03:25"} — ${nonCodeDt ? "Problem Framing + DT Artifact Deepening" : "System Design + Project Integration"} (${assessment.picks.agentWorkbench ? "40" : "60"} min)\n` +
    (nonCodeDt
      ? `  ⚠️ SAME ARTIFACT as ROW 8 — deepen research, do NOT start coding a solution.\n` +
        `  Framing (15 min): connect "${theme.systemDesign}" OR problem constraints to today's DT artifact only if it clarifies users/process — skip if forced.\n` +
        `  Deepening (45 min) — CONTINUE the research chain:\n` +
        `  ▶ Step F (15 min): Extend ROW 8 artifact using afternoon Learning insights (${sub3.topic ? `${sub3.name} ("${sub3.topic}")` : "ROW 6 hooks"}).\n` +
        `  ▶ Step G (15 min): Cross-check artifact vs problem statement — mark 2 validated insights + 1 open question.\n` +
        `  ▶ Step H (10 min): ${slice.variant.collab} — feedback on THIS research artifact only.\n` +
        `  ▶ Step I (5 min): save updated notes to /dt-notes (no feature commit).\n`
      : `  ⚠️ SAME FEATURE as ROW 8 — continue the pipeline, do NOT start a new project.\n` +
        `  System Design (15 min): "${theme.systemDesign}" — angle: "${slice.sdPhase.label}" (${slice.sdPhase.activity}).\n` +
        `    ▶ Explain only what helps today's pipeline goal.\n` +
        `    ▶ Sketch where ${theme.systemDesign} sits in the SAME artifact from ROW 8.\n` +
        `  Integration (45 min) — CONTINUE the chain:\n` +
        `  ▶ Step F (15 min): Extend ROW 8 output using ${sub3.topic ? `${sub3.name} ("${sub3.topic}")` : "afternoon Learning hooks"} — exact code change.\n` +
        `  ▶ Step G (15 min): Connect Step F to Steps A–C — run full happy path once.\n` +
        `  ▶ Step H (10 min): ${slice.variant.collab} — feedback must be about THIS feature only.\n` +
        `  ▶ Step I (5 min): git commit -m "integrate(week${theme.week}): [what was connected]"\n`) +
    (assessment.picks.projectBreakdown
      ? `  ▶ Deliverable shape (only if it advances THIS pipeline): focus "${assessment.picks.projectBreakdown.focus}" → Done when: ${assessment.picks.projectBreakdown.doneWhen}\n` +
        `     Do NOT add breakdown tasks that ignore today's learned concepts.\n`
      : "") +
    `\nROW 11 — 03:25–03:35 — ${inputsHasCompany ? `Placement Micro — ${inputsCompany}` : "Project Push"} (10 min)\n` +
    (inputsHasCompany
      ? `  SHORT placement micro for TARGET COMPANY: ${inputsCompany} (8–10 min ONLY)\n` +
        `  ▶ One micro action: careers glance OR 1 LinkedIn note OR 60-sec STAR about TODAY's pipeline OR resume 1-liner\n` +
        `  ▶ Update Placement Tracker one cell. Stop.\n`
      : nonCodeDt
        ? `  ▶ Push ONLY the next unfinished DT research step (not a coding task dump)\n` +
          `  ▶ Motivation: read the day's boost line once\n`
        : `  ▶ Push ONLY the next unfinished step in TODAY's learn→implement pipeline (not a new task list)\n` +
          `  ▶ Motivation: read the day's boost line once\n`) +
    `\nROW 12 — 03:35–04:00 — Interests / Goals (25 min)\n` +
    `  ▶ Rotate by day: Interests → Goals (from student Inputs). Never invent Capability dump or Peer Review.\n` +
    `  ▶ One short practice that matches their interest OR moves their goal/outcome forward.\n` +
    `  ▶ Include clickable Reference links (Website + YouTube). Ebook pages ONLY if they uploaded an ebook.\n` +
    `  ▶ Done when: notes/interests.md OR notes/goals.md has today's entry.\n` +
    `\nROW 13 — 04:00–04:30 — Retrospective (30 min)\n` +
    `  ▶ CONNECTIVITY CHECK (mandatory answers):\n` +
    (nonCodeDt
      ? `     1. LEARNED — which morning concept clarified the problem?\n` +
        `     2. CAPTURED — which research artifact proves the DT step?\n` +
        `     3. LINKED — how does that artifact illuminate one slice of the problem statement?\n` +
        `     4. STUCK — what open question remains, and tomorrow's first DT step?\n`
      : `     1. LEARNED — which morning concept did I use?\n` +
        `     2. BUILT — which file/function proves I implemented it?\n` +
        `     3. LINKED — how does that piece solve one slice of the problem statement?\n` +
        `     4. STUCK — what blocked the pipeline, and tomorrow's first step?\n`) +
    `  ▶ Coding Log: today's ${slice.codingPlatform} title is NEW\n` +
    `  ▶ Brainstorm: ${slice.brainstorm}\n` +
    `  ▶ Reminder: zero after-hours homework\n` +
    `\nReturn ONLY valid JSON — no markdown, no code blocks, no string concatenation:\n` +
    `Each row's 4th field ("content") MUST be a JSON ARRAY of short bullet strings, one idea per\n` +
    `element — NOT a single string. Do not put "\\n" inside a bullet; make a new array element instead.\n\n` +
    `{"rows":[["${resolvedDayKey}","08:45 – 09:00 IST","Stand-Up",["<bullet>","<bullet>"]],` +
    `["${resolvedDayKey}","09:00 – 10:30 IST","Learning",["<bullet>","<bullet>"]],` +
    `["${resolvedDayKey}","10:30 – 10:45 IST","Break",["<bullet>"]],` +
    `["${resolvedDayKey}","10:45 – 11:30 IST","Coding Practice",["<bullet>","<bullet>"]],` +
    `["${resolvedDayKey}","11:30 – 11:45 IST","Speak & Solve",["<bullet>","<bullet>"]],` +
    `["${resolvedDayKey}","11:45 – 12:30 IST","Learning",["<bullet>","<bullet>"]],` +
    `["${resolvedDayKey}","12:30 – 01:15 IST","Lunch",["<bullet>"]],` +
    `["${resolvedDayKey}","01:15 – 02:15 IST","Project Build",["<bullet>","<bullet>"]],` +
    `["${resolvedDayKey}","02:15 – 02:25 IST","${assessment.picks.game ? "Refresh Game" : "Break"}",["<bullet>"]],` +
    (assessment.picks.agentWorkbench
      ? `["${resolvedDayKey}","02:25 – 02:45 IST","Agent Workbench",["<bullet>","<bullet>"]],` +
        `["${resolvedDayKey}","02:45 – 03:25 IST","System Design",["<bullet>","<bullet>"]],`
      : `["${resolvedDayKey}","02:25 – 03:25 IST","System Design",["<bullet>","<bullet>"]],`) +
    `["${resolvedDayKey}","03:25 – 03:35 IST","${inputsHasCompany ? "Placement Prep" : "Project Push"}",["<bullet>","<bullet>"]],` +
    `["${resolvedDayKey}","03:35 – 04:00 IST","Interests",["<bullet>","<bullet>"]],` +
    `["${resolvedDayKey}","04:00 – 04:30 IST","Retrospective",["<bullet>","<bullet>"]]]}\n\n` +
    `CRITICAL:\n` +
    `- Return EXACTLY ${assessment.picks.agentWorkbench ? "14" : "13"} rows covering continuous 08:45→04:30. Column 1 always "${resolvedDayKey}".\n` +
    `- TIMES MUST be continuous with NO gaps (end of row N = start of row N+1). NEVER leave empty hours.\n` +
    `- ROW for Project Build (01:15–02:15) is MANDATORY — never omit the project.\n` +
    (assessment.picks.agentWorkbench
      ? `- Agent Workbench (02:25–02:45) is MANDATORY — give a concrete n8n-style agent build (triggers→nodes→actions), not "explore the tool".\n`
      : "") +
    `- Column 4 (content) is ALWAYS a JSON array of plain bullet strings — no ▶ prefix needed (the app adds it), no paragraphs, no embedded newlines.\n` +
    `- NO JavaScript string concatenation (no + signs). Pure JSON only.\n` +
    `- NO after-hours tasks, NO homework.\n` +
    (nonCodeDt
      ? `- ROW 8 MUST be one connected DT RESEARCH pipeline (Discussion → task → artifact) using exact DT Playbook jargon: Stage, Step, What to Learn, Real Project Task, Discussion Prompt, Problem Statement — NO syllabus-feature coding / NO git feature push.\n` +
        `- ROW 10 MUST deepen the SAME research artifact from ROW 8 — no coding a solution.\n` +
        `- ROW 13 MUST include LEARNED / CAPTURED / LINKED / STUCK connectivity answers.\n`
      : `- ROW 8 MUST be one connected pipeline (Steps A→E) that IMPLEMENTS morning Learning + DSA — not a list of unrelated chores.\n` +
        `- ROW 10 MUST continue the SAME feature from ROW 8.\n` +
        `- ROW 13 MUST include LEARNED / BUILT / LINKED / STUCK connectivity answers.\n`) +
    `- Always use FULL subject/topic names — do NOT abbreviate or use short codes; students must be able to read them directly.\n` +
    `- ROW 5 (Speak & Solve) content MUST match today's activityType: ${slice.activityType === "speaking" ? "a spoken explanation exercise, NOT an aptitude problem" : "an aptitude/reasoning exercise, NOT a spoken-explanation exercise"}.\n` +
    `- ROW 4 MUST name 2–3 REAL, DIFFERENT problems never used on earlier days — never recycle "Two Sum", "Valid Parentheses", or "Solve Me First" if already used this week.\n` +
    `- ROW 12 is Interests / Goals (NOT Peer Review, NOT Capability dump); ROW 13 is Retrospective with connectivity answers.\n` +
    `- ONE learnTopic per day only. Do not dump many concepts. Keep problem text short and complete (never mid-sentence cuts).\n` +
    `- Learning, Problem Lab, Project Build, Coding Practice, System Design, Homework, and Interests/Goals MUST include Reference links (full https URLs) when learning something new.\n` +
    `- Ebook hints ONLY if the student uploaded ebook/notes. Otherwise omit.\n` +
    `- ${isTeam
      ? "TEAM mode: Team check-in and named split work are allowed. Never invent extra people."
      : 'SOLO mode: never write team / teammates / classmate / "Team check-in" / "each person". Stand-Up = Personal check-in only.'}\n` +
    `- Use exact DT Playbook jargon wherever applicable: Stage, Step, What to Learn, Real Project Task, Discussion Prompt, Problem Statement.\n` +
    (inputsHasCompany
      ? `- ROW 11 MUST be a SHORT Placement Micro (8–10 min) for "${inputsCompany}" — not a long research block.\n`
      : "") +
    `- If Assessment Content includes cases: each student/team-member must get a DIFFERENT case title the same day.\n` +
    `- Include Product-of-the-Day speak. Refresh Game ONLY if listed in ASSESSMENT + ENGAGEMENT for this day (2–3 days/week). ` +
    `Core subject Learning MUST include PROJECT LINK / APPLY / PROVE to "${theme.project}". ` +
    `Project breakdown may SHAPE the pipeline deliverable but must not add unrelated parallel chores.\n` +
    `- Include a motivation boost line at standup.\n` +
    (dtStep
      ? nonCodeDt
        ? `- ROW 8 is locked to DT step "${dtStep.step}" (Week ${dtStep.weekNumber}: ${dtStep.stage}) as RESEARCH/ARTIFACT work — ` +
          `do NOT force morning subjects into code features; do NOT invent a full product solution.\n` +
          `- ROW 8 MUST reference the student's actual problem statement text directly.\n` +
          (dtStep.dsaConcept === "NA" || nonCodeDt
            ? `- DSA→feature hook is NOT required today — coding practice stays skill-only.\n`
            : "")
        : `- ROW 8 uses DT lens "${dtStep.step}" (Week ${dtStep.weekNumber}: ${dtStep.stage}) INSIDE the learn→implement pipeline — ` +
          `do NOT dump every DT stage.\n` +
          (evaluateDay
            ? `- Evaluate stage: fold usability/interview/observation into the pipeline where it fits.\n`
            : `- Do not restart Empathize/Define — extend yesterday's artifact.\n`) +
          `- ROW 8 MUST reference the student's actual problem statement text directly.\n` +
          (dtStep.dsaConcept === "NA"
            ? `- DSA concept is NA today — Step C continues the DT/artifact pipeline without forcing a coding-algorithm step.\n`
            : "")
      : `- DT Playbook is complete. ROW 8 is an applied build pipeline on the existing project — no Empathize/Define restart.\n`) +
    `- Agent Workbench tasks must be fully defined (title + problem + what + steps + done). Never paste a long problem essay into the agent Problem line — only a short product glance.\n` +
    `- Coding Practice / LeetCode: keep short (pattern + one problem + Apply + Done).\n` +
    `- Extra Concept line in ROW 8 ONLY when genuinely needed — omit it most days.\n`
  );
}

const FALLBACK_TOTAL_WEEKS = 13; // only used if literally nothing else is available
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Exam config resolution ──────────────────────────────────────────────────
// Exams are OPT-IN. Unless the caller explicitly built a calendar with IA/AU
// exam dates (calendarMeta present), there is NO exam week — no hardcoded
// college-semester weeks 4/8/10/12/13 get injected. This is what previously
// caused phantom "IA Exam Week"/"AU Exam Week" content and fallback exam
// distribution logs even when the user never configured any exams.
function resolveExamConfig(calendarMeta) {
  const iaWeekSet = calendarMeta?.iaWeekNums?.length ? new Set(calendarMeta.iaWeekNums) : new Set();
  const auWeekSet = calendarMeta?.auWeekNums?.length ? new Set(calendarMeta.auWeekNums) : new Set();
  const mockWeekNum = calendarMeta?.mockWeekNum ?? null;
  return { iaWeekSet, auWeekSet, mockWeekNum, examsEnabled: iaWeekSet.size > 0 || auWeekSet.size > 0 };
}

// ── Normalize LLM row output ────────────────────────────────────────────────
// The content cell is requested from the LLM as an ARRAY of bullet strings
// (one idea per element) instead of a single string with embedded "\n".
// Models are unreliable at placing literal newlines correctly inside a JSON
// string — that's what produced the "one giant paragraph despite ▶ prefixes"
// symptom. Joining server-side guarantees a real line break every time, for
// free, with no extra "polish" LLM pass needed.
function normalizeRows(rows) {
  if (!Array.isArray(rows)) return rows;
  return rows.map((r) => {
    if (!Array.isArray(r)) return r;
    const content = r[3];
    if (Array.isArray(content)) {
      const joined = content.filter((line) => typeof line === "string" && line.trim()).join("\n");
      return [r[0], r[1], r[2], joined];
    }
    return r;
  });
}
function getExamFocus(subjectName, weekTopic, examAnalysis) {
  const topics = examAnalysis?.[subjectName];
  if (topics && topics.length > 0) {
    const top = topics.slice(0, 3).map((t) => t.topic).join("; ");
    return weekTopic + " | PYQ Focus: " + top;
  }
  return weekTopic;
}

// ── Get detailed exam questions for weekly plan ───────────────────────────────
function getDetailedExamQuestions(subjectName, examAnalysis) {
  const topics = examAnalysis?.[subjectName];
  if (!topics || topics.length === 0) return null;
  return topics.slice(0, 5).map((t) => {
    const qs = (t.sampleQuestions || []).slice(0, 2).join(" | ");
    return t.topic + (qs ? " → " + qs : "") + " (" + (t.reason || "") + ")";
  }).join("\n    ");
}

// ── Distribute IA exams ───────────────────────────────────────────────────────

function distributeIAExamsAcrossWeeks(themes, examAnalysis, iaWeekNums, totalWeeks, calMap) {
  const allIAExams = [];
  const iaWeeksToUse = (iaWeekNums && iaWeekNums.length > 0) ? iaWeekNums : [];
  if (iaWeeksToUse.length === 0) return []; // exams not enabled — no IA days, ever

  if (calMap && calMap.length > 0) {
    const iaCalEntries = calMap.filter(e => e.isExam && e.examSessions?.some(s => s.examType?.startsWith("IA")));
    if (iaCalEntries.length > 0) {
      for (const entry of iaCalEntries) {
        const theme = themes.find(t => t.week === entry.week);
        if (!theme) continue;
        for (const session of (entry.examSessions || [])) {
          if (!session.examType?.startsWith("IA")) continue;
          const matchedSubject = theme.subjects.find(s =>
            s.name.toLowerCase().includes(session.name.toLowerCase()) ||
            session.name.toLowerCase().includes(s.name.toLowerCase())
          ) || theme.subjects[0];
          allIAExams.push({
            week: entry.week,
            day: entry.day,
            subject: matchedSubject,
            isCatchup: false,
          });
        }
      }
      console.log(`📋 Loaded ${allIAExams.length} IA exams from calMap examSessions`);
      return allIAExams;
    }

    if (iaWeeksToUse && iaWeeksToUse.length > 0) {
      let subjectIdx = 0;
      const allSubjects = themes[0]?.subjects || [];
      for (const weekNum of iaWeeksToUse) {
        const theme = themes.find(t => t.week === weekNum);
        if (!theme) continue;
        const workingDays = calMap.filter(e => e.week === weekNum && !e.isHoliday);
        const days = workingDays.length > 0
          ? workingDays.map(e => e.day)
          : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
        for (const day of days) {
          if (subjectIdx >= allSubjects.length) break;
          allIAExams.push({ week: weekNum, day, subject: allSubjects[subjectIdx], isCatchup: false });
          subjectIdx++;
        }
      }
      if (allIAExams.length > 0) {
        console.log(`📋 Loaded ${allIAExams.length} IA exams from calendarMeta.iaWeekNums + calMap working days`);
        return allIAExams;
      }
    }
  }

  for (const weekNum of iaWeeksToUse) {
    const theme = themes.find(t => t.week === weekNum);
    if (!theme) continue;
    const subjectsRemaining = [...theme.subjects];
    const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
    for (let i = 0; i < Math.min(5, subjectsRemaining.length); i++) {
      allIAExams.push({ week: weekNum, day: days[i], subject: subjectsRemaining[i], isCatchup: false });
    }
    if (subjectsRemaining.length > 5) {
      const remainingSubjects = subjectsRemaining.slice(5);
      let offset = 1, dayIdx = 0;
      for (const subj of remainingSubjects) {
        const cwn = Math.min(weekNum + offset, totalWeeks || FALLBACK_TOTAL_WEEKS);
        const nt = themes.find(t => t.week === cwn);
        if (nt) allIAExams.push({ week: cwn, day: days[dayIdx % 5], subject: subj, isCatchup: true, originalIAWeek: weekNum });
        dayIdx++;
        if (dayIdx >= 5 && dayIdx < remainingSubjects.length) { offset++; dayIdx = 0; }
      }
    }
  }
  console.log(`📋 Scheduled ${allIAExams.length} IA exams (fallback distribution)`);
  return allIAExams;
}

// ── IA Exam Day Rows ──────────────────────────────────────────────────────────

function buildIADayRows(theme, dayName, examAnalysis, isCatchup = false, originalIAWeek = null) {
  const dayKey = `Week ${theme.week} - ${dayName}`;
  const subjectForExam = theme.subjects[0];
  const examFocus = getExamFocus(subjectForExam.name, subjectForExam.topic, examAnalysis);
  const headerNote = isCatchup ?
    `⚠️ CATCHUP INTERNAL ASSESSMENT (from Week ${originalIAWeek})` :
    "INTERNAL ASSESSMENT DAY";

  return [
    [dayKey, "08:30 – 09:15 IST", "📖 Pre-Exam Revision",
      `${headerNote} — Subject: ${subjectForExam.name}\n` +
      `▶ Arrive by 08:30 IST, settle in\n` +
      `▶ Final revision (08:30–09:15 IST): focus on ${examFocus}\n` +
      `▶ Quick recap of formulas/definitions, no new topics\n` +
      `▶ Group huddle: clarify last-minute doubts with peers/faculty`],
    [dayKey, "09:15 – 09:30 IST", "🚶 Move to Exam Hall",
      `▶ Proceed to allocated exam hall by 09:30 IST\n` +
      `▶ Keep hall tickets / ID, stationery ready\n` +
      `▶ Switch off / submit phones as per exam rules`],
    [dayKey, "09:30 – 11:00 IST", `📝 ${isCatchup ? "Catchup " : ""}Internal Assessment — ${subjectForExam.name}`,
      `SUBJECT: ${subjectForExam.name}\n` +
      `▶ Topics covered: ${examFocus}\n` +
      `▶ Duration: 90 minutes (09:30–11:00 IST)\n` +
      `▶ Follow exam hall instructions strictly`],
    [dayKey, "11:00 – 11:30 IST", "☕ Post-Exam Break",
      `▶ Relax, hydrate, decompress (11:00–11:30 IST)\n` +
      `▶ Informal discussion of exam questions (optional)\n` +
      `▶ No immediate next-subject prep — take the break`],
    [dayKey, "11:30 – 12:30 IST", "📚 Other Subjects Revision",
      `Light revision for remaining subjects (if any)\n` +
      `▶ Focus on understanding gaps before upcoming assessments\n` +
      `▶ Prepare 5 key points per subject`],
    [dayKey, "12:30 – 01:30 IST", "🍽️ Lunch Break",
      `Rest, eat, recharge (12:30–01:30 IST). No screens for first 30 min.`],
    [dayKey, "01:30 – 03:00 IST", "💻 PROJECT IMPLEMENTATION SESSION (90 min)",
      `PROJECT WORK — Resume where the team left off:\n` +
      `▶ Milestone target: ${theme.project}\n` +
      `▶ Step 1 (15 min): Open the project folder, read last commit message, understand where you stopped\n` +
      `▶ Step 2 (20 min): Each team member picks ONE task from the project board (Trello / GitHub Issues)\n` +
      `▶ Step 3 (40 min): Implement — write the code, test locally, fix errors as you go\n` +
      `▶ Step 4 (15 min): Commit changes: git add . → git commit -m "meaningful message" → git push\n` +
      `▶ Tech stack in use: ${theme.tech}\n` +
      `▶ Beginner tip: if stuck > 10 min, ask a teammate or faculty — do NOT sit blocked alone`],
    [dayKey, "03:00 – 03:30 IST", "🎯 Project Check-in + System Design",
      `QUICK DEMO (5 min per team):\n` +
      `▶ Show what was implemented today\n` +
      `▶ System Design discussion: ${theme.systemDesign}\n` +
      `▶ Faculty Q&A on implementation decisions\n` +
      `▶ Update project board: mark tasks done / in-progress`],
    [dayKey, "03:30 – 04:00 IST", "🔁 Peer Knowledge Sharing",
      `▶ Exam debrief: what was tricky, what was straightforward\n` +
      `▶ 1 concept from today's exam subject everyone should know`],
    [dayKey, "04:00 – 04:30 IST", "🔄 Daily Retrospective + Tomorrow Prep",
      `RETRO (Start / Stop / Continue)\n` +
      `▶ How did today's exam go?\n` +
      `▶ What will each member revise tonight for next assessment?\n` +
      `▶ Project: what is the next task for tomorrow?`],
  ];
}

// ── AU Exam Day Rows ──────────────────────────────────────────────────────────

function buildAUExamDayRows(theme, dayName, examAnalysis, subjectForExam) {
  const dayKey = `Week ${theme.week} - ${dayName}`;
  const subject = subjectForExam || theme.subjects[0];
  const examFocus = getExamFocus(subject.name, subject.topic, examAnalysis);

  return [
    [dayKey, "08:30 – 09:15 IST", "📖 Pre-Exam Revision (Final)",
      `AU (UNIVERSITY) EXAM DAY — Subject: ${subject.name}\n` +
      `▶ Arrive by 08:30 IST\n` +
      `▶ Final 45-min revision: ${examFocus}\n` +
      `▶ Review key formulas, definitions, important theorems\n` +
      `▶ No new topics — only reinforce what you know\n` +
      `▶ Stay calm, hydrate, eat light`],
    [dayKey, "09:15 – 09:30 IST", "🚶 Move to Exam Hall",
      `▶ Proceed to allocated exam hall by 09:30 IST\n` +
      `▶ Carry hall ticket, ID, approved stationery\n` +
      `▶ Switch off / deposit phones as per university rules\n` +
      `▶ Take your seat 5 min early`],
    [dayKey, "09:30 – 12:30 IST", `📝 AU University Exam — ${subject.name}`,
      `UNIVERSITY EXAMINATION\n` +
      `▶ Subject: ${subject.name}\n` +
      `▶ Exam topics: ${examFocus}\n` +
      `▶ Duration: 3 hours (09:30–12:30 IST)\n` +
      `▶ Read all questions carefully before writing\n` +
      `▶ Allocate time per section; attempt all compulsory questions first\n` +
      `▶ Follow university exam hall instructions strictly`],
    [dayKey, "12:30 onwards", "🏠 Student Goes Home",
      `▶ Exam concluded — students are free to leave\n` +
      `▶ No further schedule for today\n` +
      `▶ Rest and prepare for the next AU exam subject (if any)`],
  ];
}

// ── Split learning schedule fallback ─────────────────────────────────────────

function createSplitLearningSchedule(theme, dayName, numSubjects, examAnalysis, globalDayIndex = 0) {
  const morningSubjects = theme.subjects.slice(0, Math.ceil(numSubjects / 2));
  const afternoonSubjects = theme.subjects.slice(Math.ceil(numSubjects / 2));
  const dayKey = `Week ${theme.week} - ${dayName}`;
  const variant = DAY_TASK_VARIANTS[globalDayIndex % DAY_TASK_VARIANTS.length];

  return [
    [dayKey, "08:45 – 09:00 IST", "🚀 Daily Stand-Up",
      `Day ${globalDayIndex + 1} — ${numSubjects} subjects\n` +
      `▶ Today's project target: ${variant.projectAction}`],
    [dayKey, "09:00 – 10:30 IST", "📚 Concept Learning Session 1 (90 min)",
      `ALL subjects — first session:\n` +
      morningSubjects.concat(afternoonSubjects).map(s =>
        `▶ ${s.name}: ${getExamFocus(s.name, s.topic, examAnalysis)}\n  ~${Math.floor(90 / numSubjects)} min`
      ).join("\n")],
    [dayKey, "10:30 – 10:45 IST", "☕ Short Break",
      `Step away from desk (10:30–10:45 IST). Hydrate, stretch.`],
    [dayKey, "10:45 – 12:15 IST", "💻 PROJECT WORK — Apply Morning Concepts (90 min)",
      `BEGINNER PROJECT GUIDE — implement what you just learnt:\n` +
      `▶ Step 1 (10 min): Open project folder → read the task card on your project board\n` +
      `▶ Step 2 (15 min): Sketch the logic on paper — what inputs, what outputs, what steps?\n` +
      `▶ Step 3 (45 min): Write the code:\n` +
      `    • Create a new file or open the relevant module\n` +
      `    • Apply today's concepts: ${morningSubjects.map(s => s.name).join(", ")}\n` +
      `    • Start small — get ONE function working before moving to the next\n` +
      `▶ Step 4 (15 min): Test — run the code, fix errors, try different inputs\n` +
      `▶ Step 5 (5 min): Commit: git add . → git commit -m "feat: [describe what you built]"\n` +
      `▶ Beginner rule: stuck > 10 min? Ask a teammate — do NOT Google solutions blindly`],
    [dayKey, "12:15 – 01:05 IST", "🍽️ Lunch Break (50 min)",
      `Lunch break (12:15–01:05 IST). No screens for first 25 min.`],
    [dayKey, "01:05 – 02:30 IST", "📚 DSA + System Design (85 min)",
      `▶ DSA (40 min): ${theme.dsa} — worked examples & edge cases\n` +
      `▶ System Design (45 min): ${theme.systemDesign} — apply to project architecture`],
    [dayKey, "02:30 – 02:45 IST", "🧘 Short Break",
      `Quick refresh (02:30–02:45 IST). Hydrate. Stretch.`],
    [dayKey, "02:45 – 04:00 IST", "💻 PROJECT WORK — Integrate DSA & System Design (75 min)",
      `BEGINNER PROJECT GUIDE — apply DSA and system design you just learnt:\n` +
      `▶ Step 1 (10 min): Look at the system design sketch — where does ${theme.systemDesign} fit in your project?\n` +
      `▶ Step 2 (20 min): Apply the DSA concept (${theme.dsa}) — implement or use it in your project code\n` +
      `▶ Step 3 (30 min): Integration — connect today's code with what was built earlier\n` +
      `    • Subjects to integrate: ${afternoonSubjects.map(s => s.name).join(", ")}\n` +
      `    • ${variant.collab}\n` +
      `▶ Step 4 (10 min): Final test + push: git add . → git commit -m "integrate: [what you connected]" → git push\n` +
      `▶ Project milestone progress: ${theme.project}`],
    [dayKey, "04:00 – 04:15 IST", "🔍 Review / Demo (15 min)",
      `Feature demo status · PR update · blockers · board update\n` +
      `▶ Brainstorm: ${variant.brainstorm}`],
    [dayKey, "04:15 – 04:30 IST", "🔄 Retrospective (15 min)",
      `Start / Stop / Continue\n` +
      `✅ What went well?\n❌ What did not?\n📅 One improvement for tomorrow.`],
  ];
}

// ── Mock Exam — Friday Rows ───────────────────────────────────────────────────

function buildMockExamFridayRows(theme, dayKey, examAnalysis) {
  const allSubjectLines = theme.subjects.map((s) => "▶ " + s.name + ": " + getExamFocus(s.name, s.topic, examAnalysis)).join("\n");
  const numSubjects = theme.subjects.length;

  if (numSubjects >= 5) {
    const fridaySubject = theme.subjects[4];
    const fridayExamFocus = getExamFocus(fridaySubject.name, fridaySubject.topic, examAnalysis);
    return [
      [dayKey, "08:30 – 09:15 IST", "📖 Final Revision",
        "MOCK EXAM WEEK — FRIDAY — Subject: " + fridaySubject.name + "\n" +
        "▶ Arrive by 08:30 IST\n▶ Final revision: " + fridayExamFocus + "\n" +
        "▶ Quick 10-min recap of all subjects mocked this week:\n" + allSubjectLines],
      [dayKey, "09:15 – 09:30 IST", "🚶 Move to Exam Hall",
        "▶ Proceed to allocated hall by 09:30 IST\n▶ Carry hall ticket and stationery"],
      [dayKey, "09:30 – 11:00 IST", "📝 Mock University Exam — " + fridaySubject.name,
        "SUBJECT: " + fridaySubject.name + "\n▶ University-pattern paper: " + fridayExamFocus +
        "\n▶ Duration: 90 minutes (09:30–11:00 IST)\n▶ Full exam discipline"],
      [dayKey, "11:00 – 11:30 IST", "☕ Post-Exam Break", "Relax, hydrate, decompress."],
      [dayKey, "11:30 – 01:00 IST", "🎬 Final Project Demo Prep",
        "Final polish of: " + theme.project + "\n▶ Rehearse demo script, fix last bugs\n▶ Update slide deck / README\n▶ Every team member knows what to say"],
      [dayKey, "01:00 – 02:00 IST", "🍽️ Lunch Break", "Rest, eat, recharge (01:00–02:00 IST)."],
      [dayKey, "02:00 – 04:00 IST", "🏆 Final Project Demo – Faculty & Peer Evaluation",
        "Each team presents the full project build\n▶ Faculty evaluation + peer feedback\n▶ Mock week wrap-up: each member notes 1 improvement for AU\n▶ Certificates / completion review if applicable"],
      [dayKey, "04:00 – 04:30 IST", "🔄 Mock Week Retrospective + AU Prep",
        "Whole mock-week retro: key learnings, growth areas\n▶ List top 3 weak areas → personal AU revision plan\n▶ Next week = AU exams — confirm hall tickets, schedule, transport"],
    ];
  } else {
    return [
      [dayKey, "08:30 – 09:30 IST", "📖 Mock Week Consolidation",
        `MOCK EXAM WEEK — FRIDAY — All ${numSubjects} subjects mocked Mon–Thu\n` +
        "▶ Arrive by 08:30 IST\n▶ Full recap of all mock papers:\n" + allSubjectLines +
        "\n▶ Each member: note 3 specific topics to strengthen before AU"],
      [dayKey, "09:30 – 11:30 IST", "🎬 Final Project Demo Prep",
        "Final polish of: " + theme.project + "\n▶ Fix last bugs, rehearse demo script\n▶ Update README and slide deck\n▶ Every team member practises their speaking part"],
      [dayKey, "11:30 – 12:30 IST", "🍽️ Lunch Break", "Rest, eat, recharge (11:30–12:30 IST)."],
      [dayKey, "12:30 – 02:30 IST", "🏆 Final Project Demo – Faculty & Peer Evaluation",
        "Each team presents the full project\n▶ Faculty evaluation + peer feedback\n▶ Mock week wrap-up: each member notes 1 area to improve for AU"],
      [dayKey, "02:30 – 03:30 IST", "📊 Personal AU Revision Planning",
        "Each student builds their personal AU revision plan:\n" + allSubjectLines],
      [dayKey, "03:30 – 04:30 IST", "🔄 Mock Week Retrospective + AU Prep",
        "Whole mock-week retro: key learnings, growth areas\n▶ Confirm AU exam dates, hall tickets, transport\n▶ Next week = AU exams — rest well this weekend"],
    ];
  }
}

// ── Mock Exam Day Rows (Mon–Thu) ──────────────────────────────────────────────

function buildMockExamDayRows(theme, dayName, examAnalysis) {
  const dayKey = `Week ${theme.week} - ${dayName}`;
  const DAY_INDEX = { Monday: 0, Tuesday: 1, Wednesday: 2, Thursday: 3 };
  const dayIdx = DAY_INDEX[dayName] ?? 0;

  if (dayIdx >= theme.subjects.length) {
    return [
      [dayKey, "—", "📚 Mock Study Leave",
        `▶ All subjects have been covered in mock exams\n` +
        `▶ Use this day for personal revision of weak areas\n` +
        `▶ Solve past year questions for any subject you feel uncertain about`],
    ];
  }

  const subjectForExam = theme.subjects[dayIdx];
  const examFocus = getExamFocus(subjectForExam.name, subjectForExam.topic, examAnalysis);
  const nextDayIdx = dayIdx + 1;
  const nextSubject = nextDayIdx < theme.subjects.length ? theme.subjects[nextDayIdx] : null;

  return [
    [dayKey, "08:30 – 09:15 IST", "📖 Pre-Mock Revision",
      "MOCK EXAM WEEK — " + dayName.toUpperCase() + " — Subject: " + subjectForExam.name + "\n" +
      "▶ Arrive by 08:30 IST\n▶ Final revision: " + examFocus + "\n" +
      "▶ Review common question patterns from PYQs for this subject\n" +
      "▶ Quick recap of formulas/definitions — no new content"],
    [dayKey, "09:15 – 09:30 IST", "🚶 Move to Exam Hall",
      "▶ Proceed to allocated hall by 09:30 IST\n▶ Carry hall ticket, ID, stationery"],
    [dayKey, "09:30 – 11:00 IST", "📝 Mock University Exam — " + subjectForExam.name,
      "SUBJECT: " + subjectForExam.name + "\n▶ University-pattern paper: " + examFocus +
      "\n▶ Duration: 90 minutes (09:30–11:00 IST)\n▶ Full exam discipline: no notes, no phones"],
    [dayKey, "11:00 – 11:30 IST", "☕ Post-Exam Break",
      "Relax, hydrate, decompress (11:00–11:30 IST).\nInformal debrief — what questions were tricky?"],
    [dayKey, "11:30 – 01:00 IST", "📚 Answer Review + Final Project Polish",
      "Answer script walkthrough:\n▶ Go over today's paper with peers — identify gaps\n▶ Note mistakes in revision log\n\n" +
      "Project: Final polish of: " + theme.project + " — fix last bugs, update README"],
    [dayKey, "01:00 – 02:00 IST", "🍽️ Lunch Break", "Rest, eat, recharge (01:00–02:00 IST)."],
    [dayKey, "02:00 – 03:30 IST", "📚 " + (nextSubject ? "Tomorrow's Subject Revision" : "General Revision & Weak Area Focus"),
      nextSubject
        ? ("Pre-mock prep for tomorrow's subject:\n▶ " + nextSubject.name + ": key topics & PYQ patterns\n" +
           "▶ " + getExamFocus(nextSubject.name, nextSubject.topic, examAnalysis) + "\n" +
           "▶ Solve 2 past questions from this subject")
        : ("All subjects mocked — consolidation session:\n▶ Review all mock exam scripts so far\n" +
           "▶ Identify your 3 weakest topics across all subjects\n" +
           "▶ Solve 1 challenging past-year question per weak topic")],
    [dayKey, "03:30 – 04:30 IST", "🔄 Daily Retro + Tomorrow Prep",
      "▶ Today's mock debrief: score estimation, weak areas noted\n" +
      (nextSubject
        ? `▶ Tomorrow: ${nextSubject.name} mock exam\n▶ Each member: 3 specific topics to revise tonight`
        : "▶ Tomorrow: study leave / open revision\n▶ Plan your personal revision schedule")],
  ];
}

// ── Day personality guides ────────────────────────────────────────────────────

const DAY_CONTENT = {
  Monday: {
    standupFocus:   "Week kickoff — what we learned last week, what's new this week, today's topics",
    codingPlatform: "HackerRank",
    codingType:     "Warm-up: solve 1 NEW Easy problem you have NEVER attempted — search by today's DSA tag. Log the title so it is not repeated.",
    examLink:       "Note which topics from today connect to IA syllabus — mark in notes",
    newProblemHint: "HackerRank → Problem Sets → filter by today's DSA tag → pick one with ≤ 500 successful submissions that you have not solved.",
  },
  Tuesday: {
    standupFocus:   "Yesterday's topics recap, today's topics, any doubts from Monday",
    codingPlatform: "LeetCode",
    codingType:     "Solve 1 NEW Easy or Medium problem you have NEVER attempted. Do NOT reuse Monday's problem.",
    examLink:       "Identify 1 IA-likely question from today's topic — write it down",
    newProblemHint: "LeetCode → Problems → filter by today's DSA tag → Sort by Newest → first unsolved. Write the name in the Coding Log before starting.",
  },
  Wednesday: {
    standupFocus:   "Mid-week check — topics covered Mon+Tue, today's topics, syllabus coverage status",
    codingPlatform: "Exercism",
    codingType:     "Complete 1 NEW Exercism exercise you have never submitted — next unsolved exercise matching today's topic.",
    examLink:       "Cross-check: which of this week's topics are on the IA syllabus?",
    newProblemHint: "Exercism → your language track → Exercises → filter by today's concept → first UNSUBMITTED exercise.",
  },
  Thursday: {
    standupFocus:   "Pre-assessment check — today's topics, exam prep focus, doubts cleared",
    codingPlatform: "CodeChef",
    codingType:     "Solve 1 NEW Medium practice problem on CodeChef (platform not used Mon–Wed). Log the problem code.",
    examLink:       "Prepare a 1-page cheat sheet per subject covered this week",
    newProblemHint: "CodeChef → Practice → filter by today's DSA → pick a 3–4★ problem you have NOT solved (check submission history).",
  },
  Friday: {
    standupFocus:   "End-of-week wrap — today's topics reviewed, coding challenge",
    codingPlatform: "GeeksForGeeks",
    codingType:     "Weekly challenge: solve 1 NEW Medium/Hard GFG practice problem covering ANY topic from this week.",
    examLink:       "Map this week's topics to AU exam syllabus units — tick off covered units",
    newProblemHint: "GFG → Practice → filter by this week's DSA topics → sort by Accuracy ascending → pick one you have never seen.",
  },
};


const DAY_TASK_VARIANTS = [
  { projectAction: "scaffold core module, create feature branch, set up folder structure", brainstorm: "How should we structure this feature for maximum reusability?", collab: "Assign roles: who leads implementation, who writes tests, who updates docs" },
  { projectAction: "implement primary business logic functions, write unit tests for edge cases", brainstorm: "What could go wrong with our current approach? List top 3 risks", collab: "Pair programming session: senior dev guides junior on one core function" },
  { projectAction: "integrate module with existing codebase, fix interface mismatches, update imports", brainstorm: "If this feature needed to scale 10x, what would we change first?", collab: "Cross-team code review: swap PRs, give structured feedback on readability" },
  { projectAction: "write integration tests, fix bugs found during testing, update API documentation", brainstorm: "How would a user abuse this feature? Harden against misuse.", collab: "Knowledge share: one member demonstrates a new tool or shortcut" },
  { projectAction: "polish UI/UX, add error handling and loading states, update README", brainstorm: "What one improvement would make the biggest user-facing impact this sprint?", collab: "Full dry-run demo — everyone speaks, feature works end-to-end, docs reviewed" },
  { projectAction: "refactor for clean code: extract helpers, improve naming, reduce duplication", brainstorm: "Which technical debt from last week should we address now vs later?", collab: "Retrospective-style check: what slowed us down and how do we fix it?" },
  { projectAction: "implement caching or performance optimisation for the core feature path", brainstorm: "How would we monitor this in production? What metrics matter most?", collab: "Architecture review: does our implementation match the original system design?" },
  { projectAction: "add logging, error reporting, and fallback/recovery logic to the module", brainstorm: "What is the single biggest unknown in our project right now?", collab: "Mentorship round: experienced member reviews a newcomer's code in detail" },
  { projectAction: "build or extend the admin / config layer for the week's feature", brainstorm: "If we had one more day this sprint, what would we add?", collab: "Open Q&A: any team member can ask any question about the project or tech stack" },
  { projectAction: "write end-to-end tests covering the happy path and 2 failure scenarios", brainstorm: "How can we make onboarding a new developer faster on this module?", collab: "Rotating standup format: each member presents their own progress board" },
];

// ── Pre-slice week content ────────────────────────────────────────────────────

function presliceWeekContent(theme, globalWeekDayOffset = 0) {
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  const subjects = theme.subjects;
  const numSubjects = subjects.length;
  const SUBJECTS_PER_DAY = 4;

  function getSubjectsForDay(dayIdx) {
    if (numSubjects <= SUBJECTS_PER_DAY) return subjects.slice(0, numSubjects);
    const startIdx = (dayIdx * 2) % numSubjects;
    const picked = [];
    for (let i = 0; i < SUBJECTS_PER_DAY; i++) {
      picked.push(subjects[(startIdx + i) % numSubjects]);
    }
    return picked;
  }

  const dsaBase = theme.dsa;
  const DSA_PHASES = ["Introduction & Theory", "Core Algorithm", "Worked Examples", "Edge Cases & Variants", "Practice Problems & Review"];
  const SUBJECT_PHASES = [
    { label: "Introduction & Core Definition",     activity: "faculty-led explanation, students take notes in their own words" },
    { label: "Deep Dive — Mechanics & Why It Works", activity: "faculty walks through the reasoning/derivation, students ask 1 question each" },
    { label: "Applying It — Problem-Solving",        activity: "students solve 2 problems in pairs, faculty circulates and helps" },
    { label: "Edge Cases & Common Mistakes",         activity: "faculty shows 2 wrong answers students often give and why — class debates the fix" },
    { label: "Review, Teach-Back & Quick Check",      activity: "students explain the topic to a partner, then a 3-question rapid quiz (no grading, just checking)" },
  ];
  const SD_PHASES = [
    { label: "Concept & Motivation",        activity: "why this problem exists — a real failure scenario, discussed as a class" },
    { label: "Core Mechanism",              activity: "faculty whiteboards how it actually works, step by step" },
    { label: "Trade-offs & Alternatives",   activity: "students debate in pairs: when would you NOT use this approach?" },
    { label: "Applying It to Our Project",  activity: "students sketch where this fits in their own project architecture" },
    { label: "Review & Whiteboard Practice",activity: "1 student whiteboards the full concept from memory while the class checks" },
  ];
  // Mon/Wed/Fri = communication round, Tue/Thu = aptitude round — keeps the week varied
  const ACTIVITY_TYPES = ["speaking", "aptitude", "speaking", "aptitude", "speaking"];
  const CODING_PLATFORMS = ["HackerRank", "LeetCode", "Exercism", "CodeChef", "GeeksForGeeks"];
  const CODING_DIFFICULTY = ["Easy (warm-up, NEW problem)", "Easy/Medium (NEW, never reused)", "1 NEW Exercism exercise", "Medium timed 20 min (NEW)", "Medium/Hard weekly challenge (NEW)"];
  const BRAINSTORMS = [
    "Which of today's topics is most likely to appear in the exam? Why?",
    "What is the difference between yesterday's concept and today's? Give a real-world example for each.",
    "If today's topics appeared on the same exam paper, which question would you answer first and why?",
    "What are the top 3 formulas or definitions from this week's subjects you must memorize for AU?",
    "Which 1 topic from this week do you feel least confident about? How will you fix that before the IA?",
  ];

  return days.map((dayName, i) => {
    const daySubjects = getSubjectsForDay(i);
    const primarySubject = daySubjects[0];
    return {
      dayName,
      primarySubject,
      allSubjects:         daySubjects,
      allSubjectsCount:    daySubjects.length,
      dsaSubtopic:         `${dsaBase} — ${DSA_PHASES[i]}`,
      subjectPhase:        SUBJECT_PHASES[i],
      sdPhase:             SD_PHASES[i],
      activityType:        ACTIVITY_TYPES[i],
      codingPlatform:      CODING_PLATFORMS[i],
      codingDifficulty:    CODING_DIFFICULTY[i],
      brainstorm:          BRAINSTORMS[i],
      dayGuide:            DAY_CONTENT[dayName] || DAY_CONTENT["Monday"],
      variant:             DAY_TASK_VARIANTS[(globalWeekDayOffset + i) % DAY_TASK_VARIANTS.length],
      // Project alignment — carried from theme so the LLM cannot hallucinate tech
      projectTask:         theme.projectTask || theme.project,
      cumulativeKnowledge: theme.cumulativeKnowledge || "",
    };
  });
}

// ── Build daily day prompt ────────────────────────────────────────────────────

function buildFridayRows(theme, examAnalysis, focusOverride, dayKey, globalDayIndex = 0) {
  const wk = dayKey || `Week ${theme.week} - Friday`;
  const allSubjects = theme.subjects;
  const numSubs = allSubjects.length;

  const quizLines = allSubjects
    .map((s, i) => `▶ Sub${i+1} — ${s.name}: ${getExamFocus(s.name, s.topic, examAnalysis)} — 2 MCQ + 1 short answer`)
    .join("\n");

  const syllabusLines = allSubjects
    .map((s) => `▶ ${s.name}: "${s.topic}" covered this week ✅ | Remaining units before IA: [student fills in]`)
    .join("\n");

  const focusNote = focusOverride ? "USER CHANGE: " + focusOverride + "\n" : "";

  return [
    [wk, "08:45 – 09:00 IST", "🚀 Weekly Wrap-Up Stand-Up",
      focusNote +
      `▶ Week ${theme.week} review: Which 4 subjects were covered each day? Rotation check.\n` +
      `▶ Each student: name 1 topic they understood well + 1 they are still unsure about\n` +
      `▶ Faculty: quick IA readiness check — how many units remain per subject?\n` +
      `▶ Today's plan: Quiz → Coding Challenge → Project Session → Peer Teaching → Wrap-up`],

    [wk, "09:00 – 10:15 IST", "📝 Weekly IA-Style Quiz (All Subjects — 75 min)",
      `QUIZ FORMAT — IA and AU question patterns:\n` + quizLines + "\n\n" +
      `▶ Time: 75 min total — ~10 min per subject\n` +
      `▶ Individual work — no sharing answers\n` +
      `▶ After 75 min: peer-mark using answer key on board\n` +
      `▶ Score recorded in personal revision log`],

    [wk, "10:15 – 10:30 IST", "☕ Short Break",
      `Break (10:15–10:30 IST). Hydrate, stretch. Review quiz answers mentally.`],

    [wk, "10:30 – 11:30 IST", "💻 Weekly Coding Challenge — GeeksForGeeks (60 min)",
      `▶ Platform: GeeksForGeeks — Weekly Challenge (NEW problem — do not reuse Mon–Thu titles)\n` +
      `▶ Difficulty: Medium or Hard\n` +
      `▶ Pick a problem tagged with: ${theme.dsa}\n` +
      `▶ Process:\n` +
      `    Step 1 — Read the problem twice (3 min)\n` +
      `    Step 2 — Write pseudocode on paper (5 min)\n` +
      `    Step 3 — Code and test locally (30 min)\n` +
      `    Step 4 — Submit and check result (5 min)\n` +
      `    Step 5 — Share approach with the class: explain in 3 sentences (5 min)\n` +
      `▶ Log: problem name | difficulty | result | key learning`],

    [wk, "11:30 – 12:15 IST", "💻 PROJECT SESSION — Friday Integration (45 min)",
      `KNOWLEDGE FENCE — only use concepts taught by Week ${theme.week}:\n` +
      `Known: ${(theme.cumulativeKnowledge || "subjects taught so far").slice(0, 300)}\n\n` +
      `BEGINNER STEP-BY-STEP — Friday project integration:\n` +
      (theme.week === 1
        ? `▶ Step 1 (5 min): It is only Week 1 — review what was built Mon–Thu this week on the project board\n`
        : `▶ Step 1 (5 min): Review the week's project board — DONE / IN-PROGRESS / BLOCKED\n`) +
      `▶ Step 2 (10 min): Each team member picks 1 open task that uses this week's subjects\n` +
      `   This week's task: ${theme.projectTask}\n` +
      `▶ Step 3 (20 min): Implement using ONLY this week's known concepts:\n` +
      `    • ${allSubjects.slice(0, 2).map(s => s.name + ": apply \"" + s.topic + "\" to the project").join("\n    • ")}\n` +
      `    • Write comments in your code: WHAT does each section do, WHY is it there?\n` +
      `    • Do NOT add any technology not yet covered in class\n` +
      `▶ Step 4 (5 min): Pull latest from main branch → resolve merge conflicts if any\n` +
      `▶ Step 5 (5 min): Push your work → open a Pull Request → ask 1 teammate to review\n` +
      `▶ End-of-week milestone check: ${theme.project} — what % complete after this week?`],

    [wk, "12:15 – 01:00 IST", "🍽️ Lunch Break",
      `Lunch (12:15–01:00 IST). Rest, eat, recharge. No studying for first 30 min.`],

    [wk, "01:00 – 02:00 IST", "📊 Syllabus Coverage Audit (60 min)",
      `WEEKLY SYLLABUS AUDIT:\n` + syllabusLines + "\n\n" +
      `▶ If a topic wasn't taught this week, mark it 🔴 — pick it up next week\n` +
      `▶ IA countdown: how many weeks until next IA? How many units remain?\n` +
      `▶ Calculate: units_remaining ÷ weeks_until_IA = units_per_week needed\n` +
      `▶ Is the pace on track? If behind: flag to faculty TODAY\n` +
      `▶ Fill in personal syllabus tracker (printed grid or notebook page)`],

    [wk, "02:00 – 02:15 IST", "🧘 Short Break",
      `Break (02:00–02:15 IST). Hydrate. Step outside briefly.`],

    [wk, "02:15 – 03:30 IST", "🔁 Peer Teaching + Doubt Clearing (75 min)",
      `▶ FORMAT: Each student teaches 1 topic they understood best this week\n` +
      `▶ Rotation: ${allSubjects.map((s, i) => `Student ${i+1} → ${s.name}: "${s.topic}"`).join(" | ")}\n` +
      `▶ After each mini-teach (5 min): class asks 1 question\n` +
      `▶ Faculty collects all unanswered doubts → addresses top 3\n` +
      `▶ Goal: zero pending doubts by 03:30`],

    [wk, "03:30 – 04:00 IST", "📋 Next Week Plan + IA Timeline (30 min)",
      `▶ Faculty reveals next week's 4-subject rotation\n` +
      `▶ IA exam plan: topics that MUST be covered before next IA:\n` +
      allSubjects.map((s) => `    ${s.name}: next units → [faculty specifies]`).join("\n") + "\n" +
      `▶ Coding streak reminder: Mon=HackerRank | Tue=LeetCode | Wed=Exercism | Thu=CodeChef | Fri=GeeksForGeeks — NEW problem every day, never repeat titles`],

    [wk, "04:00 – 04:30 IST", "🔄 End-of-Week Daily Retrospective",
      `▶ Each student answers (1–2 sentences, specific):\n` +
      `    ✅ DONE — What exact output did I finish this week?\n` +
      `    📚 LEARNED — What 1 NEW concept do I now understand that I did not on Monday?\n` +
      `    ❌ STUCK — What 1 topic am I still not confident about?\n` +
      `    🔧 What 1 habit will I change to study better next week?\n` +
      `▶ Coding progress this week: 5 days × 1 NEW problem = 5 unique titles. How many did you log?\n` +
      `▶ Syllabus health: on track ✅ / 1 week behind 🟡 / 2+ weeks behind 🔴\n` +
      `▶ Faculty: give 1 positive shoutout to a student who showed improvement this week\n` +
      `▶ Reminder: weekend rest is encouraged — all tasks are done in class`],
  ];
}

// ── Refinement Functions ──────────────────────────────────────────────────────

async function generateDailyPlan(inputs, themes, examAnalysis, focusOverride, calendarMeta, calMap) {
  const allRows = [];
  // Hands-on: if Subjects upload empty, use editable backend/data/collegeSyllabusInput.txt
  try {
    const { ensureSyllabusFromHandsOnFile } = require("./loadCollegeSyllabusInput");
    inputs = await ensureSyllabusFromHandsOnFile(inputs || {});
  } catch (_) {
    /* optional */
  }

  const { iaWeekSet, auWeekSet, mockWeekNum, examsEnabled } = resolveExamConfig(calendarMeta);

  console.log(`🔍 generateDailyPlan exams: ${examsEnabled
    ? `ENABLED — iaWeeks:[${[...iaWeekSet].join(",")}] auWeeks:[${[...auWeekSet].join(",")}] mockWeek:${mockWeekNum}`
    : "DISABLED (no calendarMeta / no exam weeks configured) — pure self-learning schedule"}`);

  const getActualDate = (weekNum, dayName) => {
    if (!calMap) return null;
    const entry = calMap.find(e => e.week === weekNum && e.day === dayName);
    return entry ? entry.displayDate : null;
  };

  const makeDayKey = (weekNum, dayName) => {
    const date = getActualDate(weekNum, dayName);
    return date ? `Week ${weekNum} - ${dayName} (${date})` : `Week ${weekNum} - ${dayName}`;
  };

  const iaExamSchedule = distributeIAExamsAcrossWeeks(
    themes, examAnalysis,
    calendarMeta?.iaWeekNums || null,
    calendarMeta?.totalWeeks || themes.length,
    calMap
  );

  // ── Build AU exam day map ─────────────────────────────────────────────────
  // NOTE: AU exam days may be marked isHoliday:true by the calendar builder
  // (no normal classes), so we MUST NOT filter by !isHoliday here.
  // We use isExam:true OR auWeekSet membership as the signal.
  const auExamDaysByDate = {};
  if (calMap && auWeekSet.size > 0) {
    // Priority 1: explicit AU examSessions (any examType starting with "AU" or equal to "AU")
    const auCalDays = calMap.filter(e =>
      e.isExam &&
      auWeekSet.has(e.week) &&
      e.examSessions?.some(s => s.examType === "AU" || s.examType?.startsWith("AU"))
    );
    if (auCalDays.length > 0) {
      auCalDays.forEach((e, idx) => {
        const session = e.examSessions.find(s => s.examType === "AU" || s.examType?.startsWith("AU"));
        if (session && session.name && !session.name.includes("Subject")) {
          auExamDaysByDate[e.date] = session.name;
        } else {
          auExamDaysByDate[e.date] = `__AU_SLOT_${idx}`;
        }
      });
    } else {
      // Priority 2: any day in the AU week that is marked isExam (regardless of isHoliday)
      const auExamDays = calMap.filter(e => e.isExam && auWeekSet.has(e.week));
      if (auExamDays.length > 0) {
        auExamDays.forEach((e, idx) => {
          auExamDaysByDate[e.date] = `__AU_SLOT_${idx}`;
        });
      } else {
        // Priority 3: all working days in AU week (last resort, no isExam flag at all)
        const auRangeDays = calMap.filter(e => !e.isHoliday && auWeekSet.has(e.week));
        auRangeDays.forEach((e, idx) => {
          auExamDaysByDate[e.date] = `__AU_SLOT_${idx}`;
        });
      }
    }
  }

  if (auWeekSet.size > 0) {
    console.log(`🎓 AU exam days mapped: ${Object.keys(auExamDaysByDate).length} entries`, auExamDaysByDate);
  }

  const auNoDateExamMap = {};
  if (calMap && auWeekSet.size > 0 && Object.keys(auExamDaysByDate).length === 0) {
    // Absolute fallback — include isExam days even if isHoliday:true
    const auWorkingDays = calMap
      .filter(e => (e.isExam || !e.isHoliday) && auWeekSet.has(e.week))
      .sort((a, b) => a.date.localeCompare(b.date));
    const auTheme = themes.find(t => auWeekSet.has(t.week));
    const auSubjects = auTheme ? auTheme.subjects : [];
    const numSubjects = auSubjects.length;
    const numDays = auWorkingDays.length;
    if (numSubjects > 0 && numDays > 0) {
      if (numDays <= numSubjects) {
        auSubjects.slice(0, numDays).forEach((subj, i) => {
          auNoDateExamMap[auWorkingDays[i].date] = subj;
        });
      } else {
        const step = (numDays - 1) / (numSubjects - 1 || 1);
        auSubjects.forEach((subj, i) => {
          const dayIdx = numSubjects === 1 ? 0 : Math.round(i * step);
          auNoDateExamMap[auWorkingDays[Math.min(dayIdx, numDays - 1)].date] = subj;
        });
      }
    }
  }

  let globalDayIndex = 0;

  // ALWAYS load GLOBAL engine lessons before any NEW daily generation
  // (past refine/regenerate feedback — survives logout; shared across plans)
  try {
    const { attachEngineLessons, recordFeedbackLessons } = require("./engineLessons");
    if (focusOverride && String(focusOverride).trim().length >= 8) {
      await recordFeedbackLessons(focusOverride, { surface: "daily" });
    }
    await attachEngineLessons(inputs, "daily");
  } catch (e) {
    console.warn("Engine lessons on plan gen skipped:", e.message);
  }

  // RAG expand assessment / engagement / agent banks from uploaded question PDFs (+ web)
  try {
    const { enrichAssessmentBanksRag } = require("./enrichAssessmentBanksRag");
    const { enrichAgentWorkbenchRag } = require("./enrichAgentWorkbenchRag");
    const { parseAssessmentConfig } = require("./assessmentPicker");
    const cfg = parseAssessmentConfig(inputs || {});
    const problemText = String(inputs?.problem || inputs?.problemStatement || "").trim();
    const questionsText = String(inputs?.questions || "").trim();
    const approxDays = Math.max(5, (themes || []).length * 5);
    const teamSize = Math.max(
      1,
      Number(inputs?.teamSize || inputs?.members?.length || 1) || 1
    );
    const skipBanks =
      inputs?._skipAssessmentBanks === true ||
      inputs?._skipAssessmentBanks === "true";

    if (!skipBanks) {
      // Always RAG (problem / DSA / questions) — never rely on inbuilt seed banks
      inputs._assessmentRagPack = await enrichAssessmentBanksRag(questionsText, {
        numDays: approxDays,
        teamSize,
        problemText: problemText || questionsText,
        dsaText: String(inputs?.dsaSyllabus || inputs?.dsa || "").trim(),
        sdText: String(inputs?.systemDesign || "").trim(),
      });
      if (inputs._assessmentRagPack?.agentTasks?.length) {
        inputs._agentRagPack = {
          tasks: inputs._assessmentRagPack.agentTasks,
          sources: inputs._assessmentRagPack.sources || ["rag"],
          webInsights: [
            "Banks expanded via RAG from problem / syllabus / uploaded questions (no inbuilt LeetCode seed).",
          ],
          mode: inputs._assessmentRagPack.mode || "rag",
        };
      }
      if (
        !inputs._agentRagPack &&
        cfg.banks?.agentWorkbench !== false
      ) {
        inputs._agentRagPack = await enrichAgentWorkbenchRag(
          problemText || questionsText,
          approxDays
        );
      }
    } else {
      inputs._agentRagPack = null;
      inputs._assessmentRagPack = null;
    }
  } catch (e) {
    console.warn("Assessment / Agent Workbench RAG skipped:", e.message);
  }

  try {
    const { attachSolvedLeetCode } = require("./leetcodeSolved");
    await attachSolvedLeetCode(inputs || {});
  } catch (e) {
    console.warn("LeetCode solved lookup skipped:", e.message);
  }

  // System Design — RAG curriculum (lessons + links) + short starter pack
  const skipSd =
    inputs?._skipSystemDesign === true ||
    inputs?._skipSystemDesign === "true" ||
    inputs?._skipSystemDesign === 1;
  if (!skipSd) {
    try {
      const { enrichSystemDesignRag } = require("./enrichSystemDesignRag");
      const { enrichSystemDesignCurriculumRag } = require("./enrichSystemDesignCurriculumRag");
      const sdHint = String(
        (themes || []).map((t) => t.systemDesign || "").filter(Boolean).join("\n") ||
          inputs?.systemDesign ||
          ""
      ).trim();
      const projectHint = String(
        inputs?.problem || inputs?.problemStatement || inputs?.project || ""
      ).trim();
      const approxDays = Math.max(5, (themes || []).length * 5);
      inputs._systemDesignLessonPack = await enrichSystemDesignCurriculumRag({
        numDays: approxDays,
        syllabusHint: sdHint,
        projectHint,
        uploadText: String(inputs?.systemDesign || inputs?.syllabus || "").trim(),
        inputs,
      });
      inputs._systemDesignRagPack = await enrichSystemDesignRag({
        syllabusHint: sdHint,
        projectHint,
        count: 4,
      });
    } catch (e) {
      console.warn("System Design RAG skipped:", e.message);
    }
  } else {
    inputs._systemDesignRagPack = null;
    inputs._systemDesignLessonPack = null;
  }

  for (const theme of themes) {
    const isMockWeek = theme.week === mockWeekNum;
    const isAUWeek   = auWeekSet.has(theme.week);
    const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

    const weekIAExams = iaExamSchedule.filter(exam => exam.week === theme.week);
    const weekSlices  = presliceWeekContent(theme, globalDayIndex);

    for (const day of days) {
      const dayKey   = makeDayKey(theme.week, day);
      const daySlice = weekSlices.find(s => s.dayName === day);

      if (calMap) {
        const calEntry = calMap.find(e => e.week === theme.week && e.day === day);
        if (!calEntry) {
          allRows.push([dayKey, "—", "🏖️ Holiday / Vacation", ""]);
          continue;
        }
        // AU exam days may be flagged isHoliday:true (no normal classes) — don't skip them
        if (calEntry.isHoliday && !isAUWeek) {
          allRows.push([dayKey, "—", "🏖️ Holiday / Vacation", ""]);
          continue;
        }
      }

      const iaExamForDay = weekIAExams.find(exam => exam.day === day);

      if (isAUWeek) {
        const calEntry = calMap ? calMap.find(e => e.week === theme.week && e.day === day) : null;
        const isAUExamDate = calEntry && (auExamDaysByDate[calEntry.date] || auNoDateExamMap[calEntry.date]);
        if (isAUExamDate) {
          const subjectName = auExamDaysByDate[calEntry.date] || null;
          const subjectObj  = subjectName
            ? (theme.subjects.find(s => s.name === subjectName) || theme.subjects[0])
            : (auNoDateExamMap[calEntry.date] || theme.subjects[0]);
          const rows = buildAUExamDayRows(theme, day, examAnalysis, subjectObj);
          allRows.push(...rows.map(r => [dayKey, ...r.slice(1)]));
        } else {
          allRows.push([dayKey, "—", "📚 Study Holiday",
            `▶ Study holiday — no AU exam today\n` +
            `▶ Revise for your upcoming AU exam — focus on the next scheduled subject\n` +
            `▶ Review notes, solve past questions, rest well`]);
        }
        globalDayIndex++;
        continue;
      }

      if (iaExamForDay) {
        const customTheme = { ...theme, subjects: [iaExamForDay.subject] };
        const rows = buildIADayRows(customTheme, day, examAnalysis, iaExamForDay.isCatchup, iaExamForDay.originalIAWeek);
        allRows.push(...rows.map(r => [dayKey, ...r.slice(1)]));
      } else if (isMockWeek) {
        const rows = buildMockExamDayRows(theme, day, examAnalysis);
        allRows.push(...rows.map(r => [dayKey, ...r.slice(1)]));
      } else {
        const activeStageKey = inputs?._activeDTStage || inputs?.activeDTStage || null;
        const dtStepForDay = getStepForPlanDay(globalDayIndex, activeStageKey, inputs);
        // Gap-driven day: small LLM JSON (topic gap) + deterministic continuous schedule.
        // Avoids "Partial JSON recovered — 2 rows" from the old 13-row mega-prompt.
        try {
          const { generateDayGapContent, buildGapDrivenDayRows } = require("./dayGapGenerator");
          const gap = await generateDayGapContent({
            dayName: day,
            dayKey,
            theme,
            inputs,
            globalDayIndex,
            daySlice,
            dtStep: dtStepForDay,
          });
          if (!inputs._seenResourceUrls) inputs._seenResourceUrls = new Set();
          const dayRows = buildGapDrivenDayRows(dayKey, gap, {
            theme,
            dtStep: dtStepForDay,
            dayIdx: globalDayIndex,
            inputs,
            daySlice,
          });
          console.log(
            `✅ ${dayKey}: gap-driven (${gap._fallback ? "fallback" : "LLM"})` +
            `${dtStepForDay ? ` | DT: ${dtStepForDay.step}` : ""}` +
            ` — learn "${gap.learnTopic}" → apply`
          );
          allRows.push(...enforceDayConnectivity(dayRows, { theme, dtStep: dtStepForDay }));
        } catch (err) {
          console.error(`Week ${theme.week} ${day} failed:`, err.message);
          const rows = createSplitLearningSchedule(theme, day, theme.subjects.length, examAnalysis, globalDayIndex);
          const dayRows = rows.map(r => [dayKey, ...r.slice(1)]);
          allRows.push(...enforceDayConnectivity(dayRows, { theme, dtStep: dtStepForDay }));
        }
      }
      globalDayIndex++;
    }

    console.log(`Week ${theme.week} done. Running total: ${allRows.length} rows`);
    await wait(800);
  }

  let finalRows = normalizeRows(allRows);
  // Deterministic engagement (not LLM-dependent): neat titles, 8-min placement,
  // deep project breakdown, product speak, refresh game, motivation,
  // continuous 08:45–04:30 grid, Project Build, SNS Agent Workbench.
  try {
    const { enrichArrayRows } = require("./dayEngagementEnricher");
    const themeByWeek = {};
    (themes || []).forEach((t) => { themeByWeek[t.week] = t; });
    finalRows = enrichArrayRows(finalRows, {
      ...(inputs || {}),
      _themeByWeek: themeByWeek,
    });
  } catch (e) {
    console.warn("dayEngagementEnricher skipped:", e.message);
  }

  // ── Honor the requested day count exactly ─────────────────────────────────
  // Without an explicit calendar, weeks are just a 5-day grouping convenience —
  // the user's actual unit of input is "N days". Trim (or note if short) so
  // "30 days" always means exactly 30 daily plans, never 13 weeks / 65 days.
  const requestedDays = !calMap ? (Number(inputs?._numDays) || null) : null;
  let title;
  if (requestedDays) {
    const dayGroups = [];
    let currentKey = null;
    for (const row of finalRows) {
      if (row[0] !== currentKey) { dayGroups.push([]); currentKey = row[0]; }
      dayGroups[dayGroups.length - 1].push(row);
    }
    const trimmedGroups = dayGroups.slice(0, requestedDays);
    finalRows = trimmedGroups.flat();
    title = `${trimmedGroups.length}-Day Self-Learning Roadmap · IST`;
  } else {
    const totalWeeks = themes.length;
    title = `${totalWeeks}-Week Daily Schedule (${totalWeeks * 5} Days, Mon-Fri) · IST`;
  }

  // ── Pre-output Testing Engine ─────────────────────────────────────────────
  // Only working links / docs reach the student; soft quality checks recorded.
  let testingReport = null;
  const skipTest = String(inputs?._skipTestingEngine || "").toLowerCase() === "true"
    || inputs?._skipTestingEngine === true;
  if (!skipTest && finalRows.length) {
    try {
      const { runPlanTestingEngine } = require("./planTestingEngine");
      const tested = await runPlanTestingEngine(finalRows, inputs || {});
      finalRows = tested.rows;
      testingReport = tested.report;
    } catch (e) {
      console.warn("[planTestingEngine] skipped:", e.message);
      testingReport = {
        engine: "planTestingEngine",
        passed: false,
        score: 0,
        summary: `Testing engine error: ${e.message}`,
        error: e.message,
      };
    }
  }

  return {
    module:  "daily",
    title,
    columns: ["Day", "Time", "Activity", "Task / Content"],
    rows:    finalRows,
    ...(testingReport ? { testingReport } : {}),
  };
}

function groupRowsByDay(rows) {
  const groups = [];
  let current = null;
  for (const row of rows) {
    const dayKey = row[0];
    if (!current || current.dayKey !== dayKey) {
      current = { dayKey, rows: [] };
      groups.push(current);
    }
    current.rows.push(row);
  }
  return groups;
}

function buildDailyPolishPrompt(dayKey, rows, columns) {
  return `
You are a formatting editor. You are given ${rows.length} schedule row(s) for "${dayKey}".
Each row is [${columns.join(", ")}].

TASK: Rewrite ONLY the "${columns[3]}" text of each row to be cleaner and more scannable:
- Break run-on sentences into short bullet points, one idea per line, each line starting with "▶ "
- Join lines with "\\n"
- Fix awkward phrasing, spacing, and capitalization

STRICT RULES — DO NOT VIOLATE:
1. DO NOT change, add, or remove any subject name, topic, number, or task/idea — same facts, better formatting only
2. DO NOT invent new tasks or drop existing ones
3. Copy "${columns[0]}", "${columns[1]}", "${columns[2]}" back EXACTLY as given — do not touch them
4. Return EXACTLY ${rows.length} row(s), same order
5. Return ONLY valid JSON, no markdown fences, no commentary

EXISTING ROWS:
${JSON.stringify(rows)}

Return ONLY:
{ "rows": [ ["${columns[0]} value", "${columns[1]} value", "${columns[2]} value", "polished content"], ... ] }
`;
}

async function polishDailyPlan(existingPlan) {
  if (!existingPlan?.rows?.length) throw new Error("No existing daily plan to polish");
  const columns = existingPlan.columns || ["Day", "Time", "Activity", "Task / Content"];
  const groups = groupRowsByDay(existingPlan.rows);
  const polishedRows = [];

  for (const group of groups) {
    try {
      const prompt = buildDailyPolishPrompt(group.dayKey, group.rows, columns);
      const result = await callLLM(prompt, 2200);
      if (Array.isArray(result.rows) && result.rows.length === group.rows.length) {
        // Belt-and-braces: whatever the model does, Day/Time/Activity are
        // forced back to the original values so content can never drift.
        const safeRows = result.rows.map((r, i) => [
          group.rows[i][0],
          group.rows[i][1],
          group.rows[i][2],
          /learning/i.test(String(group.rows[i][2] || ""))
            ? group.rows[i][3]
            : (r && typeof r[3] === "string" && r[3].trim()) ? r[3] : group.rows[i][3],
        ]);
        polishedRows.push(...safeRows);
      } else {
        console.warn(`Polish row-count mismatch for ${group.dayKey}, keeping original`);
        polishedRows.push(...group.rows);
      }
    } catch (err) {
      console.error(`Polish failed for ${group.dayKey}:`, err.message);
      polishedRows.push(...group.rows);
    }
    await wait(300);
  }

  return { ...existingPlan, columns, rows: polishedRows };
}

// ── Stamp week labels ─────────────────────────────────────────────────────────

module.exports = {
  generateDailyPlan,
  polishDailyPlan,
  presliceWeekContent,

  getExamFocus,
  getDetailedExamQuestions,
};
