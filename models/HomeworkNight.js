const mongoose = require("mongoose");

/**
 * Tonight's Homework — one Mongo document per user per night.
 * Kept separate from DailyPlan so homework is a first-class professional module.
 */
const homeworkTaskSchema = new mongoose.Schema(
  {
    index: { type: Number, default: 0 },
    title: { type: String, default: "" },
    kind: { type: String, default: "task" }, // leetcode | exercism | agent | linkedin | case | task
    body: { type: String, default: "" },
    doneWhen: { type: String, default: "" },
    url: { type: String, default: "" },
    done: { type: Boolean, default: false },
  },
  { _id: false }
);

const homeworkNightSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    dayId: { type: String, required: true }, // e.g. "Week 1 - Monday (01-07-2026)"
    week: { type: Number, required: true, index: true },
    dayName: { type: String, required: true }, // Monday .. Friday
    date: { type: String, default: null }, // YYYY-MM-DD when known
    time: { type: String, default: "" },
    activity: { type: String, default: "Tonight's Homework" },
    /** Full homework text block for this night */
    content: { type: String, default: "" },
    /** Parsed task checklist (optional; content remains source of truth for export) */
    tasks: { type: [homeworkTaskSchema], default: [] },
    nightDone: { type: Boolean, default: false },
    source: {
      type: String,
      enum: ["generate", "sync-from-daily", "edit", "regenerate", "import"],
      default: "sync-from-daily",
    },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

homeworkNightSchema.index({ userId: 1, dayId: 1 }, { unique: true });
homeworkNightSchema.index({ userId: 1, week: 1, dayName: 1 });

module.exports = mongoose.model("HomeworkNight", homeworkNightSchema);
