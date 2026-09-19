/**
 * System-Design / DSA LeetCode picker.
 * Prefer enrichAssessmentBanksRag → sdLeetcode / leetcode packs + verified pool.
 *
 * RULE: never fall back to LRU/cache problems unless today's pattern is actually cache.
 */
const { pickSdLeetCodeFromRag } = require("../utils/enrichAssessmentBanksRag");
const { leetcodeUrl, slugifyProblemName } = require("../utils/leetcodeUrl");

const SD_LEETCODE_BANK = []; // intentionally empty — use RAG

function slugifyLc(name) {
  return slugifyProblemName(name);
}

function leetcodeUrlFor(p) {
  return leetcodeUrl(p);
}

function isCacheProblem(p = {}) {
  const hay = `${p.name || ""} ${p.pattern || ""} ${p.sd || ""}`.toLowerCase();
  return /\blru\b|\blfu\b|cache|caching|evict/.test(hay);
}

function sdPatternHint(sdTitle = "", learnLabel = "") {
  const t = `${sdTitle} ${learnLabel}`.toLowerCase();
  if (/\blru\b|\blfu\b|cache|caching|cdn|\bredis\b|evict/.test(t)) return "Caching";
  if (/queue|async|message|event|stream|buffer/.test(t)) return "Queue / Stack";
  if (/auth|session|token|login|oauth/.test(t)) return "Hash Map";
  if (/rate.?limit|sliding|window/.test(t)) return "Sliding Window";
  if (/graph|network|friend|recommend|connect|cluster/.test(t)) return "Graphs";
  if (/tree|trie|hierarch|folder|prefix|autocomplete/.test(t)) return "Trees";
  if (/feed|twitter|fan.?out|leaderboard|rank/.test(t)) return "Heap / Priority Queue";
  if (/api|endpoint|request|response|rest|hash|kv|key.?value/.test(t)) return "Hash Map";
  if (/load|balanc|scale|shard|capacity|resource|seat|parking/.test(t)) return "Hash Map";
  if (/metric|median|monitor/.test(t)) return "Heap / Priority Queue";
  // No vague "Key-value store" default — that used to pull LRU from the SD bank
  return "Arrays & Hashing";
}

/** Normalize pattern labels so day + night LC can share one family. */
function patternFamilyKey(pattern = "") {
  const t = String(pattern || "").toLowerCase();
  if (/lru|lfu|cache|caching|doubly|evict/.test(t)) return "cache";
  if (/sliding|window|rate.?limit/.test(t)) return "window";
  if (/queue|stack|deque|monotonic/.test(t)) return "queue-stack";
  if (/graph|bfs|dfs|union|topo|island/.test(t)) return "graph";
  if (/tree|trie|bst|binary tree/.test(t)) return "tree";
  if (/binary.?search/.test(t)) return "binary-search";
  if (/two.?pointer/.test(t)) return "two-pointer";
  if (/dp|dynamic|knapsack|memoization|kadane/.test(t)) return "dp";
  if (/heap|priority|top.?k/.test(t)) return "heap";
  if (/linked.?list/.test(t)) return "linked-list";
  if (/interval/.test(t)) return "intervals";
  if (/sort/.test(t)) return "sorting";
  if (/recursion|backtrack/.test(t)) return "recursion";
  if (/hash|map|array|anagram|two sum|string/.test(t)) return "hash-array";
  return t.slice(0, 28) || "hash-array";
}

function relatedFamilies(family) {
  const f = String(family || "hash-array");
  if (f === "cache") return ["cache"];
  if (f === "hash-array") return ["hash-array", "two-pointer", "sorting"];
  if (f === "dp") return ["dp", "recursion"];
  if (f === "tree") return ["tree", "recursion"];
  if (f === "graph") return ["graph"];
  if (f === "window") return ["window", "two-pointer", "hash-array"];
  if (f === "two-pointer") return ["two-pointer", "hash-array", "sorting"];
  if (f === "binary-search") return ["binary-search", "sorting", "hash-array"];
  if (f === "queue-stack") return ["queue-stack"];
  if (f === "heap") return ["heap", "hash-array"];
  if (f === "linked-list") return ["linked-list", "hash-array"];
  if (f === "intervals") return ["intervals", "sorting"];
  if (f === "sorting") return ["sorting", "hash-array", "two-pointer"];
  if (f === "recursion") return ["recursion", "tree", "dp"];
  return [f, "hash-array"];
}

function normalizeLcPick(pick, sdTitle = "", learnLabel = "", forcedPattern = "") {
  if (!pick) return null;
  const pattern = forcedPattern || pick.pattern || sdPatternHint(sdTitle, learnLabel);
  const learned = softLabel(learnLabel || sdTitle);
  return {
    lc: pick.lc,
    name: pick.name,
    difficulty: pick.difficulty,
    pattern: pick.pattern || pattern,
    sd: pick.sd || pattern,
    url: leetcodeUrlFor(pick),
    whySd:
      pick.whySd && !isCacheProblem(pick)
        ? pick.whySd
        : `Practises "${pick.pattern || pattern}" from today's learning${learned ? ` (${learned})` : ""}.`,
    source: pick.source || "rag",
  };
}

function softLabel(s) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > 48 ? `${t.slice(0, 48)}…` : t;
}

function collectLcPool(ragPack = null, { includeSdBank = true } = {}) {
  const out = [];
  const seen = new Set();
  const push = (list) => {
    for (const p of list || []) {
      if (!p?.lc && !p?.name) continue;
      const id = String(p.lc || p.name);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(p);
    }
  };
  // DSA-first: general leetcode before SD design/cache bank
  push(ragPack?.leetcode);
  if (includeSdBank) push(ragPack?.sdLeetcode);
  try {
    const { VERIFIED_LEETCODE, VERIFIED_SD_LEETCODE } = require("./verifiedLeetCodePool");
    push(VERIFIED_LEETCODE);
    if (includeSdBank) push(VERIFIED_SD_LEETCODE);
  } catch (_) {}
  return out;
}

function filterPoolByFamilies(bank, families, { allowCache = false } = {}) {
  const want = new Set(families);
  return (bank || []).filter((p) => {
    if (!allowCache && isCacheProblem(p)) return false;
    const f = patternFamilyKey(p.pattern || p.sd || p.name);
    if (!allowCache && f === "cache") return false;
    return want.has(f);
  });
}

/**
 * Pick LC in the same pattern family (for day↔night alignment).
 * preferEasy=true → daytime warm-up; false → homework deepen.
 * Never substitutes LRU/cache unless the day's pattern is cache.
 */
function pickLcByPatternFamily({
  dayIdx = 0,
  pattern = "",
  usedLc = null,
  difficultyPrefs = null,
  ragPack = null,
  preferEasy = false,
  sdTitle = "",
  learnLabel = "",
  allowCacheFallback = false,
} = {}) {
  const resolvedPattern = pattern || sdPatternHint(sdTitle, learnLabel);
  const family = patternFamilyKey(resolvedPattern);
  const allowCache = allowCacheFallback || family === "cache";
  const bank = collectLcPool(ragPack, { includeSdBank: allowCache });

  let pool = filterPoolByFamilies(bank, [family], { allowCache });
  if (!pool.length) {
    pool = filterPoolByFamilies(bank, relatedFamilies(family), { allowCache });
  }
  if (!pool.length) {
    // Safe DSA fallback — never the full SD/cache bank
    pool = (bank || []).filter((p) => !isCacheProblem(p) && patternFamilyKey(p.pattern || p.name) !== "cache");
  }
  if (!pool.length) return null;

  let unused = pool.filter((p) => !new Set((usedLc || []).map(String)).has(String(p.lc)));
  if (!unused.length) unused = pool.slice();

  const used = new Set((usedLc || []).map(String));
  const prefs = Array.isArray(difficultyPrefs)
    ? difficultyPrefs.map((d) => String(d).toLowerCase())
    : null;

  if (preferEasy) {
    const easy = unused.filter((p) => /easy/i.test(String(p.difficulty || "")));
    if (easy.length) unused = easy;
  } else if (prefs && prefs.length) {
    const preferred = unused.filter((p) =>
      prefs.includes(String(p.difficulty || "").toLowerCase())
    );
    if (preferred.length) unused = preferred;
  }

  const i = Math.max(0, Number(dayIdx) || 0) % unused.length;
  const pick = unused[i];
  if (Array.isArray(usedLc) && pick?.lc != null && !used.has(String(pick.lc))) {
    usedLc.push(String(pick.lc));
  }
  return normalizeLcPick(pick, sdTitle, learnLabel, resolvedPattern);
}

/**
 * Pick an SD-linked LeetCode problem — only when SD lesson actually maps to a pattern.
 * Still refuses random LRU unless the lesson is about caching.
 */
function pickSdLeetCode(dayIdx = 0, sdTitle = "", learnLabel = "", usedLc = null, difficultyPrefs = null, ragPack = null) {
  const hintPattern = sdPatternHint(sdTitle, learnLabel);
  const allowCache = patternFamilyKey(hintPattern) === "cache";
  const byFamily = pickLcByPatternFamily({
    dayIdx,
    pattern: hintPattern,
    usedLc,
    difficultyPrefs,
    ragPack,
    preferEasy: false,
    sdTitle,
    learnLabel,
    allowCacheFallback: allowCache,
  });
  if (byFamily) return byFamily;

  if (!allowCache) {
    // Do not fall through to RAG SD bank (often LRU-heavy)
    return pickLcByPatternFamily({
      dayIdx,
      pattern: "Arrays & Hashing",
      usedLc,
      difficultyPrefs,
      ragPack,
      preferEasy: true,
      sdTitle: "",
      learnLabel,
      allowCacheFallback: false,
    });
  }

  let pick = pickSdLeetCodeFromRag(ragPack, dayIdx, usedLc, difficultyPrefs);
  if (!pick) {
    try {
      const { VERIFIED_SD_LEETCODE, VERIFIED_LEETCODE, pickFromVerifiedPool } = require("./verifiedLeetCodePool");
      pick =
        pickFromVerifiedPool(VERIFIED_SD_LEETCODE, dayIdx, usedLc, difficultyPrefs) ||
        pickFromVerifiedPool(VERIFIED_LEETCODE, dayIdx, usedLc, difficultyPrefs);
    } catch (_) {
      pick = null;
    }
  }
  if (pick && !allowCache && isCacheProblem(pick)) return null;
  return normalizeLcPick(pick, sdTitle, learnLabel, hintPattern);
}

module.exports = {
  SD_LEETCODE_BANK,
  pickSdLeetCode,
  pickLcByPatternFamily,
  patternFamilyKey,
  sdPatternHint,
  leetcodeUrlFor,
  isCacheProblem,
};
