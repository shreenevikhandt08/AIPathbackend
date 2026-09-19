const AuditLog = require("../models/AuditLog");
const { entityListFilter } = require("../utils/auditLog");

/**
 * GET /api/audit-logs
 * Query: entity, action, from, to, limit, skip, memberKey
 * Scoped to the logged-in account (userId). Optional memberKey filters one student's lane.
 */
async function listAuditLogs(req, res) {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const skip = Math.max(0, parseInt(req.query.skip, 10) || 0);
    const entity = req.query.entity && req.query.entity !== "all" ? String(req.query.entity) : "all";
    const memberKey = String(req.query.memberKey || "").trim();
    const q = entityListFilter(req.user.id, entity, { memberKey });

    if (req.query.action) {
      q.action = new RegExp(String(req.query.action).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    }
    if (req.query.from || req.query.to) {
      q.createdAt = {};
      if (req.query.from) q.createdAt.$gte = new Date(req.query.from);
      if (req.query.to) q.createdAt.$lte = new Date(req.query.to);
    }

    const baseUser = { userId: req.user.id };
    const [logs, total, entityCounts, memberRows] = await Promise.all([
      AuditLog.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      AuditLog.countDocuments(q),
      AuditLog.aggregate([
        { $match: baseUser },
        { $group: { _id: "$entity", count: { $sum: 1 } } },
      ]),
      AuditLog.aggregate([
        { $match: baseUser },
        {
          $group: {
            _id: { $ifNull: ["$meta.memberKey", "default"] },
            memberName: { $first: { $ifNull: ["$meta.memberName", "Solo"] } },
            count: { $sum: 1 },
          },
        },
        { $sort: { memberName: 1 } },
      ]),
    ]);

    const byEntity = {};
    for (const row of entityCounts) {
      if (row?._id) byEntity[row._id] = row.count;
    }

    // Chip counts include legacy plan→area mapping
    try {
      const [dailyEst, weeklyEst, homeworkEst] = await Promise.all([
        AuditLog.countDocuments(entityListFilter(req.user.id, "daily", { memberKey })),
        AuditLog.countDocuments(entityListFilter(req.user.id, "weekly", { memberKey })),
        AuditLog.countDocuments(entityListFilter(req.user.id, "homework", { memberKey })),
      ]);
      byEntity.daily = dailyEst;
      byEntity.weekly = weeklyEst;
      byEntity.homework = homeworkEst;
    } catch (_) { /* optional */ }

    const members = (memberRows || []).map((r) => ({
      memberKey: r._id || "default",
      memberName: r.memberName || "Solo",
      count: r.count || 0,
    }));

    res.json({
      success: true,
      total,
      byEntity,
      members,
      logs: logs.map((l) => ({
        id: l._id,
        entity: l.entity,
        action: l.action,
        summary: l.summary,
        meta: l.meta || {},
        source: l.source || "",
        actorEmail: l.actorEmail || "",
        memberName: l.meta?.memberName || "",
        memberKey: l.meta?.memberKey || "default",
        createdAt: l.createdAt,
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { listAuditLogs };
