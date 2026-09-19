const mongoose = require("mongoose");

const mcqSchema = {
  question:    String,
  options:     [String],   // exactly 4
  correct:     Number,     // 0-3 index
  explanation: String,
  difficulty:  { type: String, enum: ["easy", "medium", "hard"] },
};

const placementBankSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  company:    { type: String, required: true },
  level:      { type: String, enum: ["easy", "medium", "hard", "mixed"], default: "mixed" },

  // What we learned from the live web search — kept for transparency,
  // so the user can see this isn't hard-coded / copy-pasted.
  pattern: {
    rounds:     [String],
    sections:   [{ name: String, topics: [String] }],
    difficulty: String,
    notes:      String,
    sources:    [String],
    isLive:     Boolean,
  },

  // Freshly generated original practice questions, grouped by section name
  // (e.g. "Quantitative Aptitude", "Logical Reasoning", "Technical").
  sections: [
    {
      name:     String,
      topics:   [String],
      mcq:      [mcqSchema],
    }
  ],
}, { timestamps: true });

placementBankSchema.index({ userId: 1, company: 1, level: 1 });

module.exports = mongoose.model("PlacementBank", placementBankSchema);
