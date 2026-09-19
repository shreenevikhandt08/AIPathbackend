const mongoose = require("mongoose");

const questionBankSchema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  subject:      { type: String, required: true },
  topic:        { type: String, required: true },
  syllabusText: { type: String, default: "" },
  mcq: [
    {
      question: String,
      options:  [String],   // exactly 4
      correct:  Number,     // 0-3 index
      explanation: String,
      difficulty: { type: String, enum: ["easy","medium","hard"] },
    }
  ],
  shortAnswer: [
    {
      question:       String,
      modelAnswer:    String,
      keyPoints:      [String],
      marks:          Number,
      difficulty:     { type: String, enum: ["easy","medium","hard"] },
    }
  ],
  longAnswer: [
    {
      question:       String,
      modelAnswer:    String,
      keyPoints:      [String],
      marks:          Number,
      difficulty:     { type: String, enum: ["easy","medium","hard"] },
      suggestedTime:  Number, // minutes
    }
  ],
}, { timestamps: true });

questionBankSchema.index({ userId: 1, subject: 1, topic: 1 }, { unique: true });

module.exports = mongoose.model("QuestionBank", questionBankSchema);