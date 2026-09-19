const HomeworkNight = require("../models/HomeworkNight");
const {
  extractHomeworkNightsFromRows,
  nightsToPlanRows,
  parseHomeworkTasks,
  parseDayKey,
} = require("../utils/homeworkExtract");

function sortNights(a, b) {
  if (a.week !== b.week) return a.week - b.week;
  const order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  return order.indexOf(a.dayName) - order.indexOf(b.dayName);
}

function toPlan(nights) {
  const sorted = [...nights].sort(sortNights);
  return {
    module: "homework",
    title: "Tonight's Homework",
    columns: ["Day", "Time", "Activity", "Content"],
    rows: nightsToPlanRows(sorted),
    nightCount: sorted.length,
  };
}

/** GET /api/homework — full homework module for the user */
async function getHomework(req, res) {
  try {
    const nights = await HomeworkNight.find({ userId: req.user.id }).lean();
    if (!nights.length) {
      return res.json({ success: true, plan: null, nights: [] });
    }
    return res.json({
      success: true,
      plan: toPlan(nights),
      nights,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

/** GET /api/homework/day/:dayId */
async function getHomeworkDay(req, res) {
  try {
    const dayId = decodeURIComponent(req.params.dayId || "");
    const night = await HomeworkNight.findOne({ userId: req.user.id, dayId }).lean();
    if (!night) return res.json({ success: true, night: null });
    return res.json({ success: true, night });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/homework/sync
 * Body: { plan?: { rows }, nights?: [...], source?, replace?: boolean }
 * Upserts homework nights. If replace=true, deletes nights not in the payload.
 */
async function syncHomework(req, res) {
  try {
    const { plan, nights: rawNights, source = "sync-from-daily", replace = true } = req.body || {};
    let payloads = Array.isArray(rawNights) ? rawNights : null;
    if (!payloads?.length && plan?.rows) {
      payloads = extractHomeworkNightsFromRows(plan.rows);
    }
    if (!payloads?.length) {
      return res.status(400).json({
        success: false,
        error: "No homework rows found — pass plan.rows or nights[]",
      });
    }

    const userId = req.user.id;
    const dayIds = [];

    for (const p of payloads) {
      const dayId = String(p.dayId || "");
      if (!dayId) continue;
      dayIds.push(dayId);
      const parsed = parseDayKey(dayId) || {};
      const content = String(p.content ?? "");
      const existing = await HomeworkNight.findOne({ userId, dayId }).select("tasks nightDone").lean();

      // Preserve done flags when content is re-synced with same task titles
      let tasks = Array.isArray(p.tasks) && p.tasks.length
        ? p.tasks
        : parseHomeworkTasks(content);
      if (existing?.tasks?.length) {
        const doneByTitle = new Map(
          existing.tasks.map((t) => [String(t.title || "").toLowerCase(), !!t.done])
        );
        tasks = tasks.map((t, i) => ({
          ...t,
          index: t.index ?? i,
          done: doneByTitle.has(String(t.title || "").toLowerCase())
            ? doneByTitle.get(String(t.title || "").toLowerCase())
            : !!t.done,
        }));
      }

      await HomeworkNight.findOneAndUpdate(
        { userId, dayId },
        {
          $set: {
            userId,
            dayId,
            week: p.week ?? parsed.week ?? 1,
            dayName: p.dayName || parsed.dayName || "Monday",
            date: p.date ?? parsed.date ?? null,
            time: p.time || "",
            activity: p.activity || "Tonight's Homework",
            content,
            tasks,
            source,
            nightDone:
              typeof p.nightDone === "boolean"
                ? p.nightDone
                : existing?.nightDone || false,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }

    if (replace && dayIds.length) {
      await HomeworkNight.deleteMany({
        userId,
        dayId: { $nin: dayIds },
      });
    }

    const nights = await HomeworkNight.find({ userId }).lean();
    return res.json({
      success: true,
      synced: dayIds.length,
      plan: toPlan(nights),
      nights,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

/** PUT /api/homework/day — create/update one night (edit Save) */
async function upsertHomeworkDay(req, res) {
  try {
    const body = req.body || {};
    const dayId = String(body.dayId || "");
    if (!dayId) {
      return res.status(400).json({ success: false, error: "dayId required" });
    }
    const parsed = parseDayKey(dayId) || {};
    const content = String(body.content ?? "");
    const tasks =
      Array.isArray(body.tasks) && body.tasks.length
        ? body.tasks
        : parseHomeworkTasks(content);

    const night = await HomeworkNight.findOneAndUpdate(
      { userId: req.user.id, dayId },
      {
        $set: {
          userId: req.user.id,
          dayId,
          week: body.week ?? parsed.week ?? 1,
          dayName: body.dayName || parsed.dayName || "Monday",
          date: body.date ?? parsed.date ?? null,
          time: body.time || "",
          activity: body.activity || "Tonight's Homework",
          content,
          tasks,
          source: body.source || "edit",
          ...(typeof body.nightDone === "boolean" ? { nightDone: body.nightDone } : {}),
          ...(body.notes != null ? { notes: body.notes } : {}),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    try {
      const { audit } = require("../utils/auditLog");
      audit(req, {
        entity: "homework",
        action: "homework.edit",
        summary: `Homework updated — ${dayId}`,
        meta: { dayId, taskCount: Array.isArray(tasks) ? tasks.length : 0, source: body.source || "edit" },
      });
    } catch (_) {}

    return res.json({ success: true, night });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

/** POST /api/homework/toggle-task */
async function toggleHomeworkTask(req, res) {
  try {
    const { dayId, taskIndex, done } = req.body || {};
    if (!dayId || taskIndex == null) {
      return res.status(400).json({ success: false, error: "dayId and taskIndex required" });
    }
    const night = await HomeworkNight.findOne({ userId: req.user.id, dayId });
    if (!night) {
      return res.status(404).json({ success: false, error: "Homework night not found" });
    }
    const idx = Number(taskIndex);
    if (!night.tasks[idx]) {
      return res.status(400).json({ success: false, error: "Task index out of range" });
    }
    night.tasks[idx].done = !!done;
    night.nightDone = night.tasks.length > 0 && night.tasks.every((t) => t.done);
    night.markModified("tasks");
    await night.save();
    return res.json({ success: true, night });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

/** POST /api/homework/toggle-night */
async function toggleHomeworkNight(req, res) {
  try {
    const { dayId, done } = req.body || {};
    if (!dayId) {
      return res.status(400).json({ success: false, error: "dayId required" });
    }
    const night = await HomeworkNight.findOne({ userId: req.user.id, dayId });
    if (!night) {
      return res.status(404).json({ success: false, error: "Homework night not found" });
    }
    const willDone = !!done;
    night.nightDone = willDone;
    night.tasks = (night.tasks || []).map((t) => ({
      ...(t.toObject ? t.toObject() : t),
      done: willDone,
    }));
    night.markModified("tasks");
    await night.save();
    return res.json({ success: true, night });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

/** POST /api/homework/reset-progress — clear checks for one night or all */
async function resetHomeworkProgress(req, res) {
  try {
    const { dayId } = req.body || {};
    const filter = { userId: req.user.id };
    if (dayId) filter.dayId = dayId;

    const nights = await HomeworkNight.find(filter);
    for (const night of nights) {
      night.nightDone = false;
      night.tasks = (night.tasks || []).map((t) => ({
        ...(t.toObject ? t.toObject() : t),
        done: false,
      }));
      night.markModified("tasks");
      await night.save();
    }
    return res.json({ success: true, reset: nights.length });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * Extract homework from a daily plan and upsert (used by other controllers).
 * Non-HTTP helper.
 */
async function syncHomeworkFromDailyPlan(userId, dailyPlan, source = "sync-from-daily") {
  const payloads = extractHomeworkNightsFromRows(dailyPlan?.rows || []);
  if (!payloads.length) return { synced: 0, plan: null };

  const dayIds = [];
  for (const p of payloads) {
    dayIds.push(p.dayId);
    const existing = await HomeworkNight.findOne({ userId, dayId: p.dayId })
      .select("tasks nightDone")
      .lean();
    let tasks = p.tasks || [];
    if (existing?.tasks?.length) {
      const doneByTitle = new Map(
        existing.tasks.map((t) => [String(t.title || "").toLowerCase(), !!t.done])
      );
      tasks = tasks.map((t, i) => ({
        ...t,
        index: t.index ?? i,
        done: doneByTitle.get(String(t.title || "").toLowerCase()) || false,
      }));
    }
    await HomeworkNight.findOneAndUpdate(
      { userId, dayId: p.dayId },
      {
        $set: {
          userId,
          ...p,
          tasks,
          source,
          nightDone: existing?.nightDone || false,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  await HomeworkNight.deleteMany({ userId, dayId: { $nin: dayIds } });
  const nights = await HomeworkNight.find({ userId }).lean();
  return { synced: dayIds.length, plan: toPlan(nights), nights };
}

module.exports = {
  getHomework,
  getHomeworkDay,
  syncHomework,
  upsertHomeworkDay,
  toggleHomeworkTask,
  toggleHomeworkNight,
  resetHomeworkProgress,
  syncHomeworkFromDailyPlan,
};
