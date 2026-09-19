const express        = require("express");
const { verifyToken } = require("../middleware/auth");
const { generateLectureContent } = require("../services/aiGenerator");
const ExamBlueprint  = require("../models/ExamBlueprint");
const LectureContent = require("../models/LectureContent");

function createDefaultContent(subject, topic, type) {
  const defaultNotes = {
    explanation: `Default explanation for "${topic}" in "${subject}". Please provide a syllabus for real content.`,
    definitions: ["Definition 1: placeholder", "Definition 2: placeholder"],
    formula: "Formula placeholder: y = mx + c",
    workedExample: "Example: solve 2x + 3 = 7 → x = 2",
    commonMistakes: ["Mistake 1: forgetting to carry", "Mistake 2: sign error"],
    realWorldApplication: "Used in networking, OSI layer 7."
  };
  const defaultActivity = {
    name: "Group Discussion",
    objective: "Understand the layers",
    duration: 30,
    instructions: ["Form groups", "Discuss each layer"],
    materials: ["Whiteboard", "Markers"],
    learningOutcome: "Students can list all 7 layers.",
    rubric: [{ criterion: "Participation", excellent: "Active", satisfactory: "Moderate", needsWork: "Low" }]
  };
  const defaultWorksheet = {
    shortAnswerQuestions: ["Q1: What is the purpose of the Physical layer?"],
    problemSolving: "Draw the OSI model with correct order.",
    applicationQuestion: "How does TCP fit into the OSI model?",
    hints: ["Think about encapsulation"]
  };
  const defaultAssessment = {
    mcq: [{ question: "Which layer is responsible for routing?", options: ["Physical", "Data Link", "Network", "Transport"], correct: 2 }],
    shortAnswer: ["Explain the difference between TCP and UDP."],
    longAnswer: "Describe the OSI model in detail.",
    markingScheme: "MCQ: 1 mark each, Short: 5 marks, Long: 10 marks"
  };

  const result = { subject, topic };
  if (type === "all" || type === "notes") result.lectureNotes = defaultNotes;
  if (type === "all" || type === "activity") result.activity = defaultActivity;
  if (type === "all" || type === "worksheet") result.worksheet = defaultWorksheet;
  if (type === "all" || type === "assessment") result.assessment = defaultAssessment;
  return result;
}

// POST /
async function generateContent(req, res) {
  console.log("🔵 [lecture-notes] POST received");
  console.log("🔵 body:", req.body);
  console.log("🔵 user:", req.user?.id);

  try {
    const { subject, topic, syllabusText, type = "all" } = req.body;
    let { blueprint } = req.body;

    if (!subject || !topic) {
      return res.status(400).json({ success: false, error: "subject and topic are required" });
    }

    // Fetch blueprint if not provided
    if (!blueprint) {
      blueprint = await ExamBlueprint.findOne({ userId: req.user.id, isActive: true });
      console.log("🔵 blueprint found:", !!blueprint);
    }

    let result;
    try {
      result = await generateLectureContent({ subject, topic, syllabusText, blueprint, type });
      console.log("🔵 AI result keys:", Object.keys(result));
    } catch (aiErr) {
      console.error("❌ AI generation error:", aiErr.message);
      // Fallback to default content
      result = createDefaultContent(subject, topic, type);
      console.log("🔵 Using default content due to AI error.");
    }

    // ── Ensure at least some content ────────────────────────────────────────
    function hasContent(obj) {
      if (!obj) return false;
      return Object.keys(obj).some(key => {
        const val = obj[key];
        if (Array.isArray(val)) return val.length > 0;
        if (typeof val === "string") return val.trim().length > 0;
        return val !== null && val !== undefined;
      });
    }

    // If result has empty fields, fill them with defaults
    const defaultContent = createDefaultContent(subject, topic, type);
    if (result.lectureNotes && !hasContent(result.lectureNotes)) {
      result.lectureNotes = defaultContent.lectureNotes || result.lectureNotes;
    }
    if (result.activity && !hasContent(result.activity)) {
      result.activity = defaultContent.activity || result.activity;
    }
    if (result.worksheet && !hasContent(result.worksheet)) {
      result.worksheet = defaultContent.worksheet || result.worksheet;
    }
    if (result.assessment && !hasContent(result.assessment)) {
      result.assessment = defaultContent.assessment || result.assessment;
    }

    // ── Persist ─────────────────────────────────────────────────────────────
    const saved = await LectureContent.findOneAndUpdate(
      { userId: req.user.id, subject, topic },
      {
        $set: {
          userId: req.user.id,
          subject,
          topic,
          syllabusText: syllabusText || "",
          blueprintVersion: blueprint?.version || null,
          ...(result.lectureNotes ? { lectureNotes: result.lectureNotes } : {}),
          ...(result.activity ? { activity: result.activity } : {}),
          ...(result.worksheet ? { worksheet: result.worksheet } : {}),
          ...(result.assessment ? { assessment: result.assessment } : {}),
        },
      },
      { upsert: true, new: true }
    );

    console.log("💾 Saved document ID:", saved._id);

    res.json({
      success: true,
      content: {
        subject: saved.subject,
        topic: saved.topic,
        lectureNotes: saved.lectureNotes || result.lectureNotes || null,
        activity: saved.activity || result.activity || null,
        worksheet: saved.worksheet || result.worksheet || null,
        assessment: saved.assessment || result.assessment || null,
      },
    });
  } catch (err) {
    console.error("❌ Unhandled error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
}

// GET /
async function listContent(req, res) {
  try {
    const items = await LectureContent.find({ userId: req.user.id })
      .select("subject topic blueprintVersion updatedAt -_id")
      .sort({ updatedAt: -1 });
    res.json({ success: true, items });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// GET /content
async function getContent(req, res) {
  try {
    const { subject, topic } = req.query;
    if (!subject || !topic)
      return res.status(400).json({ success: false, error: "subject and topic query params are required" });

    const item = await LectureContent.findOne({ userId: req.user.id, subject, topic });
    if (!item)
      return res.status(404).json({ success: false, error: "No saved content found" });

    res.json({
      success: true,
      content: {
        subject: item.subject,
        topic: item.topic,
        lectureNotes: item.lectureNotes,
        activity: item.activity,
        worksheet: item.worksheet,
        assessment: item.assessment,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// GET /debug
async function debugContent(req, res) {
  try {
    const items = await LectureContent.find({ userId: req.user.id })
      .select("subject topic -_id");
    console.log("📦 All documents for user:", items.map(d => ({ subject: d.subject, topic: d.topic })));
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// DELETE /content
async function deleteContent(req, res) {
  try {
    const { subject, topic } = req.query;
    if (!subject || !topic) {
      return res.status(400).json({ success: false, error: "subject and topic query params are required" });
    }

    const trimmedSubject = subject.trim();
    const trimmedTopic = topic.trim();

    console.log("🔍 DELETE query:", { userId: req.user.id, subject: trimmedSubject, topic: trimmedTopic });

    // 1. Try case‑insensitive regex without anchors (matches substring)
    let result = await LectureContent.findOneAndDelete({
      userId: req.user.id,
      subject: { $regex: trimmedSubject, $options: "i" },
      topic: { $regex: trimmedTopic, $options: "i" },
    });

    // 2. If not found, try with exact match (case‑sensitive) – maybe the stored value is exactly as sent
    if (!result) {
      result = await LectureContent.findOneAndDelete({
        userId: req.user.id,
        subject: trimmedSubject,
        topic: trimmedTopic,
      });
    }

    // 3. If still not found, use $where to compare lowercased strings (slower but foolproof)
    if (!result) {
      const docs = await LectureContent.find({
        userId: req.user.id,
        $where: function() {
          return this.subject.toLowerCase() === trimmedSubject.toLowerCase() &&
                 this.topic.toLowerCase() === trimmedTopic.toLowerCase();
        }
      });
      if (docs.length > 0) {
        result = await LectureContent.findOneAndDelete({ _id: docs[0]._id });
      }
    }

    if (!result) {
      console.log("❌ No document found – check MongoDB manually");
      return res.status(404).json({ success: false, error: "No saved content found" });
    }

    console.log("✅ Deleted:", result.subject, result.topic);
    res.json({ success: true, message: "Deleted successfully" });
  } catch (err) {
    console.error("❌ Delete error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
}


module.exports = { generateContent, listContent, getContent, debugContent, deleteContent };
