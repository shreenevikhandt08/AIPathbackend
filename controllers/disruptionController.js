const express = require("express");
const mongoose = require("mongoose");
const { verifyToken } = require("../middleware/auth");
const DailyPlan = require("../models/DailyPlan");
const { syncWeeklyFromDaily } = require("../utils/weeklySync");

const disruptionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  date: { type: String, required: true },
  dayKey: { type: String, required: true },
  blockedSlots: { type: [String], required: true },
  alternativeType: { type: String, default: "self_study" },
  customTitle: { type: String, default: "" },
  reason: { type: String, default: "" },
  originalActivities: { type: [mongoose.Schema.Types.Mixed], default: [] },
  createdAt: { type: Date, default: Date.now },
});



const Disruption = mongoose.models.Disruption || mongoose.model("Disruption", disruptionSchema);

const swapSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  dayKeyA: { type: String, required: true },
  dayKeyB: { type: String, required: true },
  weekA: { type: Number },
  weekB: { type: Number },
  mode: { type: String, enum: ["whole", "slots"], required: true },
  swappedTimes: { type: [mongoose.Schema.Types.Mixed], default: [] }, // [{timeA, timeB}]
  originalRowsA: { type: [mongoose.Schema.Types.Mixed], default: [] }, // for undo
  originalRowsB: { type: [mongoose.Schema.Types.Mixed], default: [] },
  crossWeek: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});
const Swap = mongoose.models.Swap || mongoose.model("Swap", swapSchema);


function parseDateFromDayKey(dayKey) {
  const m = String(dayKey).match(/\((\d{2})-(\d{2})-(\d{4})\)/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}
async function findTargetDays(userId, { date, startDate, endDate, weekNumber }) {
  if (weekNumber) return DailyPlan.find({ userId, week: weekNumber });
  if (startDate && endDate) return DailyPlan.find({ userId, date: { $gte: startDate, $lte: endDate } });
  if (date) return DailyPlan.find({ userId, date: { $regex: date } });
  return [];
}

// POST /apply
async function applyDisruption(req, res) {
  try {
    const { date, startDate, endDate, weekNumber, blockedSlots = [], alternativeType, reason, customTitle } = req.body;
    const userId = req.user.id;

    const hasScope = Boolean(date) || Boolean(weekNumber) || (startDate && endDate);
    if (!hasScope) {
      return res.status(400).json({
        success: false,
        error: "Provide one of: date, weekNumber, or startDate+endDate",
      });
    }

    const dailyPlans = await findTargetDays(userId, { date, startDate, endDate, weekNumber });
    if (!dailyPlans.length) {
      return res.status(404).json({ success: false, error: "No plan found for the requested day(s)" });
    }

    const blockedSet = blockedSlots.length ? new Set(blockedSlots.map(s => String(s).trim())) : null;

    const altLabels = {
      self_study: "📚 Self Study",
      project_work: "💻 Project Work",
      exam_prep: "📝 Exam Preparation",
    };
    const altLabel = customTitle || altLabels[alternativeType] || altLabels.self_study;

    const results = [];
    for (const dailyPlan of dailyPlans) {
      if (dailyPlan.locked) {
        results.push({ dayId: dailyPlan.dayId, skipped: true, reason: "locked" });
        continue;
      }

      const originalActivities = [];
      const updatedRows = (dailyPlan.rows || []).map(row => {
        const rowTime = String(row[1] || "").trim();
        // No blockedSet => whole-day disruption: every slot on this day is replaced.
        if (blockedSet && !blockedSet.has(rowTime)) return row;

        originalActivities.push({ time: rowTime, activity: row[2], content: row[3] });
        const origContent = String(row[3] || "").trim();
        const replacementNote = `⚡ Slot replaced — ${reason || "Unexpected Activity"}`;
        return [
          row[0],
          row[1],
          altLabel,
          origContent ? `${replacementNote}\n\n${origContent}` : replacementNote,
        ];
      });

      if (originalActivities.length === 0) {
        results.push({ dayId: dailyPlan.dayId, skipped: true, reason: "no matching slots" });
        continue;
      }

      const disruption = await Disruption.create({
        userId,
        date: dailyPlan.date || date,
        dayKey: dailyPlan.dayId || dailyPlan.dayName || date,
        blockedSlots: blockedSet ? [...blockedSet] : ["__WHOLE_DAY__"],
        alternativeType,
        customTitle,
        reason: reason || "",
        originalActivities,
      });

      dailyPlan.rows = updatedRows;
      await dailyPlan.save();

      results.push({
        dayId: dailyPlan.dayId,
        disruptionId: disruption._id,
        slotsReplaced: originalActivities.length,
      });
    }

    const touched = results.filter(r => !r.skipped);
    res.json({
      success: true,
      message: touched.length
        ? `${touched.length} day(s) disrupted (${touched.reduce((s, r) => s + r.slotsReplaced, 0)} slot(s) total)`
        : "No days were modified (all locked or no matching slots)",
      results,
    });
  } catch (err) {
    console.error("Disruption error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
}
async function applySwap(req, res) {
  try {
    const { dayKeyA, dayKeyB, mode, slots = [] } = req.body;
    const userId = req.user.id;

    if (!dayKeyA || !dayKeyB)
      return res.status(400).json({ success: false, error: "dayKeyA and dayKeyB are required" });
    if (dayKeyA === dayKeyB)
      return res.status(400).json({ success: false, error: "Cannot swap a day with itself" });
    if (!["whole", "slots"].includes(mode))
      return res.status(400).json({ success: false, error: 'mode must be "whole" or "slots"' });
    if (mode === "slots" && !slots.length)
      return res.status(400).json({ success: false, error: "Provide at least one { timeA, timeB } pair" });

    const [dayA, dayB] = await Promise.all([
      DailyPlan.findOne({ userId, dayId: dayKeyA }),
      DailyPlan.findOne({ userId, dayId: dayKeyB }),
    ]);
    if (!dayA || !dayB)
      return res.status(404).json({ success: false, error: "One or both days were not found" });

    if (dayA.locked || dayB.locked) {
      const lockedDay = dayA.locked ? dayA.dayId : dayB.dayId;
      return res.status(409).json({
        success: false,
        error: `Cannot swap — "${lockedDay}" is locked. Unlock it first, then try again.`,
      });
    }

    const crossWeek = dayA.week !== dayB.week;
    const rowsA = [...(dayA.rows || [])];
    const rowsB = [...(dayB.rows || [])];
    const swappedTimes = [];

    if (mode === "whole") {
      const len = Math.min(rowsA.length, rowsB.length);
      for (let i = 0; i < len; i++) {
        const [dkA, tA, actA, contA] = rowsA[i];
        const [dkB, tB, actB, contB] = rowsB[i];
        rowsA[i] = [dkA, tA, actB, contB];
        rowsB[i] = [dkB, tB, actA, contA];
        swappedTimes.push({ timeA: tA, timeB: tB });
      }
    } else {
      for (const pair of slots) {
        const timeA = String(pair.timeA || "").trim();
        const timeB = String(pair.timeB || "").trim();
        const idxA = rowsA.findIndex(r => String(r[1] || "").trim() === timeA);
        const idxB = rowsB.findIndex(r => String(r[1] || "").trim() === timeB);
        if (idxA === -1 || idxB === -1) continue;

        const [dkA, tA, actA, contA] = rowsA[idxA];
        const [dkB, tB, actB, contB] = rowsB[idxB];
        rowsA[idxA] = [dkA, tA, actB, contB];
        rowsB[idxB] = [dkB, tB, actA, contA];
        swappedTimes.push({ timeA, timeB });
      }
      if (!swappedTimes.length)
        return res.status(400).json({
          success: false,
          error: "None of the requested time slots were found on the matching day(s)",
        });
    }

    const swapDoc = await Swap.create({
      userId,
      dayKeyA,
      dayKeyB,
      weekA: dayA.week,
      weekB: dayB.week,
      mode,
      swappedTimes,
      originalRowsA: dayA.rows,
      originalRowsB: dayB.rows,
      crossWeek,
    });

    dayA.rows = rowsA;
    dayB.rows = rowsB;
    await Promise.all([dayA.save(), dayB.save()]);

    // Keep the weekly view in sync with the swapped daily docs — daily is
    // always the source of truth, weekly is derived, never re-generated.
  const weeksToSync = new Set([dayA.week, dayB.week]);
    for (const w of weeksToSync) {
      syncWeeklyFromDaily(userId, w).catch(err =>
        console.error("[applySwap] weekly sync error:", err.message)
      );
    }

    res.json({
      success: true,
      swapId: swapDoc._id,
      crossWeek,
      message:
        `Swapped ${mode === "whole" ? "the whole day" : swappedTimes.length + " slot(s)"} ` +
        `between "${dayKeyA}" and "${dayKeyB}"` +
        (crossWeek
          ? ` ⚠️ Cross-week (Week ${dayA.week} ↔ Week ${dayB.week}) — please verify no concept-sequencing issue was introduced.`
          : ""),
      dayA: { dayId: dayA.dayId, rows: dayA.rows },
      dayB: { dayId: dayB.dayId, rows: dayB.rows },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}
// POST /undo-swap
async function undoSwap(req, res) {
  try {
    const { swapId } = req.body;
    const userId = req.user.id;
    if (!swapId) return res.status(400).json({ success: false, error: "swapId required" });

    const swap = await Swap.findOne({ _id: swapId, userId });
    if (!swap) return res.status(404).json({ success: false, error: "Swap not found" });

    const [dayA, dayB] = await Promise.all([
      DailyPlan.findOne({ userId, dayId: swap.dayKeyA }),
      DailyPlan.findOne({ userId, dayId: swap.dayKeyB }),
    ]);

    if (dayA) { dayA.rows = swap.originalRowsA; await dayA.save(); }
    if (dayB) { dayB.rows = swap.originalRowsB; await dayB.save(); }

    const weeksToSync = new Set([swap.weekA, swap.weekB]);
    for (const w of weeksToSync) {
      syncWeeklyFromDaily(userId, w).catch(err =>
        console.error("[undoSwap] weekly sync error:", err.message)
      );
    }

    await Swap.deleteOne({ _id: swapId });

    // Return the restored rows directly so the frontend can push them back
    // through onDayRegenerated without a second fetch.
    res.json({
      success: true,
      message: "Swap undone — both days restored to their pre-swap content.",
      dayA: dayA ? { dayId: dayA.dayId, rows: dayA.rows } : null,
      dayB: dayB ? { dayId: dayB.dayId, rows: dayB.rows } : null,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// GET /swaps/:dayKey — swap history involving a specific day (either side of the swap)
async function getSwapsByDay(req, res) {
  try {
    const userId = req.user.id;
    const dayKey = req.params.dayKey;
    const swaps = await Swap.find({
      userId,
      $or: [{ dayKeyA: dayKey }, { dayKeyB: dayKey }],
    }).sort({ createdAt: -1 }).limit(20);

    res.json({ success: true, swaps });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// GET /date/:date
async function getByDate(req, res) {
  try {
    const userId = req.user.id;
    const disruptions = await Disruption.find({ 
      userId, 
      date: req.params.date 
    }).sort({ createdAt: -1 });

    res.json({ success: true, disruptions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// GET /all
async function getAllDisruptions(req, res) {
  try {
    const userId = req.user.id;
    const disruptions = await Disruption.find({ userId })
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({ success: true, disruptions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// DELETE /:id
async function deleteDisruption(req, res) {
  try {
    const userId = req.user.id;
    const disruption = await Disruption.findOne({ _id: req.params.id, userId });

    if (!disruption) {
      return res.status(404).json({ success: false, error: "Disruption not found" });
    }

    // Restore original activities
    const dailyPlan = await DailyPlan.findOne({ 
      userId, 
      date: { $regex: disruption.date } 
    });

    if (dailyPlan && disruption.originalActivities.length > 0) {
      const origMap = {};
      disruption.originalActivities.forEach(orig => {
        origMap[orig.time] = orig;
      });

      dailyPlan.rows = dailyPlan.rows.map(row => {
        const rowTime = String(row[1] || "").trim();
        if (origMap[rowTime]) {
          const orig = origMap[rowTime];
          return [row[0], row[1], orig.activity, orig.content];
        }
        return row;
      });
      await dailyPlan.save();
    }

    await Disruption.deleteOne({ _id: req.params.id });

    res.json({ 
      success: true, 
      message: "Disruption removed, original schedule restored",
      plan: dailyPlan
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// POST /undo
async function undoDisruption(req, res) {
  try {
    const { date } = req.body;
    const userId = req.user.id;

    if (!date) {
      return res.status(400).json({ success: false, error: "date required" });
    }

    const lastDisruption = await Disruption.findOne({ userId, date })
      .sort({ createdAt: -1 });

    if (!lastDisruption) {
      return res.status(404).json({ success: false, error: "No disruption found to undo" });
    }

    // Restore original activities
    const dailyPlan = await DailyPlan.findOne({ userId, date: { $regex: date } });

    if (dailyPlan && lastDisruption.originalActivities.length > 0) {
      const origMap = {};
      lastDisruption.originalActivities.forEach(orig => {
        origMap[orig.time] = orig;
      });

      dailyPlan.rows = dailyPlan.rows.map(row => {
        const rowTime = String(row[1] || "").trim();
        if (origMap[rowTime]) {
          const orig = origMap[rowTime];
          return [row[0], row[1], orig.activity, orig.content];
        }
        return row;
      });
      await dailyPlan.save();
    }

    await Disruption.deleteOne({ _id: lastDisruption._id });

    res.json({
      success: true,
      message: "Last disruption undone",
      plan: dailyPlan,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// DELETE /clear-date/:date
async function clearDate(req, res) {
  try {
    const userId = req.user.id;
    const result = await Disruption.deleteMany({ userId, date: req.params.date });

    res.json({ 
      success: true, 
      message: `Cleared ${result.deletedCount} disruption(s)`,
      count: result.deletedCount
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}


module.exports = { applyDisruption, getByDate, getAllDisruptions, deleteDisruption, undoDisruption, clearDate, applySwap, undoSwap, getSwapsByDay };