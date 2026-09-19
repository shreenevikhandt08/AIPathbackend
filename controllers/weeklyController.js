const WeeklyPlan = require("../models/WeeklyPlan");

/** GET /api/weekly — load saved weekly plan */
async function getWeekly(req, res) {
  try {
    const doc = await WeeklyPlan.findOne({ userId: req.user.id, module: "weekly" }).lean();
    if (!doc) return res.json({ success: true, plan: null });
    return res.json({
      success: true,
      plan: {
        module: "weekly",
        title: doc.title,
        columns: doc.columns,
        rows: doc.rows || [],
        source: doc.source,
        lastSyncedAt: doc.lastSyncedAt,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

/** POST /api/weekly/sync — save client weekly plan rows to Mongo */
async function saveWeekly(req, res) {
  try {
    const { plan } = req.body || {};
    if (!plan?.rows || !Array.isArray(plan.rows)) {
      return res.status(400).json({ success: false, error: "plan.rows required" });
    }

    const doc = await WeeklyPlan.findOneAndUpdate(
      { userId: req.user.id, module: "weekly" },
      {
        $set: {
          userId: req.user.id,
          module: "weekly",
          title: plan.title || "Weekly Plan",
          columns:
            plan.columns ||
            ["Week", "Days", "Subjects Covered", "Project Milestone", "Exam Focus"],
          rows: plan.rows,
          source: plan.source || "client-save",
          lastSyncedAt: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    try {
      const { audit } = require("../utils/auditLog");
      audit(req, {
        entity: "weekly",
        action: "weekly.save",
        summary: `Weekly plan saved — ${Array.isArray(plan.rows) ? plan.rows.length : 0} week(s)`,
        meta: {
          weeklyRows: Array.isArray(plan.rows) ? plan.rows.length : 0,
          source: plan.source || "client-save",
        },
      });
    } catch (_) {}

    return res.json({
      success: true,
      plan: {
        module: "weekly",
        title: doc.title,
        columns: doc.columns,
        rows: doc.rows,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { getWeekly, saveWeekly };
