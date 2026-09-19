/**
 * Placement Prep — clear day format for interview prep:
 *   LEARN (1 interview concept) + 2–3 TASKS + Done when
 * Shared by gap-driven schedule + engagement enricher.
 */

function softClip(text, n = 200) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  const slice = t.slice(0, n);
  const sp = slice.lastIndexOf(" ");
  return `${(sp > 60 ? slice.slice(0, sp) : slice).trim()}…`;
}

/**
 * Full tracks (~20 min) — interview learning + exactly 2–3 tasks.
 * Each entry: { name, learn, tasks: [2..3 strings], done }
 */
function buildFullTracks(company, problemQuote = "") {
  const c = String(company || "").trim() || "TCS";
  const q = softClip(problemQuote, 140) || "your uploaded problem";

  return [
    {
      name: "Introduce yourself (HR)",
      learn: `Interview tip: “Tell me about yourself” = 60–90 sec: Who you are → What you are learning → 1 project line → Why ${c}.`,
      tasks: [
        `Write a 6–8 line “Tell me about yourself” script (include 1 line about: "${q}").`,
        `Say it out loud once (phone timer 90 sec).`,
        `Notebook: keep the final script + 1 line you will improve tomorrow.`,
      ],
      done: "Script written + spoken once.",
    },
    {
      name: "Why this company?",
      learn: `Interview tip: “Why ${c}?” needs 2 real facts + 1 link to your skills/project — not “it is famous”.`,
      tasks: [
        `Find 2 real facts about ${c} (product, values, recent news).`,
        `Write a 5-line answer: Fact1 + Fact2 + how your project ("${q}") fits.`,
        `Say the answer once out loud.`,
      ],
      done: "2 facts + spoken “Why company” answer.",
    },
    {
      name: "STAR story practice",
      learn: "Interview tip: STAR = Situation → Task → Action → Result. One clear story beats a long story.",
      tasks: [
        `Pick 1 real moment from this week’s project work on "${q}".`,
        `Write 4 lines only: S / T / A / R.`,
        `Speak the STAR story in 60–90 sec.`,
      ],
      done: "4 STAR lines written + spoken once.",
    },
    {
      name: "Job skills match",
      learn: "Interview tip: recruiters check if your skills match the job post keywords.",
      tasks: [
        `Open 1 fresher job post for ${c}; list 5 must-have skills.`,
        `Mark each: I know / Learning / Not yet.`,
        `Pick 1 “Learning” skill and write how you will practice it this week.`,
      ],
      done: "5 skills listed + 1 practice plan.",
    },
    {
      name: "Resume bullet for interview",
      learn: "Interview tip: every resume bullet should be Action + Tool + Result (so you can explain it in interview).",
      tasks: [
        `Rewrite 1 resume bullet about "${q}" as Action → Tool → Result.`,
        `Practice explaining that bullet in 45 sec.`,
      ],
      done: "1 strong bullet + 45-sec explanation practiced.",
    },
    {
      name: "Project explain (technical)",
      learn: "Interview tip: explain project as Problem → Approach → What you built → What you learned (no jargon dump).",
      tasks: [
        `Write 5 lines: Problem / Approach / Built / Stuck / Learned for "${q}".`,
        `Explain it to a classmate (or mirror) in 2 minutes.`,
        `Notebook: 1 question the classmate asked (or you expect).`,
      ],
      done: "5-line project story + 2-min practice.",
    },
    {
      name: "HR strength & weakness",
      learn: "Interview tip: Strength = skill + proof. Weakness = real gap + what you are doing to improve (honest).",
      tasks: [
        `Write 1 strength with proof from your project ("${q}").`,
        `Write 1 weakness + your improvement action this week.`,
        `Say both answers out loud once.`,
      ],
      done: "Strength + weakness answers ready.",
    },
    {
      name: "Aptitude drill (interview round)",
      learn: "Interview tip: aptitude rounds are timed — practice small sets daily, not long cramming.",
      tasks: [
        `Solve 5 quantitative OR logical questions (any free source) in 10 minutes.`,
        `Notebook: score / 5 and 1 mistake type to fix next time.`,
      ],
      done: "5Q done + score logged.",
    },
    {
      name: "Technical concept explain",
      learn: "Interview tip: if you cannot explain a topic simply, the interviewer assumes you do not know it.",
      tasks: [
        `Pick 1 concept from today’s Learning slot.`,
        `Write a 4-sentence simple explanation using your problem domain ("${q}").`,
        `Speak it in 60 sec to a peer (or aloud).`,
      ],
      done: "4-sentence explain + spoken once.",
    },
    {
      name: "LinkedIn for interviewers",
      learn: "Interview tip: interviewers often open your LinkedIn — Headline + About + 1 Project must look clear.",
      tasks: [
        `Fix Headline: "Student | skills | interested in ${c}".`,
        `Update About with 4 lines (include 1 project line about "${q}").`,
        `Add/update 1 Project/Featured with 3 bullets.`,
      ],
      done: "Headline + About + Project updated.",
    },
    {
      name: "Behavioral question pack",
      learn: "Interview tip: common HR Qs — challenge faced, teamwork, deadline pressure. Prepare short true stories.",
      tasks: [
        `Pick ONE: Challenge / Teamwork / Deadline.`,
        `Write a short STAR answer (4–6 lines) from college or project "${q}".`,
        `Speak it once (90 sec max).`,
      ],
      done: "1 behavioral answer written + spoken.",
    },
    {
      name: "Company research notes",
      learn: `Interview tip: knowing what ${c} builds helps you ask smart questions at the end.`,
      tasks: [
        `Write 3 lines: what ${c} does / who their users are / 1 recent news.`,
        `Write 2 questions YOU would ask the interviewer.`,
      ],
      done: "Company notes + 2 smart questions.",
    },
    {
      name: "Coding interview talk-through",
      learn: "Interview tip: say your plan before coding — Input → Steps → Edge cases → Then code.",
      tasks: [
        `Take today’s Coding Practice problem (or one Easy).`,
        `On paper: write Input / Steps / 1 edge case (no code yet).`,
        `Explain that plan out loud in 60 sec.`,
      ],
      done: "Paper plan + spoken talk-through.",
    },
    {
      name: "Mock Q with peer",
      learn: "Interview tip: pressure practice with a classmate beats only reading notes.",
      tasks: [
        `Ask a peer to ask you 2 questions: 1 HR + 1 “explain your project”.`,
        `Answer using "${q}" as your project.`,
        `Notebook: 1 praise + 1 fix from the peer.`,
      ],
      done: "2 mock answers + feedback logged.",
    },
    {
      name: "Gap plan for next interview week",
      learn: "Interview tip: turn job-post gaps into a weekly practice list (skills + stories + aptitude).",
      tasks: [
        `From a ${c} job post, list 3 gaps (skills you still need).`,
        `Write tomorrow’s 1 interview practice action for each gap.`,
      ],
      done: "3 gaps + 3 next actions written.",
    },
    {
      name: "Closing questions ready",
      learn: "Interview tip: always ask 1–2 good questions — shows interest and thinking.",
      tasks: [
        `Write 3 closing questions for a ${c} interviewer (team / learning / role).`,
        `Pick your best 2 and practice saying them politely.`,
      ],
      done: "2 closing questions ready to ask.",
    },
    {
      name: "Debug story (interview)",
      learn: "Interview tip: “Tell me about a bug you fixed” shows real engineering — use STAR.",
      tasks: [
        `Recall 1 bug/confusion from this week.`,
        `Write STAR (4 lines) and speak it once.`,
      ],
      done: "Debug STAR ready.",
    },
    {
      name: "Role fit answer",
      learn: "Interview tip: “Why this role?” = what the role does + what you already practice + what you will learn.",
      tasks: [
        `Find 1 fresher role title at ${c} (or similar).`,
        `Write 5 lines: Role does X / I practiced Y / I will learn Z.`,
        `Say it once out loud.`,
      ],
      done: "Role-fit answer written + spoken.",
    },
    {
      name: "Portfolio proof for interview",
      learn: "Interview tip: if you claim a skill, show a file/repo/notes as proof.",
      tasks: [
        `List 3 skills you claim.`,
        `For each: point to evidence (file/repo) OR mark “need proof”.`,
        `Create 1 tiny proof today for a “need proof” skill.`,
      ],
      done: "Skills ↔ evidence checklist done.",
    },
    {
      name: "Weekly interview review",
      learn: "Interview tip: a 10-min weekly review compounds — scripts, gaps, mock feedback.",
      tasks: [
        `Review this week’s interview notes (scripts, STAR, aptitude scores).`,
        `Write: 1 win | 1 gap | 1 practice focus for next week (for ${c}).`,
        `Schedule that focus on tomorrow’s checklist.`,
      ],
      done: "Win / gap / next focus written.",
    },
  ];
}

/** Short micro tracks (problem-first days) — LEARN + 2 tasks */
function buildLightTracks(company) {
  const c = String(company || "").trim() || "your target company";
  return [
    {
      name: "60-sec intro line",
      learn: "Interview tip: keep a 1-line intro ready — name, course, focus.",
      tasks: [
        `Write 1 intro line: “I am ___, learning ___, interested in ${c}.”`,
        `Say it out loud once.`,
      ],
      done: "Intro line ready.",
    },
    {
      name: "One company fact",
      learn: "Interview tip: one real fact about the company beats generic praise.",
      tasks: [
        `Write 1 recent fact about ${c}.`,
        `Notebook: fact + source.`,
      ],
      done: "1 company fact logged.",
    },
    {
      name: "STAR one-liner",
      learn: "Interview tip: practice short STAR lines so full stories come easier later.",
      tasks: [
        `Write 1 STAR line about today’s project work.`,
        `Say it once.`,
      ],
      done: "STAR one-liner done.",
    },
    {
      name: "Aptitude 3Q",
      learn: "Interview tip: tiny daily aptitude beats weekend cramming.",
      tasks: [
        `Solve 3 aptitude questions.`,
        `Notebook: score / 3.`,
      ],
      done: "3Q + score logged.",
    },
    {
      name: "Why company (short)",
      learn: "Interview tip: “Why this company?” needs a specific reason.",
      tasks: [
        `Write 3 lines: why ${c} interests you.`,
        `Say them once.`,
      ],
      done: "Short “Why company” ready.",
    },
    {
      name: "Skill keyword",
      learn: "Interview tip: job posts show the words interviewers listen for.",
      tasks: [
        `From 1 ${c} job post, copy 3 skill keywords.`,
        `Mark each: know / learning.`,
      ],
      done: "3 keywords marked.",
    },
    {
      name: "Resume verb",
      learn: "Interview tip: strong verbs make bullets easier to defend in interview.",
      tasks: [
        `Rewrite 1 resume bullet with a stronger action verb.`,
        `Notebook: before → after.`,
      ],
      done: "1 bullet improved.",
    },
    {
      name: "Closing question",
      learn: "Interview tip: prepare 1 polite question to ask at the end.",
      tasks: [
        `Write 1 question you would ask a ${c} interviewer.`,
        `Practice saying it politely.`,
      ],
      done: "1 closing question ready.",
    },
    {
      name: "LinkedIn headline",
      learn: "Interview tip: Headline is the first line recruiters see.",
      tasks: [
        `Set Headline to: Student | skill | interested in ${c}.`,
        `Notebook: final headline text.`,
      ],
      done: "Headline updated.",
    },
    {
      name: "Strength line",
      learn: "Interview tip: strength needs proof, not a buzzword.",
      tasks: [
        `Write 1 strength + 1 proof from today’s work.`,
        `Say it once.`,
      ],
      done: "Strength line ready.",
    },
    {
      name: "Project 30-sec pitch",
      learn: "Interview tip: you must pitch your project in 30 seconds.",
      tasks: [
        `Write a 3-line project pitch.`,
        `Speak it in 30 sec.`,
      ],
      done: "30-sec pitch practiced.",
    },
    {
      name: "Tracker + next action",
      learn: "Interview tip: tracking applications keeps prep focused.",
      tasks: [
        `Add 1 row for ${c} in notes/placement-tracker.md.`,
        `Write tomorrow’s 1 interview practice action.`,
      ],
      done: "Tracker row + next action.",
    },
  ];
}

function clampTasks(tasks) {
  const list = (tasks || []).filter(Boolean).map(String);
  if (list.length <= 3) return list.slice(0, 3);
  return list.slice(0, 3);
}

function pickFullTrack(company, dayIdx = 0, problemQuote = "") {
  const tracks = buildFullTracks(company, problemQuote);
  const i = Math.max(0, Number(dayIdx) || 0) % tracks.length;
  const t = tracks[i];
  return { ...t, tasks: clampTasks(t.tasks), index: i, dayNum: i + 1, total: tracks.length };
}

function pickLightTrack(company, dayIdx = 0) {
  const tracks = buildLightTracks(company);
  const i = Math.max(0, Number(dayIdx) || 0) % tracks.length;
  const t = tracks[i];
  return { ...t, tasks: clampTasks(t.tasks), index: i, dayNum: i + 1, total: tracks.length };
}

function formatFullPlacement(company, dayIdx = 0, problemQuote = "") {
  const raw = String(company || "").trim();
  const c = raw || "[TARGET_COMPANY]";
  // Mon–Fri rotation: Intro, STAR, Technical, Why company, Mock
  const rotation = [
    "Introduce yourself (HR)",
    "STAR story practice",
    "Technical concept explain",
    "Why this company?",
    "Mock Q with peer",
  ];
  const tracks = buildFullTracks(c === "[TARGET_COMPANY]" ? "your target company" : c, problemQuote);
  const want = rotation[Math.max(0, Number(dayIdx) || 0) % 5];
  const track = tracks.find((t) => t.name === want) || tracks[Math.max(0, Number(dayIdx) || 0) % tracks.length];
  const tasks = clampTasks(track.tasks);

  return [
    `▶ Placement Prep — ${track.name} (~20 min)`,
    raw
      ? `▶ Target company: ${c}`
      : `▶ Target company: [TARGET_COMPANY] (set dream/target company once — used every day)`,
    `▶ LEARN (interview): ${track.learn}`,
    `▶ TASKS (do these ${tasks.length}):`,
    ...tasks.map((t, i) => `▶ Task ${i + 1}: ${t}`),
    `▶ Done when: ${track.done || "all tasks above are finished and noted in placement-day.md."}`,
  ].join("\n");
}

function formatLightPlacement(company, dayIdx = 0) {
  const track = pickLightTrack(company, dayIdx);
  const tasks = clampTasks(track.tasks);

  return [
    `▶ Placement — Day ${Number(dayIdx) + 1}: ${track.name} (8–10 min)`,
    `▶ LEARN (interview): ${track.learn}`,
    `▶ TASKS (do these ${tasks.length}):`,
    ...tasks.map((t, i) => `▶ Task ${i + 1}: ${t}`),
    `▶ Done when: ${track.done || "tasks finished."}`,
  ].join("\n");
}

module.exports = {
  buildFullTracks,
  buildLightTracks,
  pickFullTrack,
  pickLightTrack,
  formatFullPlacement,
  formatLightPlacement,
};
