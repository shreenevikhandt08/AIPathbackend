/**
 * Persist + inject engine lessons from regeneration / refine feedback.
 * Lessons are GLOBAL — every later user/plan benefits.
 * Dual store: MongoDB + local JSON file (so feedback is never lost if DB blips).
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

let EngineLesson = null;
let mongoose = null;
try {
  mongoose = require("mongoose");
  EngineLesson = require("../models/EngineLesson");
} catch (_) {
  EngineLesson = null;
}

const FILE_STORE = path.join(__dirname, "../data/engineLessonsStore.json");

function mongoReady() {
  return Boolean(EngineLesson && mongoose && mongoose.connection && mongoose.connection.readyState === 1);
}

/** Map free-text feedback → structured rule lines (quality contract). */
const RULE_PATTERNS = [
  {
    re: /repeat|verbatim|same.*(question|slot|playbook)|problem review.*learning|across slots/i,
    key: "no-dt-questions-outside-lab",
    rule:
      "DT Playbook questions appear ONLY in Problem Lab. Problem Review = read/understand topic; Learning = study with examples/links; Project Build = apply to project — never paste the same Q list into multiple slots.",
    tags: ["repetition", "playbook"],
  },
  {
    re: /fake|404|placeholder|example\.com|invalid.*(link|url)|youtube\.com\/watch\?v=example/i,
    key: "no-fake-resource-urls",
    rule:
      "Never invent URLs. Use curated/verified free links only. If no confirmed URL exists, write Search: <query> — never a fake host or watch?v=example.",
    tags: ["links"],
  },
  {
    re: /leetcode.*(same|duplicate|repeat)|same problem|#\d+.*(week|again)/i,
    key: "no-leetcode-repeat-in-plan",
    rule:
      "Never assign the same LeetCode problem number twice in one multi-week plan. Check inputs._planUsedLc before every assignment.",
    tags: ["leetcode"],
  },
  {
    re: /mini build.*(same|identical|copy)|project build.*(mini)/i,
    key: "mini-build-distinct",
    rule:
      "Mini Build must be a small 15–25 min sub-piece that extends/tests Project Build — never copy-paste Project Build steps.",
    tags: ["mini-build"],
  },
  {
    re: /system design.*(connect|link|why)|sd.*(dt|playbook)/i,
    key: "sd-linked-to-dt",
    rule:
      "Every System Design slot must include ▶ Why this connects: (1 sentence) linking today's DT Playbook step to the SD concept.",
    tags: ["system-design"],
  },
  {
    re: /done when|vague|explain in 60/i,
    key: "concrete-done-when",
    rule:
      "Done when must name a concrete artifact (file, page answers, diagram). Never use 'you can explain' unless a named peer/mentor verifies.",
    tags: ["done-when"],
  },
  {
    re: /oracle|hardcoded.*company|target.?company/i,
    key: "target-company-variable",
    rule:
      "Use inputs.targetCompany / [TARGET_COMPANY] — never hardcode Oracle. Placement Prep runs every weekday with the Mon–Fri rotation.",
    tags: ["placement"],
  },
  {
    re: /case study \d|placeholder.*case|\[Business/i,
    key: "real-case-studies",
    rule:
      "Case studies must be real company/product stories with 2-line context + lesson — never 'Case study N' placeholders.",
    tags: ["cases"],
  },
  {
    re: /agent.*(generic|weather|disconnected)|workbench.*(project)/i,
    key: "agent-project-linked",
    rule:
      "Agent Workbench tasks must be named from the student's project domain — never generic weather/country demos.",
    tags: ["agent"],
  },
  {
    re: /tonight'?s homework.*(twice|duplicate|label)/i,
    key: "no-duplicate-homework-heading",
    rule:
      "Tonight's Homework row must not repeat the heading inside content. Use LeetCode / Agent / Case sections only.",
    tags: ["homework"],
  },
  {
    re: /same.*(project|task).*(day|week)|static.*project build|5 days.*same/i,
    key: "project-build-progression",
    rule:
      "Each day's Project Build must be a new forward step that starts from yesterday's output — never the same task 5 days in a row.",
    tags: ["project"],
  },
  {
    re: /motivation|quote.*repeat/i,
    key: "unique-motivation-quotes",
    rule:
      "Motivation quotes must be unique within a plan; pick from the 30+ theme-tagged pool by week theme.",
    tags: ["motivation"],
  },
  {
    re: /refresh game|plain break/i,
    key: "refresh-mon-wed",
    rule:
      "Refresh Game on Monday and Wednesday only; Tuesday/Thursday = plain break; Friday = optional team/free break.",
    tags: ["refresh"],
  },
  {
    re: /connectiv|not.?link|disconnect|no.?link|unrelated|doesn't.?apply|does not apply|not.?tied|not.?related.*problem|random.*(case|leetcode|activity)/i,
    key: "full-day-connectivity",
    rule:
      "EVERY activity (Learning, SD, Coding, Speak, Case, Agent, Placement, Homework, Project Build) must name the student's problem in 1 line and say how today's work applies to building that product. Never leave a slot as generic practice with no project link.",
    tags: ["connectivity", "project"],
  },
  {
    re: /day.*night|homework.*daily|leetcode.*align|same pattern/i,
    key: "day-night-lc-same-pattern",
    rule:
      "When DSA is ON: daytime Coding Practice and tonight's Homework LeetCode share the same pattern family, both tied to the problem statement + Apply-to-project note.",
    tags: ["leetcode", "connectivity"],
  },
];

const BASELINE_RULES = [
  {
    key: "baseline-slot-roles",
    rule:
      "Slot roles: Problem Review=read DT page/topic meaning; Learning=study concept+links; Problem Lab=write DT answers ONLY HERE; Project Build=apply learning to project; Mini Build=small extension of Project Build.",
    tags: ["baseline", "slots"],
    surface: "daily",
  },
  {
    key: "baseline-no-fake-urls",
    rule:
      "No fake/placeholder URLs. Prefer curated verified links; else Search: <query>.",
    tags: ["baseline", "links"],
    surface: "all",
  },
  {
    key: "baseline-leetcode-unique",
    rule:
      "LeetCode numbers never repeat across the full plan — use inputs._planUsedLc.",
    tags: ["baseline", "leetcode"],
    surface: "all",
  },
  {
    key: "baseline-placement-rotation",
    rule:
      "Placement Prep every weekday: Mon Intro, Tue STAR, Wed Technical, Thu Why company, Fri Mock. Company from TARGET_COMPANY.",
    tags: ["baseline", "placement"],
    surface: "daily",
  },
  {
    key: "baseline-friday-review",
    rule:
      "Friday ends with Weekly Review (shipped / incomplete / differently / next week). Week 2 Friday also Sprint Demo.",
    tags: ["baseline", "weekly"],
    surface: "daily",
  },
  {
    key: "baseline-full-connectivity",
    rule:
      "PRODUCT CONNECTIVITY (mandatory): Every slot must include the student's problem glance (or 'your project') and one concrete Apply line — Learning, System Design, Coding Practice, Speak & Solve, Refresh case, Placement, Agent, Homework LeetCode/Case. Case studies must end with: how this case changes ONE decision in YOUR product.",
    tags: ["baseline", "connectivity", "project"],
    surface: "all",
  },
  {
    key: "baseline-day-night-lc",
    rule:
      "When DSA ON: day Coding Practice + night Homework LC = same pattern family → Apply to problem. When DSA OFF: night LC still Apply-to-project.",
    tags: ["baseline", "leetcode", "connectivity"],
    surface: "daily",
  },
];

function slugKey(text) {
  return crypto
    .createHash("sha1")
    .update(String(text || "").toLowerCase().replace(/\s+/g, " ").trim())
    .digest("hex")
    .slice(0, 16);
}

function extractRulesFromFeedback(feedback, surface = "all") {
  const text = String(feedback || "").trim();
  if (!text || text.length < 8) return [];

  const out = [];
  for (const p of RULE_PATTERNS) {
    if (p.re.test(text)) {
      out.push({
        ruleKey: p.key,
        rule: p.rule,
        sourceFeedback: text.slice(0, 2000),
        surface,
        tags: p.tags,
      });
    }
  }
  // Always keep a free-form lesson so faculty wording is not lost
  out.push({
    ruleKey: `feedback-${slugKey(text)}`,
    rule: `Faculty feedback (obey forever on new plans + refine): ${text.slice(0, 900)}`,
    sourceFeedback: text.slice(0, 2000),
    surface,
    tags: ["feedback"],
  });
  return out;
}

function readFileStore() {
  try {
    if (!fs.existsSync(FILE_STORE)) return [];
    const raw = JSON.parse(fs.readFileSync(FILE_STORE, "utf8"));
    return Array.isArray(raw?.lessons) ? raw.lessons : [];
  } catch (_) {
    return [];
  }
}

function writeFileStore(lessons) {
  try {
    const dir = path.dirname(FILE_STORE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      FILE_STORE,
      JSON.stringify({ updatedAt: new Date().toISOString(), lessons }, null, 2),
      "utf8"
    );
  } catch (e) {
    console.warn("engineLessons file store write failed:", e.message);
  }
}

function upsertFileLesson(item) {
  const list = readFileStore();
  const idx = list.findIndex((l) => l.ruleKey === item.ruleKey);
  const next = {
    ruleKey: item.ruleKey,
    rule: item.rule,
    sourceFeedback: item.sourceFeedback || "",
    surface: item.surface || "all",
    tags: item.tags || [],
    active: true,
    hitCount: idx >= 0 ? (Number(list[idx].hitCount) || 1) + 1 : 1,
    updatedAt: new Date().toISOString(),
  };
  if (idx >= 0) list[idx] = { ...list[idx], ...next };
  else list.push(next);
  writeFileStore(list);
  return next;
}

async function ensureBaselineLessons() {
  for (const b of BASELINE_RULES) {
    upsertFileLesson({
      ruleKey: b.key,
      rule: b.rule,
      sourceFeedback: "baseline quality contract",
      surface: b.surface,
      tags: b.tags,
    });
    if (!mongoReady()) continue;
    try {
      const doc = await EngineLesson.findOneAndUpdate(
        { ruleKey: b.key },
        {
          $setOnInsert: {
            rule: b.rule,
            sourceFeedback: "baseline quality contract",
            surface: b.surface,
            tags: b.tags,
            active: true,
          },
        },
        { upsert: true, new: true }
      );
      void doc;
    } catch (e) {
      console.warn("ensureBaselineLessons mongo:", e.message);
    }
  }
}

async function recordFeedbackLessons(feedback, opts = {}) {
  const surface = opts.surface || "all";
  const createdBy = opts.userId || null;
  const extracted = extractRulesFromFeedback(feedback, surface);
  if (!extracted.length) return [];

  const saved = [];
  for (const item of extracted) {
    // Always persist to file so the lesson survives DB issues
    const fileDoc = upsertFileLesson(item);
    saved.push(fileDoc);

    if (!mongoReady()) continue;
    try {
      const doc = await EngineLesson.findOneAndUpdate(
        { ruleKey: item.ruleKey },
        {
          $set: {
            rule: item.rule,
            sourceFeedback: item.sourceFeedback,
            surface: item.surface,
            tags: item.tags,
            active: true,
            createdBy,
          },
          $inc: { hitCount: 1 },
        },
        { upsert: true, new: true }
      );
      if (doc) saved[saved.length - 1] = doc;
    } catch (e) {
      console.warn("recordFeedbackLessons mongo:", e.message);
    }
  }
  console.log(
    `✅ Engine lessons recorded (${saved.length}):`,
    extracted.map((e) => e.ruleKey).join(", ")
  );
  return saved;
}

async function loadActiveLessons(surface = null) {
  try {
    await ensureBaselineLessons();
  } catch (_) {}

  const byKey = new Map();

  for (const row of readFileStore()) {
    if (row.active === false) continue;
    if (
      surface &&
      surface !== "all" &&
      row.surface &&
      row.surface !== "all" &&
      row.surface !== surface
    ) {
      continue;
    }
    byKey.set(row.ruleKey, row);
  }

  if (mongoReady()) {
    try {
      const q = { active: true };
      if (surface && surface !== "all") {
        q.$or = [{ surface: "all" }, { surface }];
      }
      const rows = await EngineLesson.find(q).sort({ updatedAt: -1 }).limit(80).lean();
      for (const row of rows) {
        byKey.set(row.ruleKey, row);
      }
    } catch (err) {
      console.warn("loadActiveLessons mongo:", err.message);
    }
  }

  const merged = Array.from(byKey.values()).sort((a, b) => {
    const ta = new Date(a.updatedAt || 0).getTime();
    const tb = new Date(b.updatedAt || 0).getTime();
    return tb - ta;
  });
  return merged.slice(0, 80);
}

function formatLessonsForPrompt(lessons = []) {
  if (!lessons.length) return "";
  const lines = lessons.map((l, i) => `${i + 1}. ${l.rule}`);
  return (
    `\nENGINE QUALITY LESSONS (mandatory — never repeat these mistakes on NEW or REFINED plans):\n` +
    lines.join("\n") +
    "\n"
  );
}

/** Attach lessons onto inputs for generators. Always call before NEW generate / refine. */
async function attachEngineLessons(inputs = {}, surface = "daily") {
  const lessons = await loadActiveLessons(surface);
  inputs._engineLessons = lessons;
  inputs._engineLessonsBlock = formatLessonsForPrompt(lessons);
  console.log(
    `📌 Engine lessons attached for ${surface}: ${lessons.length} rule(s)` +
      (lessons.length ? ` [${lessons.slice(0, 4).map((l) => l.ruleKey).join(", ")}${lessons.length > 4 ? ", …" : ""}]` : "")
  );
  return inputs;
}

module.exports = {
  extractRulesFromFeedback,
  recordFeedbackLessons,
  loadActiveLessons,
  formatLessonsForPrompt,
  attachEngineLessons,
  ensureBaselineLessons,
  BASELINE_RULES,
};
