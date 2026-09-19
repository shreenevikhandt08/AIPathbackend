const mongoose = require("mongoose");

/**
 * Campus-scoped schedule repository.
 *
 * Students do NOT browse a campus-wide list. Lookup auto-resolves by cohort:
 *   campus + department + year/grade + semester + planner mode + days
 *
 * kind:
 *   - template  → official cohort schedule (faculty/admin published)
 *   - personal  → a user's/team save (visible to owner + same cohort soft match)
 *
 * visibility:
 *   - private  → only sourceUserId
 *   - cohort   → same campus/dept/year/sem soft fingerprint
 *   - campus   → same campus (admin / rare)
 */
const scheduleRepositorySchema = new mongoose.Schema(
  {
    fingerprint: { type: String, required: true, index: true },
    softFingerprint: { type: String, required: true, index: true },
    cohortKey: { type: String, default: "", index: true },
    key: { type: mongoose.Schema.Types.Mixed, default: {} },
    title: { type: String, default: "" },
    memberName: { type: String, default: "", index: true },
    memberKey: { type: String, default: "", index: true },
    /** Daily schedule (source of truth for day slots; may include homework activity rows). */
    plan: { type: mongoose.Schema.Types.Mixed, required: true },
    /** Weekly overview plan */
    weekly: { type: mongoose.Schema.Types.Mixed, default: null },
    /** Dedicated homework module plan (nights / tasks) */
    homework: { type: mongoose.Schema.Types.Mixed, default: null },
    /**
     * Version Management snapshots for this member (V1…Vn) so GitHub/DB can reopen history.
     * Each item: { version, memberVersion, changeType, createdAt, plan, reason?, trigger? }
     */
    versions: { type: [mongoose.Schema.Types.Mixed], default: [] },
    /** Counts / pointers for quick listing */
    bundleMeta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    inputsSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    campus: { type: String, default: "" },
    department: { type: String, default: "" },
    year: { type: String, default: "" },
    semester: { type: String, default: "" },
    mode: { type: String, default: "" },
    numDays: { type: Number, default: null },
    problemPreview: { type: String, default: "" },
    useCount: { type: Number, default: 0 },
    sourceUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    kind: {
      type: String,
      enum: ["template", "personal"],
      default: "personal",
      index: true,
    },
    status: {
      type: String,
      enum: ["draft", "published"],
      default: "published",
      index: true,
    },
    visibility: {
      type: String,
      enum: ["private", "cohort", "campus"],
      default: "cohort",
      index: true,
    },
    isPublic: { type: Boolean, default: true }, // legacy; prefer visibility
  },
  { timestamps: true }
);

scheduleRepositorySchema.index({ fingerprint: 1, updatedAt: -1 });
scheduleRepositorySchema.index({ softFingerprint: 1, kind: 1, useCount: -1 });
scheduleRepositorySchema.index({ cohortKey: 1, kind: 1, status: 1, useCount: -1 });
scheduleRepositorySchema.index({ sourceUserId: 1, updatedAt: -1 });

module.exports = mongoose.model("ScheduleRepository", scheduleRepositorySchema);
