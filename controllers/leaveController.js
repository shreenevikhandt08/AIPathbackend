const express     = require("express");
const PlanVersion = require("../models/PlanVersion");
const DailyPlan   = require("../models/DailyPlan");
const BasePlan    = require("../models/BasePlan");
const { verifyToken } = require("../middleware/auth");
const { regenerateSchedule, applyDisruption: applyDisruptionService } = require("../services/scheduleEngine");
const { syncWeeklyFromDaily } = require("../utils/weeklySync");
const { syncHomeworkFromDailyPlan } = require("./homeworkController");

async function getLockedDayIds(userId) {
  const locked = await DailyPlan.find({ userId, locked: true }).select("dayId");
  return locked.map(d => d.dayId);
}

// ── Parse "Week N - DayName (DD-MM-YYYY)" → { week, dayName, date } ──────────
function parseDayKey(raw) {
  const m = String(raw).match(/Week\s*(\d+)\s*[-–]\s*(\w+)(?:\s*\((\d{2})-(\d{2})-(\d{4})\))?/i);
  if (!m) return null;
  const date = m[3] ? `${m[5]}-${m[4]}-${m[3]}` : null;
  return { week: parseInt(m[1]), dayName: m[2], date };
}

function groupRowsByDay(rows) {
  const map = {};
  rows.forEach(row => {
    const dayKey = row[0];
    if (!map[dayKey]) {
      const parsed = parseDayKey(dayKey);
      map[dayKey] = { week: parsed?.week || 1, dayName: parsed?.dayName || "Monday", date: parsed?.date || null, rows: [] };
    }
    map[dayKey].rows.push(row);
  });
  return map;
}

async function persistPlanToDailyPlan(userId, plan) {
  if (!plan?.rows?.length) return;

  const byDay = groupRowsByDay(plan.rows);
  const ops = Object.entries(byDay).map(([dayId, { week, dayName, date, rows }]) => ({
    updateOne: {
      filter: { userId, dayId },
      update: {
        $set: { userId, dayId, week, dayName, date, rows },
        $setOnInsert: { locked: false, completed: false, doneRows: [], subTaskDoneRows: [] },
      },
      upsert: true,
    },
  }));

  await DailyPlan.bulkWrite(ops);

  const syncedDayIds = Object.keys(byDay);
  await DailyPlan.deleteMany({ userId, dayId: { $nin: syncedDayIds } });

  syncHomeworkFromDailyPlan(userId, plan, "sync-from-daily").catch((err) =>
    console.error("[persistPlanToDailyPlan] homework sync error:", err.message)
  );

  const weeks = [...new Set(Object.values(byDay).map(d => d.week))];
  for (const w of weeks) {
    syncWeeklyFromDaily(userId, w).catch(err =>
      console.error("[persistPlanToDailyPlan] weekly sync error:", err.message)
    );
  }
}

function countLeaveDays(startDate, endDate) {
  let count = 0;
  let cursor = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");
  while (cursor <= end) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

// POST /set-base
async function setBase(req, res) {
  try {
    const { plan } = req.body;
    if (!plan?.rows)
      return res.status(400).json({ success: false, error: "plan with rows is required" });

    await BasePlan.findOneAndUpdate(
      { userId: req.user.id },
      { plan },
      { upsert: true, new: true }
    );
    // Also write day rows into DailyPlan so homework / lock / regenerate / weekly sync work
    await persistPlanToDailyPlan(req.user.id, plan);
    res.json({ success: true, message: "Base plan saved", daysSynced: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/** GET /base — load full daily base plan blob */
async function getBase(req, res) {
  try {
    const base = await BasePlan.findOne({ userId: req.user.id }).lean();
    if (!base?.plan) return res.json({ success: true, plan: null });
    return res.json({ success: true, plan: base.plan });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// GET /
async function getLeaveEvents(req, res) {
  try {
    const latest = await PlanVersion.findOne({ userId: req.user.id }).sort({ version: -1 });
    if (!latest) return res.json({ success: true, leaveEvents: [] });
    res.json({ success: true, leaveEvents: latest.leaveEvents || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// POST /add
async function addLeave(req, res) {
  try {
    const { startDate, endDate, reason } = req.body;
    if (!startDate || !endDate)
      return res.status(400).json({ success: false, error: "startDate and endDate required" });

    const base = await BasePlan.findOne({ userId: req.user.id });
    if (!base)
      return res.status(400).json({
        success: false,
        error: "No base plan found — generate a plan first.",
      });

    const latest = await PlanVersion.findOne({ userId: req.user.id }).sort({ version: -1 });
    const newVersion = (latest?.version || 0) + 1;
    const existingLeaves = latest?.leaveEvents || [];

    // Reject overlapping ranges
    const overlaps = existingLeaves.some(
      l => startDate <= l.endDate && endDate >= l.startDate
    );
    if (overlaps)
      return res.status(400).json({
        success: false,
        error: "This date range overlaps an existing leave. Remove or adjust it first.",
      });

    const newLeave = { startDate, endDate, reason: reason || "College Leave", id: Date.now() };
    const allLeaves = [...existingLeaves, newLeave];

    const lockedDayIds = await getLockedDayIds(req.user.id);
    const { plan: updatedPlan, diff } = regenerateSchedule(base.plan, allLeaves, lockedDayIds);

    {
      const {
        buildCompareDiff,
        slimDiff,
        inferTrigger,
        inferChangedBy,
      } = require("../utils/planVersioning");
      const previousPlan = latest?.plan || base.plan || null;
      const semanticDiff = previousPlan
        ? buildCompareDiff(previousPlan, updatedPlan)
        : (diff ? { ...diff, summary: diff.summary || "" } : null);
      const leaveReason = `${reason || "College Leave"} (${startDate} to ${endDate})`;
      const trigger = inferTrigger("Leave Added", leaveReason);
      const changedBy = inferChangedBy(req, "Leave Added");

      await PlanVersion.create({
        userId: req.user.id,
        version: newVersion,
        previousVersion: latest?.version || null,
        changeType: "Leave Added",
        reason: leaveReason,
        trigger,
        changedBy,
        changedByEmail: String(req.user?.email || "").slice(0, 120),
        plan: updatedPlan,
        previousPlan,
        leaveEvents: allLeaves,
        diff: slimDiff(semanticDiff) || diff,
        differenceSummary: semanticDiff?.summary || "",
      });

      try {
        const { audit } = require("../utils/auditLog");
        audit(req, {
          entity: "leave",
          action: "leave.add",
          summary: `Version ${newVersion} · Leave added — ${startDate} to ${endDate}${
            semanticDiff?.summary ? ` · ${semanticDiff.summary}` : ""
          }`,
          meta: {
            startDate,
            endDate,
            version: newVersion,
            previousVersion: latest?.version || null,
            changeType: "Leave Added",
            reason: reason || "College Leave",
            trigger,
            changedBy,
            differenceSummary: semanticDiff?.summary || "",
          },
        });
      } catch (_) {}
    }

    const leaveDayCount = countLeaveDays(startDate, endDate);
        await persistPlanToDailyPlan(req.user.id, updatedPlan);
    res.json({
      success: true,
      plan: updatedPlan,
      version: newVersion,
      diff,
      leaveEvents: allLeaves,
      message: `${leaveDayCount} working day(s) of leave added — schedule shifted forward by ${leaveDayCount} day(s) in a domino chain.`,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// POST /remove
async function removeLeave(req, res) {
  try {
    const { leaveId } = req.body;

    const base = await BasePlan.findOne({ userId: req.user.id });
    if (!base)
      return res.status(400).json({ success: false, error: "No base plan found" });

    const latest = await PlanVersion.findOne({ userId: req.user.id }).sort({ version: -1 });
    if (!latest)
      return res.status(404).json({ success: false, error: "No plan found" });

    const updatedLeaves = (latest.leaveEvents || []).filter(l => l.id !== leaveId);
    const lockedDayIds  = await getLockedDayIds(req.user.id);

    const { plan: updatedPlan, diff } = updatedLeaves.length > 0
      ? regenerateSchedule(base.plan, updatedLeaves, lockedDayIds)
      : { plan: base.plan, diff: null };

    const newVersion = (latest.version || 0) + 1;
    {
      const {
        buildCompareDiff,
        slimDiff,
        inferTrigger,
        inferChangedBy,
      } = require("../utils/planVersioning");
      const previousPlan = latest.plan || null;
      const semanticDiff = previousPlan
        ? buildCompareDiff(previousPlan, updatedPlan)
        : (diff ? { ...diff, summary: diff.summary || "" } : null);
      const leaveReason = "Leave event removed — schedule restored for that range";
      const trigger = inferTrigger("Leave Removed", leaveReason);
      const changedBy = inferChangedBy(req, "Leave Removed");

      await PlanVersion.create({
        userId: req.user.id,
        version: newVersion,
        previousVersion: latest.version || null,
        changeType: "Leave Removed",
        reason: leaveReason,
        trigger,
        changedBy,
        changedByEmail: String(req.user?.email || "").slice(0, 120),
        plan: updatedPlan,
        previousPlan,
        leaveEvents: updatedLeaves,
        diff: slimDiff(semanticDiff) || diff,
        differenceSummary: semanticDiff?.summary || "",
      });

      try {
        const { audit } = require("../utils/auditLog");
        audit(req, {
          entity: "leave",
          action: "leave.remove",
          summary: `Version ${newVersion} · Leave removed — schedule restored`,
          meta: {
            version: newVersion,
            previousVersion: latest.version || null,
            changeType: "Leave Removed",
            leaveId,
            trigger,
            changedBy,
            differenceSummary: semanticDiff?.summary || "",
          },
        });
      } catch (_) {}
    }

    // Persist the restored plan into DailyPlan + WeeklyPlan too.
    await persistPlanToDailyPlan(req.user.id, updatedPlan);

    res.json({ success: true, plan: updatedPlan, leaveEvents: updatedLeaves, diff, version: newVersion });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}


// POST /disruption
async function applyDisruption(req, res) {
  try {
    const { date, startDate, endDate, weekNumber, blockedSlots = [], alternativeType, reason, customTitle } = req.body;

    const hasScope = Boolean(date) || Boolean(weekNumber) || (startDate && endDate);
    if (!hasScope)
      return res.status(400).json({
        success: false,
        error: "Provide one of: date, weekNumber, or startDate+endDate.",
      });

    const validTypes = ["self_study", "project_work", "exam_prep"];
    if (alternativeType && !validTypes.includes(alternativeType))
      return res.status(400).json({
        success: false,
        error: `alternativeType must be one of: ${validTypes.join(", ")}`,
      });

    const latest = await PlanVersion.findOne({ userId: req.user.id }).sort({ version: -1 });
    if (!latest)
      return res.status(404).json({ success: false, error: "No plan found — generate a plan first." });

    const disruption = {
      date,
      startDate,
      endDate,
      weekNumber,
      blockedSlots,            // optional — empty/omitted means the WHOLE matched day(s)
      alternativeType: alternativeType || "self_study",
      reason: reason || "Unexpected Activity",
    };

    const { plan: updatedPlan, diff } = applyDisruptionService(latest.plan, disruption);

    const scopeLabel = weekNumber
      ? `Week ${weekNumber}`
      : (startDate && endDate) ? `${startDate} to ${endDate}` : date;

    const newVersion = (latest.version || 0) + 1;
    {
      const {
        buildCompareDiff,
        slimDiff,
        inferTrigger,
        inferChangedBy,
      } = require("../utils/planVersioning");
      const previousPlan = latest.plan || null;
      const semanticDiff = previousPlan
        ? buildCompareDiff(previousPlan, updatedPlan)
        : (diff ? { ...diff, summary: diff.summary || "" } : null);
      const disruptReason = `${reason || "Unexpected Activity"} (${scopeLabel}) — ${blockedSlots.length ? blockedSlots.length + " slot(s)" : "whole day(s)"} replaced with ${alternativeType || "self_study"}`;
      const trigger = inferTrigger("Partial Disruption", disruptReason);
      const changedBy = inferChangedBy(req, "Partial Disruption");

      await PlanVersion.create({
        userId: req.user.id,
        version: newVersion,
        previousVersion: latest.version || null,
        changeType: "Partial Disruption",
        reason: disruptReason,
        trigger,
        changedBy,
        changedByEmail: String(req.user?.email || "").slice(0, 120),
        plan: updatedPlan,
        previousPlan,
        leaveEvents: latest.leaveEvents || [],
        diff: slimDiff(semanticDiff) || diff,
        differenceSummary: semanticDiff?.summary || "",
      });

      try {
        const { audit } = require("../utils/auditLog");
        audit(req, {
          entity: "disruption",
          action: "disruption.apply",
          summary: `Version ${newVersion} · Disruption — ${scopeLabel}`,
          meta: {
            version: newVersion,
            previousVersion: latest.version || null,
            changeType: "Partial Disruption",
            scopeLabel,
            alternativeType: alternativeType || "self_study",
            reason: reason || "Unexpected Activity",
            trigger,
            changedBy,
            differenceSummary: semanticDiff?.summary || "",
          },
        });
      } catch (_) {}
    }

    // Persist the disrupted plan into DailyPlan + WeeklyPlan too.
    await persistPlanToDailyPlan(req.user.id, updatedPlan);

    res.json({
      success: true,
      plan: updatedPlan,
      diff,
      version: newVersion,
      message: `${blockedSlots.length ? blockedSlots.length + " slot(s)" : "Whole day(s)"} on ${scopeLabel} replaced with ${(alternativeType || "self_study").replace("_", " ")} due to: ${reason || "Unexpected Activity"}`,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}


module.exports = { setBase, getBase, getLeaveEvents, addLeave, removeLeave, applyDisruption };
