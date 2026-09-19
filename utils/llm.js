const axios = require("axios");

// Ensure system CAs even if this module is required without server.js bootstrap
try {
  require("./tlsSetup").applySystemCa();
} catch (_) {}

const GPT4O_MINI_MAX_TOKENS = 4096;

/**
 * Robust parse for LLM JSON (full or truncated). Used by callLLM and RAG helpers.
 */
function parseLLMJson(raw) {
  // ── Step 1: Strip markdown fences ────────────────────────────────────────
  let cleaned = String(raw || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  // ── Step 2: Fix JS-style string concatenation that LLM sometimes emits ──
  // Pattern: "text" +\n      "more text"  →  "textmore text"
  // This is the root cause of "No JSON in response" for complex daily rows.
  cleaned = cleaned.replace(/"(\s*\+\s*\n\s*")/g, "");

  // Trailing commas before ] or } (common LLM mistake)
  cleaned = cleaned.replace(/,\s*([\]}])/g, "$1");

  // ── Step 3: Try direct parse ──────────────────────────────────────────────
  try {
    return JSON.parse(cleaned);
  } catch (_) {}

  // ── Step 4: Extract first {...} block ─────────────────────────────────────
  const fullMatch = cleaned.match(/(\{[\s\S]*\})/s);
  if (fullMatch) {
    try {
      return JSON.parse(fullMatch[1]);
    } catch (_) {}
    try {
      return JSON.parse(fullMatch[1].replace(/,\s*([\]}])/g, "$1"));
    } catch (_) {}
  }

  // ── Step 5: Salvage rows array even from partial/broken JSON ─────────────
  // Handles cases where the JSON is cut off mid-stream
  const rowsStart = cleaned.indexOf('"rows"');
  if (rowsStart !== -1) {
    const arrStart = cleaned.indexOf("[", rowsStart);
    if (arrStart !== -1) {
      // Try to close the array and object, then parse
      let partial = cleaned.slice(arrStart);
      // Count open brackets to find last complete row
      const completeRows = [];
      let depth = 0, inStr = false, escape = false, rowStart = -1;
      for (let i = 0; i < partial.length; i++) {
        const ch = partial[i];
        if (escape) { escape = false; continue; }
        if (ch === "\\") { escape = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === "[") {
          if (depth === 1) rowStart = i; // start of a row array
          depth++;
        }
        if (ch === "]") {
          depth--;
          if (depth === 1 && rowStart !== -1) {
            // complete row
            try {
              const row = JSON.parse(partial.slice(rowStart, i + 1));
              if (Array.isArray(row) && row.length >= 3) completeRows.push(row);
            } catch (_) {}
            rowStart = -1;
          }
          if (depth === 0) break;
        }
      }
      if (completeRows.length > 0) {
        console.warn("Partial JSON recovered — " + completeRows.length + " rows");
        return { rows: completeRows };
      }
    }
  }

  // ── Step 6: Salvage ALL top-level array-of-objects keys (not just the first)
  // Bug: recovering only the first key (often "sources") dropped leetcode /
  // sdLeetcode when the response was truncated — homework then had no LC.
  function salvageObjectArray(text, key) {
    const re = new RegExp(`"${key}"\\s*:\\s*\\[`);
    const m = text.match(re);
    if (!m || m.index == null) return null;
    const arrStart = text.indexOf("[", m.index);
    if (arrStart < 0) return null;
    const partial = text.slice(arrStart);
    const completeItems = [];
    let depth = 0;
    let inStr = false;
    let escape = false;
    let itemStart = -1;
    for (let i = 0; i < partial.length; i++) {
      const ch = partial[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;
      if (ch === "{") {
        if (depth === 0) itemStart = i;
        depth++;
      }
      if (ch === "}") {
        depth--;
        if (depth === 0 && itemStart !== -1) {
          try {
            completeItems.push(JSON.parse(partial.slice(itemStart, i + 1)));
          } catch (_) {}
          itemStart = -1;
        }
      }
    }
    return completeItems.length ? completeItems : null;
  }

  const preferredKeys = [
    "leetcode",
    "sdLeetcode",
    "pm",
    "cases",
    "products",
    "agentTasks",
    "projectBreakdown",
    "sources",
    "rows",
    "lessons",
    "tasks",
  ];
  const foundKeys = new Set();
  const keyRe = /"(\w+)"\s*:\s*\[/g;
  let km;
  while ((km = keyRe.exec(cleaned))) foundKeys.add(km[1]);
  const keysToTry = [
    ...preferredKeys.filter((k) => foundKeys.has(k)),
    ...[...foundKeys].filter((k) => !preferredKeys.includes(k)),
  ];

  const salvaged = {};
  for (const key of keysToTry) {
    const items = salvageObjectArray(cleaned, key);
    if (items && items.length) {
      salvaged[key] = items;
      console.warn(`Partial JSON recovered — ${items.length} "${key}" item(s)`);
    }
  }
  if (Object.keys(salvaged).length > 0) return salvaged;

  throw new Error("No JSON in response: " + cleaned.slice(0, 300));
}

async function callLLM(prompt, maxTokens = 4000) {
  const clampedTokens = Math.min(maxTokens, GPT4O_MINI_MAX_TOKENS);

  let response;
  try {
    response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: clampedTokens,
      },
      // {
      //   model: "openai/gpt-4o-mini",
      //   messages: [{ role: "user", content: prompt }],
      //   temperature: 0.3,
      //   max_tokens: clampedTokens,
      // },
      {
        headers: {
          Authorization: "Bearer " + process.env.OPENROUTER_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    // Log the actual API error body so 400/429/5xx are self-diagnosing
    if (err.response) {
      console.error("OpenRouter API error", err.response.status, JSON.stringify(err.response.data));
    }
    throw err;
  }

  const raw = response.data.choices?.[0]?.message?.content || "";
  return parseLLMJson(raw);
}

module.exports = {
  callLLM,
  parseLLMJson,
};