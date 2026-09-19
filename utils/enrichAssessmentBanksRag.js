/**
 * RAG for assessment / engagement / LeetCode banks.
 * Prefer web + uploaded PDFs. Do NOT pad from inbuilt seed lists.
 * LeetCode: only real problems (valid # + title + difficulty) — no invented items.
 */
const axios = require("axios");
const { callLLM, parseLLMJson } = require("./llm");
const { stripLinks } = require("../data/agentWorkbenchBanks");

const ONLINE_MODEL = "openai/gpt-4o-mini:online";

function clip(text, n = 6000) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function callOnlineJson(prompt, maxTokens = 4000) {
  const clampedTokens = Math.min(maxTokens, 4096);
  const response = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      model: "openai/gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: clampedTokens,
    },
    {
      headers: {
        Authorization: "Bearer " + process.env.OPENROUTER_API_KEY,
        "Content-Type": "application/json",
      },
      timeout: 75001,
    }
  );

  const raw = response.data.choices?.[0]?.message?.content || "";
  // Same salvage path as callLLM — truncated bank JSON must not hard-fail
  return parseLLMJson(raw);
}

function computeNeed(numDays = 10, teamSize = 1) {
  const days = Math.max(5, Number(numDays) || 10);
  const members = Math.max(1, Number(teamSize) || 1);
  const slots = days * members + 8;
  // Keep packs small enough to fit in one JSON response (avoids mid-array truncation)
  return {
    pm: Math.min(Math.max(slots, 12), 18),
    cases: Math.min(Math.max(slots, 10), 16),
    products: Math.min(Math.max(slots, 10), 14),
    breakdown: Math.min(Math.max(days + 2, 8), 12),
    agent: Math.min(Math.max(days, 6), 12),
    leetcode: Math.min(Math.max(slots, 14), 24),
    sdLeetcode: Math.min(Math.max(Math.ceil(slots / 2), 8), 16),
  };
}

/** Accept only plausible real LeetCode rows — drop hallucinations. */
function normalizeLeetCodeItem(p, i = 0, { sd = false } = {}) {
  if (!p || typeof p !== "object") return null;
  const lc = Number(p.lc ?? p.id ?? p.number);
  const name = String(p.name || p.title || "").replace(/\s+/g, " ").trim();
  const diffRaw = String(p.difficulty || "").trim();
  const difficulty = ["Easy", "Medium", "Hard"].find(
    (d) => d.toLowerCase() === diffRaw.toLowerCase()
  );
  const pattern = String(p.pattern || p.topic || p.tag || "").trim() || "General";
  if (!Number.isFinite(lc) || lc < 1 || lc > 4000) return null;
  if (!name || name.length < 3 || name.length > 120) return null;
  if (!difficulty) return null;
  // Reject obvious placeholders
  if (/^(problem|example|todo|test|untitled)\b/i.test(name)) return null;
  if (/\b(fake|hallucin|placeholder|lorem)\b/i.test(name)) return null;

  const slugFromUrl = String(p.url || "")
    .match(/leetcode\.com\/problems\/([a-z0-9-]+)/i)?.[1];
  const slug = slugFromUrl || slugify(name);
  if (!slug || slug.length < 2) return null;

  const out = {
    lc,
    name,
    difficulty,
    pattern,
    url: `https://leetcode.com/problems/${slug}/`,
    source: "rag",
  };
  if (sd) {
    out.sd = String(p.sd || p.sdTheme || pattern).trim() || "System Design building block";
    out.whySd = String(p.whySd || p.why || "").trim() || null;
  }
  return out;
}

function dedupeLc(list) {
  const seen = new Set();
  const out = [];
  for (const p of list || []) {
    const key = String(p.lc);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function emptyPack(need, mode = "empty") {
  return {
    sources: [],
    pm: [],
    cases: [],
    products: [],
    projectBreakdown: [],
    agentTasks: [],
    leetcode: [],
    sdLeetcode: [],
    mode,
    need,
  };
}

function buildPrompt({ questionsText, problemText, dsaText, sdText, need }) {
  return `
You build college placement question banks using RAG over the sources below + the public web.

UPLOADED QUESTIONS / PDF TEXT (prefer extracting real items from here):
"""
${clip(questionsText, 5001) || "(none)"}
"""

STUDENT PROBLEM STATEMENT:
"""
${clip(problemText, 1800) || "(none)"}
"""

DSA / SYLLABUS HINTS:
"""
${clip(dsaText, 1500) || "(none)"}
"""

SYSTEM DESIGN HINTS:
"""
${clip(sdText, 1200) || "(none)"}
"""

Return ONLY valid JSON:
{
  "sources": ["leetcode.com", "uploaded-pdf", "..."],
  "leetcode": [
    {"lc":1,"name":"Two Sum","difficulty":"Easy","pattern":"Arrays & Hashing","url":"https://leetcode.com/problems/two-sum/"}
  ],
  "sdLeetcode": [
    {"lc":146,"name":"LRU Cache","difficulty":"Medium","pattern":"Hash Map + Doubly Linked List","sd":"Caching / eviction","whySd":"Teaches eviction for API caches","url":"https://leetcode.com/problems/lru-cache/"}
  ],
  "pm": [{"id":"rag-pm-1","category":"Estimation|Strategy|Execution|Technical|Analytical|Design","skill":"logical|business|analytical|technical|empathy","text":"..."}],
  "cases": [{"id":"rag-case-1","title":"...","theme":"...","link":null}],
  "products": [{"name":"...","category":"...","prompt":"90-sec speak prompt"}],
  "projectBreakdown": [{"focus":"...","tasks":["..."],"doneWhen":"..."}],
  "agentTasks": [{
    "dayIndex": 0,
    "title":"...",
    "theme":"HTTP|Transform|IF|Schedule|Webhook",
    "what":"...",
    "steps":["Step 1","Step 2","Step 3"],
    "doneWhen":"..."
  }]
}

TARGET unique counts (prefer COMPLETE valid JSON over hitting every count):
- leetcode: up to ${need.leetcode}  (classic DSA — mix Easy/Medium/Hard matched to syllabus)
- sdLeetcode: up to ${need.sdLeetcode}  (Design-* / cache / queue / hashmap problems that EXIST on LeetCode)
- pm: up to ${need.pm}
- cases: up to ${need.cases}
- products: up to ${need.products}
- projectBreakdown: up to ${need.breakdown}
- agentTasks: up to ${need.agent} (dayIndex 0..${Math.max(0, need.agent - 1)})

If the response would be too long, STOP early with fewer items — never leave a trailing comma or cut mid-object.

CRITICAL ANTI-HALLUCINATION RULES:
- LeetCode: ONLY real problems that exist on leetcode.com. lc number MUST match the official title.
- Do NOT invent problem numbers, titles, or URLs. If unsure a problem exists, OMIT it.
- Prefer well-known public problems (NeetCode / Blind 75 / top interview) when syllabus is thin.
- PM / cases / products: prefer uploaded PDF; else well-known public interview patterns. No fake company case URLs.
- No paid course links. Agent steps: no URLs.
`.trim();
}

function normalizePack(parsed, need, mode) {
  const base = emptyPack(need, mode);
  if (!parsed || typeof parsed !== "object") return base;

  const leetcode = dedupeLc(
    (Array.isArray(parsed.leetcode) ? parsed.leetcode : [])
      .map((p, i) => normalizeLeetCodeItem(p, i, { sd: false }))
      .filter(Boolean)
  );

  const sdLeetcode = dedupeLc(
    (Array.isArray(parsed.sdLeetcode) ? parsed.sdLeetcode : [])
      .map((p, i) => normalizeLeetCodeItem(p, i, { sd: true }))
      .filter(Boolean)
  );

  const pm = (Array.isArray(parsed.pm) ? parsed.pm : [])
    .map((q, i) => ({
      id: String(q.id || `rag-pm-${i + 1}`),
      category: String(q.category || "Analytical"),
      skill: String(q.skill || "analytical"),
      text: stripLinks(String(q.text || "").trim()),
    }))
    .filter((q) => q.text.length >= 20);

  const cases = (Array.isArray(parsed.cases) ? parsed.cases : [])
    .map((c, i) => ({
      id: String(c.id || `rag-case-${i + 1}`),
      title: stripLinks(String(c.title || "").trim()),
      theme: String(c.theme || "General"),
      link: c.link && /^https?:\/\//i.test(String(c.link)) ? String(c.link) : null,
    }))
    .filter((c) => c.title.length >= 3);

  const products = (Array.isArray(parsed.products) ? parsed.products : [])
    .map((p) => ({
      name: stripLinks(String(p.name || "").trim()),
      category: String(p.category || "Product"),
      prompt: stripLinks(String(p.prompt || "").trim()),
    }))
    .filter((p) => p.name && p.prompt.length >= 20);

  const projectBreakdown = (Array.isArray(parsed.projectBreakdown) ? parsed.projectBreakdown : [])
    .map((b) => ({
      focus: String(b.focus || "").trim(),
      tasks: Array.isArray(b.tasks) ? b.tasks.map(String).filter(Boolean).slice(0, 6) : [],
      doneWhen: String(b.doneWhen || "").trim(),
    }))
    .filter((b) => b.focus && b.tasks.length);

  const agentIn = Array.isArray(parsed.agentTasks) ? parsed.agentTasks : [];
  const agentTasks = [];
  for (let i = 0; i < need.agent; i++) {
    const t = agentIn[i] || agentIn[i % Math.max(1, agentIn.length)] || null;
    if (!t) continue;
    const stepsIn = Array.isArray(t.steps)
      ? t.steps.map((s) => stripLinks(String(s))).filter(Boolean)
      : [];
    if (stepsIn.length < 2) continue;
    const what = stripLinks(String(t.what || "").trim());
    const doneWhen = stripLinks(String(t.doneWhen || t.success || "").trim());
    const title = stripLinks(String(t.title || "").trim());
    if (!title || !what) continue;
    agentTasks.push({
      dayIndex: i,
      title,
      theme: String(t.theme || "HTTP"),
      what,
      steps: stepsIn,
      buildSteps: stepsIn.map((s, n) => `${n + 1}) ${s}`).join("\n"),
      skillFocus: what,
      doneWhen: doneWhen || "Task complete with a short note.",
      success: doneWhen || "Task complete with a short note.",
    });
  }

  return {
    sources: Array.isArray(parsed.sources)
      ? parsed.sources.map(String).slice(0, 12)
      : ["rag-web"],
    pm,
    cases,
    products,
    projectBreakdown,
    agentTasks,
    leetcode,
    sdLeetcode,
    mode,
    need,
  };
}

/**
 * @param {string} questionsText uploaded PDF / paper text (optional)
 * @param {{ numDays?: number, teamSize?: number, problemText?: string, dsaText?: string, sdText?: string }} opts
 */
async function enrichAssessmentBanksRag(questionsText, opts = {}) {
  const need = computeNeed(opts.numDays, opts.teamSize);
  const src = clip(questionsText, 8000);
  const problemText = clip(opts.problemText || "", 2000);
  const dsaText = clip(opts.dsaText || "", 2000);
  const sdText = clip(opts.sdText || "", 1500);

  const hasAnyContext =
    (src && src.length >= 40) ||
    problemText.length >= 40 ||
    dsaText.length >= 40 ||
    sdText.length >= 40;

  if (!hasAnyContext) {
    console.log("⚠️ Assessment RAG: no PDF / problem / DSA context — using verified LeetCode fallback");
    try {
      const { mergeVerifiedFallback } = require("../data/verifiedLeetCodePool");
      return mergeVerifiedFallback(emptyPack(need, "empty-no-context"));
    } catch (_) {
      return emptyPack(need, "empty-no-context");
    }
  }

  console.log(
    `🌐 RAG assessment banks (leetcode+sd+pm+cases…) days≈${opts.numDays}, team=${opts.teamSize || 1}…`
  );

  const prompt = buildPrompt({
    questionsText: src,
    problemText,
    dsaText,
    sdText,
    need,
  });

  let parsed = null;
  let mode = "online";
  try {
    parsed = await callOnlineJson(prompt, 4500);
  } catch (err) {
    console.warn("Online bank RAG failed, trying offline LLM:", err.message);
    mode = "offline";
    try {
      parsed = await callLLM(
        prompt +
          `\n\n(Web tool unavailable — ONLY include LeetCode problems you are certain exist with correct lc# + title. Prefer omitting over inventing.)`,
        3600
      );
    } catch (err2) {
      console.warn("Offline bank RAG failed:", err2.message);
      try {
        const { mergeVerifiedFallback } = require("../data/verifiedLeetCodePool");
        return mergeVerifiedFallback(emptyPack(need, "failed"));
      } catch (_) {
        return emptyPack(need, "failed");
      }
    }
  }

  let pack = normalizePack(parsed, need, mode);
  // When RAG truncates / fails anti-hallucination filters → lc=0 and homework
  // silently loses LeetCode. Merge verified real problems as a safety net.
  try {
    const { mergeVerifiedFallback } = require("../data/verifiedLeetCodePool");
    pack = mergeVerifiedFallback(pack);
  } catch (e) {
    console.warn("Verified LC fallback skipped:", e.message);
  }
  console.log(
    `✅ Bank RAG done (mode=${pack.mode}, lc=${pack.leetcode.length}, sdLc=${pack.sdLeetcode.length}, pm=${pack.pm.length}, cases=${pack.cases.length}, products=${pack.products.length}, agent=${pack.agentTasks.length})`
  );
  return pack;
}

function pickFromRagList(list, index) {
  if (!Array.isArray(list) || !list.length) return null;
  return list[Math.max(0, Number(index) || 0) % list.length];
}

/** Pick SD-flavoured LeetCode from RAG pack only. */
function pickSdLeetCodeFromRag(ragPack, dayIdx = 0, usedLc = null, difficultyPrefs = null) {
  const bank = Array.isArray(ragPack?.sdLeetcode) && ragPack.sdLeetcode.length
    ? ragPack.sdLeetcode
    : Array.isArray(ragPack?.leetcode)
      ? ragPack.leetcode.filter((p) => /design|cache|stack|queue|hash|trie|stream/i.test(`${p.name} ${p.pattern}`))
      : [];
  if (!bank.length) return null;

  const used = new Set((usedLc || []).map(String));
  const prefs = Array.isArray(difficultyPrefs)
    ? difficultyPrefs.map((d) => String(d).toLowerCase())
    : null;

  let pool = bank.filter((p) => !used.has(String(p.lc)));
  if (!pool.length) pool = bank.slice();
  if (prefs && prefs.length) {
    const preferred = pool.filter((p) => prefs.includes(String(p.difficulty || "").toLowerCase()));
    if (preferred.length) pool = preferred;
  }
  const i = Math.max(0, Number(dayIdx) || 0) % pool.length;
  const pick = pool[i];
  if (Array.isArray(usedLc) && pick?.lc != null) usedLc.push(String(pick.lc));
  return pick || null;
}

module.exports = {
  enrichAssessmentBanksRag,
  computeNeed,
  emptyPack,
  pickFromRagList,
  pickSdLeetCodeFromRag,
  normalizeLeetCodeItem,
  dedupeLc,
};
