const QuestionBank = require("../models/Questionbank");
const { callLLM }   = require("../utils/llm");


exports.generateQuestions = async (req, res) => {
  try {
    const userId      = req.user.id;
    const { subject, topic, syllabusText = "", counts = {}, difficulty = "mixed", manualInstructions = "" } = req.body;

    if (!subject || !topic) return res.status(400).json({ success: false, error: "subject and topic required" });

    const mcqCount   = Math.min(counts.mcq   ?? 10, 30);
    const shortCount = Math.min(counts.short  ?? 5,  20);
    const longCount  = Math.min(counts.long   ?? 3,  10);

    const diffNote = difficulty === "mixed"
      ? "Mix easy (30%), medium (50%), hard (20%) across questions."
      : `All questions should be ${difficulty} difficulty.`;

    const prompt = `
You are an expert exam question generator for a college-level ${subject} course.
Subject: ${subject}
Topic: ${topic}
Syllabus context: ${syllabusText ? syllabusText.slice(0, 1500) : "General college syllabus"}
${manualInstructions ? "Teacher instructions: " + manualInstructions : ""}
${diffNote}

Generate a complete question bank in this EXACT JSON structure (no markdown, no trailing commas):
{
  "mcq": [
    {
      "question": "Question text",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correct": 0,
      "explanation": "Why this is correct",
      "difficulty": "easy"
    }
  ],
  "shortAnswer": [
    {
      "question": "Question text (answer in 3-5 sentences)",
      "modelAnswer": "Complete model answer",
      "keyPoints": ["Key point 1", "Key point 2", "Key point 3"],
      "marks": 5,
      "difficulty": "medium"
    }
  ],
  "longAnswer": [
    {
      "question": "Question text (detailed essay/descriptive)",
      "modelAnswer": "Detailed model answer covering all aspects",
      "keyPoints": ["Key point 1", "Key point 2", "Key point 3", "Key point 4"],
      "marks": 15,
      "difficulty": "hard",
      "suggestedTime": 20
    }
  ]
}

Generate exactly: ${mcqCount} MCQ, ${shortCount} short answer, ${longCount} long answer questions.
Ensure all questions are specific to the topic and directly testable.
Return ONLY valid JSON. No explanation text outside JSON.
`.trim();

    const raw = await callLLM(prompt, 4096);

    // callLLM already parses JSON — extract arrays safely
    const mcq         = Array.isArray(raw?.mcq)         ? raw.mcq         : [];
    const shortAnswer = Array.isArray(raw?.shortAnswer)  ? raw.shortAnswer : [];
    const longAnswer  = Array.isArray(raw?.longAnswer)   ? raw.longAnswer  : [];

    // Upsert into MongoDB
    const doc = await QuestionBank.findOneAndUpdate(
      { userId, subject, topic },
      { userId, subject, topic, syllabusText, mcq, shortAnswer, longAnswer },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.json({ success: true, data: doc });
  } catch (err) {
    console.error("generateQuestions error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ── GET /api/question-bank ────────────────────────────────────────────────────
// Returns all question banks for the user
exports.getAllBanks = async (req, res) => {
  try {
    const banks = await QuestionBank.find({ userId: req.user.id })
      .select("subject topic createdAt updatedAt mcq shortAnswer longAnswer")
      .sort({ updatedAt: -1 });
    return res.json({ success: true, data: banks });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ── GET /api/question-bank/:id ────────────────────────────────────────────────
exports.getBank = async (req, res) => {
  try {
    const bank = await QuestionBank.findOne({ _id: req.params.id, userId: req.user.id });
    if (!bank) return res.status(404).json({ success: false, error: "Not found" });
    return res.json({ success: true, data: bank });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ── DELETE /api/question-bank/:id ─────────────────────────────────────────────
exports.deleteBank = async (req, res) => {
  try {
    await QuestionBank.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};