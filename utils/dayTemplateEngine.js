/**
 * Activity-layout days: start from _dayTemplate (else _activityBlueprint.daily).
 * Never invent start/end via LLM. LLM fills Task / Content (column 4) only.
 *
 * Flow: parse template → Must apply patches template (layout/times) →
 * per working day skeleton rows → LLM content → retry empties → homework.
 */

const { callLLM } = require("./llm");
const {
  formatClockRange,
  normalizeClockCell,
  parseJsonField,
  parseActivityBlueprint,
  applyHomeworkOverridesToDailyRows,
  SLOT_LABELS,
  minutesOf,
  hhmm,
} = require("./scheduleOverrides");
const {
  forceApplyOn,
  mustApplyPromptSection,
  extractMustApplyVerbatim,
} = require("./forceOverride");
function trimText(v) {
  return String(v || "").trim();
}

function truthyFlag(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

function isPhase2(inputs = {}) {
  return String(inputs._cohortPhase || inputs.cohortPhase || "").trim() === "2";
}

function snsAgentWorkbenchOn(inputs = {}) {
  // Explicit ON, or any plan that includes an Agent period (SNS Agent Workbench)
  if (truthyFlag(inputs._snsAgentWorkbench) || truthyFlag(inputs.snsAgentWorkbench)) {
    return true;
  }
  // Phase 2 defaults to SNS workbench for agent cells
  return isPhase2(inputs);
}

function requireLearningLinks(inputs = {}) {
  // Explicit OFF only when frontend sends false
  if (inputs._requireLearningLinks === false || inputs._requireLearningLinks === "false") {
    return false;
  }
  // Explicit ON — never skip inject (frontend already sends this)
  if (truthyFlag(inputs._requireLearningLinks) || truthyFlag(inputs.requireLearningLinks)) {
    return true;
  }
  // Template / activity-layout days default to requiring real Learning links
  return (
    truthyFlag(inputs._useActivityLayout) ||
    truthyFlag(inputs._dayTemplateApplied) ||
    inputs._requireLearningLinks == null
  );
}

/** Learning period by id or title (e.g. "Learning / Theory"). */
function isLearningPeriod(periodOrId = {}, titleHint = "") {
  if (periodOrId && typeof periodOrId === "object") {
    const id = String(periodOrId.id || "").toLowerCase();
    const title = String(periodOrId.title || titleHint || "").toLowerCase();
    return (
      id === "learning" ||
      /^learn/.test(id) ||
      /\blearning\b/.test(title) ||
      /\btheory\b/.test(title)
    );
  }
  const id = String(periodOrId || "").toLowerCase();
  const title = String(titleHint || "").toLowerCase();
  return (
    id === "learning" ||
    /^learn/.test(id) ||
    /\blearning\b/.test(title) ||
    /\btheory\b/.test(title)
  );
}

function isAgentPeriod(period = {}) {
  const id = String(period.id || "").toLowerCase();
  const title = String(period.title || "").toLowerCase();
  return (
    id === "agent" ||
    /agent/.test(id) ||
    /agent\s*builder|agent\s*workbench|sns\s*agent/i.test(title)
  );
}

function isProjectPeriod(period = {}, titleHint = "") {
  const id = String(period?.id || period || "").toLowerCase();
  const title = String(period?.title || titleHint || "").toLowerCase();
  return (
    id === "project" ||
    /^project/.test(id) ||
    /project\s*build|dt playbook/i.test(title)
  );
}

function isCodingPeriod(period = {}, titleHint = "") {
  const blob = `${period?.id || ""} ${period?.title || titleHint}`.toLowerCase();
  return /coding|dsa|leetcode|problem solving/.test(blob);
}

function isSysDesignPeriod(period = {}, titleHint = "") {
  const blob = `${period?.id || ""} ${period?.title || titleHint}`.toLowerCase();
  return /system design|architecture|hld|lld/.test(blob);
}

/** Learning, Project, coding, system design, agent — inject YouTube + article. */
function isTechnicalResourcePeriod(period = {}, titleHint = "") {
  return (
    isLearningPeriod(period, titleHint) ||
    isProjectPeriod(period, titleHint) ||
    isCodingPeriod(period, titleHint) ||
    isSysDesignPeriod(period, titleHint) ||
    isAgentPeriod(period)
  );
}

function guessContentFamily(content = "") {
  const c = String(content || "").toLowerCase();
  if (/what agent to build|sns agent workbench|n8n-style|agent to build|workflow steps:/.test(c)) {
    return "agent";
  }
  if (/▶\s*done:/.test(c) && /stuck/.test(c)) return "standup";
  if (/short rest|hydrate \/ stretch/.test(c) && c.length < 200) return "break";
  // Invented activities the model sometimes pastes as the whole cell
  if (
    /^(▶\s*)?(meditation|okr(\s*sync)?|student should demonstrate|presentation topic)\b/i.test(
      String(content || "").trim()
    ) ||
    (/meditation session|okr sync|key results for today|student should demonstrate/i.test(c) &&
      !/n8n|workflow|concept:|stage:|real project task/i.test(c))
  ) {
    return "forbidden";
  }
  return "";
}

/**
 * Drop LLM paste that belongs to another period
 * (Agent text into Learning/OKR, Meditation/Demonstrate inventions, etc.).
 */
function contentMatchesPeriod(period = {}, content = "") {
  const fam = guessContentFamily(content);
  if (!fam) return true;
  const id = String(period.id || "").toLowerCase();
  const title = String(period.title || "").toLowerCase();
  if (fam === "forbidden") {
    // Only keep if the template itself is that activity (it never should be)
    return /meditation|okr|demonstrate|presentation topic/i.test(`${id} ${title}`);
  }
  if (fam === "agent") return isAgentPeriod(period);
  if (fam === "standup") return /standup|stand[\s-]?up/.test(`${id} ${title}`);
  if (fam === "break") return /lunch|break|game|refresh/.test(`${id} ${title}`);
  return true;
}

/** Video/article topic per role so each cell gets an on-topic, non-repeating link. */
function linkTopicForRole(role, ctx = {}, topicHint = "", period = {}) {
  const step = ctx.dtStep?.step || topicHint || period.title || "design thinking";
  if (role === "sysdesign") return `system design architecture api database ${topicHint}`;
  if (role === "agent") return "n8n agent workflow automation api http endpoint machine learning";
  if (role === "coding") return topicHint || step;
  if (role === "problem" || role === "project") {
    const stage = String(ctx.dtStep?.stage || "").toLowerCase();
    if (/pitch|bmc|implement/.test(stage)) return `${step} pitch business model value proposition`;
    if (/ideat|plan|prototype/.test(stage)) return `${step} design thinking wireframe prototype ui ux`;
    if (/evaluat|test/.test(stage)) return `${step} usability prepare test interview design thinking`;
    return `${step} design thinking persona user research empathy`;
  }
  return step;
}

/**
 * SNS Agent Workbench task tied to THEIR problem and today's DT stage
 * (Empathize collects real pains → Define tags them → Plan backlog → Prototype intake → Evaluate feedback → Pitch metrics).
 */
function problemAgentTask(ctx = {}) {
  const problem = softClip(softProblem(ctx.inputs || {}), 70);
  const stage = String(ctx.dtStep?.stage || "").toLowerCase();
  const prevAgent = (ctx.inputs?._prevDayChain?.chain || []).find((c) => c.role === "agent");
  const T = (name, what, steps, deliverable, helps) => ({ name, what, steps, deliverable, helps });
  let task;
  if (/empathi/.test(stage)) {
    task = T(
      "User Voice Collector Agent",
      `collect real pain points from people affected by "${problem}" into one sheet`,
      [
        "Form / Webhook trigger with 3 questions: who are you · what went wrong · how often",
        "Set node keeps role, pain, frequency, date",
        "Append each answer as a row in the empathy-log sheet",
        "Run with 3 real answers from classmates or users",
      ],
      "empathy-log sheet has 3+ real rows (role · pain · frequency).",
      "today's empathy map and DT Playbook answers use real quotes, not guesses"
    );
  } else if (/define/.test(stage)) {
    task = T(
      "Pain Theme Tagger Agent",
      `group the collected pains for "${problem}" into themes with severity`,
      [
        "Manual trigger reads the empathy-log rows",
        "AI / Code node tags each pain: theme + severity (1–5)",
        "Aggregate node counts rows per theme",
        "Write the top 3 themes to pain-themes.md",
      ],
      "pain-themes.md lists top 3 themes with counts + severity.",
      "the focus statement is built on the most frequent, most severe pain"
    );
  } else if (/ideat|plan/.test(stage)) {
    task = T(
      "Feature Backlog Agent",
      `turn the focus statement for "${problem}" into a prioritised feature backlog`,
      [
        "Manual trigger with the focus statement + top pain themes",
        "AI node proposes 5 features, each mapped to one user action",
        "Code node scores each feature (impact × effort)",
        "Save backlog.md sorted by score",
      ],
      "backlog.md has 5 features → user action → score.",
      "Product Development picks the top feature instead of guessing"
    );
  } else if (/prototype/.test(stage)) {
    task = T(
      "Submission Intake Agent",
      `receive one submission from the prototype form for "${problem}" and store it cleanly`,
      [
        "Webhook trigger receives the prototype form data",
        "IF node validates required fields (name, category, description)",
        "Save the record to the sheet / DB with a status = new",
        "Send a confirmation message back (email / Slack / response node)",
      ],
      "one test submission stored with status + confirmation sent.",
      "the prototype works end to end with real data, ready for user testing"
    );
  } else if (/evaluat|test/.test(stage)) {
    task = T(
      "Usability Feedback Agent",
      `collect and summarise usability-test feedback on the "${problem}" prototype`,
      [
        "Form trigger: task completed? (yes/no) · time taken · one comment",
        "Code node computes success rate + average time",
        "AI node summarises comments into 3 issues",
        "Write feedback-summary.md",
      ],
      "feedback-summary.md with success rate, avg time, top 3 issues.",
      "the reiterate step fixes the issues users actually hit"
    );
  } else if (/pitch|bmc|implement/.test(stage)) {
    task = T(
      "Pitch Metrics Agent",
      `turn the logged data for "${problem}" into slide-ready numbers`,
      [
        "Manual trigger reads the sheets from earlier agents",
        "Code node computes users reached, pains logged, test success rate",
        "Format a 4-row KPI table",
        "Save kpi-table.md for the BMC / pitch deck",
      ],
      "kpi-table.md with 4 real metrics for the pitch.",
      "the pitch and BMC quote real traction, not claims"
    );
  } else {
    task = T(
      "Problem Intake Agent",
      `automate one repetitive step of "${problem}"`,
      [
        "Webhook / schedule trigger",
        "Transform node keeps the 3 fields the product needs",
        "Save the result where Product Development can read it",
        "Run once end to end",
      ],
      "workflow runs once and its output is saved for Product Development.",
      "removes one manual step from the problem"
    );
  }
  if (prevAgent && prevAgent.agentName === task.name) {
    task.steps = [
      `Open yesterday's ${task.name} and re-run it with 2 new real inputs`,
      ...task.steps.slice(1, 3),
      "Extend it: add a notify / summary node so the team sees each new result",
    ];
    task.deliverable = `${task.deliverable} Plus the new notify / summary node working.`;
  }
  return task;
}

/** Deterministic SNS Agent Workbench cell for Phase 2 — never OKR / generic AI talk. */
function buildPhase2AgentContent(ctx = {}) {
  const inputs = ctx.inputs || {};
  const problem = softProblem(inputs);
  const dayIdx = ctx.dayIdx || 0;
  const dtStep = ctx.dtStep || null;
  const learnLabel =
    ctx.daySlice?.primarySubject?.topic ||
    ctx.daySlice?.primarySubject?.name ||
    dtStep?.step ||
    "";
  let ragTask = null;
  if (inputs._agentRagPack) {
    try {
      const { getAgentRagTask } = require("./enrichAgentWorkbenchRag");
      ragTask = getAgentRagTask(inputs._agentRagPack, dayIdx) || null;
    } catch (_) {
      ragTask = null;
    }
  }
  if (!ragTask) {
    const t = problemAgentTask(ctx);
    return [
      `▶ SNS Agent Workbench (Phase 2) — workbench on THEIR problem (never OKRion)`,
      `▶ Problem (short): ${softClip(problem, 120)}`,
      `▶ What agent to build (n8n-style): ${t.name}`,
      `▶ What to build: an agent that will ${t.what}`,
      ...t.steps.map((s, i) => `▶ Step ${i + 1}: ${s}`),
      `▶ How it helps their problem: ${t.helps}`,
      `▶ Deliverable: ${t.deliverable}`,
    ].join("\n");
  }
  let body = "";
  try {
    const { formatAgentWorkbenchTask } = require("../data/agentWorkbenchBanks");
    body = formatAgentWorkbenchTask(
      null,
      inputs._agentWorkbenchNotes || inputs.agentWorkbenchNotes || "",
      problem,
      ragTask,
      dayIdx,
      {
        projectMode: true,
        problemQuote: softClip(problem, 80),
        learnLabel: softClip(learnLabel, 60),
      }
    );
  } catch (_) {
    body = "";
  }

  // Normalize to required Phase 2 labels
  const titleMatch = body.match(/▶\s*Task:\s*(.+)/i);
  const whatMatch = body.match(/▶\s*What to build:\s*(.+)/i);
  const stepLines = (body.match(/▶\s*Step\s*\d+:\s*.+/gi) || []).map((l) =>
    l.replace(/^▶\s*/, "")
  );
  const successMatch = body.match(/▶\s*Success check:\s*(.+)/i);
  const applyMatch = body.match(/▶\s*Apply:\s*(.+)/i);

  const agentName =
    (titleMatch && titleMatch[1].trim()) ||
    `n8n agent for ${softClip(problem, 50)}`;
  const what =
    (whatMatch && whatMatch[1].trim()) ||
    "Trigger → 2–3 nodes → action that saves a useful output for the product.";
  const steps =
    stepLines.length > 0
      ? stepLines
      : [
          "Step 1: Set a webhook / schedule trigger",
          "Step 2: Add a transform or HTTP node for one product field",
          "Step 3: Write the result to a note/file the project can use",
        ];
  const placeholder = /your (project|uploaded) problem|\b1 sentence\b|\[insert/i;
  let helps = (applyMatch && applyMatch[1].trim()) || "";
  if (!helps || placeholder.test(helps)) helps = problemAgentTask(ctx).helps;
  const done =
    (successMatch && successMatch[1].trim()) ||
    "Workflow runs once end-to-end and output is saved for Project Build.";

  return [
    `▶ SNS Agent Workbench (Phase 2) — workbench on THEIR problem (never OKRion)`,
    `▶ Problem (short): ${softClip(problem, 120)}`,
    `▶ What agent to build (n8n-style): ${agentName}`,
    `▶ What to build: ${what}`,
    ...steps.map((s) => `▶ ${/^step\s*\d/i.test(s) ? s : `Workflow: ${s}`}`),
    `▶ How it helps their problem: ${helps}`,
    `▶ Deliverable: ${done}`,
  ].join("\n");
}

function looksLikeGenericAgentTalk(content = "") {
  const c = String(content || "");
  if (!c.trim()) return true;
  if (/\bOKR\b/i.test(c) && !/n8n|workflow|trigger|node/i.test(c)) return true;
  if (/generic\s+ai|what is ai|history of ai|ai talk/i.test(c)) return true;
  if (!/n8n|workflow|trigger|node|agent to build|Deliverable|Done when/i.test(c)) return true;
  return false;
}

/** Empty / placeholder only — do not treat rich LLM text as weak. */
function isEmptyContent(content) {
  const c = trimText(content)
    .replace(/^▶\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!c) return true;
  if (/^(tbd|todo|n\/?a|-|—|–|\.|…|_+)$/i.test(c)) return true;
  if (/^today'?s\s+concept\.?$/i.test(c)) return true;
  return false;
}

function useActivityLayout(inputs = {}) {
  if (truthyFlag(inputs._useActivityLayout)) return true;
  // FE may send template without the flag — still honour layout
  const t = parseDayTemplateRaw(inputs);
  return Boolean(t && t.length);
}

function parseDayTemplateRaw(inputs = {}) {
  let base = null;
  const direct = parseJsonField(inputs._dayTemplate);
  if (Array.isArray(direct) && direct.length) {
    base = direct.filter((p) => p && typeof p === "object");
  } else if (direct && typeof direct === "object") {
    if (Array.isArray(direct.periods) && direct.periods.length) base = direct.periods;
    else if (Array.isArray(direct.daily) && direct.daily.length) base = direct.daily;
  }

  const bp = parseActivityBlueprint(inputs);
  const bpDaily = bp && Array.isArray(bp.daily) ? bp.daily.filter((p) => p && typeof p === "object") : [];

  if (!base || !base.length) {
    return bpDaily.length ? bpDaily : null;
  }

  // Merge blueprint `mode: "add"` rows (e.g. manual AI Agent Builder) so they are
  // never dropped when _dayTemplate is a subset of the Activities list.
  const have = new Set(
    base.map((p) => String(p.id || p.title || "").trim().toLowerCase()).filter(Boolean)
  );
  const extras = [];
  for (const p of bpDaily) {
    const mode = String(p.mode || "keep").toLowerCase();
    if (mode === "hide") continue;
    const key = String(p.id || p.title || "").trim().toLowerCase();
    if (!key) continue;
    if (have.has(key)) continue;
    if (mode === "add" || /agent/i.test(key) || /agent/i.test(String(p.title || ""))) {
      extras.push({ ...p, mode: mode === "add" ? "add" : p.mode || "add" });
      have.add(key);
    }
  }
  return extras.length ? [...base, ...extras] : base;
}

/**
 * Activity role from the visible title. A renamed catalog slot (id "break" titled
 * "AI Agent Builder") must be filled as what the student sees, not as its old id.
 */
function roleFromTitle(title = "") {
  const t = String(title || "").toLowerCase().replace(/_/g, " ");
  if (!t.trim()) return "";
  if (/homework/.test(t)) return "homework";
  if (/meditation|stand[\s-]?up|self[\s-]?intro/.test(t)) return "standup";
  if (/\blunch\b/.test(t)) return "lunch";
  if (/agent\s*builder|ai\s*agent|agent\s*workbench|sns\s*agent|\bn8n\b/.test(t)) return "agent";
  if (/\bokrs?\b|okrion/.test(t)) return "okr";
  if (/system\s*design|\bhld\b|\blld\b|architecture/.test(t)) return "sysdesign";
  if (/\bbreak\b|snack|refresh/.test(t)) return "break";
  if (/product\s*development|project\s*build|\d+[\s-]*day\s*build|prototype|implement/.test(t)) return "project";
  if (/dt\s*playbook|capstone|problem\s*(review|lab)/.test(t)) return "problem";
  if (/coding|\bdsa\b|leetcode|problem\s*solving/.test(t)) return "coding";
  if (/learning|theory|concept/.test(t)) return "learning";
  if (/presentation|speak|pitch/.test(t)) return "presentation";
  if (/demonstrat|\bdemo\b|showcase/.test(t)) return "demonstrate";
  if (/placement|interview/.test(t)) return "placement";
  if (/retro|wrap[\s-]?up/.test(t)) return "close";
  return "";
}

function idRole(id = "") {
  const base = String(id || "").toLowerCase().replace(/^basics_/, "").replace(/_\d+$/, "");
  return roleFromTitle(base) || base;
}

/** Period role (title first, then id) — e.g. "okr", "agent", "sysdesign", "presentation". */
function periodRole(period = {}) {
  return roleFromTitle(period.title) || idRole(period.id);
}

/** End before start in the morning (e.g. "00:20" typed for 12:20 PM) → add 12h. */
function fixEndClock(start, end) {
  if (!start || !end) return end;
  const s = minutesOf(start);
  const e = minutesOf(end);
  if (e < s && e < 12 * 60) {
    return hhmm(`${Math.floor(e / 60) + 12}:${String(e % 60).padStart(2, "0")}`) || end;
  }
  return end;
}

/**
 * Layouts where work slots run into Break/Lunch (Learning 9:36–10:37 vs Break 10:00):
 * keep breaks/lunch fixed and flow the work slots around them in order, keeping each
 * slot's length. Layouts without overlaps are left exactly as the user typed them.
 */
function reflowOverlappingTemplate(list = [], inputs = {}) {
  const timed = list.filter((p) => p.start && p.end);
  const overlaps = timed.some((p, i) =>
    timed.some((q, j) => j > i && minutesOf(p.start) < minutesOf(q.end) && minutesOf(q.start) < minutesOf(p.end))
  );
  if (!overlaps) return list;

  const toHhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const isFixed = (p) => /^(break|lunch)$/.test(periodRole(p));
  const fixed = timed.filter(isFixed).sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
  let cursor = timed.length ? minutesOf(timed[0].start) : 9 * 60;

  for (const p of list) {
    if (!p.start || !p.end) continue;
    if (isFixed(p)) {
      cursor = Math.max(cursor, minutesOf(p.end));
      continue;
    }
    const dur = Math.max(10, minutesOf(p.end) - minutesOf(p.start));
    for (const f of fixed) {
      if (cursor >= minutesOf(f.start) && cursor < minutesOf(f.end)) cursor = minutesOf(f.end);
    }
    let end = cursor + dur;
    const nextFixed = fixed.find((f) => minutesOf(f.start) >= cursor);
    if (nextFixed) {
      const fs = minutesOf(nextFixed.start);
      if (end > fs || fs - end <= 15) end = fs;
    }
    p.start = toHhmm(cursor);
    p.end = toHhmm(end);
    p.clock = normalizeClockCell("", p.start, p.end, inputs) || p.clock;
    cursor = end;
  }
  list.sort((a, b) => {
    const am = a.start ? minutesOf(a.start) : 9999;
    const bm = b.start ? minutesOf(b.start) : 9999;
    return am !== bm ? am - bm : a.order - b.order;
  });
  return list;
}

/**
 * Normalize periods: clocks in original "9:00–9:15 AM IST" shape,
 * chronological from _dailyStart / start times (never PM-first if mornings exist).
 * Activity title = blueprint rename if present, else usual SLOT_LABELS name.
 */
function normalizeDayTemplate(rawPeriods = [], inputs = {}) {
  const dayStartMin = minutesOf(hhmm(inputs._dailyStart) || "09:00");

  const list = (rawPeriods || [])
    .filter((p) => p && typeof p === "object")
    .filter((p) => String(p.mode || "keep").toLowerCase() !== "hide")
    .map((p, idx) => {
      const rawId = trimText(p.id) || `period${idx + 1}`;
      // Prefer FE/blueprint title (rename); else usual catalog name
      const title = trimText(p.title) || SLOT_LABELS[rawId] || rawId;
      const titleRole = roleFromTitle(title);
      const id = titleRole && titleRole !== idRole(rawId) ? titleRole : rawId;
      const start = hhmm(p.start) || "";
      const end = fixEndClock(start, hhmm(p.end) || "");
      const clock = normalizeClockCell(p.clock, start, end, inputs) || "—";
      const order = Number(p.order) || idx + 1;
      return {
        order,
        id,
        slotId: rawId,
        title,
        start,
        end,
        clock,
        notes: trimText(p.notes),
        mode: String(p.mode || "keep").toLowerCase(),
      };
    });

  // FE sends catalog Break/Lunch plus "basics_*" copies at the same time → keep one.
  const deduped = [];
  for (const p of list) {
    const role = periodRole(p);
    const clash = deduped.find((q) => {
      if (periodRole(q) !== role) return false;
      if (p.start && q.start && p.start === q.start && p.end === q.end) return true;
      if (!/^(break|lunch|standup)$/.test(role)) return false;
      if (!p.start || !q.start || !p.end || !q.end) return p.title === q.title;
      return minutesOf(p.start) < minutesOf(q.end) && minutesOf(q.start) < minutesOf(p.end);
    });
    if (clash) {
      if (!/^basics_/.test(p.slotId) && /^basics_/.test(clash.slotId)) {
        deduped[deduped.indexOf(clash)] = { ...p, order: clash.order };
      }
      continue;
    }
    deduped.push(p);
  }
  list.length = 0;
  list.push(...deduped);

  const seenIds = new Map();
  list.forEach((p) => {
    const n = (seenIds.get(p.id) || 0) + 1;
    seenIds.set(p.id, n);
    if (n > 1) p.id = `${p.id}_${n}`;
  });

  // Chronological by start (from ~_dailyStart), then order — never leave 2:45 PM first
  list.sort((a, b) => {
    const am = a.start ? minutesOf(a.start) : 9999;
    const bm = b.start ? minutesOf(b.start) : 9999;
    if (am !== bm) return am - bm;
    return a.order - b.order;
  });

  // If somehow all afternoon before morning relative to dayStart, still sorted by absolute time
  void dayStartMin;

  reflowOverlappingTemplate(list, inputs);

  list.forEach((p, i) => {
    p.order = i + 1;
  });
  return list;
}

function parseDayTemplate(inputs = {}) {
  const raw = parseDayTemplateRaw(inputs);
  if (!raw || !raw.length) return null;
  const normalized = normalizeDayTemplate(raw, inputs);
  return normalized.length ? normalized : null;
}

/**
 * Must apply FIRST on the template (times / drop / add periods).
 * Returns patched period list. If force off or empty → original template.
 */
async function patchTemplateWithMustApply(template = [], inputs = {}) {
  if (!forceApplyOn(inputs)) return template;
  const must = trimText(extractMustApplyVerbatim(inputs)) || trimText(mustApplyPromptSection(inputs));
  if (!must) return template;

  const prompt =
    `You patch a daily ACTIVITY TEMPLATE (layout + times only).\n` +
    `Apply the HARD USER OVERRIDE verbatim if it asks for different times, dropped periods, or added periods.\n` +
    `If it only talks about content (not layout), return the template UNCHANGED.\n` +
    `Do NOT invent a canned 9–6 / OKR day. Do NOT invent start/end unless the override specifies them.\n` +
    `Clocks must be 12-hour IST style: "9:00–9:15 AM IST" (never 09:00-09:15, never UTC/GMT).\n` +
    `Keep periods in chronological order from morning (_dailyStart, usually ~9:00 AM).\n` +
    `start/end in JSON stay HH:MM 24h for parsing.\n` +
    `Do not invent a new table shape — periods only.\n\n` +
    `OVERRIDE:\n${must}\n\n` +
    `CURRENT TEMPLATE:\n${JSON.stringify(template, null, 2)}\n\n` +
    `Return ONLY valid JSON:\n` +
    `{"periods":[{"order":1,"id":"standup","title":"Stand-Up","start":"09:00","end":"09:15","clock":"9:00–9:15 AM IST","notes":""}]}\n`;

  try {
    const parsed = await callLLM(prompt, 2500);
    const periods = Array.isArray(parsed?.periods)
      ? parsed.periods
      : Array.isArray(parsed?.daily)
        ? parsed.daily
        : Array.isArray(parsed)
          ? parsed
          : null;
    if (!periods || !periods.length) {
      console.warn("📐 Must-apply template patch returned empty — keeping original template");
      return template;
    }
    const next = normalizeDayTemplate(periods, inputs);
    console.log(`⚡ Must-apply patched day template → ${next.length} period(s)`);
    return next.length ? next : template;
  } catch (e) {
    console.warn("Must-apply template patch skipped:", e.message);
    return template;
  }
}

/** Skeleton rows: original shape [dayKey, time, activity, content]. */
function buildSkeletonDayRows(dayKey, template = [], inputs = {}) {
  return (template || []).map((p) => [
    dayKey,
    normalizeClockCell(p.clock, p.start, p.end, inputs) ||
      formatClockRange(p.start, p.end, inputs) ||
      "—",
    p.title || SLOT_LABELS[p.id] || p.id,
    "",
  ]);
}

function contentToText(raw) {
  if (raw == null) return "";
  if (Array.isArray(raw)) {
    return raw
      .map((x) => String(x || "").trim())
      .filter(Boolean)
      .map((l) => (/^▶\s/.test(l) ? l : `▶ ${l}`))
      .join("\n");
  }
  return String(raw).trim();
}

function todayTopic(ctx = {}) {
  return (
    ctx.dtStep?.whatToLearn ||
    ctx.dtStep?.step ||
    ctx.daySlice?.primarySubject?.topic ||
    ctx.daySlice?.primarySubject?.name ||
    ctx.theme?.learnTopic ||
    "today's concept"
  );
}

function todayBuildTask(ctx = {}) {
  return (
    ctx.dtStep?.realProjectTask ||
    ctx.dtStep?.step ||
    "one working slice of their tool"
  );
}

/** First working day of the plan (Week 1 Day 1). */
function isDay1(ctx = {}) {
  const idx = Number(ctx.dayIdx);
  if (Number.isFinite(idx)) return idx === 0;
  const key = String(ctx.dayKey || "");
  return /week\s*1.*monday|monday.*week\s*1/i.test(key);
}

function weakChainContent(content = "") {
  const c = String(content || "");
  if (isEmptyContent(c)) return true;
  if (c.split(/\s+/).filter(Boolean).length < 18) return true;
  // Missing the do-this / deliverable spine students must see
  if (!/do this|deliverable/i.test(c)) return true;
  return false;
}

/** Role-aware quality bar: placeholders, missing "Do this" steps, or an agent with no trigger/nodes. */
function weakForRole(role, content = "") {
  const c = String(content || "");
  if (weakChainContent(c)) return true;
  if (/\[(insert|add|your|diagram)[^\]]*\]|lorem ipsum|\bTBD\b/i.test(c)) return true;
  if (/^(learning|sysdesign|project|problem|coding)$/.test(role) && !/do this/i.test(c)) return true;
  if (role === "sysdesign" && !/box|arrow|component|diagram/i.test(c)) return true;
  if (role === "agent" && !(/trigger/i.test(c) && /node|step\s*\d/i.test(c))) return true;
  return false;
}

function stripMarkdown(content = "") {
  return String(content || "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildConnectedHomework(ctx = {}) {
  const inputs = ctx.inputs || {};
  const topic = softClip(todayTopic(ctx), 80);
  const build = softClip(todayBuildTask(ctx), 90);
  const problem = softClip(softProblem(inputs), 160);
  const stage = (ctx.dtStep && ctx.dtStep.stage) || "Build";
  return (
    `▶ Tonight's Homework — continue TODAY, do not start a new topic.\n` +
    `▶ Learned today: ${topic}\n` +
    `▶ Built today: ${build}\n` +
    `▶ Problem: ${problem}\n` +
    `▶ System Design: finish / clean the diagram of the box that uses "${topic}".\n` +
    `▶ Do this: 1) 20 min — practice the same topic  2) 20 min — push the tool slice  3) 10 min — write the deliverable note.\n` +
    `▶ Deliverable: homework-day notes with (a) topic in 2 lines (b) screenshot or file path of the tool slice (c) one SD box name.\n` +
    `▶ Connect: Learn → System Design box → tool code/screen → this homework.\n` +
    `▶ Stage: ${stage}\n` +
    `▶ Deliverable: you can show Learn → Design → Build in 60 seconds tomorrow.`
  );
}

/** Day 1 Stand-Up — NEVER blank: DONE = none yet + the problem. */
function buildDay1StandUp(ctx = {}) {
  const problem = softClip(softProblem(ctx.inputs || {}), 160);
  const topic = softClip(todayTopic(ctx), 80);
  const build = softClip(todayBuildTask(ctx), 90);
  return (
    `▶ DONE: none yet (Day 1) — say the problem in one line: ${problem}\n` +
    `▶ TODAY: learn "${topic}" → draw the System Design box → build "${build}"\n` +
    `▶ STUCK: (or "none")\n` +
    `▶ Deliverable: 3 spoken lines — problem / today's topic / today's build.\n` +
    `▶ Chain: problem → learn → SD box → tool build → deliverable → homework tonight.`
  );
}

/** Empathize / Define / Evaluate / Pitch days: research + docs, not repo code. */
function isNonCodeStage(ctx = {}) {
  return /empathi|define|evaluate|test|pitch|bmc/i.test(String(ctx.dtStep?.stage || ""));
}

function buildPhase2Guide(kind, ctx = {}) {
  const topic = softClip(todayTopic(ctx), 80);
  const build = softClip(todayBuildTask(ctx), 90);
  const problem = softClip(softProblem(ctx.inputs || {}), 120);
  const stage = (ctx.dtStep && ctx.dtStep.stage) || "Build";
  const step = (ctx.dtStep && ctx.dtStep.step) || kind;
  const nonCode = isNonCodeStage(ctx);
  if (kind === "dtpage") {
    const dt = ctx.dtStep || {};
    const page = dt.page != null ? `DT Playbook page ${dt.page}` : "today's DT Playbook page";
    return [
      `▶ ${page} — "${step}" · ${stage} — take and fill the questions on this page`,
      `▶ Problem (short): ${problem}`,
      `▶ Stage: ${stage}`,
      `▶ Step: ${step}`,
      `▶ What to Learn: ${topic}`,
      `▶ Do this: 1) read every question on ${page}  2) answer each in 2–3 lines for YOUR problem (real users, real numbers)  3) circle the one assumption you must test`,
      `▶ Real Project Task: ${build}`,
      `▶ Discussion Prompt: ${softClip(dt.discussionPrompt || "Which answer surprised you most, and why?", 140)}`,
      `▶ Deliverable: ${page} filled + 3-line summary (used by today's agent, diagram and build).`,
    ].join("\n");
  }
  if (kind === "project" && nonCode) {
    return [
      `▶ Product time (${stage} stage — research & docs, no app code yet)`,
      `▶ Stage: ${stage}`,
      `▶ Step: ${step}`,
      `▶ What to Learn: ${topic}`,
      `▶ Real Project Task: ${build}`,
      `▶ Do this:`,
      `  1) Open this morning's DT Playbook answers and today's System Design diagram`,
      `  2) Turn them into the ${step} artifact (Figma / doc / sheet) for YOUR problem`,
      `  3) Add one real data point (a user quote, count, or screenshot) from the Agent Builder output`,
      `  4) Update the PRD section for ${step}`,
      `▶ Problem (short): ${problem}`,
      `▶ Deliverable: ${step} artifact saved + PRD updated (file link ready for Demonstrate).`,
    ].join("\n");
  }
  if (kind === "sysdesign" && nonCode) {
    return [
      `▶ Do this: draw the current (as-is) flow of the problem as boxes + arrows — who acts, which system, where it breaks`,
      `▶ Connect: mark on the diagram where today's finding ("${topic}") shows up`,
      `▶ Then: add the ONE box your product will add or replace, with 3 arrows in/out (who calls it, what it stores, what it returns)`,
      `▶ Use: today's DT Playbook answers + the Agent Builder output as evidence for each pain point`,
      `▶ Problem (short): ${problem}`,
      `▶ Deliverable: as-is diagram with pain points + one new box — Product Development builds on it next.`,
    ].join("\n");
  }
  if (kind === "standup") {
    if (isDay1(ctx)) return buildDay1StandUp(ctx);
    return (
      `▶ DONE: yesterday's tool slice on ${problem}\n` +
      `▶ TODAY: learn "${topic}" then build "${build}"\n` +
      `▶ STUCK: (or "none")\n` +
      `▶ Deliverable: 3 spoken lines — problem / today's topic / today's build.\n` +
      `▶ Chain: problem → learn → SD box → tool build → deliverable.`
    );
  }
  const v = Math.abs(Number(ctx.dayIdx) || 0);
  const pick = (arr) => arr[v % arr.length];
  if (kind === "learning") {
    const doThis = pick([
      `1) watch the video once  2) write 5 bullets in your own words  3) name where "${topic}" sits in your tool`,
      `1) read the article section  2) draw a 4-box sketch of how "${topic}" works  3) list 2 mistakes beginners make`,
      `1) skim both links  2) explain "${topic}" to a peer in 60 seconds  3) write the one example that fits ${step}`,
      `1) note 3 key terms  2) compare "${topic}" with yesterday's concept  3) write one question you still have`,
    ]);
    const deliverable = pick([
      `notes "Learn — ${topic}" with Concept + Why + one example from your problem`,
      `4-box sketch + 2 beginner mistakes, photographed into your notes`,
      `60-second explanation script + the ${step} example`,
      `3 terms defined + yesterday-vs-today comparison table`,
    ]);
    return (
      `▶ Concept: ${topic}\n` +
      `▶ Why today (${stage} · ${step}): this is the piece you will design and then build for your problem\n` +
      `▶ Do this: ${doThis}\n` +
      `▶ Connect next: System Design draws the box for "${topic}"; Project Build implements it.\n` +
      `▶ Problem (short): ${problem}\n` +
      `▶ Deliverable: ${deliverable}.`
    );
  }
  if (kind === "sysdesign") {
    const focus = pick([
      `the API box — request in, response out`,
      `the data box — which table/collection stores what`,
      `the screen box — what the user sees and clicks`,
      `the integration box — which outside service it calls`,
    ]);
    return (
      `▶ Do this: draw ONE system box for "${topic}" — today's focus: ${focus}.\n` +
      `▶ Connect: this box exists because of the problem; Project Build implements it this afternoon.\n` +
      `▶ Step context: ${stage} · ${step} — the box must serve this step.\n` +
      `▶ Then: list 3 arrows in/out (who calls it, what it stores, what it returns).\n` +
      `▶ Problem (short): ${problem}\n` +
      `▶ Deliverable: diagram of ${focus.split(" — ")[0]} (boxes + arrows) saved in notes, ready for Project Build.`
    );
  }
  if (kind === "project") {
    const steps = pick([
      [`Open the repo and create a branch for "${step}"`, `Implement the System Design box you drew today`, `Wire "${topic}" into code, data, or UI`, `Run it once and capture a screenshot`],
      [`Write the smallest test/input for today's box`, `Build the box until that input works`, `Connect it to yesterday's slice`, `Record a 20-second screen clip`],
      [`List the 3 arrows from today's diagram as TODOs`, `Implement each arrow (call / store / return)`, `Use "${topic}" in at least one arrow`, `Push the commit with a clear message`],
      [`Fix one bug or gap from yesterday's demo`, `Add today's box on top`, `Show "${topic}" in the UI or output`, `Write a 3-line README update`],
    ]);
    return (
      `▶ Tool time: this WHOLE period is for BUILDING the tool — not discussion only.\n` +
      `▶ Stage: ${stage}\n` +
      `▶ Step: ${step}\n` +
      `▶ What to Learn: ${topic}\n` +
      `▶ Real Project Task: ${build}\n` +
      `▶ Do this:\n` +
      steps.map((s, i) => `  ${i + 1}) ${s}`).join("\n") +
      `\n▶ Problem (short): ${problem}\n` +
      `▶ Deliverable: ${build} — working slice + 3-line note (what / file path / how to demo).`
    );
  }
  if (kind === "coding") {
    const drill = pick([
      `solve 1 named problem on "${topic}", then write the pattern in 2 lines`,
      `solve 1 easy + 1 medium on "${topic}" and compare time complexity`,
      `re-solve yesterday's problem faster, then 1 new "${topic}" problem`,
      `solve 1 problem on "${topic}" and write 3 edge-case tests`,
    ]);
    return (
      `▶ Practice the SAME topic you learned: ${topic}\n` +
      `▶ Do this: ${drill}; then say how it helps "${build}"\n` +
      `▶ Connect: this drill makes today's tool slice easier.\n` +
      `▶ Problem (short): ${problem}\n` +
      `▶ Deliverable: ${pick(["solution + pattern note", "2 solutions + complexity comparison", "timed re-solve + new solution", "solution + 3 edge-case tests"])} (where it appears in the tool).`
    );
  }
  return "";
}

function softProblem(inputs = {}) {
  return softClip(
    String(inputs.problem || inputs.problemStatement || inputs._problem || "")
      .trim()
      .replace(/^\s*problem\s*statement\s*[:\-–—]\s*/i, "") ||
      "the student's uploaded problem",
    400
  );
}

function softClip(text, n = 400) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (t.length <= n) return t;
  let cut = t.slice(0, n - 1);
  const sp = cut.lastIndexOf(" ");
  if (sp > n * 0.6) cut = cut.slice(0, sp);
  cut = cut.replace(/[\s,;:–—-]+$/, "").replace(/\s+(the|a|an|to|for|with|and|or|of|in|on|at|by)$/i, "");
  return `${cut}…`;
}

function weekOfDayKey(dayKey = "") {
  return Number(String(dayKey || "").match(/week\s*(\d+)/i)?.[1]) || 1;
}

/** Thin cell for a rich period (OKR / Presentation / Demonstrate / Stand-Up). */
function thinRichContent(content = "") {
  const c = String(content || "");
  if (isEmptyContent(c)) return true;
  const words = c.split(/\s+/).filter(Boolean).length;
  const bullets = (c.match(/^\s*▶/gm) || []).length;
  return words < 35 || bullets < 4;
}

/** OKRion cell — weekly objective, today's key result, LinkedIn / cert. Never the Agent Workbench. */
function buildOkrContent(ctx = {}) {
  const problem = softClip(softProblem(ctx.inputs || {}), 120);
  const dt = ctx.dtStep || {};
  const week = weekOfDayKey(ctx.dayKey);
  const topic = softClip(todayTopic(ctx), 80);
  const build = softClip(todayBuildTask(ctx), 120);
  const goal = softClip(dt.stageGoal || dt.productGoal || `${dt.stage || "Build"} stage on the problem`, 140);
  return [
    `▶ OKRion — weekly Objective + today's Key Result (LinkedIn / certification live here, not in the Agent Workbench)`,
    `▶ Problem (short): ${problem}`,
    `▶ Objective (Week ${week}): ${goal}`,
    `▶ Key Result today: "${build}" finished and proven with a file / screenshot / link`,
    `▶ Do this: 1) open OKRion  2) update today's KR % honestly  3) paste the proof link from Product Development / System Design  4) write a 2-line reflection`,
    `▶ LinkedIn / cert (10 min): draft a post "What I learned about ${topic} while working on ${softClip(problem, 60)}" — or finish one module of your certification track`,
    `▶ Deliverable: OKRion KR updated with proof link + LinkedIn draft (or cert module) saved.`,
  ].join("\n");
}

/** Presentation cell — 4-slide talk on today's chain. */
function buildPresentationContent(ctx = {}) {
  const problem = softClip(softProblem(ctx.inputs || {}), 120);
  const dt = ctx.dtStep || {};
  const topic = softClip(todayTopic(ctx), 80);
  const build = softClip(todayBuildTask(ctx), 110);
  const prompt = softClip(dt.discussionPrompt || "What is the riskiest assumption in our plan today?", 140);
  return [
    `▶ Problem (short): ${problem}`,
    `▶ Presentation topic: "${dt.step || topic}" — how today's work moves the problem forward`,
    `▶ Stage: ${dt.stage || "Build"} · Step: ${dt.step || "today's step"}`,
    `▶ Slide 1 — Problem: who is affected and one real example`,
    `▶ Slide 2 — Learned today: ${topic}`,
    `▶ Slide 3 — Built / designed today: ${build}`,
    `▶ Slide 4 — Next step + question for the room: ${prompt}`,
    `▶ Speak rule: 3 minutes, every team member presents one slide; take one question`,
    `▶ Deliverable: 4-slide deck (or 4 cards) + 3-minute talk delivered to the cohort.`,
  ].join("\n");
}

/** Placement Prep cell — interview practice tied to today's topic and build. */
function buildPlacementContent(ctx = {}) {
  const problem = softClip(softProblem(ctx.inputs || {}), 120);
  const topic = softClip(todayTopic(ctx), 80);
  const build = softClip(todayBuildTask(ctx), 100);
  const v = Math.abs(Number(ctx.dayIdx) || 0);
  const drills = [
    [`Explain "${topic}" in 60 seconds as if to an interviewer`, `Answer: "Tell me about a project you are building" using today's slice`, `Write one STAR story from today's work`],
    [`Answer 2 aptitude questions (time yourself, 3 min each)`, `Explain where "${topic}" is used in real products`, `Update one resume bullet with today's build: ${build}`],
    [`Mock HR question: "Why this role?" — 3 sentences tied to your goal`, `Technical question on "${topic}" — say the answer aloud, then write it`, `Add today's deliverable to your portfolio/GitHub README`],
    [`Pair mock: ask a peer 2 questions on "${topic}", then swap`, `Describe your System Design box from today in 4 sentences`, `Note one company that solves a problem like yours and why`],
  ][v % 4];
  return [
    `▶ Problem (short): ${problem}`,
    `▶ Focus today: interview-ready on "${topic}" + your project story`,
    ...drills.map((d, i) => `▶ Drill ${i + 1}: ${d}`),
    `▶ Deliverable: 3 drills done + answers saved in your placement notes (reused in tonight's homework).`,
  ].join("\n");
}

/** Any slot without a dedicated builder (Mini Build, Retrospective, custom titles). */
function buildGenericSlotContent(period = {}, ctx = {}) {
  const problem = softClip(softProblem(ctx.inputs || {}), 120);
  const topic = softClip(todayTopic(ctx), 80);
  const build = softClip(todayBuildTask(ctx), 100);
  const title = softClip(period.title || "this period", 50);
  const role = periodRole(period);
  if (role === "close") {
    return [
      `▶ Problem (short): ${problem}`,
      `▶ Retrospective — look back on today in 4 lines:`,
      `  1) LEARNED: one sentence on "${topic}"`,
      `  2) FINISHED: the deliverable you can show (${build})`,
      `  3) LINKED: how today's work moved the problem forward`,
      `  4) TOMORROW: the first step you will take at Stand-Up`,
      `▶ Team: each member names one thing that went well and one blocker`,
      `▶ Deliverable: 4-line retro saved in notes — tomorrow's Stand-Up DONE reads it back.`,
    ].join("\n");
  }
  return [
    `▶ Problem (short): ${problem}`,
    `▶ ${title} — a short focused task on today's topic "${topic}"`,
    `▶ Do this:`,
    `  1) Pick the smallest piece of "${build}" not finished yet`,
    `  2) Finish it in this slot (doc, sketch, code or sheet — whatever the stage needs)`,
    `  3) Write 2 lines: what you finished + where it fits in the product`,
    `▶ Deliverable: ${title} output saved (file or screenshot) + 2-line note.`,
  ].join("\n");
}

/** Demonstrate cell — show every deliverable of the day (filled from the real chain when known). */
function buildDemonstrateContent(ctx = {}, chain = []) {
  const problem = softClip(softProblem(ctx.inputs || {}), 120);
  const shown = (chain || []).filter((c) => c.deliverable && !/standup|presentation|demonstrate/.test(c.role));
  const items = shown.length
    ? shown.map((c, i) => `  ${i + 1}) ${softClip(c.title, 50)} → ${softClip(c.deliverable, 110)}`)
    : [
        `  1) Learning → explain today's concept in 2 lines (${softClip(todayTopic(ctx), 60)})`,
        `  2) System Design → the one-box diagram`,
        `  3) Product Development → ${softClip(todayBuildTask(ctx), 90)}`,
        `  4) Agent Builder → one workflow run`,
      ];
  return [
    `▶ Problem (short): ${problem}`,
    `▶ Show, don't tell — demo today's chain in 60–90 seconds`,
    `▶ Show today's deliverables:`,
    ...items,
    `▶ Mentor checks: is each item tied to the problem? Is it a real file / screen / link?`,
    `▶ Deliverable: mentor sign-off on today's deliverables + one "fix tomorrow" note.`,
  ].join("\n");
}

/** Stand-Up from Day 2 on — DONE reads back yesterday's deliverables + homework. */
function buildConnectedStandUp(ctx = {}) {
  if (isDay1(ctx)) return buildDay1StandUp(ctx);
  const problem = softClip(softProblem(ctx.inputs || {}), 120);
  const prev = ctx.inputs?._prevDayChain || null;
  const done = (prev?.chain || [])
    .filter((c) => c.deliverable && /agent|sysdesign|project|problem|learning|coding/.test(c.role))
    .slice(0, 3)
    .map((c) => `${softClip(c.title, 30)}: ${softClip(c.deliverable, 70)}`);
  const topic = softClip(todayTopic(ctx), 80);
  const build = softClip(todayBuildTask(ctx), 90);
  return [
    `▶ DONE (${prev?.dayKey ? softClip(prev.dayKey.replace(/\s*\(.*\)$/, ""), 30) : "yesterday"}): ${done.length ? done.join(" · ") : `yesterday's slice of ${problem}`}`,
    `▶ Homework check: ${prev?.homework ? softClip(prev.homework, 110) : "last night's LeetCode + case notes ready"}`,
    `▶ TODAY: learn "${topic}" → design the box → build "${build}"`,
    `▶ STUCK: one blocker (or "none") — name who can help`,
    `▶ Problem (short): ${problem}`,
    `▶ Deliverable: 3 spoken lines — done / today / stuck — in under 90 seconds.`,
  ].join("\n");
}

function extractDeliverable(text = "") {
  const all = [...String(text || "").matchAll(/Deliverable:\s*([^\n]+)/gi)];
  if (!all.length) return "";
  return softClip(all[all.length - 1][1].replace(/^[\s"“]+|[\s"”]+$/g, ""), 120);
}

/** Learned topic line for homework / chain (never a dangling "— Introduction & Theory"). */
function cleanTopicLabel(raw = "") {
  const t = softClip(String(raw || "").replace(/^[\s—–\-:·]+/, ""), 90);
  if (!t || /^(introduction|edge cases|theory|variants)\b/i.test(t) && t.length < 30) return "";
  return t;
}

/**
 * Wire the day together: every work cell says what it builds on and what it feeds,
 * Demonstrate lists the real deliverables, and the chain is kept for homework + tomorrow.
 */
function connectDayRows(rows = [], template = [], ctx = {}) {
  const chain = [];
  rows.forEach((r, i) => {
    const p = template[i] || {};
    const role = periodRole({ id: p.id, title: r[2] });
    if (/^(lunch|break|homework)$/.test(role) || /^(Lunch|Break)$/i.test(String(r[3] || "").trim())) return;
    chain.push({ i, role, title: String(r[2] || p.title || ""), deliverable: extractDeliverable(r[3]) });
  });

  chain.forEach((c, k) => {
    let text = String(rows[c.i][3] || "");
    if (c.role === "demonstrate") {
      if (!/Show today's deliverables/i.test(text) || /Show, don't tell/i.test(text) || thinRichContent(text)) {
        text = buildDemonstrateContent(ctx, chain);
      }
      rows[c.i][3] = text;
      return;
    }
    if (c.role === "standup") {
      if (!/Today's chain:/i.test(text)) {
        const flow = chain
          .filter((x) => x.role !== "standup")
          .map((x) => softClip(x.title, 28))
          .join(" → ");
        text = `${text}\n▶ Today's chain: ${flow} → Tonight's Homework`.trim();
      }
      rows[c.i][3] = text;
      return;
    }
    const prev = chain[k - 1];
    const next = chain[k + 1];
    const extra = [];
    if (!/▶\s*Builds on:/i.test(text)) {
      if (!prev || prev.role === "standup") {
        extra.push(`▶ Builds on: the problem statement + this morning's Stand-Up plan (TODAY line)`);
      } else {
        extra.push(
          `▶ Builds on: ${softClip(prev.title, 40)}${prev.deliverable ? ` — ${softClip(prev.deliverable, 90)}` : ""}`
        );
      }
    }
    if (!/▶\s*Feeds next:/i.test(text)) {
      extra.push(`▶ Feeds next: ${next ? softClip(next.title, 40) : "Tonight's Homework"}`);
    }
    if (extra.length) {
      const lines = text.split("\n");
      const di = lines.findIndex((l) => /Deliverable:/i.test(l));
      if (di >= 0) lines.splice(di, 0, ...extra);
      else lines.push(...extra);
      text = lines.join("\n").trim();
    }
    rows[c.i][3] = text;
  });

  return chain.map((c) => ({
    role: c.role,
    title: c.title,
    deliverable: extractDeliverable(rows[c.i][3]),
    agentName:
      c.role === "agent"
        ? softClip(String(rows[c.i][3] || "").match(/What agent to build[^:]*:\s*([^\n]+)/i)?.[1] || "", 70)
        : "",
  }));
}

/** Homework header: real problem + every deliverable from today to continue tonight. */
function homeworkChainHeader(ctx = {}, chain = []) {
  const problem = softClip(softProblem(ctx.inputs || {}), 140);
  const topic = cleanTopicLabel(todayTopic(ctx)) || "today's class topic";
  const carry = (chain || [])
    .filter((c) => c.deliverable && /agent|sysdesign|project|problem|learning|coding|okr/.test(c.role))
    .slice(0, 5)
    .map((c) => `  • ${softClip(c.title, 40)} → ${softClip(c.deliverable, 100)}`);
  return [
    `▶ Problem (short): ${problem}`,
    `▶ Learned today: ${topic}`,
    `▶ Continue tonight (from today's deliverables):`,
    ...(carry.length ? carry : [`  • Product Development → finish today's slice of ${softClip(todayBuildTask(ctx), 90)}`]),
    `▶ Connect: today's class → tonight's tasks below → tomorrow's Stand-Up DONE reads these back`,
  ].join("\n");
}

function pickCuratedLinks(topic = "", dayIdx = 0, inputs = {}) {
  const fallback = {
    youtube: "https://www.youtube.com/watch?v=_r0VX-aU_T8",
    article: "https://www.nngroup.com/articles/design-thinking/",
    dayIdx,
  };
  if (inputs && typeof inputs === "object") {
    if (!(inputs._seenResourceUrls instanceof Set)) {
      inputs._seenResourceUrls = new Set(
        Array.isArray(inputs._seenResourceUrls) ? inputs._seenResourceUrls : []
      );
    }
  }
  try {
    const { pickPoolVideo } = require("../data/youtubePool");
    const seen = inputs?._seenResourceUrls instanceof Set ? inputs._seenResourceUrls : null;
    const vid = pickPoolVideo(String(topic || "design thinking"), { seen, dayIdx });
    if (vid?.url) {
      const { curatedOrDefault } = require("../data/curatedLearningLinks");
      let article = vid.article || curatedOrDefault(topic)?.web?.url || fallback.article;
      if (/geeksforgeeks\.org\/\?s=|\/search\?/i.test(article)) article = fallback.article;
      if (seen) seen.add(vid.url);
      return { youtube: vid.url, youtubeTitle: `${vid.title} · ${vid.channel}`, article, dayIdx };
    }
  } catch (_) {
    /* fall through to curated pairs */
  }
  try {
    const { pickResourcesForTopic } = require("./learningResources");
    const {
      isWatchYoutubeStrict,
      DEFAULT_PAIR,
      curatedOrDefault,
    } = require("../data/curatedLearningLinks");
    const pack =
      pickResourcesForTopic(String(topic || "design thinking").trim(), "", null, {
        dayIdx,
        seenUrls: inputs?._seenResourceUrls instanceof Set ? inputs._seenResourceUrls : null,
      }) || curatedOrDefault(topic);
    let yt = String(pack?.youtube?.url || "").trim();
    let article = String(pack?.web?.url || "").trim();
    if (!isWatchYoutubeStrict(yt)) {
      yt = isWatchYoutubeStrict(DEFAULT_PAIR.youtube.url)
        ? DEFAULT_PAIR.youtube.url
        : fallback.youtube;
    }
    if (
      !article ||
      /geeksforgeeks\.org\/\?s=/i.test(article) ||
      /\/search\?/i.test(article) ||
      /youtube\.com\/results\?/i.test(article)
    ) {
      article = DEFAULT_PAIR.web?.url || fallback.article;
    }
    if (inputs?._seenResourceUrls instanceof Set) {
      if (yt) inputs._seenResourceUrls.add(yt);
      if (article) inputs._seenResourceUrls.add(article);
    }
    return { youtube: yt, article, dayIdx };
  } catch (_) {
    return fallback;
  }
}

/**
 * Learning: force-append YouTube watch?v= + real Article if missing.
 * Runs on every learning period (incl. "Learning / Theory").
 * When _requireLearningLinks=true, never skip.
 */
function ensureLearningProjectLinks(content, periodId, links, inputs = {}, titleHint = "") {
  const technical = isTechnicalResourcePeriod(periodId, titleHint);
  let text = String(content || "");

  // Strip banned search URLs from any cell (never leave them in saved content)
  text = text
    .replace(/https?:\/\/(?:www\.)?geeksforgeeks\.org\/\?s=[^\s)\]"']+/gi, "")
    .replace(/https?:\/\/(?:www\.)?youtube\.com\/results\?search_query=[^\s)\]"']+/gi, "")
    // Drop label-only lines left after stripping bad URLs
    .replace(/^[·•\s]*▶?\s*(YouTube|Article|Website|Video)\s*:\s*$/gim, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!technical) return text;

  // Explicit true → never skip. Explicit false → skip. Else default on for layout days.
  if (!requireLearningLinks(inputs)) return text;

  const assignedYt = String(links?.youtube || "");
  if (/youtube\.com\/watch\?v=[\w-]{11}/i.test(assignedYt)) {
    const { KNOWN_VIDEO_IDS } = require("../data/youtubePool");
    const seen = inputs?._seenResourceUrls instanceof Set ? inputs._seenResourceUrls : null;
    text = text.replace(
      /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})[^\s)\]"']*/gi,
      (url, id) => {
        if (url === assignedYt) return url;
        const canonical = `https://www.youtube.com/watch?v=${id}`;
        const repeated = seen && seen.has(canonical) && canonical !== assignedYt;
        return !KNOWN_VIDEO_IDS.has(id) || repeated ? assignedYt : url;
      }
    );
  }

  const ytUrl =
    links?.youtube && /youtube\.com\/watch\?v=[\w-]{11}/i.test(links.youtube)
      ? links.youtube
      : "https://www.youtube.com/watch?v=_r0VX-aU_T8";
  const articleUrl =
    links?.article &&
    !/geeksforgeeks\.org\/\?s=/i.test(links.article) &&
    !/\/search\?/i.test(links.article) &&
    !/youtube\.com/i.test(links.article)
      ? links.article
      : "https://www.freecodecamp.org/learn/";

  const hasYt = /https?:\/\/(?:www\.)?youtube\.com\/watch\?v=[\w-]{11}/i.test(text);
  const urls = text.match(/https?:\/\/[^\s)\]"']+/gi) || [];
  const hasGoodArticle = urls.some(
    (u) =>
      !/youtube\.com|youtu\.be/i.test(u) &&
      !/geeksforgeeks\.org\/\?s=/i.test(u) &&
      !/\/search\?/i.test(u)
  );

  // Normalize existing good lines to the required ▶ YouTube / ▶ Article labels
  if (hasYt && !/▶\s*YouTube:\s*https?:\/\/(?:www\.)?youtube\.com\/watch\?v=/i.test(text)) {
    const m = text.match(/https?:\/\/(?:www\.)?youtube\.com\/watch\?v=[\w-]{11}[^\s)\]"']*/i);
    if (m && !/YouTube:\s*$/i.test(text.slice(Math.max(0, text.indexOf(m[0]) - 12), text.indexOf(m[0])))) {
      /* keep URL; extras only if label missing entirely */
    }
  }

  const extras = [];
  if (!hasYt) extras.push(`▶ YouTube: ${ytUrl}`);
  if (!hasGoodArticle) extras.push(`▶ Article: ${articleUrl}`);
  if (!extras.length) {
    // Still ensure labels exist even when raw URLs are present without ▶ lines
    if (!/▶\s*YouTube:/i.test(text) && hasYt) {
      const m = text.match(/https?:\/\/(?:www\.)?youtube\.com\/watch\?v=[\w-]{11}[^\s)\]"']*/i);
      if (m) extras.push(`▶ YouTube: ${m[0]}`);
    }
    if (!/▶\s*Article:/i.test(text) && hasGoodArticle) {
      const art = urls.find(
        (u) =>
          !/youtube\.com|youtu\.be/i.test(u) &&
          !/geeksforgeeks\.org\/\?s=/i.test(u) &&
          !/\/search\?/i.test(u)
      );
      if (art) extras.push(`▶ Article: ${art}`);
    }
    if (!extras.length) return text;
  }

  // Prefer Deliverable (never invent Done when)
  text = text.replace(/(▶\s*)?Done when:/gi, "▶ Deliverable:");
  if (/Deliverable:/i.test(text)) {
    return text.replace(/(▶\s*)?Deliverable:/i, `${extras.join("\n")}\n▶ Deliverable:`);
  }
  return `${text}\n${extras.join("\n")}`.trim();
}

/** Ensure Project Build has Phase 1 DT Playbook labels (append missing only). */
function ensureProjectDtLabels(content, ctx = {}) {
  let text = String(content || "").trim().replace(/(▶\s*)?Done when:/gi, "▶ Deliverable:");
  const dt = ctx.dtStep || {};
  const problem = softClip(softProblem(ctx.inputs || {}), 120);
  const extras = [];
  if (dt.page != null && !/DT\s*Playbook\s*page\s*\d/i.test(text)) {
    text = `▶ DT Playbook page ${dt.page} — "${dt.step || "today's step"}"${dt.stage ? ` · ${dt.stage}` : ""} — take and fill the questions on this page\n${text}`.trim();
  }
  if (!/▶\s*Stage:/i.test(text)) extras.push(`▶ Stage: ${dt.stage || "Build"}`);
  if (!/▶\s*Step:/i.test(text)) extras.push(`▶ Step: ${dt.step || "Applied build"}`);
  if (!/What to Learn:/i.test(text)) {
    extras.push(`▶ What to Learn: ${softClip(dt.whatToLearn || "one skill needed for today's project step", 160)}`);
  }
  if (!/Real Project Task:/i.test(text)) {
    extras.push(
      `▶ Real Project Task: ${softClip(dt.realProjectTask || "one concrete deliverable on the problem", 180)}`
    );
  }
  if (!/Discussion Prompt:/i.test(text)) {
    extras.push(
      `▶ Discussion Prompt: ${softClip(dt.discussionPrompt || "What is the riskiest assumption today?", 140)}`
    );
  }
  if (!/Problem \(short\)|Problem Statement:/i.test(text)) {
    extras.push(`▶ Problem (short): ${problem}`);
  }
  if (!/Deliverable:/i.test(text)) {
    extras.push(`▶ Deliverable: notes/file proves today's Real Project Task.`);
  }
  if (!extras.length) return text;
  if (/Deliverable:/i.test(text) && extras.some((e) => !/Deliverable:/i.test(e))) {
    const withoutDone = extras.filter((e) => !/Deliverable:/i.test(e));
    return text.replace(/(▶\s*)?Deliverable:/i, `${withoutDone.join("\n")}\n▶ Deliverable:`);
  }
  return `${text}\n${extras.join("\n")}`.trim();
}

function buildContentFillPrompt(dayKey, template, ctx = {}) {
  const inputs = ctx.inputs || {};
  const theme = ctx.theme || {};
  const dtStep = ctx.dtStep || null;
  const daySlice = ctx.daySlice || null;
  const dayIdx = ctx.dayIdx || 0;
  const problem = softProblem(inputs);
  const subjects = (daySlice?.allSubjects || theme.subjects || [])
    .slice(0, 4)
    .map((s) => `${s.name}: ${s.topic || s.name}`)
    .join(" · ");
  const topicHint =
    (daySlice?.primarySubject?.topic ||
      daySlice?.primarySubject?.name ||
      dtStep?.step ||
      theme.project ||
      "design thinking") + "";
  const links = pickCuratedLinks(topicHint, dayIdx, inputs);

  const mapHit = dtStep && dtStep.fromDtPlaybookMap;
  const dtLine = dtStep
    ? `DT STAGE FOR THIS DAY${mapHit ? " (from _dtPlaybookMap — honour this Stage, do not replace with generic Empathize)" : ""}: ${dtStep.stage} → "${dtStep.step}"` +
      (dtStep.playbookWorkingDay ? ` (playbook day ${dtStep.playbookWorkingDay})` : "") +
      `\n` +
      (dtStep.page != null
        ? `DT Playbook page ${dtStep.page} — Project Build / Problem Review must start with "▶ DT Playbook page ${dtStep.page} — \\"${dtStep.step}\\"".\n`
        : "") +
      `Stage goal: ${softClip(dtStep.stageGoal || dtStep.productGoal || "", 200)}\n` +
      (dtStep.whatToLearn ? `What to Learn: ${softClip(dtStep.whatToLearn, 220)}\n` : "") +
      (dtStep.realProjectTask
        ? `Real Project Task: ${softClip(dtStep.realProjectTask, 220)}\n`
        : "") +
      (dtStep.discussionPrompt
        ? `Discussion Prompt: ${softClip(dtStep.discussionPrompt, 180)}\n`
        : "") +
      (inputs._productStageBlock
        ? `Product stage block: ${softClip(String(inputs._productStageBlock), 200)}\n`
        : "")
    : `DT STAGE: applied build on the existing project\n` +
      (inputs._dtPlaybookMap
        ? `WARNING: _dtPlaybookMap is present but no row for this day — still avoid inventing a generic empathize-only plan.\n`
        : "");
  const skipSd = truthyFlag(inputs._skipSystemDesign);
  const skipDsa = truthyFlag(inputs._skipDsa);
  const phase2 = isPhase2(inputs);
  const snsAgent = snsAgentWorkbenchOn(inputs);
  const must = forceApplyOn(inputs) ? mustApplyPromptSection(inputs) : "";

  // Exact title + clock from template — same every day (day list + week table)
  const slots = template.map((p) => ({
    order: p.order,
    id: p.id,
    role: periodRole(p),
    title: p.title,
    clock: p.clock,
    notes: p.notes || "",
  }));

  const phaseBanner = phase2
    ? `\nCOHORT PHASE 2` +
      (snsAgent ? ` · SNS Agent Workbench ON (_snsAgentWorkbench=true)` : "") +
      `.\n` +
      `Keep the SAME row shape and template titles/clocks as Phase 1.\n`
    : `\nCOHORT PHASE 1 style content (template layout).\n`;

  const agentRules =
    phase2 && snsAgent
      ? `- Agent / AI Agent Builder (id agent): EVERY day this cell is SNS Agent Workbench for THEIR problem.\n` +
        `  Required labels: Problem (short) · What agent to build (n8n-style) · Workflow steps · How it helps their problem · Deliverable.\n` +
        `  FORBIDDEN in Agent cells: OKRion, OKR, LinkedIn, certification text. Those belong in an OKR / OKRion cell only.\n`
      : `- Agent: workbench automation on THEIR problem — Problem (short) + Deliverable. Never OKRion.\n`;

  return (
    `Fill ONLY the Content cell for each FIXED period. Same format as Phase 1 good plans.\n` +
    `Row shape: [dayKey, time, activity, content] — e.g. ["${dayKey}","9:00–9:15 AM IST","Stand-Up","…"].\n` +
    `Titles and clocks are FIXED from _dayTemplate — identical every day. Do not rename or shuffle.\n` +
    `If you invent different names/times than the template, the day list and week table will break.\n` +
    phaseBanner +
    `\nNever invent periods that are not in FIXED PERIODS. Fill each period by its "role" (the title wins over the old id).\n` +
    `If the template itself has OKR / Presentation / Demonstrate / Meditation periods, fill them richly (rules below) — never one line.\n` +
    `FORBIDDEN in Agent cells: any OKRion / LinkedIn / certification wording.\n` +
    `ONE row → ONE content cell.\n` +
    `Use "Deliverable:" — never "Done when:".\n` +
    `Every Learning / System Design / Project / Coding / Agent cell MUST include "▶ Problem (short): …".\n\n` +
    `Day: ${dayKey}\n` +
    `${dtLine}` +
    `Problem: ${problem}\n` +
    (subjects ? `Today's subjects: ${subjects}\n` : "") +
    `Project: ${softClip(theme.project || "", 120)}\n` +
    `Tech: ${softClip(theme.tech || "", 80)}\n` +
    (skipSd ? `System Design module: OFF — project-related work only in that slot.\n` : "") +
    (skipDsa ? `DSA module: OFF — coding slots are project practice only.\n` : "") +
    `\nUSE THESE REAL LINKS in Learning, Project Build, Coding, System Design, and Agent (required):\n` +
    `- YouTube (exact form): ${links.youtube}\n` +
    `- Article (real page, NOT geeksforgeeks.org/?s=): ${links.article}\n` +
    `Never copy Agent / Stand-Up / Break text into another period.\n\n` +
    `FIXED PERIODS (copy these titles + clocks exactly):\n` +
    `${JSON.stringify(slots, null, 2)}\n\n` +
    `CONTENT BY PERIOD (▶ bullets; keep these exact labels):\n` +
    `- Stand-Up: DONE / TODAY / STUCK. Day 1 DONE = "none yet" + one-line problem. Always include Deliverable.\n` +
    `- Learning: Problem (short) · Concept · Why · Do this · YouTube · Article · Deliverable.\n` +
    `- System Design: Problem (short) · Do this — draw the ONE box · Deliverable = diagram.\n` +
    `- Project Build: Problem (short) · Stage · Step · What to Learn · Real Project Task · Do this · Deliverable.\n` +
    `- Coding: Problem (short) · same topic as Learning · Deliverable.\n` +
    `- role okr (OKRion): Problem (short) · Objective (this week) · Key Result today tied to today's build · OKRion update with proof link · LinkedIn / cert task · Deliverable. Never the Agent Workbench.\n` +
    `- role presentation: Problem (short) · Presentation topic · 4 slides (problem / learned today / built today / next step + question) · Speak rule · Deliverable.\n` +
    `- role demonstrate: Problem (short) · list every deliverable from today's earlier periods to show · mentor checks · Deliverable.\n` +
    `- role standup (Meditation + Self Introduction too): DONE = yesterday's deliverables · TODAY · STUCK · Deliverable.\n` +
    `- CONNECTIVITY: Problem → Learn topic → System Design box → Agent workflow → Build/tool → Deliverable. Each period's Deliverable is used by the NEXT period — say so.\n` +
    `- Every non-break cell: at least 5 ▶ lines, concrete to THIS problem. No generic one-liners.\n` +
    `- Homework (if asked): LeetCode + Agent Workbench (continue today's workbench slice) + Case. LinkedIn/cert = OKRion only.\n` +
    agentRules +
    `- Problem Review: 3–5 sentences on today's problem slice + Deliverable.\n` +
    `- Coding / Placement / Speak / Mini Build / Retro: concrete task + Deliverable.\n` +
    `- Lunch / Break: write ONLY the word Lunch or Break. No tasks, no hydrate, no bullets.\n` +
    `YouTube MUST be https://www.youtube.com/watch?v=... — never search URLs or fake links.\n` +
    `Never empty / TBD / "today's concept". Never invent extra periods.\n\n` +
    (must ? `MUST APPLY (wins last if present; if empty invent nothing):\n${must}\n` : "") +
    `Return ONLY valid JSON:\n` +
    `{"contents":[{"id":"standup","content":["▶ DONE: …","▶ TODAY: …","▶ STUCK: …","▶ Deliverable: …"]},{"id":"learning","content":["▶ Problem (short): …","▶ Concept: …","▶ Why: …","▶ YouTube: ${links.youtube}","▶ Article: ${links.article}","▶ Deliverable: …"]},{"id":"project","content":["▶ Problem (short): …","▶ Stage: …","▶ Step: …","▶ What to Learn: …","▶ Real Project Task: …","▶ Deliverable: …"]},{"id":"agent","content":["▶ Problem (short): …","▶ What agent to build (n8n-style): …","▶ Workflow steps: …","▶ How it helps their problem: …","▶ Deliverable: …"]}]}\n` +
    `Include EVERY period id from FIXED PERIODS. No times in the response.\n`
  );
}

function mapContentsById(parsed, template) {
  const byId = {};
  const list = Array.isArray(parsed?.contents)
    ? parsed.contents
    : Array.isArray(parsed?.slots)
      ? parsed.slots
      : Array.isArray(parsed)
        ? parsed
        : [];
  list.forEach((item, i) => {
    if (!item || typeof item !== "object") return;
    const id = trimText(item.id) || template[i]?.id || "";
    if (!id) return;
    byId[id] = contentToText(item.content != null ? item.content : item.text);
  });
  return byId;
}

async function fillOneSlotWithLLM(dayKey, period, ctx = {}) {
  const inputs = ctx.inputs || {};
  const role = periodRole(period);
  if (role === "okr") return buildOkrContent({ ...ctx, dayKey });
  if (role === "presentation") return buildPresentationContent({ ...ctx, dayKey });
  if (role === "demonstrate") return buildDemonstrateContent({ ...ctx, dayKey });
  if (role === "standup") return buildConnectedStandUp({ ...ctx, dayKey });
  if (role === "placement") return buildPlacementContent({ ...ctx, dayKey });
  const problem = softProblem(inputs);
  const dtStep = ctx.dtStep || null;
  const links = pickCuratedLinks(
    dtStep?.step || period.title || "design thinking",
    ctx.dayIdx || 0,
    inputs
  );
  const id = String(period.id || "").toLowerCase();
  const needsRichDt = /learn|project|problem/i.test(id) || isTechnicalResourcePeriod(period);
  const linkHint =
    `Include ▶ YouTube: ${links.youtube} and ▶ Article: ${links.article} in this cell.\n`;
  const prompt =
    `Fill Task / Content for ONE schedule slot. Same format as the first good plans.\n` +
    `Title and clock are FIXED: "${period.title}" @ ${period.clock}. One cell only — do not merge other activities.\n` +
    `Never invent Meditation, OKR, Presentation Topic, or Student Should Demonstrate.\n` +
    `Never copy Agent / Stand-Up / Break text into this slot.\n` +
    `Day: ${dayKey}\n` +
    `Slot id=${period.id}\n` +
    `Problem: ${problem}\n` +
    (dtStep
      ? `Stage: ${dtStep.stage}\nStep: ${dtStep.step}\n` +
        (dtStep.page != null ? `DT Playbook page: ${dtStep.page}\n` : "") +
        (dtStep.whatToLearn ? `What to Learn: ${softClip(dtStep.whatToLearn, 200)}\n` : "") +
        (dtStep.realProjectTask
          ? `Real Project Task: ${softClip(dtStep.realProjectTask, 200)}\n`
          : "") +
        (dtStep.discussionPrompt
          ? `Discussion Prompt: ${softClip(dtStep.discussionPrompt, 160)}\n`
          : "")
      : "") +
    (period.notes ? `Activity notes: ${period.notes}\n` : "") +
    (isAgentPeriod(period) && snsAgentWorkbenchOn(inputs)
      ? `SNS Agent Workbench on THEIR problem — required labels:\n` +
        `Problem (short) · What agent to build (n8n-style) · Workflow steps · How it helps their problem · Deliverable.\n` +
        `FORBIDDEN: OKRion / OKR / LinkedIn / certification. NOT generic AI talk. Never leave this cell empty.\n` +
        linkHint
      : isLearningPeriod(period)
        ? `Learning: Problem (short) · Concept · Why · Outcome · YouTube · Article · Deliverable.\n` +
          linkHint +
          (requireLearningLinks(inputs)
            ? `_requireLearningLinks=true — both links are mandatory; no geeksforgeeks.org/?s= or YT search URLs.\n`
            : "")
        : isProjectPeriod(period)
          ? `Project Build DT labels:\n` +
            `Problem (short) · Stage · Step · What to Learn · Real Project Task · Discussion Prompt · Deliverable.\n` +
            linkHint
          : isCodingPeriod(period)
            ? `Coding / DSA: Problem (short) · one named practice problem · Deliverable.\n` + linkHint
            : isSysDesignPeriod(period)
              ? `System Design: Problem (short) · one component + diagram · Deliverable.\n` + linkHint
              : needsRichDt
                ? `Concrete task for "${period.title}" + Problem (short) + Deliverable.\n` + linkHint
                : /standup/i.test(id)
                  ? `Stand-Up only: DONE / TODAY / STUCK · Deliverable.\n`
                  : /lunch/i.test(id)
                    ? `Return only the word Lunch.\n`
                    : /break/i.test(id)
                      ? `Return only the word Break.\n`
                  : /game/i.test(id)
                    ? `One short rest line only.\n`
                    : `Concrete task + Done when. Never Agent / Meditation / OKR text.\n`) +
    `Return ONLY JSON: {"content":["▶ …"]}\n` +
    `Never empty / TBD / today's concept.\n`;
  try {
    const parsed = await callLLM(prompt, 1400);
    let text = contentToText(parsed?.content);
    if (text && !contentMatchesPeriod(period, text)) {
      text = "";
    }
    if (text && !isEmptyContent(text)) {
      text = ensureLearningProjectLinks(text, period, links, inputs, period.title);
      if (isProjectPeriod(period)) {
        text = ensureProjectDtLabels(text, ctx);
      }
      if (isAgentPeriod(period) && snsAgentWorkbenchOn(inputs) && looksLikeGenericAgentTalk(text)) {
        text = buildPhase2AgentContent(ctx);
        text = ensureLearningProjectLinks(text, period, links, inputs, period.title);
      }
      return text;
    }
  } catch (e) {
    console.warn(`Slot retry LLM failed (${period.id}):`, e.message);
  }
  return "";
}

/**
 * LLM ALWAYS fills column 4. Titles/clocks stay from _dayTemplate.
 * Retry empty slots; only append missing Learning/Project links — never strip DT blocks.
 */
async function fillDayContentWithLLM(dayKey, template, ctx = {}) {
  const inputs = ctx.inputs || {};
  const rows = buildSkeletonDayRows(dayKey, template, inputs);
  const topicHint =
    ctx.dtStep?.step ||
    ctx.daySlice?.primarySubject?.topic ||
    ctx.theme?.project ||
    "design thinking";
  const links = pickCuratedLinks(topicHint, ctx.dayIdx || 0, inputs);
  let byId = {};

  // Always call the model — never skip
  try {
    const prompt = buildContentFillPrompt(dayKey, template, ctx);
    const parsed = await callLLM(prompt, 5500);
    byId = mapContentsById(parsed, template);
  } catch (e) {
    console.warn(`Day content LLM failed (${dayKey}):`, e.message);
  }

  for (let i = 0; i < template.length; i++) {
    const p = template[i];
    // Always use template title + clock (same every day)
    rows[i][1] = p.clock;
    rows[i][2] = p.title;

    let content = byId[p.id] || "";
    // Reject Agent / Meditation / OKR paste into the wrong slot
    if (content && !contentMatchesPeriod(p, content)) {
      content = "";
    }

    if (isEmptyContent(content)) {
      content = await fillOneSlotWithLLM(dayKey, p, ctx);
      if (content && !contentMatchesPeriod(p, content)) content = "";
    }
    if (isEmptyContent(content) && p.notes && !isEmptyContent(p.notes) && contentMatchesPeriod(p, p.notes)) {
      content = p.notes;
    }
    if (isEmptyContent(content)) {
      content = await fillOneSlotWithLLM(dayKey, p, ctx);
      if (content && !contentMatchesPeriod(p, content)) content = "";
    }
    if (isEmptyContent(content)) {
      const id = String(p.id || "").toLowerCase();
      if (isAgentPeriod(p) && snsAgentWorkbenchOn(inputs)) {
        content = buildPhase2AgentContent(ctx);
      } else if (/lunch/i.test(id) || /lunch/i.test(p.title || "")) {
        content = "Lunch";
      } else if (/break/i.test(id) || /\bbreak\b/i.test(p.title || "")) {
        content = "Break";
      } else if (/game|refresh/i.test(id) || /game|refresh/i.test(p.title || "")) {
        content = `▶ ${p.title}: short rest — hydrate / stretch. No task dump.`;
      } else if (/standup/i.test(id) || /stand[\s-]?up/i.test(p.title || "")) {
        content = buildPhase2Guide("standup", ctx) ||
          `▶ DONE: yesterday's progress on the problem\n` +
          `▶ TODAY: next slice of ${softProblem(inputs)}\n` +
          `▶ STUCK: (or "none")`;
      } else if (isLearningPeriod(p)) {
        content =
          (buildPhase2Guide("learning", ctx) ||
            `▶ Concept: ${softClip(topicHint, 80)}\n` +
            `▶ Why: helps the next step on ${softProblem(inputs)}\n` +
            `▶ Outcome: explain the concept and apply one idea to the problem\n` +
            `▶ Done when: notes show Concept + Why + Outcome.`) +
          `\n▶ YouTube: ${links.youtube}\n▶ Article: ${links.article}`;
      } else if (periodRole(p) === "problem") {
        content = buildPhase2Guide("dtpage", ctx);
      } else if (isProjectPeriod(p)) {
        content = buildPhase2Guide("project", ctx) || ensureProjectDtLabels("", ctx);
      } else if (isCodingPeriod(p)) {
        content =
          (buildPhase2Guide("coding", ctx) ||
            `▶ Practice: one named problem on today's topic\n▶ Done when: solution + 2-line note.`) +
          `\n▶ YouTube: ${links.youtube}\n▶ Article: ${links.article}`;
      } else if (isSysDesignPeriod(p)) {
        content =
          (buildPhase2Guide("sysdesign", ctx) ||
            `▶ Component: one part of the system for today's problem\n▶ Done when: diagram saved.`) +
          `\n▶ YouTube: ${links.youtube}\n▶ Article: ${links.article}`;
      } else {
        content = buildGenericSlotContent(p, ctx);
      }
    }

    const role = periodRole(p);
    content = stripMarkdown(content);
    if (role === "standup") {
      if (isDay1(ctx)) {
        // Day 1: DONE = none yet + the problem (never blank / generic)
        if (
          isEmptyContent(content) ||
          !/none yet|day\s*1/i.test(content) ||
          !/▶\s*DONE:/i.test(content) ||
          thinRichContent(content)
        ) {
          content = buildDay1StandUp(ctx);
        }
      } else if (
        isEmptyContent(content) ||
        /none yet/i.test(content) ||
        !/▶\s*DONE/i.test(content) ||
        (inputs._prevDayChain && !/Homework check/i.test(content)) ||
        thinRichContent(content)
      ) {
        content = buildConnectedStandUp(ctx);
      }
    } else if (role === "okr") {
      if (
        thinRichContent(content) ||
        !/okrion|key result/i.test(content) ||
        /what agent to build|workflow steps/i.test(content)
      ) {
        content = buildOkrContent(ctx);
      }
    } else if (role === "presentation") {
      if (thinRichContent(content)) content = buildPresentationContent(ctx);
    } else if (role === "demonstrate") {
      if (thinRichContent(content)) content = buildDemonstrateContent(ctx);
    } else if (role === "placement") {
      if (thinRichContent(content)) content = buildPlacementContent(ctx);
    }

    // Phase 2 (and weak cells): enforce do-this chain Learn → SD → tool → Deliverable
    const wantChain = isPhase2(inputs) || truthyFlag(inputs._useActivityLayout);
    if (wantChain && !isAgentPeriod(p)) {
      if (isLearningPeriod(p) && weakForRole("learning", content)) {
        content = buildPhase2Guide("learning", ctx);
      } else if (isSysDesignPeriod(p) && weakForRole("sysdesign", content)) {
        content = buildPhase2Guide("sysdesign", ctx);
      } else if (role === "problem" && (weakForRole("problem", content) || /tool time|open the repo/i.test(content))) {
        content = buildPhase2Guide("dtpage", ctx);
      } else if (isProjectPeriod(p) && weakForRole("project", content)) {
        content = buildPhase2Guide("project", ctx);
      } else if (isCodingPeriod(p) && weakForRole("coding", content)) {
        content = buildPhase2Guide("coding", ctx);
      }
    }

    // Agent / AI Agent Builder → SNS Agent Workbench; never leave empty / never OKR
    if (isAgentPeriod(p) && snsAgentWorkbenchOn(inputs)) {
      if (
        isEmptyContent(content) ||
        looksLikeGenericAgentTalk(content) ||
        !contentMatchesPeriod(p, content) ||
        weakForRole("agent", content)
      ) {
        content = buildPhase2AgentContent(ctx);
      }
    }

    // Learning / Project / Coding / System Design / Agent → YouTube + Article
    const periodLinks = isTechnicalResourcePeriod(p, p.title)
      ? pickCuratedLinks(linkTopicForRole(role, ctx, topicHint, p), ctx.dayIdx || 0, inputs)
      : links;
    content = ensureLearningProjectLinks(content, p, periodLinks, inputs, p.title);
    if (isProjectPeriod(p)) {
      content = ensureProjectDtLabels(content, ctx);
    }
    // Final guard: agent cell never blank; never keep foreign Agent paste elsewhere
    if (isAgentPeriod(p) && isEmptyContent(content)) {
      content = buildPhase2AgentContent(ctx);
      content = ensureLearningProjectLinks(content, p, periodLinks, inputs, p.title);
    }
    if (!isAgentPeriod(p) && guessContentFamily(content) === "agent") {
      content = "";
      content = await fillOneSlotWithLLM(dayKey, p, ctx);
      if (isEmptyContent(content) || !contentMatchesPeriod(p, content)) {
        if (isLearningPeriod(p)) content = buildPhase2Guide("learning", ctx);
        else if (isSysDesignPeriod(p)) content = buildPhase2Guide("sysdesign", ctx);
        else if (isProjectPeriod(p)) content = buildPhase2Guide("project", ctx);
        else {
          content = buildGenericSlotContent(p, ctx);
        }
        content = ensureLearningProjectLinks(content, p, periodLinks, inputs, p.title);
      }
    }

    // Normalize: Deliverable not Done when; Problem (short) on technical cells
    content = String(content || "").replace(/(▶\s*)?Done when:/gi, "▶ Deliverable:");
    if (isTechnicalResourcePeriod(p, p.title) && !/lunch|break/i.test(String(p.id || p.title || ""))) {
      if (!/Problem \(short\)/i.test(content)) {
        const shortP = softClip(softProblem(inputs), 120);
        content = `▶ Problem (short): ${shortP}\n${content}`.trim();
      }
      if (!/Deliverable:/i.test(content)) {
        content = `${content}\n▶ Deliverable: notes prove today's task.`.trim();
      }
      // Agent cells must never carry OKRion / LinkedIn / cert wording
      if (isAgentPeriod(p) && /okrion|linkedin|certificat/i.test(content)) {
        content = buildPhase2AgentContent(ctx);
        content = ensureLearningProjectLinks(content, p, periodLinks, inputs, p.title);
      }
    }

    if (role === "lunch") content = "Lunch";
    else if (role === "break") content = "Break";
    else if (/Problem \(short\):/i.test(content)) {
      // One consistent problem line across the day (the model rewords it per cell)
      const shortP = softClip(softProblem(inputs), 120);
      content = content.replace(/^(▶\s*)?Problem \(short\):[^\n]*/im, `▶ Problem (short): ${shortP}`);
    }
    rows[i][3] = content;
  }

  // First hour must never be blank — especially Week 1 Day 1 Stand-Up
  const firstEmpty = rows[0] && isEmptyContent(rows[0][3]);
  const day1StandupWeak =
    rows[0] &&
    isDay1({ ...ctx, dayKey }) &&
    /stand[\s-]?up/i.test(String(rows[0][2] || "")) &&
    !/none yet/i.test(String(rows[0][3] || ""));
  if (firstEmpty || day1StandupWeak) {
    const first = template[0] || {};
    const isSu =
      /standup/i.test(String(first.id || "")) ||
      /stand[\s-]?up/i.test(String(first.title || rows[0][2] || ""));
    if (isSu) {
      rows[0][3] = isDay1({ ...ctx, dayKey })
        ? buildDay1StandUp({ ...ctx, dayKey })
        : buildPhase2Guide("standup", { ...ctx, dayKey });
    } else if (firstEmpty) {
      rows[0][3] =
        buildPhase2Guide("learning", ctx) ||
        `▶ TODAY: ${softClip(todayTopic(ctx), 80)} on ${softProblem(inputs)}\n` +
          `▶ Deliverable: say the problem + today's first task.`;
    }
  }

  return rows;
}

function looksLikeOriginalHomework(content = "") {
  return /^(LeetCode|Exercism|LinkedIn|Agent Workbench|Case study)\b/im.test(
    String(content || "")
  );
}

/** Original Tonight's Homework: LeetCode + Agent/LinkedIn + Case study (dayGapGenerator). */
function buildOriginalHomework(dayKey, dayRows = [], ctx = {}) {
  const inputs = ctx.inputs || {};
  let topic = "";
  try {
    topic = cleanTopicLabel(todayTopic({ ...ctx, dayKey }));
  } catch (_) {
    topic = "";
  }
  if (!topic) {
    const learn = (dayRows || []).find((r) => /learning|concept|theory/i.test(String(r?.[2] || "")));
    topic =
      String(learn?.[3] || "").match(/▶\s*(?:Concept|What to Learn|Heading):\s*([^\n]+)/i)?.[1] ||
      "today's topic";
  }
  try {
    const { homeworkBlock } = require("./dayGapGenerator");
    const body = homeworkBlock({
      picks: ctx.picks || {},
      gap: ctx.theme || ctx.gap || { learnTopic: topic },
      learnLabel: topic,
      agentNotes: "",
      sysContent: "",
      dayIdx: ctx.dayIdx || ctx.globalDayIndex || 0,
      inputs,
      problemFirst: false,
      skipDsa: truthyFlag(inputs._skipDsa),
      skipSd: truthyFlag(inputs._skipSystemDesign),
      skipBanks: truthyFlag(inputs._skipAssessmentBanks),
      dayKey,
      member: ctx.member || null,
      memberIdx: ctx.memberIdx || 0,
      daySlice: ctx.daySlice || null,
      themeDsa: (ctx.theme && ctx.theme.dsa) || "",
    });
    if (looksLikeOriginalHomework(body)) return body;
  } catch (_) {
    /* fall through */
  }
  return buildConnectedHomework({ ...ctx, dayKey });
}

async function appendHomeworkRow(dayKey, dayRows, ctx = {}) {
  const inputs = ctx.inputs || {};
  const withoutHw = (dayRows || []).filter(
    (r) => !/homework/i.test(String(r?.[2] || ""))
  );
  const existing = (dayRows || []).find((r) => /homework/i.test(String(r?.[2] || "")));
  let content = String(existing?.[3] || "").trim();
  if (!looksLikeOriginalHomework(content)) {
    content = buildOriginalHomework(dayKey, withoutHw, ctx);
  }
  if (!/Continue tonight \(from today's deliverables\)/i.test(content)) {
    // The header carries the clean "Learned today" line
    content = content
      .split("\n")
      .filter((l) => !/^\s*(▶\s*)?Learned today:/i.test(l))
      .join("\n");
    content = `${homeworkChainHeader({ ...ctx, dayKey }, ctx.dayChain || [])}\n${content}`.trim();
  }
  const firstDay = !Number(ctx.dayIdx || ctx.globalDayIndex || 0);
  const story = /^\s*(▶\s*)?(Objective:|Outcome:|Purpose tonight|Tasks \(max 3\))/i;
  const profile = /^\s*(▶\s*)?((Pace|Career objective|Career outcome|Career)\b[^:]*:|End each task with)/i;
  const parts = content.split(/\n\n/);
  parts[0] = parts[0]
    .split("\n")
    .filter((l) => !story.test(l) && (firstDay || !profile.test(l)))
    .join("\n");
  content = parts
    .filter((p) => p.trim())
    .join("\n\n")
    .replace(/(^|[“"(]|:\s+)Problem Statement:\s*/gim, "$1");
  const todayAgent = (ctx.dayChain || []).find((c) => c.role === "agent" && c.agentName);
  if (todayAgent) {
    const block = [
      `Agent Workbench`,
      `${todayAgent.agentName} (Easy) — continue today's workbench slice`,
      `Problem (short): ${softClip(softProblem(inputs), 110)}`,
      `Do this: 1) re-run today's workflow with 2 new real inputs  2) fix the step that failed or felt manual  3) write 2 lines on what the output tells you about the problem`,
      `Deliverable: ${softClip(todayAgent.deliverable || "workflow output saved", 120)} + 2 new runs logged`,
      `Apply: 1 line — how this output feeds tomorrow's DT Playbook page and Stand-Up DONE.`,
    ].join("\n");
    content = /(^|\n)Agent Workbench\n/.test(content)
      ? content.replace(/(^|\n)Agent Workbench\n[\s\S]*?(?=\n\n|$)/, `$1${block}`)
      : content;
  }
  const row = [dayKey, "Tonight", "Tonight's Homework", content];
  return applyHomeworkOverridesToDailyRows([...withoutHw, row], inputs);
}

/**
 * Build one working day from template: skeleton → LLM content → homework.
 */
async function generateTemplateDayRows(dayKey, template, ctx = {}) {
  const inputs = ctx.inputs || {};
  if (Number(ctx.dayIdx) === 0) delete inputs._prevDayChain;
  const dayCtx = { ...ctx, dayKey };
  const timed = await fillDayContentWithLLM(dayKey, template, dayCtx);
  const chain = connectDayRows(timed, template, dayCtx);
  const rows = await appendHomeworkRow(dayKey, timed, { ...dayCtx, dayChain: chain });
  const hw = rows.find((r) => /homework/i.test(String(r?.[2] || "")));
  const hwTasks = String(hw?.[3] || "")
    .split("\n")
    .filter((l) => /^(LeetCode|Exercism|LinkedIn|Agent Workbench|Case study)\b/i.test(l.trim()))
    .map((l) => l.trim());
  inputs._prevDayChain = {
    dayKey,
    chain,
    homework: hwTasks.length ? `${hwTasks.join(" + ")} from last night` : "",
  };
  return rows;
}

module.exports = {
  buildOriginalHomework,
  looksLikeOriginalHomework,
  useActivityLayout,
  parseDayTemplate,
  normalizeDayTemplate,
  patchTemplateWithMustApply,
  buildSkeletonDayRows,
  fillDayContentWithLLM,
  generateTemplateDayRows,
  appendHomeworkRow,
  buildConnectedHomework,
  buildDay1StandUp,
  buildPhase2Guide,
  ensureLearningProjectLinks,
  isLearningPeriod,
  isTechnicalResourcePeriod,
  contentMatchesPeriod,
  requireLearningLinks,
  pickCuratedLinks,
  softProblem,
  isDay1,
};
