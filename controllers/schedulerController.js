const express     = require("express");
const { verifyToken } = require("../middleware/auth");
const { detectDifficulty: detectDifficultyService, buildDifficultyAwareSchedule } = require("../services/difficultyScorer");

// POST /detect-difficulty
async function detectDifficulty(req, res) {
  try {
    const { subjects } = req.body;
    if (!subjects || !Array.isArray(subjects))
      return res.status(400).json({ success: false, error: "subjects array required" });

    const results = await detectDifficultyService(subjects);
    res.json({ success: true, subjects: results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// POST /ia
async function buildIASchedule(req, res) {
  try {
    const { subjects, examDays, constraints } = req.body;
    if (!subjects || !examDays)
      return res.status(400).json({ success: false, error: "subjects and examDays required" });

    const schedule = buildDifficultyAwareSchedule(subjects, examDays, constraints || {});
    res.json({ success: true, schedule });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}


module.exports = { detectDifficulty, buildIASchedule };
