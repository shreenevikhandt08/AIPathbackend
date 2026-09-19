/**
 * Global engine lessons — persist regeneration feedback so mistakes
 * are not repeated for ANY later login / plan generation.
 */
const mongoose = require("mongoose");

const engineLessonSchema = new mongoose.Schema(
  {
    /** Stable key so the same class of mistake is upserted, not duplicated */
    ruleKey: { type: String, required: true, unique: true, index: true },
    /** Human-readable rule injected into generators */
    rule: { type: String, required: true },
    /** Original feedback / issue text */
    sourceFeedback: { type: String, default: "" },
    /** daily | weekly | homework | all */
    surface: { type: String, default: "all", index: true },
    /** Tags e.g. repetition, leetcode, links, placement */
    tags: { type: [String], default: [] },
    active: { type: Boolean, default: true, index: true },
    hitCount: { type: Number, default: 1 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("EngineLesson", engineLessonSchema);
