const mongoose = require("mongoose");

const subjectSchema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  name:         { type: String, required: true },
  units:        { type: Array, default: [] },       // week-by-week topics
  syllabusText: { type: String, default: "" },        // raw text used for difficulty detection
  source:       { type: String, default: "planner" }, // "planner" | "manual" (added via + button)
}, { timestamps: true });

subjectSchema.index({ userId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("Subject", subjectSchema);
