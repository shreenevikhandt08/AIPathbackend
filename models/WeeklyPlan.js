const mongoose = require("mongoose");

const weeklyPlanSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  module: { type: String, default: "weekly" },
  title: { type: String, default: "Weekly Plan" },
  columns: { type: [String], default: ["Week", "Day", "Schedule", "Notes"] },
  rows: { type: Array, default: [] },
  source: { type: String, default: "daily-sync" },
  lastSyncedAt: { type: Date, default: Date.now },
}, { timestamps: true });

weeklyPlanSchema.index({ userId: 1, module: 1 }, { unique: true });

module.exports = mongoose.model("WeeklyPlan", weeklyPlanSchema);
