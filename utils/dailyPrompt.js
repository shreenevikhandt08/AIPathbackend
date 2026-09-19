const axios    = require("axios");
const { buildAssessmentPromptBlock } = require("./assessmentPicker");
const { buildAcademicPromptBlock } = require("./academicLevel");
const DAY_CONTENT = {
  Monday: {
    standupFocus:   "Week kickoff — what we learned last week, what's new this week, today's topics",
    codingPlatform: "HackerRank",
    codingType:     "Warm-up: solve 1 NEW Easy problem you have NEVER attempted before — search for a problem tagged with today's DSA topic. Log the problem title so it is not repeated next week.",
    examLink:       "Note which topics from today connect to IA syllabus — mark in notes",
    newProblemHint: "Search HackerRank Problem Sets → filter by tag matching today's DSA topic → pick one you have not solved. Aim for a problem with ≤ 500 successful submissions so it is fresh.",
  },
  Tuesday: {
    standupFocus:   "Yesterday's topics recap, today's topics, any doubts from Monday",
    codingPlatform: "LeetCode",
    codingType:     "Solve 1 NEW Easy or Medium problem you have NEVER attempted. Do NOT reuse Monday's or any earlier problem. Filter LeetCode by today's DSA tag and sort by 'New' to find unseen problems.",
    examLink:       "Identify 1 IA-likely question from today's topic — write it down",
    newProblemHint: "LeetCode → Problems → Filter by Topic Tag matching today's DSA → Sort by 'Newest' → pick first unsolved. Write the problem name in your coding log before starting.",
  },
  Wednesday: {
    standupFocus:   "Mid-week check — topics covered Mon+Tue, today's topics, syllabus coverage status",
    codingPlatform: "Exercism",
    codingType:     "Complete 1 NEW Exercism exercise you have never attempted before — pick an exercise matching today's topic or data structure. Exercism exercises are unique and do not repeat — pick the next one in sequence.",
    examLink:       "Cross-check: which of this week's topics are on the IA syllabus?",
    newProblemHint: "Exercism → choose your language track → Exercises → filter by concept matching today's DSA topic → pick the first UNSUBMITTED exercise. Submit and read the community solutions after.",
  },
  Thursday: {
    standupFocus:   "Pre-assessment check — today's topics, exam prep focus, doubts cleared",
    codingPlatform: "CodeChef",
    codingType:     "Solve 1 NEW Medium problem on CodeChef (a platform not used earlier this week). Pick from the 'Practice' section — filter by difficulty and topic. Log the problem code/name.",
    examLink:       "Prepare a 1-page cheat sheet per subject covered this week",
    newProblemHint: "CodeChef → Practice → filter by topic matching today's DSA → choose a problem rated 3-4 stars you have NOT solved. CodeChef shows your submission history — verify it is new.",
  },
  Friday: {
    standupFocus:   "End-of-week wrap — today's topics reviewed, coding challenge",
    codingPlatform: "GeeksForGeeks",
    codingType:     "Weekly challenge: solve 1 NEW Medium or Hard problem on GeeksForGeeks that covers ANY topic from this week — not just today's. Choose a problem from GFG Practice → DSA → filter by this week's topics.",
    examLink:       "Map this week's topics to AU exam syllabus units — tick off covered units",
    newProblemHint: "GFG → Practice Problems → filter by this week's DSA topics → sort by 'Accuracy' ascending to find harder, less-attempted problems → pick one you have never seen. After solving, compare your approach with GFG's editorial.",
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

function getExamFocus(subjectName, weekTopic, examAnalysis) {
  const topics = examAnalysis?.[subjectName];
  if (topics && topics.length > 0) {
    const top = topics.slice(0, 3).map((t) => t.topic).join("; ");
    return weekTopic + " | PYQ Focus: " + top;
  }
  return weekTopic;
}

function buildDailyDayPrompt(dayName, theme, inputs, examAnalysis, focusOverride, dayKey, globalDayIndex = 0, daySlice = null) {
  const resolvedDayKey = dayKey || `Week ${theme.week} - ${dayName}`;
  const activeStageKey = inputs?._activeDTStage || inputs?.activeDTStage || null;
  let dtStep = null;
  let nonCodeDt = false;
  let empathyDay = false;
  let evaluateDay = false;
  try {
    const {
      getStepForPlanDay,
      isNonCodeDtDay,
      isEmpathyDefineStage,
      isEvaluateStage,
    } = require("./dtPlaybookLookup");
    dtStep = getStepForPlanDay(globalDayIndex, activeStageKey, inputs);
    nonCodeDt = isNonCodeDtDay(dtStep);
    empathyDay = isEmpathyDefineStage(dtStep);
    evaluateDay = isEvaluateStage(dtStep);
  } catch (_) { /* optional */ }

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
    } catch (_) { /* ignore */ }
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
    (isTeam
      ? `MODE = TEAM. Team check-in / named split work allowed. Never invent extra people.\n`
      : `MODE = SOLO (one student). HARD RULES: never write team, teammates, classmate, peer review, "Team check-in", "each person", or group board updates. Stand-Up must be a PERSONAL check-in (DONE / TODAY / STUCK for that one student).\n`) +
    `DAY: ${dayName} | Week ${theme.week} | Day ${globalDayIndex + 1}` +
    (dtStep
      ? ` | DT STAGE LOCKED: ${dtStep.stage} → "${dtStep.step}"`
      : ` | DT STAGE: applied build`) +
    `\n\n` +
    `KEY RULES:\n` +
    `1. Cover ONLY the ${todayCount} topic${todayCount === 1 ? "" : "s"} listed below for today — no more, no fewer.\n` +
    `2. REALISTIC timing: each subject gets 40–45 min. NO gaps — each row end time = next row start time.\n` +
    `3. ALL tasks WITHIN college hours (08:45–04:30). ZERO after-college tasks.\n` +
    `4. DAILY CODING PRACTICE: 1 problem on ${slice.codingPlatform} (${slice.codingDifficulty}) — done IN class.\n` +
    (nonCodeDt
      ? `5. DT RESEARCH DAY (${empathyDay ? "Empathize & Define" : "Pitch & BMC"}): Learning still happens, but Project/DT block is RESEARCH / ARTIFACT — NO syllabus-feature coding. BUILD HOOKs name today's DT artifact, not a code file.\n` +
        `6. ONE CONNECTED DT PIPELINE: Discussion → playbook task → captured artifact → peer share.\n` +
        `7. Every Learning bullet ends with a BUILD HOOK naming the DT research output it feeds today.\n\n`
      : `5. LEARN → IMPLEMENT: Project session MUST implement ONLY what was taught today, as ONE connected pipeline A→B→C. No disconnected parallel chores.\n` +
        `6. Afternoon System Design CONTINUES the same artifact — never a second unrelated project.\n` +
        `7. Every Learning bullet ends with a BUILD HOOK naming the exact file/function/screen built later today.\n\n`) +
    `TODAY'S TOPICS:\n${subjectLines}\n\n` +
    `DSA Topic today: ${slice.dsaSubtopic}\n` +
    `System Design today: ${theme.systemDesign}\n` +
    `Project milestone: ${theme.project}\n` +
    `Tech stack: ${theme.tech}\n` +
    `Coding platform: ${slice.codingPlatform} — ${slice.codingDifficulty}\n` +
    (focusOverride ? `\nUSER CHANGE: ${focusOverride}\n` : "") +
    academic.block +
    `\nLEARNER PACE LOCK: ${academic.profile?.learnerPace?.label || "Average"} — ${academic.profile?.learnerPace?.coreRule || "finish main work first"}. Put this rule in Learning, Project, and Coding.\n` +
    (skipBanks
      ? `\nASSESSMENT BANKS OFF — still use Assess text in Speak & Solve and Mini Build.\n`
      : assessment.block) +
    `\nGENERATE EXACTLY 12 ROWS in this order:\n\n` +
    `ROW 1 — 08:45–09:00 — Daily Stand-Up + DT Activation (15 min)\n` +
    `  Content (fold Morning Activation INTO stand-up):\n` +
    `  ▶ DT ACTIVATION (3–4 min): 60-sec breath OR mindset prompt — "What would a curious designer notice about today's problem?"\n` +
    (dtStep
      ? `  ▶ DT LENS LOCKED: ${dtStep.stage} → "${dtStep.step}" — ${dtStep.stageGoal}\n` +
        `  ▶ PROBLEM GLANCE (2 min): one-sentence insight for this step. Learn today: ${dtStep.whatToLearn}\n`
      : `  ▶ DT LENS + PROBLEM GLANCE (2 min): one-sentence insight from the problem statement for today's stage.\n`) +
    `  ▶ MICRO-TEACH / TALK (2–3 min): one useful tip — tool, soft skill, career, or tiny concept.\n` +
    (globalDayIndex === 0
      ? isTeam
        ? `  ▶ Day 1 TEAM KICKOFF: project "${theme.project.split(":")[0]}" — who it's for; ground rule: ${nonCodeDt ? "research before solutioning" : "build only what we learn today"}.\n` +
          `  ▶ Each person: introduce yourself + one learning goal.\n`
        : `  ▶ Day 1 PERSONAL KICKOFF: project "${theme.project.split(":")[0]}" — who it's for; ground rule: ${nonCodeDt ? "research before solutioning" : "build only what we learn today"}.\n` +
          `  ▶ Write: TODAY aim · one thing you want to understand by evening · STUCK (or "none"). No team meet.\n`
      : isTeam
        ? `  ▶ Heading: Team check-in\n` +
          `  ▶ Board: Done / Today / Blocked.\n` +
          `  ▶ ${guide.standupFocus}\n` +
          `  ▶ Today's topics preview: ${todaySubjects.map(s => s.name).join(", ")}.\n`
        : `  ▶ Heading: Personal check-in\n` +
          `  ▶ Write: DONE · TODAY · STUCK (1 line each).\n` +
          `  ▶ ${guide.standupFocus}\n` +
          `  ▶ Today's topics preview: ${todaySubjects.map(s => s.name).join(", ")}.\n`) +
    `  ▶ Motivation boost — read aloud once.\n` +
    `\nROW 2 — 09:00–10:30 — Learning (90 min, 45 min per subject)\n` +
    `  CORE SUBJECT → PROJECT CONNECTIVITY (mandatory for each subject):\n` +
    (nonCodeDt
      ? `    • PROJECT LINK: how today's concept clarifies a user pain / process in "${theme.project}"\n` +
        `    • APPLY: 1 insight into today's DT research artifact (NOT code)\n` +
        `    • PROVE: 1-line "This concept helps us understand ___ about the problem because …"\n` +
        `  First 45 min — ${sub1.name}: "${sub1.topic}"\n` +
        `    ▶ Definition + 1 worked example + 2 named sub-topics\n` +
        `    ▶ PROJECT LINK + APPLY + PROVE\n` +
        `    ▶ BUILD HOOK: "In today's DT block you will use ${sub1.topic} to ___ (named research output)."\n` +
        `  Next 45 min — ${sub2.name}: "${getExamFocus(sub2.name, sub2.topic, examAnalysis)}"\n` +
        `    ▶ Definition + 1 worked example + named sub-topics\n` +
        `    ▶ PROJECT LINK + APPLY + PROVE\n` +
        `    ▶ BUILD HOOK: next DT research step that uses this concept\n`
      : `    • PROJECT LINK: exact screen/file/flow in "${theme.project}"\n` +
        `    • APPLY: 1 concrete Project Build change using today's concept\n` +
        `    • PROVE: 1-line "I used X in Y because…"\n` +
        `  First 45 min — ${sub1.name}: "${sub1.topic}"\n` +
        `    ▶ Definition of the core concept (2 sentences) + 1 worked example + 2 named sub-topics\n` +
        `    ▶ PROJECT LINK + APPLY + PROVE\n` +
        `    ▶ BUILD HOOK (mandatory): "In Project Build you will use ${sub1.topic} to ___ (exact file/function/screen)."\n` +
        `    ▶ End: student writes concept → where it appears in today's build\n` +
        `  Next 45 min — ${sub2.name}: "${getExamFocus(sub2.name, sub2.topic, examAnalysis)}"\n` +
        `    ▶ Definition + 1 worked example + named sub-topics\n` +
        `    ▶ PROJECT LINK + APPLY + PROVE\n` +
        `    ▶ BUILD HOOK (mandatory): next pipeline step that depends on the previous hook\n` +
        `    ▶ End: peer explain in 1 minute\n`) +
    ((inputs?.syllabus || "").trim()
      ? `  CORE / SUPPORTING SYLLABUS (must appear as real Learning topics with project links):\n` +
        `  ${(inputs.syllabus || "").trim().slice(0, 1200)}\n`
      : "") +
    `\nROW 3 — 10:30–10:45 — Short Break\n` +
    `  ▶ Stand up, hydrate, stretch. Do NOT start next topic early.\n` +
    `\nROW 4 — 10:45–11:30 — DSA + Coding Practice (45 min)\n` +
    (dtStep && (dtStep.dsaConcept === "NA" || nonCodeDt)
      ? `  ⚠️ ${nonCodeDt ? "DT research day — " : ""}No forced algorithm-to-feature DSA today` +
        (dtStep.dsaConcept === "NA" ? ` — playbook marks DSA as NA for "${dtStep.step}".` : ".") +
        `\n` +
        `  Coding Practice (25 min): ${slice.codingPlatform} — ${slice.codingDifficulty} [NEW PROBLEM] — skill practice ONLY.\n` +
        `  ▶ LANGUAGE: you can use any language (Python/Java/JS/C/C++/Go/…).\n` +
        `  ▶ Give 2–3 REAL named problems — student picks ONE. Log Date | Platform | Title | Language | Result.\n` +
        `  Remaining 20 min: continue today's DT research notes (see ROW 7) — not feature coding.\n`
      : `  DSA (25 min): "${slice.dsaSubtopic}"\n` +
        `    ▶ Name the exact sub-concept being taught today — be specific\n` +
        `    ▶ Explain with pseudocode + trace 1 small example by hand\n` +
        `    ▶ BUILD HOOK: exact place in TODAY's Project Build pipeline where this DSA pattern is applied\n` +
        `  Coding Practice (20 min): ${slice.codingPlatform} — ${slice.codingDifficulty} [NEW PROBLEM EVERY DAY]\n` +
        `    ▶ LANGUAGE RULE: you can use any language the student/team chose.\n` +
        (assessment.picks.leetcode
          ? `    ▶ MANDATORY: ${assessment.picks.leetcode.label} (${assessment.picks.leetcode.pattern})\n`
          : `    ▶ ${guide.newProblemHint}\n` +
            `    ▶ ${guide.codingType}\n`) +
        `    ▶ Process: read → pseudocode → code (any language) → submit → log Language\n`) +
    (assessment.picks.pm
      ? `\n  Also include a 3C micro-prompt somewhere in today's afternoon rows:\n` +
        `  ▶ ${assessment.picks.pm.category}: ${assessment.picks.pm.text}\n`
      : "") +
    (assessment.picks.caseStudy || assessment.picks.game
      ? `  ▶ Refresh slot: student picks ONE — Hollywood game OR case study chat` +
        (assessment.picks.caseStudy ? ` (${assessment.picks.caseStudy.title})` : "") +
        `. Do NOT put case study inside Project Build.\n`
      : "") +
    `\nROW 5 — 11:30–12:15 — Learning  (45 min)\n` +
    (todayCount > 2
      ? `  First half — ${sub3.name}: "${sub3.topic}"\n` +
        `    ▶ Definition, key formula, 1 worked example\n` +
        (nonCodeDt
          ? `    ▶ BUILD HOOK: feeds today's DT research artifact\n`
          : `    ▶ BUILD HOOK: extension step in afternoon System Design\n`) +
        `  Second half — ${sub4.name}: "${getExamFocus(sub4.name, sub4.topic, examAnalysis)}"\n` +
        `    ▶ Definition, key formula, 1 worked example\n` +
        (nonCodeDt
          ? `    ▶ BUILD HOOK: which problem insight this concept validates\n`
          : `    ▶ Quick pair check: explain key point to partner\n`)
      : nonCodeDt
        ? `  Only 2 subjects today — deepen morning research BUILD HOOKS (no new unrelated topics)\n`
        : `  Only 2 subjects today — use this slot for deeper worked examples mapped to Project Build pipeline\n`) +
    `\nROW 6 — 12:15–01:00 — Lunch Break\n` +
    `  ▶ Lunch (12:15–01:00 IST). No studying for first 30 min.\n` +
    `\nROW 7 — 01:00–02:00 — ${dtStep ? `DT PLAYBOOK: ${dtStep.stage.toUpperCase()} — ${dtStep.step}` : "PROJECT BUILD"} (60 min)\n` +
    (nonCodeDt
      ? `⚠️ DT RESEARCH / ARTIFACT PIPELINE — NO syllabus-feature coding:\n` +
        `  Project: ${theme.project} | Locked: Week ${dtStep.weekNumber} ${dtStep.stage} → "${dtStep.step}"\n` +
        `  Stage goal: ${dtStep.stageGoal}\n` +
        `  Real task: ${dtStep.realProjectTask}\n` +
        `  ▶ PIPELINE GOAL: single research/pitch artifact finished by 02:00.\n` +
        `  ▶ Step A (10 min) — Discussion: "${dtStep.discussionPrompt}"\n` +
        `  ▶ Step B (25 min) — Do the real project task, grounded in the problem statement.\n` +
        `  ▶ Step C (15 min) — Capture artifact (persona / map / table / tech-stack decision / BMC / pitch notes).\n` +
        `  ▶ Step D (5 min) — Peer share: 2 insights + 1 open question.\n` +
        `  ▶ Step E (5 min) — Save to /dt-notes (docs only).\n` +
        `  FORBIDDEN: coding morning subjects as features; inventing a full solution.\n` +
        (/tech\s*stack/i.test(String(dtStep.step || ""))
          ? `  TECH STACK SESSION (mandatory today): decide language + UI + storage for THIS problem statement.\n` +
            `  ▶ Language: you can choose any (Python/Java/JS/C/C++/Go/…) — team skill + fit.\n` +
            `  ▶ Write /dt-notes/tech-stack.md — later build weeks MUST follow this stack.\n`
          : "") +
        (empathyDay
          ? `  STAGE RULE: Empathize & Define — understand the problem; NO solutioning.\n`
          : `  STAGE RULE: Pitch & BMC — business artifacts, not a coding sprint.\n`)
      : `⚠️ LEARN → IMPLEMENT PIPELINE — implement ONLY morning concepts as ONE chain:\n` +
        `  Taught today: ${sub1.name} ("${sub1.topic}"), ${sub2.name} ("${sub2.topic}"), DSA ("${slice.dsaSubtopic}")\n` +
        `  Project: ${theme.project} | Milestone: ${theme.projectTask}\n` +
        `  Knowledge fence: ${theme.cumulativeKnowledge || "subjects taught so far"}\n` +
        `  Do NOT invent tech outside the fence.\n\n` +
        `  ▶ PIPELINE GOAL (1 line): single feature finished by 02:00.\n` +
        `  ▶ Step A (15 min) — IMPLEMENT "${sub1.topic}": file → code → prove with 1 input.\n` +
        `  ▶ Step B (15 min) — IMPLEMENT "${sub2.topic}" ON TOP OF Step A (same feature).\n` +
        `  ▶ Step C (15 min) — APPLY DSA "${slice.dsaSubtopic}" inside the same feature.\n` +
        `  ▶ Step D (10 min) — end-to-end run + 1 fix + Done-when.\n` +
        `  ▶ Step E (5 min) — git commit -m "feat(week${theme.week}): [pipeline goal]" && git push\n` +
        `  LANGUAGE: team's Empathy Tech Stack Choice (you can use any language).\n` +
        `  FORBIDDEN: disconnected parallel tasks unless they are today's taught chain.\n` +
        (globalDayIndex === 0
          ? `  Day 1 only: before Step A, 5 min folder create + 1-line problem who/pain (still feeds the same pipeline).\n`
          : evaluateDay
            ? `  Evaluate day: fold usability/interview/observation into the pipeline where it fits.\n`
            : `  Continue yesterday's artifact — do not restart Empathize/Define from scratch.\n`)) +
    `\nROW 8 — ${assessment.picks.game ? "02:00–02:10 — Refresh Game (10 min)" : "02:00–02:10 — Short Break (10 min)"}\n` +
    (assessment.picks.game
      ? `  ▶ Game: ${assessment.picks.game.name} — ${assessment.picks.game.how}\n`
      : `  ▶ No refresh game today (only 2–3 random days per week). Stretch / hydrate only.\n`) +
    `\nROW 9 — 02:10–03:10 — ${nonCodeDt ? "Problem Framing + DT Artifact Deepening" : "System Design + Project Integration"} (60 min)\n` +
    (nonCodeDt
      ? `  ⚠️ SAME ARTIFACT as ROW 7 — deepen research, do NOT code a solution.\n` +
        `  ▶ Step F: extend ROW 7 using ${sub3.topic ? `${sub3.name} ("${sub3.topic}")` : "afternoon Learning"}\n` +
        `  ▶ Step G: cross-check vs problem statement — 2 insights + 1 open question\n` +
        `  ▶ Step H: ${slice.variant.collab} — feedback on THIS research artifact\n` +
        `  ▶ Step I: save to /dt-notes (no feature commit)\n`
      : `  ⚠️ CONTINUE the SAME feature from ROW 7 — no second project.\n` +
        `  System Design (15 min): "${theme.systemDesign}" — only what helps today's pipeline.\n` +
        `  Integration (45 min):\n` +
        `  ▶ Step F: extend ROW 7 using ${sub3.topic ? `${sub3.name} ("${sub3.topic}")` : "afternoon Learning"}\n` +
        `  ▶ Step G: connect F to A–C — full happy path\n` +
        `  ▶ Step H: ${slice.variant.collab}\n` +
        `  ▶ Step I: integrate commit\n`) +
    `\nROW 10 — 03:10–03:20 — ${inputsHasCompany ? `Placement Micro — ${inputsCompany}` : "Project Push"} (10 min)\n` +
    (inputsHasCompany
      ? `  8–10 min ONLY for ${inputsCompany}: careers glance OR LinkedIn note OR STAR about TODAY's build. Tracker 1 cell.\n`
      : nonCodeDt
        ? `  Push the next unfinished DT research step only — not a coding dump.\n`
        : `  Push the next unfinished pipeline step only — not a new task dump.\n`) +
    `\nROW 11 — 03:20–04:00 — Interests / Goals (40 min)\n` +
    `  ▶ Rotate by day: Interests → Goals. No Capability dump. No Peer Review.\n` +
    `  ▶ Connect to today's DT Playbook Step + Real Project Task + Problem Statement.\n` +
    `  ▶ Include full https Reference links. Ebook only if uploaded.\n` +
    `\nROW 12 — 04:00–04:30 — Retrospective (30 min)\n` +
    (nonCodeDt
      ? `  ▶ CONNECTIVITY: LEARNED (insight) / CAPTURED (artifact) / LINKED (problem slice) / STUCK (tomorrow DT question)\n`
      : `  ▶ CONNECTIVITY: LEARNED (concept) / BUILT (file) / LINKED (problem slice) / STUCK (tomorrow step)\n`) +
    `  ▶ Coding Log: today's ${slice.codingPlatform} title is NEW\n` +
    `  ▶ Brainstorm: ${slice.brainstorm}\n` +
    `  ▶ Zero after-hours homework\n` +
    `\nReturn ONLY valid JSON — no markdown, no code blocks, no string concatenation:\n` +
    `Each row's 4th field ("content") MUST be a JSON ARRAY of short bullet strings, one idea per\n` +
    `element — NOT a single string. Do not put "\\n" inside a bullet; make a new array element instead.\n\n` +
    `{"rows":[["${resolvedDayKey}","08:45 – 09:00 IST","Stand-Up",["<bullet>","<bullet>"]],` +
    `["${resolvedDayKey}","09:00 – 10:30 IST","Learning",["<bullet>","<bullet>"]],` +
    `["${resolvedDayKey}","10:30 – 10:45 IST","Break",["<bullet>"]],` +
    `["${resolvedDayKey}","10:45 – 11:30 IST","Coding Practice",["<bullet>","<bullet>"]],` +
    `["${resolvedDayKey}","11:30 – 12:15 IST","Learning",["<bullet>","<bullet>"]],` +
    `["${resolvedDayKey}","12:15 – 01:00 IST","Lunch",["<bullet>"]],` +
    `["${resolvedDayKey}","01:00 – 02:00 IST","Project Build",["<bullet>","<bullet>"]],` +
    `["${resolvedDayKey}","02:00 – 02:10 IST","${assessment.picks.game ? "Refresh Game" : "Break"}",["<bullet>"]],` +
    `["${resolvedDayKey}","02:10 – 03:10 IST","System Design",["<bullet>","<bullet>"]],` +
    `["${resolvedDayKey}","03:10 – 03:20 IST","${inputsHasCompany ? "Placement Prep" : "Project Push"}",["<bullet>","<bullet>"]],` +
    `["${resolvedDayKey}","03:20 – 04:00 IST","Interests",["<bullet>","<bullet>"]],` +
    `["${resolvedDayKey}","04:00 – 04:30 IST","Retrospective",["<bullet>","<bullet>"]]]}\n\n` +
    `CRITICAL:\n` +
    `- Return EXACTLY 12 rows. Column 1 always "${resolvedDayKey}".\n` +
    `- TIMES MUST be continuous with NO gaps.\n` +
    `- Column 4 (content) is ALWAYS a JSON array of plain bullet strings — no ▶ prefix needed (the app adds it), no paragraphs, no embedded newlines.\n` +
    `- NO JavaScript string concatenation (no + signs). Pure JSON only.\n` +
    `- NO after-hours tasks, NO homework.\n` +
    `- Always use FULL subject/topic names — do NOT abbreviate or use short codes; students must be able to read them directly.\n` +
    `- ROW 4 MUST name NEW problems only — never recycle earlier days' titles.\n` +
    `- ROW 11 is Interests / Goals (NOT Peer Review, NOT Capability).\n` +
    `- ONE learnTopic per day. Short complete problem text. Solo = no team language.\n` +
    `- Reference links must be full https URLs. Ebook only if uploaded.\n` +
    `- Use exact DT Playbook jargon: Stage, Step, What to Learn, Real Project Task, Discussion Prompt, Problem Statement.\n` +
    (nonCodeDt
      ? `- ROW 7 MUST be one connected DT RESEARCH pipeline — NO syllabus-feature coding / NO git feature push.\n` +
        `- ROW 9 MUST deepen the SAME research artifact from ROW 7.\n` +
        `- ROW 12 MUST include LEARNED / CAPTURED / LINKED / STUCK.\n`
      : `- ROW 7 MUST be one connected pipeline implementing morning Learning + DSA.\n` +
        `- ROW 9 MUST continue the SAME feature from ROW 7.\n` +
        `- ROW 12 MUST include LEARNED / BUILT / LINKED / STUCK.\n`) +
    (inputsHasCompany
      ? `- ROW 10 MUST be a SHORT Placement Micro for "${inputsCompany}" (8–10 min).\n`
      : "") +
    `- Extra Concept line ONLY when genuinely needed — omit it most days.\n`
  );
}
module.exports = {
  buildDailyDayPrompt
};