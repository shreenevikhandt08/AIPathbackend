const axios = require("axios");
const { callLLM } = require("./llm");

const ONLINE_MODEL = "openai/gpt-4o-mini:online";

function hasContent(s) {
  return String(s || "").trim().length >= 40;
}

async function callOnlineJson(prompt, maxTokens = 2200) {
  const clampedTokens = Math.min(maxTokens, 4096);
  const response = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      model: "openai/gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: clampedTokens,
    },
    // {
    //   model: ONLINE_MODEL,
    //   messages: [{ role: "user", content: prompt }],
    //   temperature: 0.35,
    //   max_tokens: maxTokens,
    // },
    {
      headers: {
        Authorization: "Bearer " + process.env.OPENROUTER_API_KEY,
        "Content-Type": "application/json",
      },
      timeout: 45001,
    }
  );

  const raw = response.data.choices?.[0]?.message?.content || "";
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const match = cleaned.match(/(\{[\s\S]*\})/);
  return JSON.parse(match ? match[1] : cleaned);
}

function buildEnrichPrompt(problem, needDsa, needSd, totalWeeks) {
  return `
You are a curriculum RAG assistant for student engineering projects.

PROBLEM / PROJECT STATEMENT:
"""
${String(problem || "").slice(0, 3500)}
"""

Search the web (and use current best practices) for DSA patterns and System Design topics that a college team would need to BUILD this exact problem — not a generic interview dump.

Program length: ~${totalWeeks} weeks of working days.

Return ONLY valid JSON:
{
  "dsaSyllabus": ${needDsa ? `"<detailed week-ready DSA syllabus: topics, subtopics, why each maps to THIS problem, suggested practice patterns. Min 800 chars.>"` : `null`},
  "systemDesign": ${needSd ? `"<detailed System Design syllabus: components, APIs, data model, scaling, diagrams to draw — all grounded in THIS problem. Min 800 chars.>"` : `null`},
  "sources": ["short source or concept references you used"],
  "isLive": true
}

Rules:
- Ground every topic in entities/flows from the problem statement (name them).
- Prefer practical build topics over trivia.
- If web search is thin, still invent a strong curriculum from the problem — never return empty strings for requested fields.
`.trim();
}

function buildOfflinePrompt(problem, needDsa, needSd, totalWeeks) {
  return `
Derive a DSA + System Design curriculum for this student project (offline — no web).

PROBLEM:
"""
${String(problem || "").slice(0, 3500)}
"""

Weeks: ~${totalWeeks}

Return ONLY JSON:
{
  "dsaSyllabus": ${needDsa ? `"<detailed DSA syllabus grounded in THIS problem, min 800 chars>"` : `null`},
  "systemDesign": ${needSd ? `"<detailed System Design syllabus grounded in THIS problem, min 800 chars>"` : `null`},
  "sources": ["derived from problem statement"],
  "isLive": false
}
`.trim();
}

function toText(v) {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join("\n");
  if (typeof v === "object") return JSON.stringify(v, null, 2);
  return String(v);
}

/**
 * Enrich inputs in-place: fill missing dsaSyllabus / systemDesign from RAG.
 * Returns { enriched, meta }.
 */
function truthyFlag(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

async function enrichMissingDsaSd(inputs = {}, totalWeeks = 8) {
  const problem = String(inputs.problem || "").trim();
  if (!problem) {
    return { enriched: inputs, meta: { skipped: true, reason: "no problem" } };
  }

  // Respect Include toggles from Inputs — never invent content the student turned OFF
  const skipDsa = truthyFlag(inputs._skipDsa);
  const skipSd = truthyFlag(inputs._skipSystemDesign);

  const needDsa = !skipDsa && !hasContent(inputs.dsaSyllabus);
  const needSd = !skipSd && !hasContent(inputs.systemDesign);
  if (!needDsa && !needSd) {
    return {
      enriched: inputs,
      meta: {
        skipped: true,
        reason: skipDsa || skipSd ? "skip flags / present" : "both present",
        skipDsa,
        skipSd,
      },
    };
  }

  console.log(
    `🌐 RAG enrich DSA/SD from problem (needDsa=${needDsa}, needSd=${needSd}, weeks=${totalWeeks})`
  );

  let parsed = null;
  let mode = "online";
  try {
    parsed = await callOnlineJson(buildEnrichPrompt(problem, needDsa, needSd, totalWeeks));
  } catch (err) {
    console.warn("Online RAG DSA/SD failed, falling back offline:", err.message);
    mode = "offline";
    try {
      parsed = await callLLM(buildOfflinePrompt(problem, needDsa, needSd, totalWeeks), 2500);
    } catch (err2) {
      console.warn("Offline DSA/SD enrich failed:", err2.message);
      parsed = null;
    }
  }

  const next = { ...inputs };
  const filled = { dsa: false, systemDesign: false, mode, sources: [] };

  if (parsed && typeof parsed === "object") {
    if (needDsa) {
      const dsa = toText(parsed.dsaSyllabus);
      if (dsa.length >= 80) {
        next.dsaSyllabus = dsa;
        filled.dsa = true;
      }
    }
    if (needSd) {
      const sd = toText(parsed.systemDesign);
      if (sd.length >= 80) {
        next.systemDesign = sd;
        filled.systemDesign = true;
      }
    }
    if (Array.isArray(parsed.sources)) filled.sources = parsed.sources;
  }

  // Hard fallback curriculum if still empty
  if (needDsa && !hasContent(next.dsaSyllabus)) {
    next.dsaSyllabus =
      `DSA curriculum derived for project:\n${problem.slice(0, 400)}\n\n` +
      `1. Arrays & Hash Maps — model core entities / lookup tables for the problem domain\n` +
      `2. Strings & Parsing — validate / normalize user inputs and text fields\n` +
      `3. Stacks & Queues — workflows, undo, job queues in the product flow\n` +
      `4. Trees / Graphs — relationships between entities in the problem (navigation, deps)\n` +
      `5. Sorting & Searching — ranking, filters, search UX for the problem's users\n` +
      `6. Recursion / Backtracking — combinatorial choices inside the problem domain\n` +
      `7. Dynamic Programming (intro) — optimization decisions the product may need\n` +
      `8. Heaps / Priority — top-K, scheduling, urgency in the problem\n` +
      `Practice: 1 Easy + 1 Medium pattern per week tied to the feature being built.`;
    filled.dsa = true;
    filled.mode = filled.mode || "fallback";
  }
  if (needSd && !hasContent(next.systemDesign)) {
    next.systemDesign =
      `System Design curriculum derived for project:\n${problem.slice(0, 400)}\n\n` +
      `1. Users & personas — who uses the system and primary journeys\n` +
      `2. Requirements — functional + non-functional for THIS problem\n` +
      `3. High-level architecture — client, API, services, storage\n` +
      `4. Data model — entities/tables/collections named from the problem\n` +
      `5. APIs — REST/GraphQL endpoints for the core user stories\n` +
      `6. Auth & roles — who can do what\n` +
      `7. Consistency & caching — what must be fresh vs cacheable\n` +
      `8. Scaling sketch — bottlenecks unique to this domain\n` +
      `Weekly: one diagram (context → sequence → ER → deployment).`;
    filled.systemDesign = true;
    filled.mode = filled.mode || "fallback";
  }

  next._dsaSdRagMeta = filled;
  console.log(`✅ DSA/SD RAG enrich done (mode=${filled.mode}, dsa=${filled.dsa}, sd=${filled.systemDesign})`);
  return { enriched: next, meta: filled };
}

module.exports = { enrichMissingDsaSd, hasContent };
