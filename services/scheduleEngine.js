function isLeaveDay(dateStr, leaveEvents) {
  for (const leave of leaveEvents) {
    if (dateStr >= leave.startDate && dateStr <= leave.endDate) return true;
  }
  return false;
}

function parseDayKey(dayKey) {
  const mDate = String(dayKey).match(
    /Week\s*(\d+)\s*[-–]\s*(\w+)\s*\((\d{2})-(\d{2})-(\d{4})\)/
  );
  if (mDate) {
    return { week: parseInt(mDate[1]), dayName: mDate[2], iso: `${mDate[5]}-${mDate[4]}-${mDate[3]}` };
  }
  const mNoDate = String(dayKey).match(/Week\s*(\d+)\s*[-–]\s*(\w+)/);
  if (mNoDate) return { week: parseInt(mNoDate[1]), dayName: mNoDate[2], iso: null };
  return null;
}

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

function isoToDDMMYYYY(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function isWeekend(iso) {
  const day = new Date(iso + "T00:00:00Z").getUTCDay();
  return day === 0 || day === 6;
}

function nextWorkingDayAfter(iso, leaveEvents) {
  let cursor = iso;
  do { cursor = addDays(cursor, 1); }
  while (isWeekend(cursor) || isLeaveDay(cursor, leaveEvents));
  return cursor;
}

function buildWeekAnchors(rows) {
  const byWeek = {};
  rows.forEach(r => {
    const p = parseDayKey(r[0]);
    if (!p || !p.iso) return;
    if (!byWeek[p.week] || p.iso < byWeek[p.week]) byWeek[p.week] = p.iso;
  });
  return Object.entries(byWeek)
    .map(([week, iso]) => ({ week: parseInt(week), iso }))
    .sort((a, b) => (a.iso < b.iso ? -1 : 1));
}

function weekForIso(iso, weekAnchors) {
  let best = weekAnchors[0];
  for (const a of weekAnchors) {
    if (a.iso <= iso) best = a; else break;
  }
  const days = Math.round((new Date(iso) - new Date(best.iso)) / 86400000);
  return best.week + Math.floor(days / 7);
}

function makeDayKey(iso, weekAnchors) {
  const week = weekAnchors.length > 0 ? weekForIso(iso, weekAnchors) : 1;
  const dayIdx = new Date(iso + "T00:00:00Z").getUTCDay() - 1;
  const dayName = DAY_NAMES[dayIdx] || "Monday";
  return `Week ${week} - ${dayName} (${isoToDDMMYYYY(iso)})`;
}

function buildLeaveNote(leaveEvents, dateStr) {
  const leave = leaveEvents.find(l => dateStr >= l.startDate && dateStr <= l.endDate);
  return leave
    ? `▶ ${leave.reason || "College Leave"} (${leave.startDate} to ${leave.endDate})\n▶ All scheduled tasks have been pushed to the next working day`
    : "▶ College Leave — tasks pushed forward";
}

// ── Pin detection ─────────────────────────────────────────────────────────────

// These keywords on ANY day = always pinned (IA/AU/formal exams)
const EXAM_KEYWORDS = [
  "ia exam", "au exam", "internal assessment", "internal audit",
  "end semester", "model exam", "university exam",
];

// These keywords on FRIDAY = pinned (weekly assessment/test/quiz)
const FRIDAY_ASSESSMENT_KEYWORDS = [
  "assessment", "test", "quiz", "ia", "au", "internal",
];

function isPinnedRow(row) {
  const activity = String(row[2] || "").toLowerCase();
  const notes    = String(row[3] || "").toLowerCase();
  const combined = activity + " " + notes;
  const dayName  = (parseDayKey(row[0])?.dayName || "").toLowerCase();

  if (EXAM_KEYWORDS.some(k => combined.includes(k))) return true;
  if (dayName === "friday" && FRIDAY_ASSESSMENT_KEYWORDS.some(k => combined.includes(k))) return true;
  return false;
}

// ── Enrich rows that lack ISO dates ──────────────────────────────────────────
function enrichRowsWithDates(rows) {
  const knownDates = {};
  rows.forEach(r => {
    const p = parseDayKey(r[0]);
    if (p && p.iso) knownDates[`${p.week}:${p.dayName}`] = p.iso;
  });

  const allHaveDates = rows.every(r => { const p = parseDayKey(r[0]); return !p || p.iso !== null; });
  if (allHaveDates) return rows;

  const sortedKnown = Object.entries(knownDates).sort((a, b) => a[1].localeCompare(b[1]));
  if (sortedKnown.length === 0) return rows;

  const DAY_ORDER_MAP = { Monday: 0, Tuesday: 1, Wednesday: 2, Thursday: 3, Friday: 4 };
  const allParsed = [];
  const seenKeys = new Set();
  rows.forEach(r => {
    const p = parseDayKey(r[0]);
    if (!p) return;
    const k = `${p.week}:${p.dayName}`;
    if (!seenKeys.has(k)) { seenKeys.add(k); allParsed.push(p); }
  });
  allParsed.sort((a, b) => {
    if (a.week !== b.week) return a.week - b.week;
    return (DAY_ORDER_MAP[a.dayName] ?? 9) - (DAY_ORDER_MAP[b.dayName] ?? 9);
  });

  const [firstKey, firstIso] = sortedKnown[0];
  const [firstWeek, firstDay] = firstKey.split(":").map((v, i) => i === 0 ? parseInt(v) : v);
  const anchorIdx = allParsed.findIndex(p => p.week === firstWeek && p.dayName === firstDay);

  let cursor = firstIso;
  for (let i = anchorIdx - 1; i >= 0; i--) {
    const p = allParsed[i];
    const k = `${p.week}:${p.dayName}`;
    if (knownDates[k]) { cursor = knownDates[k]; continue; }
    let d = new Date(cursor + "T00:00:00Z");
    do { d.setUTCDate(d.getUTCDate() - 1); } while (isWeekend(d.toISOString().slice(0, 10)));
    cursor = d.toISOString().slice(0, 10);
    knownDates[k] = cursor;
  }
  cursor = firstIso;
  for (let i = anchorIdx + 1; i < allParsed.length; i++) {
    const p = allParsed[i];
    const k = `${p.week}:${p.dayName}`;
    if (knownDates[k]) { cursor = knownDates[k]; continue; }
    let d = new Date(cursor + "T00:00:00Z");
    do { d.setUTCDate(d.getUTCDate() + 1); } while (isWeekend(d.toISOString().slice(0, 10)));
    cursor = d.toISOString().slice(0, 10);
    knownDates[k] = cursor;
  }

  return rows.map(r => {
    const p = parseDayKey(r[0]);
    if (!p || p.iso) return r;
    const k = `${p.week}:${p.dayName}`;
    const iso = knownDates[k];
    if (!iso) return r;
    const [y, m, d] = iso.split("-");
    return [`Week ${p.week} - ${p.dayName} (${d}-${m}-${y})`, ...r.slice(1)];
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CASE 1 — pushForwardSchedule
// ─────────────────────────────────────────────────────────────────────────────
function pushForwardSchedule(plan, leaveEvents, lockedDayIds = []) {
  if (!plan?.rows || !leaveEvents?.length) return plan;

  const rows        = JSON.parse(JSON.stringify(enrichRowsWithDates(plan.rows)));
  const lockedSet   = new Set(lockedDayIds);
  const weekAnchors = buildWeekAnchors(rows);

  // ── Group rows by dayKey ──────────────────────────────────────────────────
  const byDay    = {};
  const dayOrder = [];
  rows.forEach(row => {
    const key = row[0];
    if (!byDay[key]) { byDay[key] = []; dayOrder.push(key); }
    byDay[key].push(row);
  });

  // ── Split each day into pinned vs normal rows ─────────────────────────────
  // PINNED rows never enter carry and are always emitted on their original day.
  const pinnedByDay = {};
  const normalByDay = {};
  dayOrder.forEach(dk => {
    pinnedByDay[dk] = byDay[dk].filter(r => isPinnedRow(r));
    normalByDay[dk] = byDay[dk].filter(r => !isPinnedRow(r));
  });

  // ── Find remaining Mon–Thu slots per week for same-week absorption ────────
  // Returns dayKeys in that week that are Mon-Thu, not leave, not locked
  function remainingAbsorbSlots(weekNum, afterIdx) {
    return dayOrder.slice(afterIdx + 1).filter(dk => {
      const p = parseDayKey(dk);
      return (
        p && p.week === weekNum &&
        p.dayName !== "Friday" &&
        !lockedSet.has(dk) &&
        !isLeaveDay(p.iso, leaveEvents)
      );
    });
  }

  // ── Track topics covered per week (for Friday note update) ────────────────
  const weekTopics = {}; // week → Set of activity strings

  const result  = []; // final output blocks
  let carry     = []; // tasks displaced by leave, waiting to land
  // absorb map: dayKey → extra tasks to inject when we visit that day
  const absorb  = {};

  for (let i = 0; i < dayOrder.length; i++) {
    const dk     = dayOrder[i];
    const parsed = parseDayKey(dk);
    const week   = parsed ? parsed.week : 0;
    const isLeave = parsed?.iso ? isLeaveDay(parsed.iso, leaveEvents) : false;

    if (!weekTopics[week]) weekTopics[week] = new Set();

    // ── Locked day: emit as-is, carry skips over ──────────────────────────
    if (lockedSet.has(dk)) {
      result.push({ dk, rows: byDay[dk] });
      continue;
    }

    // ── PINNED day (e.g. Friday assessment): always emit pinned rows as-is ─
    //    Normal rows on a pinned day also stay (Friday can have normal topics too).
    //    Carry is NOT absorbed here — Friday is sacred, carry skips over it.
    const hasPinned = pinnedByDay[dk].length > 0;
    const isFriday  = parsed?.dayName === "Friday";

    if (isLeave) {
      // ── Leave day ─────────────────────────────────────────────────────────
      // Emit leave marker + any pinned rows that happen to fall on leave (rare)
      result.push({
        dk,
        rows: [
          [dk, "—", "🏖️ College Leave", buildLeaveNote(leaveEvents, parsed.iso)],
          ...pinnedByDay[dk],
        ],
      });

      // Normal rows of leave day → go into carry
      normalByDay[dk].forEach(r =>
        carry.push({ data: r, fromLabel: `[Pushed from leave on ${parsed.iso}]` })
      );

      // ── Try same-week absorption first ────────────────────────────────────
      if (carry.length > 0) {
        const slots = remainingAbsorbSlots(week, i);
        let ci = 0;
        for (const slot of slots) {
          if (ci >= carry.length) break;
          if (!absorb[slot]) absorb[slot] = [];
          absorb[slot].push(carry[ci]);
          ci++;
        }
        carry = carry.slice(ci); // remove absorbed items

        // Update Friday note regardless (leave happened this week)
        // We flag it; actual note is written when we visit Friday
      }

    } else if (isFriday) {
      // ── Friday: always emit as planned — never touched by carry ───────────
      // Update note if a leave happened this week
      const topics = weekTopics[week];
      const topicStr = topics && topics.size > 0
        ? `Topics covered this week: ${[...topics].slice(0, 5).join(", ")}.`
        : "";

      // Check if any leave occurred this week
      const leaveThisWeek = leaveEvents.some(l => {
        const p = parseDayKey(dk);
        if (!p) return false;
        // Monday of this week
        const weekStart = dayOrder.find(d2 => { const p2 = parseDayKey(d2); return p2 && p2.week === week && p2.dayName === "Monday"; });
        if (!weekStart) return false;
        const ws = parseDayKey(weekStart)?.iso;
        const we = p.iso; // Friday date = end of week
        return l.startDate <= we && l.endDate >= (ws || we);
      });

      const updatedPinnedRows = pinnedByDay[dk].map(r => leaveThisWeek ? [
        r[0], r[1], r[2],
        `📌 Assessment kept on Friday as scheduled. ${topicStr} (Leave occurred this week — only taught content is assessed.)`,
      ] : r);

      result.push({ dk, rows: [...normalByDay[dk], ...updatedPinnedRows] });

    } else if (carry.length > 0) {
      // ── Domino day: carry lands here, this day's normal tasks shift forward ─
      //    Pinned rows on this day stay put (emitted unchanged).
      const carryRows = carry.map(c => [
        dk, c.data[1], c.data[2],
        `${c.fromLabel} ${c.data[3] || ""}`.trim(),
      ]);

      carryRows.forEach(r => weekTopics[week].add(String(r[2] || "").trim()));

      result.push({ dk, rows: [...carryRows, ...pinnedByDay[dk]] });

      // This day's normal tasks now enter carry (domino)
      carry = normalByDay[dk].map(r => ({ data: r, fromLabel: "[Pushed forward]" }));

    } else if (absorb[dk]) {
      // ── Absorbed day: extra tasks injected alongside this day's own tasks ──
      const injected = absorb[dk];
      delete absorb[dk];

      const injectedRows = injected.map(c => [
        dk, c.data[1], c.data[2],
        `[Absorbed same week] ${c.data[3] || ""}`.trim(),
      ]);

      injectedRows.forEach(r => weekTopics[week].add(String(r[2] || "").trim()));
      normalByDay[dk].forEach(r => weekTopics[week].add(String(r[2] || "").trim()));

      result.push({ dk, rows: [...normalByDay[dk], ...injectedRows, ...pinnedByDay[dk]] });

    } else {
      // ── Normal day ────────────────────────────────────────────────────────
      normalByDay[dk].forEach(r => weekTopics[week].add(String(r[2] || "").trim()));
      result.push({ dk, rows: byDay[dk] });
    }
  }

  // ── Tail: carry left over after the plan ends — append new days ───────────
  if (carry.length > 0) {
    const lastParsed = parseDayKey(dayOrder[dayOrder.length - 1]);
    let tailIso = lastParsed?.iso || new Date().toISOString().slice(0, 10);

    while (carry.length > 0) {
      tailIso = nextWorkingDayAfter(tailIso, leaveEvents);
      const newDk = makeDayKey(tailIso, weekAnchors);
      result.push({
        dk: newDk,
        rows: carry.map(c => [newDk, c.data[1], c.data[2], `${c.fromLabel} ${c.data[3] || ""}`.trim()]),
      });
      carry = [];
    }
  }

  const flatRows = [];
  result.forEach(d => d.rows.forEach(r => flatRows.push(r)));
  return { ...plan, rows: flatRows };
}

// ─────────────────────────────────────────────────────────────────────────────
// CASE 2 — Partial-Day Disruption
// ─────────────────────────────────────────────────────────────────────────────
const ALTERNATIVE_LABELS = {
  self_study:   "📚 Self Study",
  project_work: "💻 Project Work",
  exam_prep:    "📝 Exam Preparation",
};

function applyPartialDisruption(plan, disruption) {
  if (!plan?.rows || !disruption?.date || !disruption?.blockedSlots?.length) return plan;
  const { date, blockedSlots, alternativeType = "self_study", reason = "Unexpected Activity" } = disruption;
  const blockedSet = new Set(blockedSlots.map(s => String(s).trim()));
  const altLabel   = ALTERNATIVE_LABELS[alternativeType] || ALTERNATIVE_LABELS.self_study;

  const updatedRows = plan.rows.map(row => {
    const parsed = parseDayKey(row[0]);
    if (!parsed || parsed.iso !== date) return row;
    if (isPinnedRow(row)) return row;  // never touch pinned rows
    if (!blockedSet.has(String(row[1] || "").trim())) return row;
    return [row[0], row[1], altLabel, `▶ Original task replaced due to: ${reason}`];
  });

  return { ...plan, rows: updatedRows };
}

// ─────────────────────────────────────────────────────────────────────────────
// Diff helper
// ─────────────────────────────────────────────────────────────────────────────
function computeDiff(oldPlan, newPlan) {
  if (!oldPlan?.rows || !newPlan?.rows) return null;
  const changes = [];
  const oldMap  = {};
  const newMap  = {};

  oldPlan.rows.forEach(r => { oldMap[r[0] + "||" + r[1]] = r; });
  newPlan.rows.forEach(r => { newMap[r[0] + "||" + r[1]] = r; });

  Object.keys(oldMap).forEach(k => {
    if (!newMap[k]) changes.push({ type: "removed", day: oldMap[k][0], time: oldMap[k][1], activity: oldMap[k][2] });
  });
  Object.keys(newMap).forEach(k => {
    if (!oldMap[k]) changes.push({ type: "added",    day: newMap[k][0], time: newMap[k][1], activity: newMap[k][2] });
    else if (JSON.stringify(oldMap[k]) !== JSON.stringify(newMap[k]))
      changes.push({ type: "modified", day: newMap[k][0], time: newMap[k][1], activity: newMap[k][2] });
  });

  return { totalChanges: changes.length, changes: changes.slice(0, 50) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────
function regenerateSchedule(plan, leaveEvents, lockedDayIds = []) {
  const updatedPlan = pushForwardSchedule(plan, leaveEvents, lockedDayIds);
  const diff = computeDiff(plan, updatedPlan);
  return { plan: updatedPlan, diff };
}

function applyDisruption(plan, disruption) {
  const updatedPlan = applyPartialDisruption(plan, disruption);
  const diff = computeDiff(plan, updatedPlan);
  return { plan: updatedPlan, diff };
}

module.exports = {
  pushForwardSchedule,
  applyPartialDisruption,
  computeDiff,
  isLeaveDay,
  isPinnedRow,
  regenerateSchedule,
  applyDisruption,
};