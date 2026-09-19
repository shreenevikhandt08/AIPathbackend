const mongoose = require("mongoose");

/**
 * Durable store for Path Builder wizard inputs + last generation payload
 * (includes extracted text from uploaded PDFs/docs — binaries are not kept).
 */
const plannerInputSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    textInputs: { type: mongoose.Schema.Types.Mixed, default: {} },
    lastGenInputs: { type: mongoose.Schema.Types.Mixed, default: {} },
    calendar: {
      startDate: { type: String, default: "" },
      endDate: { type: String, default: "" },
      calendarData: { type: mongoose.Schema.Types.Mixed, default: null },
      exams: { type: Array, default: [] },
    },
    timing: {
      numDays: { type: Number, default: null },
      dailyStart: { type: String, default: "" },
      dailyEnd: { type: String, default: "" },
      lunchStart: { type: String, default: "" },
      lunchEnd: { type: String, default: "" },
      breaks: { type: Array, default: [] },
      breakStart: { type: String, default: "" },
      breakEnd: { type: String, default: "" },
      dtActivated: { type: mongoose.Schema.Types.Mixed, default: null },
    },
    assessmentConfig: { type: mongoose.Schema.Types.Mixed, default: {} },
    team: {
      members: { type: Array, default: [] },
      teamName: { type: String, default: "" },
      linkedPsId: { type: String, default: "" },
      teamDays: { type: mongoose.Schema.Types.Mixed, default: null },
    },
    enabledModules: { type: mongoose.Schema.Types.Mixed, default: {} },
    /** Per-field file metadata: filename, url, key, size, uploadedAt */
    uploadedFiles: { type: mongoose.Schema.Types.Mixed, default: {} },
    problemVerified: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PlannerInput", plannerInputSchema);
