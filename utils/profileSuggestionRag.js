/**
 * Curated persona banks + live recommendations for Assessment typeahead.
 * Returns list matches first; when the typed query is new / weak, asks the LLM
 * for related suggestions (Google-style “you might mean…” list).
 */
const CAPABILITY = [
  "Communication", "Presentation", "Leadership", "Teamwork", "Empathy",
  "Time management", "Adaptability", "Creativity", "Critical thinking",
  "Aptitude", "Logical thinking", "Analytical thinking", "Writing",
  "Mentoring juniors", "Ownership / accountability",
  "Python", "JavaScript", "Java", "C / C++", "SQL", "React", "Node.js",
  "HTML / CSS", "Git", "Debugging", "DSA basics", "API basics",
  "Prompt engineering", "Using ChatGPT / Copilot well", "Excel / Sheets",
  "UI design eye", "Documentation",
  "Fast learner", "Detail-oriented", "Self-starter", "Calm under pressure",
  "Asks good questions", "Explains simply", "Hands-on builder",
  "Research-first", "Pair-programming friendly",
];

const DIFFICULTIES = [
  "Tamil medium", "Difficulty in English", "Struggles with English writing",
  "Weak in DSA", "Weak in math / aptitude", "Slow at coding syntax",
  "Hard to debug", "Forgets concepts quickly",
  "Public speaking anxiety", "Hard to start tasks", "Procrastination",
  "Gets stuck alone", "Overwhelmed by big problems", "Weak in system design",
  "Hard to read long docs", "Exam anxiety", "Time pressure in contests",
  "Easily distracted", "Hard to estimate time", "Perfectionism slows delivery",
  "Avoids asking for help", "Inconsistent daily practice", "Sleep / energy dips",
  "Group conflicts", "Hard to prioritize",
];

const INTERESTS = [
  "Cricket", "Football", "Basketball", "Badminton", "Volleyball", "Tennis",
  "Athletics / running", "Gym / fitness", "Yoga", "Swimming", "Kabaddi",
  "Table tennis", "Cycling", "Martial arts", "Chess",
  "Dance", "Classical dance", "Western dance", "Music", "Singing",
  "Guitar / instruments", "DJ / music production", "Theatre / drama",
  "Drawing / sketching", "Painting", "Photography", "Videography",
  "Content creation", "Podcasting",
  "Reading novels", "Anime / manga", "Gaming", "Travel", "Cooking",
  "Baking", "Gardening", "Volunteering", "Debate", "Quiz clubs",
  "Blogging", "Fashion / styling", "Movies / short films", "Board games",
  "Astronomy", "DIY / making things",
  "Building side projects", "Hackathons", "Open source", "Startups",
  "Product thinking", "UI/UX", "Data stories", "Teaching peers",
  "AI tools exploration", "Automation / no-code", "Competitive programming",
  "Cybersecurity curious", "Robotics / IoT tinkering",
];

const DISLIKES = [
  "Long lectures", "Rote memorization", "Public speaking", "Group presentations",
  "Competitive coding contests", "Heavy theory without practice", "Night-long coding",
  "Strict timelines", "Repetitive drills", "Reading dense papers",
  "Cold-calling in class", "Solo projects with no feedback",
  "Pure math-heavy work", "Hardware soldering", "Sales-y tasks",
  "Overly formal writing", "Unclear requirements", "Busywork / filler tasks",
  "Forced icebreakers", "Gaming as a task", "Dance / stage performance",
];

const DOMAIN = [
  "FinTech", "EdTech", "HealthTech", "E-commerce", "SaaS / B2B",
  "AgriTech", "Climate / sustainability", "Media / entertainment",
  "Logistics", "HR Tech", "LegalTech", "Travel Tech", "Social impact",
  "Web frontend", "Backend APIs", "Full-stack", "Mobile apps",
  "AI / ML apps", "Data analytics", "Cloud / DevOps", "Cybersecurity",
  "IoT / embedded", "Game development", "AR / VR", "Blockchain curious",
  "Automation / agents", "QA / testing",
  "Software engineer", "Product manager path", "UI/UX designer path",
  "Data analyst path", "DevRel / community", "Research intern path",
  "Founder / builder path", "Teaching / mentoring path",
];

const BANKS = {
  capability: CAPABILITY,
  difficulties: DIFFICULTIES,
  interest: INTERESTS,
  dislikes: DISLIKES,
  domain: DOMAIN,
};

const KIND_HINT = {
  capability: "student strengths / skills",
  difficulties: "learning difficulties or weak areas",
  interest: "hobbies and interests",
  dislikes: "things the student prefers to avoid",
  domain: "project domain or career path",
};

const llmCache = new Map(); // kind|query -> { at, items }

function uniq(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const k = String(x || "").trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(String(x).trim());
  }
  return out;
}

function scoreText(query, text) {
  const q = String(query || "").toLowerCase().trim();
  const t = String(text || "").toLowerCase();
  if (!q) return 1;
  let score = 0;
  if (t.startsWith(q)) score += 12;
  if (t.includes(q)) score += 8;
  q.split(/\s+/).filter((w) => w.length >= 2).forEach((w) => {
    if (t.includes(w)) score += 3;
  });
  // soft fuzzy: shared prefix of 3+
  const pref = q.slice(0, Math.min(4, q.length));
  if (pref.length >= 3 && t.includes(pref)) score += 2;
  return score;
}

async function llmRelatedSuggestions(kind, query) {
  const cacheKey = `${kind}|${query.toLowerCase()}`;
  const hit = llmCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.items;

  if (!process.env.OPENROUTER_API_KEY) return [];

  try {
    const { callLLM } = require("./llm");
    const prompt = `You help college students fill a short Assessment profile field (${KIND_HINT[kind] || kind}).
The student typed: "${query}"
Return 8 short related suggestion labels they might mean or want to pick (like Google autocomplete).
Rules:
- Each suggestion 2–6 words, title case where natural
- Relevant to ${KIND_HINT[kind] || kind}
- Include close variants of their typed words
- No explanations, no numbering outside JSON
Return ONLY JSON: {"suggestions":["..."]}`;

    const parsed = await callLLM(prompt, 400);
    const items = uniq(
      Array.isArray(parsed?.suggestions) ? parsed.suggestions : []
    ).slice(0, 10);
    llmCache.set(cacheKey, { at: Date.now(), items });
    return items;
  } catch (err) {
    console.warn("profile suggestion LLM failed:", err.message);
    return [];
  }
}

/**
 * @param {'interest'|'capability'|'domain'|'difficulties'|'dislikes'} kind
 * @param {{ query?: string, limit?: number, refresh?: boolean }} opts
 */
async function retrieveProfileSuggestions(kind = "interest", opts = {}) {
  const key = BANKS[kind] ? kind : "interest";
  const limit = Math.min(80, Math.max(8, Number(opts.limit) || 48));
  const query = String(opts.query || "").trim();
  const base = BANKS[key] || INTERESTS;

  const ranked = base
    .map((label) => ({ label, score: scoreText(query, label) }))
    .sort((a, b) => b.score - a.score);

  let listHits = [];
  if (query) {
    listHits = ranked.filter((x) => x.score > 0).map((x) => x.label);
  } else {
    listHits = ranked.map((x) => x.label);
  }

  const strongHits = ranked.filter((x) => x.score >= 8).length;
  const needRecommend =
    Boolean(query) &&
    query.length >= 2 &&
    (strongHits < 3 || !listHits.some((l) => l.toLowerCase() === query.toLowerCase()));

  let recommended = [];
  if (needRecommend) {
    recommended = await llmRelatedSuggestions(key, query);
  }

  const suggestions = uniq([...listHits, ...recommended]).slice(0, limit);

  return {
    kind: key,
    source: recommended.length ? "curated+recommended" : "curated",
    banks: [key],
    query: query || null,
    suggestions,
    listMatches: listHits.slice(0, limit),
    recommended,
    meta: {
      pool: base.length,
      strongHits,
      note: recommended.length
        ? "Includes live recommendations for typed words beyond the dropdown."
        : "Curated persona bank matches.",
    },
  };
}

module.exports = { retrieveProfileSuggestions, BANKS };
