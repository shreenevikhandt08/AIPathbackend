const PlannerInput = require("../models/PlannerInput");

/** GET /api/planner-inputs — load wizard inputs for the logged-in user */
async function getPlannerInputs(req, res) {
  try {
    const doc = await PlannerInput.findOne({ userId: req.user.id }).lean();
    if (!doc) {
      return res.json({ success: true, inputs: null });
    }
    const { _id, userId, __v, ...inputs } = doc;
    return res.json({ success: true, inputs });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

/** POST /api/planner-inputs — upsert wizard inputs (partial merge) */
async function savePlannerInputs(req, res) {
  try {
    const body = req.body || {};
    const $set = { userId: req.user.id };

    if (body.textInputs != null) $set.textInputs = body.textInputs;
    if (body.lastGenInputs != null) $set.lastGenInputs = body.lastGenInputs;
    if (body.calendar != null) $set.calendar = body.calendar;
    if (body.timing != null) $set.timing = body.timing;
    if (body.assessmentConfig != null) $set.assessmentConfig = body.assessmentConfig;
    if (body.team != null) $set.team = body.team;
    if (body.enabledModules != null) $set.enabledModules = body.enabledModules;
    if (body.uploadedFiles != null) $set.uploadedFiles = body.uploadedFiles;
    if (typeof body.problemVerified === "boolean") $set.problemVerified = body.problemVerified;

    const doc = await PlannerInput.findOneAndUpdate(
      { userId: req.user.id },
      { $set },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    const { _id, userId, __v, ...inputs } = doc;
    return res.json({ success: true, inputs });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { getPlannerInputs, savePlannerInputs };
