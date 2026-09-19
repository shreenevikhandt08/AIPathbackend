const mongoose = require("mongoose");

/**
 * Schedule version management:
 * V1 → V2 → V3 with previous/new snapshots, semantic diff, trigger, changedBy,
 * timestamp, rollback, faculty protected override, and audit linkage.
 */
const planVersionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  /** Global storage id (unique across account). Per-student display uses memberVersion. */
  version: { type: Number, required: true },
  /** Pointer to previous version number for this student lane when available */
  previousVersion: { type: Number, default: null },
  memberKey: { type: String, default: "default", trim: true },
  memberName: { type: String, default: "Solo", trim: true },
  /** Per-student Version 1, 2, 3… (separate lane per name/email) */
  memberVersion: { type: Number },
  changeType: { type: String, required: true },
  reason: { type: String, default: "" },
  /**
   * What caused this version:
   * holiday_added | leave_added | task_pending | faculty_override | regenerate | …
   */
  trigger: { type: String, default: "other", trim: true },
  /** AI | Faculty | Admin | Student | System */
  changedBy: { type: String, default: "Student", trim: true },
  changedByEmail: { type: String, default: "", trim: true },
  /** Faculty / manual override — protected from auto regen / leave push when true */
  protected: { type: Boolean, default: false },
  /** Slot keys (day|time|activity) marked protected on this version */
  protectedSlots: { type: [String], default: [] },
  /** New version schedule/content snapshot */
  plan: { type: mongoose.Schema.Types.Mixed, required: true },
  /** Previous version schedule/content snapshot (for side-by-side & rollback safety) */
  previousPlan: { type: mongoose.Schema.Types.Mixed, default: null },
  leaveEvents: { type: Array, default: [] },
  /** Semantic diff vs previous (moved / added / removed / modified) */
  diff: { type: mongoose.Schema.Types.Mixed, default: null },
  /** Human-readable difference line, e.g. "Physics moved from Monday → Wednesday" */
  differenceSummary: { type: String, default: "" },
}, { timestamps: true });

planVersionSchema.index({ userId: 1, version: -1 });
planVersionSchema.index({ userId: 1, memberKey: 1, memberVersion: -1 });
planVersionSchema.index({ userId: 1, trigger: 1, createdAt: -1 });

planVersionSchema.pre("validate", async function assignMemberVersion(next) {
  try {
    if (!this.memberKey) this.memberKey = "default";
    if (!this.memberName) this.memberName = "Solo";
    // Only auto-number when caller did not set memberVersion
    if (!Number.isFinite(Number(this.memberVersion)) || Number(this.memberVersion) < 1) {
      const latest = await this.constructor
        .findOne({ userId: this.userId, memberKey: this.memberKey })
        .sort({ memberVersion: -1 })
        .select("memberVersion");
      const prev = Number(latest?.memberVersion) || 0;
      this.memberVersion = prev + 1;
    }
    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.model("PlanVersion", planVersionSchema);
