/**
 * Fire-and-forget audit writer — never blocks the main request on failure.
 * Summaries are kept short and professional for Maintain Logs.
 *
 * One Mongo collection (AuditLog). Areas are separate via `entity`
 * (plan / daily / weekly / homework / …) and stay linked by userId + meta.version + memberName.
 */
function clip(text, n = 400) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function versionLabel(meta = {}) {
  const n = Number(meta.version || meta.newVersion || meta.memberVersion);
  if (!Number.isFinite(n) || n < 1) return "";
  return `Version ${n}`;
}

function personPrefix(meta = {}) {
  const name = String(meta.memberName || "").trim();
  if (!name || /^solo$/i.test(name)) return "";
  return name;
}

/**
 * Build a clean log line.
 * Example: "Priya · Version 3 · Daily schedule saved — Initial Plan"
 */
function buildAuditSummary({ version, memberVersion, memberName, changeType, reason, detail } = {}) {
  const parts = [];
  const who = personPrefix({ memberName });
  if (who) parts.push(who);
  const v = versionLabel({ version, memberVersion });
  if (v) parts.push(v);
  if (changeType) parts.push(String(changeType).trim());
  let line = parts.join(" · ");
  const extra = String(reason || detail || "").trim();
  if (extra) line = line ? `${line} — ${extra}` : extra;
  return clip(line || "Change recorded", 500);
}

async function recordAudit(reqOrUser, payload = {}) {
  try {
    const AuditLog = require("../models/AuditLog");
    const user =
      reqOrUser?.user ||
      (reqOrUser?.id || reqOrUser?._id ? reqOrUser : null);
    const userId = user?.id || user?._id || payload.userId;
    if (!userId) return null;

    const meta = payload.meta && typeof payload.meta === "object" ? { ...payload.meta } : {};
    const summary = clip(
      payload.summary ||
        buildAuditSummary({
          version: meta.version || meta.newVersion,
          memberVersion: meta.memberVersion,
          memberName: meta.memberName,
          changeType: meta.changeType,
          reason: meta.reason,
          detail: payload.action,
        }),
      500
    );

    const doc = await AuditLog.create({
      userId,
      actorEmail: String(user?.email || payload.actorEmail || "").slice(0, 120),
      entity: payload.entity || "system",
      action: String(payload.action || "change").slice(0, 80),
      summary,
      meta,
      source: String(
        payload.source ||
          (reqOrUser?.originalUrl
            ? `${reqOrUser.method || ""} ${reqOrUser.originalUrl}`.trim()
            : "")
      ).slice(0, 200),
    });
    return doc;
  } catch (err) {
    console.warn("[auditLog]", err.message);
    return null;
  }
}

/** Non-blocking wrapper for controllers */
function audit(req, payload) {
  void recordAudit(req, payload);
}

/**
 * One audit row per version save/restore — daily/weekly/homework stay linked via meta.areas
 * so Maintain Logs filters still work without repeating the same event 4 times.
 */
function auditVersionAreas(req, {
  version,
  memberKey = "default",
  memberName = "Solo",
  memberVersion,
  changeType = "Update",
  reason = "",
  action = "version.save",
  plan = null,
  weeklyRows = null,
  homeworkNights = null,
  previousVersion = null,
  changeCount = 0,
  trigger = "",
  changedBy = "",
  differenceSummary = "",
  protected: isProtected = false,
} = {}) {
  const rowCount = Array.isArray(plan?.rows) ? plan.rows.length : 0;
  const who = String(memberName || "Solo").trim() || "Solo";
  const isRestore = action === "version.restore";

  // Prefer human reason; fall back to difference; keep short for the table.
  const summary = clip(
    reason ||
      differenceSummary ||
      (isRestore
        ? `Rolled back to previous schedule (now Version ${version})`
        : `${changeType || "Schedule updated"}`),
    220
  );

  let diffLine = String(differenceSummary || "").trim();
  if (!diffLine) {
    if (Number(changeCount) > 0) {
      diffLine = `${changeCount} schedule change${Number(changeCount) === 1 ? "" : "s"}`;
    } else if (isRestore) {
      diffLine = previousVersion
        ? `Restored from version ${previousVersion}`
        : "Schedule restored from earlier version";
    } else if (rowCount > 0) {
      diffLine = `${rowCount} schedule rows saved`;
    } else if (reason) {
      diffLine = String(reason).slice(0, 220);
    } else {
      diffLine = String(changeType || "Schedule updated");
    }
  }

  audit(req, {
    entity: "plan",
    action: isRestore ? "version.restore" : action,
    summary,
    meta: {
      version,
      memberKey,
      memberName: who,
      memberVersion,
      changeType,
      reason: String(reason || "").slice(0, 300),
      previousVersion,
      changeCount,
      trigger,
      changedBy,
      differenceSummary: String(diffLine).slice(0, 220),
      protected: Boolean(isProtected),
      rowCount,
      weeklyRows: weeklyRows ?? null,
      homeworkNights: homeworkNights ?? null,
      // Lets Daily / Weekly / Homework filters include this single row
      areas: ["plan", "daily", "weekly", "homework"],
    },
  });
}

/**
 * Build Mongo filter for Maintain Logs area chips.
 * Version saves are one row (entity: plan) with meta.areas covering daily/weekly/homework.
 */
function entityListFilter(userId, entity, opts = {}) {
  const base = { userId };
  const memberKey = String(opts.memberKey || "").trim();
  if (memberKey && memberKey !== "all") {
    base["meta.memberKey"] = memberKey;
  }
  if (!entity || entity === "all") return base;

  if (entity === "plan") {
    return {
      ...base,
      $or: [
        { entity: "plan" },
        { action: { $in: ["version.save", "version.restore", "version.delete", "version.protect", "version.unprotect", "plan.generate"] } },
      ],
    };
  }

  if (entity === "daily") {
    return {
      ...base,
      $or: [
        { entity: "daily" },
        { action: { $regex: /^daily\./i } },
        { "meta.areas": "daily" },
        { entity: "plan", action: { $in: ["version.save", "version.restore", "plan.generate"] } },
      ],
    };
  }

  if (entity === "weekly") {
    return {
      ...base,
      $or: [
        { entity: "weekly" },
        { action: { $regex: /^weekly\./i } },
        { "meta.areas": "weekly" },
        { entity: "plan", action: { $in: ["version.save", "version.restore", "plan.generate"] } },
      ],
    };
  }

  if (entity === "homework") {
    return {
      ...base,
      $or: [
        { entity: "homework" },
        { action: { $regex: /^homework\./i } },
        { "meta.areas": "homework" },
        { entity: "plan", action: { $in: ["version.save", "version.restore", "plan.generate"] } },
      ],
    };
  }

  return { ...base, entity: String(entity) };
}

module.exports = {
  recordAudit,
  audit,
  buildAuditSummary,
  versionLabel,
  auditVersionAreas,
  entityListFilter,
};
