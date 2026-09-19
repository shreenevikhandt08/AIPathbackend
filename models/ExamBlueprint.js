
const mongoose = require("mongoose");

const patternSchema = new mongoose.Schema(
  {
    count: Number,
    questionType: String,
    marks: Number,
  },
  { _id: false }
);

const blueprintSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    version: { type: Number, required: true },
    name: { type: String, default: "Exam Blueprint" },

    pattern: {
      partA: {
        type: patternSchema,
        default: {
          count: 20,
          questionType: "MCQ",
          marks: 1,
        },
      },
      partB: {
        type: patternSchema,
        default: {
          count: 5,
          questionType: "Short Answer",
          marks: 5,
        },
      },
      partC: {
        type: patternSchema,
        default: {
          count: 2,
          questionType: "Essay",
          marks: 10,
        },
      },
    },

    notes: { type: String, default: "" },
    isActive: { type: Boolean, default: false },
  },
  { timestamps: true }
);

blueprintSchema.index({ userId: 1, version: -1 });

module.exports = mongoose.model("ExamBlueprint", blueprintSchema);