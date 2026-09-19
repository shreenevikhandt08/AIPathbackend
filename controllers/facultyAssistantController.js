const express    = require("express");
const { verifyToken } = require("../middleware/auth");
const { generateFacultyActivity } = require("../services/aiGenerator");

// POST /
async function generateActivity(req, res) {
  try {
    const { subject, topic, duration = 45, learningOutcome, syllabusText } = req.body;
    if (!subject || !topic)
      return res.status(400).json({ success: false, error: "subject and topic are required" });

    const result = await generateFacultyActivity({ subject, topic, duration, learningOutcome, syllabusText });
    res.json({ success: true, activity: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}


module.exports = { generateActivity };
