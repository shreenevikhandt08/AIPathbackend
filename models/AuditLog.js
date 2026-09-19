const mongoose = require("mongoose");

/**
 * Lightweight audit trail for schedule / content / system changes.
 * Separate from PlanVersion (full restore snapshots).
 */
const auditLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    actorEmail: { type: String, default: "" },
    entity: {
      type: String,
      required: true,
      enum: [
        "plan",
        "daily",
        "weekly",
        "homework",
        "disruption",
        "leave",
        "blueprint",
        "inputs",
        "content",
        "system",
      ],
      index: true,
    },
    action: { type: String, required: true }, // e.g. "version.save", "daily.regenerate"
    summary: { type: String, required: true },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    source: { type: String, default: "" }, // API route
  },
  { timestamps: true }
);

auditLogSchema.index({ userId: 1, createdAt: -1 });
auditLogSchema.index({ entity: 1, createdAt: -1 });
auditLogSchema.index({ userId: 1, "meta.memberKey": 1, createdAt: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
