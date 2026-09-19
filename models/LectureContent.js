const mongoose = require("mongoose");

const lectureContentSchema = new mongoose.Schema({
  userId:          { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  subject:         { type: String, required: true },
  topic:           { type: String, required: true },
  syllabusText:    { type: String, default: "" },
  blueprintVersion:{ type: Number, default: null }, // which blueprint version this content was generated against
  lectureNotes:    { type: mongoose.Schema.Types.Mixed, default: null },
  activity:        { type: mongoose.Schema.Types.Mixed, default: null },
  worksheet:       { type: mongoose.Schema.Types.Mixed, default: null },
  assessment:      { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true });

lectureContentSchema.index({ userId: 1, subject: 1, topic: 1 }, { unique: true });

module.exports = mongoose.model("LectureContent", lectureContentSchema);
