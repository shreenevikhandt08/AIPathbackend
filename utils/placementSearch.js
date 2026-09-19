const axios = require("axios");
const ONLINE_MODEL = "openai/gpt-4o-mini:online";


const cache = new Map(); // key: `${company}|${YYYY-MM-DD}` -> pattern object

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function fallbackPattern(company) {
  return {
    company,
    rounds: ["Online Aptitude Test", "Technical Interview", "HR Interview"],
    sections: [
      { name: "Quantitative Aptitude", topics: ["Percentages", "Time & Work", "Profit & Loss", "Permutation & Combination"] },
      { name: "Logical Reasoning",     topics: ["Puzzles", "Blood Relations", "Series", "Syllogisms"] },
      { name: "Verbal Ability",        topics: ["Reading Comprehension", "Sentence Correction", "Synonyms/Antonyms"] },
      { name: "Technical",             topics: ["Data Structures", "OOP Concepts", "DBMS Basics", "Operating Systems"] },
    ],
    notes: "General placement-style pattern (offline fallback — live search unavailable).",
    sources: [],
    isLive: false,
  };
}

async function searchLiveExamPattern(company) {
  const prompt = `
Search the web right now for the CURRENT campus placement / recruitment exam pattern used by "${company}" for hiring (typically freshers/graduate engineer trainee roles).

Find:
1. The rounds involved (e.g. online aptitude test, coding round, technical interview, HR interview) and roughly how many questions / how much time per round.
2. The topics/syllabus tested in the aptitude section (quantitative, logical reasoning, verbal ability) if applicable.
3. The topics tested in the technical/coding section if applicable (e.g. DSA, DBMS, OS, CN, OOP, specific languages).
4. Typical difficulty level (easy/moderate/hard) reported by recent candidates.
5. Common PAST-QUESTION THEMES for this company (topic names only — never paste real questions verbatim).

Do NOT reproduce any exact real questions verbatim — only summarize the pattern, structure, and topics.

Return ONLY this JSON, no markdown, no commentary:
{
  "rounds": ["short round name", "..."],
  "sections": [
    { "name": "Quantitative Aptitude", "topics": ["topic1", "topic2", "..."] }
  ],
  "difficulty": "easy | moderate | hard | mixed",
  "notes": "1-2 sentence summary of what recent candidates report",
  "sources": ["short source name or domain", "..."]
}
`.trim();

  const clampedTokens = Math.min(900, 4096);
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
    //   max_tokens: 900,
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
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
  const match = cleaned.match(/(\{[\s\S]*\})/);
  const parsed = JSON.parse(match ? match[1] : cleaned);

  if (!Array.isArray(parsed.sections) || !parsed.sections.length) {
    throw new Error("Empty sections from live search");
  }

  return {
    company,
    rounds: Array.isArray(parsed.rounds) ? parsed.rounds : [],
    sections: parsed.sections,
    difficulty: parsed.difficulty || "mixed",
    notes: parsed.notes || "",
    sources: Array.isArray(parsed.sources) ? parsed.sources : [],
    isLive: true,
  };
}

// Returns { pattern, isLive, cached }
async function getCompanyExamPattern(company, forceRefresh = false) {
  const key = `${company.toLowerCase()}|${todayKey()}`;

  if (!forceRefresh && cache.has(key)) {
    return { pattern: cache.get(key), cached: true };
  }

  try {
    const pattern = await searchLiveExamPattern(company);
    cache.set(key, pattern);
    return { pattern, cached: false };
  } catch (err) {
    console.error("placementSearch live fetch failed:", err.message);
    return { pattern: fallbackPattern(company), cached: false };
  }
}

module.exports = { getCompanyExamPattern };
