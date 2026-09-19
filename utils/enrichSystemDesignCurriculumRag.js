/**
 * Web/LLM RAG — full beginner System Design day path (not a fixed in-code curriculum).
 * Stored on inputs._systemDesignLessonPack and consumed by systemDesignLesson.js.
 */
const axios = require("axios");
const { callLLM } = require("./llm");

const ONLINE_MODEL = "openai/gpt-4o-mini:online";

function clip(text, n = 500) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

async function callOnlineJson(prompt, maxTokens = 4200) {
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
      timeout: 60000,
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

function emergencyLessons(count) {
  const seeds = [
    {
      title: "System Design Overview",
      learn: "Plan Client → Logic/API → Store before deep coding.",
      note: "Three boxes are enough for day 1.",
      doNow: "In notes/system-design.md write ## Day 1 — Overview and draw the 3 boxes for your problem.",
      doc: "Create notes/system-design.md — continuing notebook.",
    },
    {
      title: "Users and journeys",
      learn: "Name the main user and the steps they take to get value.",
      note: "One primary user is enough.",
      doNow: "Add ## Day 2 — Users with goal + 5 journey steps.",
      doc: "Continue notes/system-design.md.",
    },
    {
      title: "Client screens",
      learn: "List screens and what each sends to the logic layer.",
      note: "Screens first, polish later.",
      doNow: "Add ## Day 3 — Client with 3–5 screens.",
      doc: "Continue notes/system-design.md.",
    },
    {
      title: "Data to store",
      learn: "Decide what must be saved vs recalculated.",
      note: "If you show it tomorrow, store it.",
      doNow: "Add ## Day 4 — Data with 4–6 nouns + fields.",
      doc: "Continue notes/system-design.md.",
    },
    {
      title: "APIs",
      learn: "Write clear request/response names in plain English.",
      note: "GET list · POST create · GET one.",
      doNow: "Add ## Day 5 — APIs with 3 calls linked to screens.",
      doc: "Continue notes/system-design.md.",
    },
  ];
  const out = [];
  for (let i = 0; i < count; i++) {
    const s = seeds[i % seeds.length];
    out.push({
      dayIndex: i,
      title: i < seeds.length ? s.title : `${s.title} (cont. ${i + 1})`,
      learn: s.learn,
      note: s.note,
      doNow: s.doNow.replace(/Day \d+/i, `Day ${i + 1}`),
      doc: s.doc,
    });
  }
  return out;
}

function buildPrompt({ count, syllabusHint, projectHint, uploadText, academicBlock }) {
  return `
Design a System Design learning path for college students (one NEW lesson per day).
Calibrate difficulty to their Year / Semester / Stream — NOT one-size-fits-all.

${academicBlock || "Academic: Year 2 default — clear intermediate beginner path."}

Project: ${clip(projectHint, 280) || "(generic student product)"}
Syllabus hint: ${clip(syllabusHint, 280) || "(none)"}
Upload excerpt: ${clip(uploadText, 500) || "(none)"}

Return ONLY valid JSON:
{
  "sources": ["site or curriculum name"],
  "lessons": [
    {
      "dayIndex": 0,
      "title": "short lesson title",
      "learn": "1-2 sentences what to learn",
      "note": "one simple reminder",
      "doNow": "concrete task for notes/system-design.md",
      "doc": "how to continue the notes file",
      "web": { "title": "...", "url": "https://..." },
      "youtube": { "title": "...", "url": "https://www.youtube.com/watch?v=..." }
    }
  ]
}

Rules:
- Exactly ${count} lessons, dayIndex 0..${count - 1}.
- Day 0 MUST be System Design Overview (Client → API → Store) — still required for all years.
- Year 1 / Arts: stay on journeys, screens, simple data — avoid load balancers / CAP / Kafka.
- Year 3–4 Tech: may introduce auth, validation, cache idea, scale awareness — still NOT PhD/research.
- Each later day is a NEW concept (no repeats).
- Prefer real resources matched to level (intro explainers vs intermediate SD).
- Tie doNow to the student's project when possible.
`.trim();
}

function normalizePack(parsed, count, mode) {
  const fb = emergencyLessons(count);
  const lessonsIn = Array.isArray(parsed?.lessons) ? parsed.lessons : [];
  const lessons = [];
  for (let i = 0; i < count; i++) {
    const t = lessonsIn[i] || lessonsIn[i % Math.max(1, lessonsIn.length)] || {};
    const base = fb[i];
    const webUrl = String(t.web?.url || "").trim();
    const ytUrl = String(t.youtube?.url || "").trim();
    lessons.push({
      dayIndex: i,
      title: String(t.title || base.title).trim(),
      learn: String(t.learn || base.learn).trim(),
      note: String(t.note || base.note).trim(),
      doNow: String(t.doNow || base.doNow).trim(),
      doc: String(t.doc || base.doc).trim(),
      web:
        /^https?:\/\//i.test(webUrl)
          ? { title: String(t.web?.title || "System Design resource").trim(), url: webUrl }
          : null,
      youtube:
        /^https?:\/\//i.test(ytUrl) && /youtu/i.test(ytUrl)
          ? { title: String(t.youtube?.title || "System Design video").trim(), url: ytUrl }
          : null,
    });
  }
  return {
    sources: Array.isArray(parsed?.sources) ? parsed.sources.map(String).slice(0, 8) : [],
    lessons,
    mode,
  };
}

async function enrichSystemDesignCurriculumRag(opts = {}) {
  const count = Math.min(40, Math.max(5, Number(opts.numDays) || 12));
  let academicBlock = opts.academicBlock || "";
  if (!academicBlock && opts.inputs) {
    try {
      const { buildAcademicPromptBlock } = require("./academicLevel");
      academicBlock = buildAcademicPromptBlock(opts.inputs).block;
    } catch {
      academicBlock = "";
    }
  }
  const prompt = buildPrompt({
    count,
    syllabusHint: opts.syllabusHint || "",
    projectHint: opts.projectHint || "",
    uploadText: opts.uploadText || opts.systemDesign || "",
    academicBlock,
  });

  console.log(`🌐 RAG System Design curriculum (days=${count})…`);
  let parsed = null;
  let mode = "online";
  try {
    if (!process.env.OPENROUTER_API_KEY) throw new Error("no key");
    parsed = await callOnlineJson(prompt, 4500);
  } catch (err) {
    console.warn("Online SD curriculum RAG failed:", err.message);
    mode = "offline";
    try {
      parsed = await callLLM(
        prompt + `\n\n(Web unavailable — invent a solid beginner path; Day 0 = overview.)`,
        3200
      );
    } catch (err2) {
      console.warn("Offline SD curriculum RAG failed:", err2.message);
      return { lessons: emergencyLessons(count), sources: ["emergency"], mode: "fallback" };
    }
  }

  const pack = normalizePack(parsed, count, mode);
  console.log(`✅ SD curriculum RAG done (mode=${pack.mode}, lessons=${pack.lessons.length})`);
  return pack;
}

function getSdLessonFromPack(pack, dayIdx) {
  if (!pack || !Array.isArray(pack.lessons) || !pack.lessons.length) return null;
  const i = Math.max(0, Number(dayIdx) || 0) % pack.lessons.length;
  return { ...pack.lessons[i], mode: pack.mode, sources: pack.sources };
}

module.exports = {
  enrichSystemDesignCurriculumRag,
  getSdLessonFromPack,
  emergencyLessons,
};
