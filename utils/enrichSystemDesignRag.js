/**
 * System Design starter topics via LLM (not web RAG) — short schedule lines only.
 * Same schedule rules as before: Topic / Learn / In project / Do.
 */
const { callLLM } = require("./llm");

function clip(text, n = 600) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function asText(v) {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join("; ");
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch (_) {
      return "";
    }
  }
  return String(v).trim();
}

function normalizeUnit(u = {}) {
  const first = (...keys) => {
    for (const k of keys) {
      const v = u[k];
      if (Array.isArray(v) && v.length) return asText(v[0]);
      const t = asText(v);
      if (t) return t;
    }
    return "";
  };

  return {
    title: first("title") || "System Design basics",
    learn: first("learn", "concept", "oneLiner"),
    inProject: first("inProject", "whereInProject"),
    doToday: first("doToday", "howToUse", "do"),
  };
}

function buildSdStarterPrompt(syllabusHint, projectHint, count) {
  return `
You write SHORT System Design schedule lines for a college daily planner (not a textbook).

Syllabus hint: ${clip(syllabusHint, 350) || "(none)"}
Project hint: ${clip(projectHint, 250) || "(none)"}

Return ONLY valid JSON:
{
  "bigTitle": "System Design",
  "bigOneLiner": "one short sentence",
  "starterUnits": [
    {
      "title": "short topic name",
      "learn": "ONE short line — what to learn today",
      "inProject": "ONE short line — where it fits in the student project",
      "doToday": "ONE short action line"
    }
  ]
}

Rules:
- Exactly ${count} starterUnits.
- Each field is ONE short line (max ~20 words). No essays. No analogy paragraphs.
- No sampleData. No keyPoints arrays. No restaurant analogies.
- Strings only — never nested objects.
- Keep Class ~6 clarity: clear, not baby talk, not heavy jargon.
- Day 1 = foundation; Day 2 = map one action onto the project.
`;
}

const OFFLINE_STARTER_FALLBACK = {
  bigTitle: "System Design",
  bigOneLiner: "plan parts, data, and flow before heavy coding",
  starterUnits: [
    {
      title: "System Design basics",
      learn: "Plan Client → Logic/API → Store before deep coding.",
      inProject: "Name those 3 parts for your uploaded problem.",
      doToday: "Write goal + 3 part names in notes.",
    },
    {
      title: "One action end-to-end",
      learn: "Follow one user action across Client → Logic → Store.",
      inProject: "Pick the main action from your problem statement.",
      doToday: "Sketch that one action with boxes and arrows.",
    },
  ],
};

/**
 * Build SD starter pack with LLM. Export name kept for existing callers.
 */
async function enrichSystemDesignRag(opts = {}) {
  const syllabusHint = String(opts.syllabusHint || opts.systemDesign || "").trim();
  const projectHint = String(opts.projectHint || opts.project || opts.problem || "").trim();
  const count = Math.min(3, Math.max(2, Number(opts.count) || 2));

  if (!process.env.OPENROUTER_API_KEY) {
    return {
      source: "offline-fallback",
      bigTitle: OFFLINE_STARTER_FALLBACK.bigTitle,
      bigOneLiner: OFFLINE_STARTER_FALLBACK.bigOneLiner,
      starterUnits: OFFLINE_STARTER_FALLBACK.starterUnits,
    };
  }

  try {
    const data = await callLLM(
      buildSdStarterPrompt(syllabusHint, projectHint, count),
      1000
    );
    const units = (Array.isArray(data?.starterUnits) ? data.starterUnits : [])
      .map(normalizeUnit)
      .filter((u) => u.title && (u.learn || u.doToday));

    if (units.length < 2) throw new Error("too few starter units");

    console.log(`✅ System Design starters (LLM): ${units.length} short units`);
    return {
      source: "llm",
      bigTitle: asText(data.bigTitle) || "System Design",
      bigOneLiner: asText(data.bigOneLiner) || OFFLINE_STARTER_FALLBACK.bigOneLiner,
      starterUnits: units.slice(0, count),
    };
  } catch (err) {
    console.warn(`⚠️ System Design LLM starters failed: ${err.message} — offline fallback`);
    return {
      source: "offline-fallback",
      bigTitle: OFFLINE_STARTER_FALLBACK.bigTitle,
      bigOneLiner: OFFLINE_STARTER_FALLBACK.bigOneLiner,
      starterUnits: OFFLINE_STARTER_FALLBACK.starterUnits,
      error: err.message,
    };
  }
}

function getSdStarterLesson(pack) {
  if (!pack || !Array.isArray(pack.starterUnits) || !pack.starterUnits.length) {
    return {
      bigTitle: OFFLINE_STARTER_FALLBACK.bigTitle,
      bigOneLiner: OFFLINE_STARTER_FALLBACK.bigOneLiner,
      units: OFFLINE_STARTER_FALLBACK.starterUnits,
    };
  }
  return {
    bigTitle: asText(pack.bigTitle) || OFFLINE_STARTER_FALLBACK.bigTitle,
    bigOneLiner: asText(pack.bigOneLiner) || OFFLINE_STARTER_FALLBACK.bigOneLiner,
    units: pack.starterUnits.map(normalizeUnit),
  };
}

module.exports = {
  enrichSystemDesignRag,
  enrichSystemDesignStarters: enrichSystemDesignRag,
  getSdStarterLesson,
  OFFLINE_STARTER_FALLBACK,
};
