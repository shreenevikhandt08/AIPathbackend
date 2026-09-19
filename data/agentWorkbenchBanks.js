/**
 * SNS Agent Workbench — clear beginner automation tasks (no URLs).
 * Seed tasks; plan generation prefers RAG from uploaded questions PDF
 * (enrichAssessmentBanksRag / enrichAgentWorkbenchRag) when available.
 */

const WORKBENCH_TASKS = [
  // Easy
  {
    difficulty: "easy",
    title: "City Weather Note Agent",
    problem: "Save city, temperature, and condition for one city.",
    what: "Build a small agent that reads today's weather for one city and writes 3 fields into a notes file.",
    steps: [
      "Open Agent Workbench. Create workflow Weather-Note-Day.",
      "Add Manual Trigger → HTTP Request (free weather API) for one city.",
      "Keep only city, temperature, condition. Save to weather-day.txt.",
      "Run once and open the file.",
    ],
    success: "weather-day.txt shows city + temperature + condition.",
  },
  {
    difficulty: "easy",
    title: "Sample Post Saver Agent",
    problem: "Save one sample post: title, short body, and author id.",
    what: "Build an agent that fetches ONE sample blog post and saves title, body preview, and author id.",
    steps: [
      "Create workflow Post-Saver-Day.",
      "Manual Trigger → HTTP Request to a free sample-posts API (post id = 1).",
      "Keep title, first 80 characters of body, and userId. Save to post-saver.txt.",
      "Run once and open the file.",
    ],
    success: "post-saver.txt has title, short body, and userId.",
  },
  {
    difficulty: "easy",
    title: "Random Fact Logger Agent",
    problem: "Save one fun fact with today's date.",
    what: "Build an agent that fetches one fun fact and logs it with today's date.",
    steps: [
      "Create workflow Fact-Logger-Day.",
      "Manual Trigger → HTTP Request to a free facts API.",
      "Keep fact text + today's date. Append one line to facts-log.txt.",
      "Run once and confirm the new line.",
    ],
    success: "facts-log.txt has a new line with date + fact.",
  },
  // Intermediate
  {
    difficulty: "intermediate",
    title: "Country Fact Card Agent",
    problem: "Make a 3-line card for India: capital, currency, language.",
    what: "Build an agent that loads India country data and saves a 3-line fact card.",
    steps: [
      "Create workflow Country-Card-Day.",
      "Manual Trigger → HTTP Request to a free countries API for India.",
      "Keep capital, currency code, and one language. Save as Capital | Currency | Language.",
      "Run once and check country-card.txt.",
    ],
    success: "country-card.txt has Capital, Currency, and Language.",
  },
  {
    difficulty: "intermediate",
    title: "Name Age Estimator Agent",
    problem: "Estimate age for a first name; save name, age, and count.",
    what: "Build an agent that estimates age for a given first name and saves the result.",
    steps: [
      "Create workflow Name-Age-Day.",
      "Manual Trigger → HTTP Request to a free age-guess API with your first name.",
      "Keep name, predicted age, and count. Save to name-age.txt.",
      "Run once and verify all 3 fields.",
    ],
    success: "name-age.txt shows name, age, and count.",
  },
  {
    difficulty: "intermediate",
    title: "University Shortlist Agent",
    problem: "Shortlist exactly 3 university names for one country.",
    what: "Build an agent that fetches universities for a country and keeps a shortlist of 3 names.",
    steps: [
      "Create workflow Uni-Shortlist-Day.",
      "Manual Trigger → HTTP Request to a free universities API.",
      "Keep only the first 3 names. Save as a numbered list.",
      "Run once and open uni-shortlist.txt.",
    ],
    success: "uni-shortlist.txt lists exactly 3 university names.",
  },
  {
    difficulty: "intermediate",
    title: "JSON Cleaner Agent",
    problem: "Clean messy JSON. Keep only name and email.",
    what: "Build an agent that takes messy JSON and outputs only the fields you need.",
    steps: [
      "Create workflow Json-Cleaner-Day.",
      "Manual Trigger with sample JSON (name, email, junk fields).",
      "Keep only name and email. Save to cleaned.txt.",
      "Run once; confirm junk fields are gone.",
    ],
    success: "cleaned file contains only name and email.",
  },
  // Difficult
  {
    difficulty: "difficult",
    title: "If-Else Alert Agent",
    problem: "If score >= 50 write PASS, else FAIL. Save the result.",
    what: "Build an agent that checks a number and writes PASS or FAIL into a notes file.",
    steps: [
      "Create workflow If-Alert-Day.",
      "Manual Trigger with score = 70.",
      "IF score >= 50 → write PASS; else write FAIL into alert.txt.",
      "Run once with 70, then with 40, and confirm the text changes.",
    ],
    success: "alert.txt shows PASS for 70 and FAIL for 40.",
  },
  {
    difficulty: "difficult",
    title: "Webhook Echo Agent",
    problem: "Echo only studentName and taskStatus from the JSON.",
    what: "Build an agent that receives a webhook JSON and echoes 2 fields into a reply/note.",
    steps: [
      "Create workflow Webhook-Echo-Day.",
      "Webhook Trigger (or Manual Trigger with sample JSON).",
      "Keep studentName + taskStatus only. Save to webhook-echo.txt.",
      "Send one test payload / run once.",
    ],
    success: "webhook-echo.txt shows studentName and taskStatus.",
  },
  {
    difficulty: "difficult",
    title: "Daily Digest Stub Agent",
    problem: "Write a day digest: title + 2 lines (learning + project).",
    what: "Build a 3-node digest: trigger → collect 2 text lines → save as today's digest.",
    steps: [
      "Create workflow Digest-Stub-Day.",
      "Manual Trigger → Set node with two summary lines you write.",
      "Save into digest-today.txt with title 'Day Digest'.",
      "Run once and open the file.",
    ],
    success: "digest-today.txt has a title plus 2 summary lines.",
  },
];

/** Back-compat alias used by RAG prompt */
const FREE_APIS = WORKBENCH_TASKS.map((t) => ({
  name: t.title,
  task: t.what,
}));

function stripLinks(text) {
  return String(text || "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\bURL\s*:\s*\S+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function pickWorkbenchTask(dayIdx = 0) {
  const d = Math.max(0, Number(dayIdx) || 0);
  return WORKBENCH_TASKS[d % WORKBENCH_TASKS.length];
}

/** Easy → intermediate → difficult progression across the week */
function pickWorkbenchByDifficulty(dayIdx = 0) {
  const d = Math.max(0, Number(dayIdx) || 0);
  const level = d % 5 <= 1 ? "easy" : d % 5 <= 3 ? "intermediate" : "difficult";
  const pool = WORKBENCH_TASKS.filter((t) => t.difficulty === level);
  const list = pool.length ? pool : WORKBENCH_TASKS;
  return { ...list[d % list.length], difficulty: level };
}

/**
 * Format a clear, defined Agent Workbench assignment (no URLs).
 * After ~1 week (dayIdx >= 5), tasks connect to the student's project problem.
 */
function shortProductGlance(text = "", max = 55) {
  let t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "your product";
  const sentence = t.match(/^[^.!?]+[.!?]/);
  if (sentence) t = sentence[0].trim();
  if (t.length > max) {
    const slice = t.slice(0, max);
    const sp = slice.lastIndexOf(" ");
    t = `${(sp > 20 ? slice.slice(0, sp) : slice).trim()}…`;
  }
  return t || "your product";
}

function formatAgentWorkbenchTask(_unusedProject, customNotes = "", problemText = "", ragTask = null, dayIdx = 0, opts = {}) {
  const custom = String(customNotes || "").trim();
  const bank = pickWorkbenchTask(dayIdx);
  const projectMode = opts.projectMode === true || Math.max(0, Number(dayIdx) || 0) >= 5;
  // Prefer short quote — never paste the full problem essay into the task
  const problemGlance = shortProductGlance(opts.problemQuote || problemText || "", 55);
  const learnLabel = String(opts.learnLabel || "").trim();

  // Prefer RAG only when it has a real definition + steps; else use bank
  const ragSteps = String(ragTask?.buildSteps || "")
    .split(/\n|(?:\d+[.)]\s+)/)
    .map((s) => stripLinks(s).trim())
    .filter((s) => s.length > 8);
  const ragHasBody =
    ragTask &&
    ragTask.title &&
    String(ragTask.what || ragTask.buildSteps || "").trim().length > 40 &&
    (Array.isArray(ragTask.steps) ? ragTask.steps.length >= 3 : ragSteps.length >= 3);

  let title;
  let what;
  let steps;
  let success;
  let problem = "";

  if (ragHasBody) {
    title = stripLinks(ragTask.title);
    what = stripLinks(ragTask.what || ragTask.skillFocus || ragTask.buildSteps);
    problem = stripLinks(ragTask.problem || what);
    steps = Array.isArray(ragTask.steps) && ragTask.steps.length
      ? ragTask.steps.map((s) => stripLinks(s)).filter(Boolean)
      : ragSteps;
    success = stripLinks(ragTask.doneWhen || ragTask.success || "Workflow runs once and output file/note is filled.");
  } else {
    title = bank.title;
    what = bank.what;
    problem = bank.problem || bank.what;
    steps = bank.steps;
    success = bank.success;
  }

  const projectBridge = projectMode
    ? [
        `▶ Product glance: ${problemGlance}`,
        learnLabel
          ? `▶ Tie-in: use today's topic "${learnLabel}" as one field or filter.`
          : `▶ Tie-in: save output to project-agent-day.txt for Project Build.`,
        `▶ Apply: 1 sentence — how this agent helps "${problemGlance}".`,
      ]
    : [
        `▶ Note: Week 1 = skill practice. Later weeks connect agents to your product.`,
      ];

  return [
    `▶ Task: ${title}`,
    problem ? `▶ Problem: ${problem}` : null,
    `▶ What to build: ${what}`,
    ...(Array.isArray(steps) ? steps.slice(0, 5).map((s, i) => `▶ Step ${i + 1}: ${s}`) : []),
    `▶ Success check: ${success}`,
    ...projectBridge,
    custom ? `▶ Coach note: ${custom}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

module.exports = {
  FREE_APIS,
  WORKBENCH_TASKS,
  formatAgentWorkbenchTask,
  pickWorkbenchTask,
  pickWorkbenchByDifficulty,
  stripLinks,
};
