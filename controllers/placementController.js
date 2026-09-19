const PlacementBank = require("../models/placementBank");
const { callLLM } = require("../utils/llm");
const { getCompanyExamPattern } = require("../utils/placementSearch");
const { COMPANIES } = require("../utils/companyList");

// ── GET /api/placement/companies ──────────────────────────────────────────────
exports.getCompanies = async (req, res) => {
  return res.json({ success: true, data: COMPANIES });
};

function robustJsonParse(raw) {
  const clean = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  // Strategy 1 — plain parse
  try { return JSON.parse(clean); } catch (_) {}

  // Strategy 2 — first {...} blob
  const blobMatch = clean.match(/(\{[\s\S]*\})/);
  if (blobMatch) {
    try { return JSON.parse(blobMatch[1]); } catch (_) {}
  }

  // Strategy 3 — find the deepest well-balanced closing brace
  // Walk forward tracking depth; record the index of every depth-0 close.
  let depth = 0, lastGoodClose = -1;
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] === "{") depth++;
    else if (clean[i] === "}") {
      depth--;
      if (depth === 0) lastGoodClose = i;
    }
  }
  if (lastGoodClose > 0) {
    try { return JSON.parse(clean.slice(0, lastGoodClose + 1)); } catch (_) {}
  }

  // Strategy 4 — trim from the tail one char at a time (truncated JSON)
  // Cap at 200 attempts so this doesn't spin forever on completely broken output.
  let trimmed = clean;
  for (let i = 0; i < 200; i++) {
    trimmed = trimmed.slice(0, -1).trimEnd();
    // Quick heuristic: only bother trying if we're close to a "}" or "]"
    const last = trimmed[trimmed.length - 1];
    if (last === "}" || last === "]" || last === '"') {
      // Try auto-closing and parsing
      const candidates = [
        trimmed,
        trimmed + "}",
        trimmed + "]}",
        trimmed + '"]}',
        trimmed + '"}]}',
        trimmed + '"]}]}',
      ];
      for (const c of candidates) {
        try { return JSON.parse(c); } catch (_) {}
      }
    }
  }

  throw new Error(`No JSON in response: ${raw.slice(0, 300)}`);
}

/**
 * Generate questions for ONE section.
 * Keeping each LLM call to a single section dramatically reduces token usage
 * and eliminates the truncation problem.
 */
async function generateSectionQuestions(companyName, section, level, perSection, ctx = {}) {
  const diffNote = level === "mixed"
    ? "Mix easy (30%), medium (50%), hard (20%) across questions."
    : `All questions should be ${level} difficulty.`;

  const roleLine = ctx.role ? `Target role: ${ctx.role}.` : "";
  const dsaLine = ctx.dsaHint ? `Student DSA focus: ${String(ctx.dsaHint).slice(0, 280)}.` : "";
  const problemLine = ctx.problemHint
    ? `Student project context (do NOT copy verbatim into questions): ${String(ctx.problemHint).slice(0, 220)}.`
    : "";

  const prompt = `
You are an expert placement-exam question setter creating ORIGINAL practice questions
for students preparing for "${companyName}" campus recruitment.

${roleLine}
${dsaLine}
${problemLine}

Section: "${section.name}"
Topics reported for this company section: ${(section.topics || []).join(", ") || "general"}
Also include themes similar to past/common ${companyName} questions for this section — but write ORIGINAL questions only (never copy real past papers verbatim).

${diffNote}
Generate exactly ${perSection} multiple-choice questions for this section.

RULES:
- Every question must be completely ORIGINAL — do NOT reproduce any real past questions.
- Cover the topics listed above; distribute questions across them.
- Prefer themes that often appear in ${companyName} placement rounds for this section.
- Each question must have exactly 4 options (A-D).
- "correct" is the 0-based index of the correct option (0=A, 1=B, 2=C, 3=D).

Return ONLY this JSON, no markdown, no commentary:
{
  "name": "${section.name}",
  "topics": ${JSON.stringify(section.topics || [])},
  "mcq": [
    {
      "question": "Question text",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correct": 0,
      "explanation": "Why this is correct (1-2 sentences)",
      "difficulty": "easy"
    }
  ]
}
`.trim();

  // Token budget per section: 300 tokens input + ~110 tokens per question output
  const maxTokens = Math.min(400 + perSection * 120, 4096);
  const raw = await callLLM(prompt, maxTokens);

  // callLLM may return a pre-parsed object or a raw string depending on the impl
  if (raw && typeof raw === "object" && Array.isArray(raw.mcq)) return raw;
  if (typeof raw === "string") return robustJsonParse(raw);

  // callLLM returned something unexpected — try to coerce it
  throw new Error(`Unexpected callLLM return type for section "${section.name}"`);
}

// ── POST /api/placement/generate ──────────────────────────────────────────────
// Body: { company, level, questionsPerSection, refreshPattern }
//
// FIX: The original single-prompt approach put ALL sections into one LLM call,
// easily exceeding 4096 tokens and producing truncated JSON.
// Now we call the LLM ONCE PER SECTION so each response is small and complete.
exports.generateQuestions = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      company,
      level = "mixed",
      questionsPerSection = 8,
      refreshPattern = false,
      role = "",
      problemHint = "",
      dsaHint = "",
    } = req.body;

    if (!company || !company.trim()) {
      return res.status(400).json({ success: false, error: "company is required" });
    }
    const companyName = company.trim();
    const perSection = Math.min(Math.max(Number(questionsPerSection) || 8, 3), 20);
    const plannerCtx = { role, problemHint, dsaHint };

    // ── Step 1: retrieve current exam pattern via live search ──────────────
    const { pattern, cached } = await getCompanyExamPattern(companyName, !!refreshPattern);

    // ── Step 2: generate questions ONE section at a time ───────────────────
    // This replaces the old single mega-prompt that truncated at 4096 tokens.
    const sections = [];
    const sectionErrors = [];

    for (const section of pattern.sections) {
      try {
        const result = await generateSectionQuestions(
          companyName,
          section,
          level,
          perSection,
          plannerCtx
        );
        // Normalise — ensure we always have an mcq array
        sections.push({
          name:   result.name   || section.name,
          topics: result.topics || section.topics || [],
          mcq:    Array.isArray(result.mcq) ? result.mcq : [],
        });
      } catch (sectionErr) {
        console.error(
          `placement: section "${section.name}" failed — ${sectionErr.message}`
        );
        sectionErrors.push(section.name);
        // Keep going: push the section with an empty mcq so the UI still renders it
        sections.push({ name: section.name, topics: section.topics || [], mcq: [] });
      }
    }

    if (sections.length === 0) {
      return res.status(500).json({ success: false, error: "All sections failed to generate" });
    }

    // Warn in the response if some sections had errors (non-fatal)
    const warningNote = sectionErrors.length
      ? `Note: ${sectionErrors.length} section(s) failed and returned 0 questions: ${sectionErrors.join(", ")}`
      : undefined;

    const doc = await PlacementBank.create({
      userId,
      company: companyName,
      level,
      pattern: {
        rounds:     pattern.rounds,
        sections:   pattern.sections,
        difficulty: pattern.difficulty,
        notes:      pattern.notes,
        sources:    pattern.sources,
        isLive:     pattern.isLive,
      },
      sections,
    });

    return res.json({
      success: true,
      data: doc,
      meta: {
        patternCached: cached,
        isLive: pattern.isLive,
        ...(warningNote && { warning: warningNote }),
      },
    });
  } catch (err) {
    console.error("placement generateQuestions error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ── GET /api/placement ────────────────────────────────────────────────────────
exports.getAllBanks = async (req, res) => {
  try {
    const banks = await PlacementBank.find({ userId: req.user.id })
      .select("company level pattern.isLive createdAt updatedAt sections")
      .sort({ updatedAt: -1 });
    return res.json({ success: true, data: banks });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ── GET /api/placement/:id ────────────────────────────────────────────────────
exports.getBank = async (req, res) => {
  try {
    const bank = await PlacementBank.findOne({ _id: req.params.id, userId: req.user.id });
    if (!bank) return res.status(404).json({ success: false, error: "Not found" });
    return res.json({ success: true, data: bank });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ── DELETE /api/placement/:id ─────────────────────────────────────────────────
exports.deleteBank = async (req, res) => {
  try {
    await PlacementBank.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};