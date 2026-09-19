const { getAssessmentBanks, DEFAULT_ASSESSMENT_CONFIG } = require("../data/assessmentBanks");
const { pickForDay, parseAssessmentConfig } = require("../utils/assessmentPicker");

function getBanks(req, res) {
  try {
    return res.json({
      success: true,
      data: getAssessmentBanks(),
      defaultConfig: DEFAULT_ASSESSMENT_CONFIG,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// GET /api/assessment/pick?day=0  — preview what a day would get
function previewPick(req, res) {
  try {
    const dayIdx = Math.max(0, Number(req.query.day) || 0);
    let config = DEFAULT_ASSESSMENT_CONFIG;
    if (req.query.config) {
      try {
        config = parseAssessmentConfig({ _assessmentConfig: req.query.config });
      } catch (_) { /* keep default */ }
    }
    return res.json({ success: true, dayIdx, picks: pickForDay(dayIdx, config) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { getBanks, previewPick };
