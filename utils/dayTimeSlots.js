/**
 * Build a full-day activity timetable from Basics → Timing.
 * Continuous slots: morning → midday lunch → afternoon → Retro at day end.
 * Displays times in 12-hour format with AM/PM (e.g. "9:00 AM – 10:30 AM IST").
 *
 * Honors optional manual lunch / break from inputs:
 *   _lunchStart / _lunchEnd  (or lunchStart / lunchEnd)
 *   _breakStart / _breakEnd  (or breakStart / breakEnd)
 */

function parseHHMM(raw, fallback = "09:00") {
  const s = String(raw || "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) {
    const fb = String(fallback).match(/^(\d{1,2}):(\d{2})/);
    const h = fb ? Math.min(23, Math.max(0, parseInt(fb[1], 10))) : 9;
    const min = fb ? Math.min(59, Math.max(0, parseInt(fb[2], 10))) : 0;
    return h * 60 + min;
  }
  let h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const min = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  const ap = (m[3] || "").toUpperCase();
  if (ap === "PM" && h < 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return h * 60 + min;
}

/** 12-hour clock label, e.g. "9:00 AM" or "1:15 PM" */
function formatHHMM(totalMinutes) {
  const mins = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  let h = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function formatRange(startMin, endMin) {
  return `${formatHHMM(startMin)} – ${formatHHMM(endMin)} IST`;
}

/** Parse a schedule time cell → minutes from midnight (supports AM/PM and legacy labels) */
function timeSortKey(t) {
  const s = String(t || "");
  if (/^tonight$/i.test(s.trim())) return 24 * 60 + 1;
  const m = s.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return 9999;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = (m[3] || "").toUpperCase();
  if (ap === "PM" && h < 12) h += 12;
  else if (ap === "AM" && h === 12) h = 0;
  else if (!ap && h >= 1 && h <= 7) h += 12; // legacy afternoon 01–07
  return h * 60 + min;
}

/** Snap to nearest 5 minutes for a cleaner timetable */
function snap5(mins) {
  return Math.round(mins / 5) * 5;
}

/** Minutes → friendly length, e.g. "1 hr 15 min" */
function formatDuration(mins) {
  const n = Math.max(0, Math.round(mins));
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (m === 0) return h === 1 ? "1 hr" : `${h} hr`;
  return `${h} hr ${m} min`;
}

function pickTiming(inputs, keys, fallback = "") {
  for (const k of keys) {
    const v = inputs?.[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return fallback;
}

/**
 * Read timing from planner inputs (Basics page).
 * Defaults match frontend: 09:00–18:00.
 */
function resolveDayWindow(inputs = {}) {
  let start = parseHHMM(pickTiming(inputs, ["_dailyStart", "dailyStart"], "09:00"), "09:00");
  let end = parseHHMM(pickTiming(inputs, ["_dailyEnd", "dailyEnd"], "18:00"), "18:00");

  if (end <= start) end = start + 8 * 60;

  const span = end - start;
  if (span < 4 * 60) end = start + 4 * 60;
  if (span > 12 * 60) end = start + 12 * 60;

  return {
    startMin: start,
    endMin: end,
    startLabel: formatHHMM(start),
    endLabel: formatHHMM(end),
    spanMin: end - start,
    spanLabel: formatDuration(end - start),
  };
}

/**
 * Resolve lunch window — manual if valid, else auto near midday.
 */
function resolveLunchWindow(inputs = {}, dayWindow) {
  const rawStart = pickTiming(inputs, ["_lunchStart", "lunchStart"], "");
  const rawEnd = pickTiming(inputs, ["_lunchEnd", "lunchEnd"], "");
  const span = dayWindow.spanMin;
  const veryTight = span < 6 * 60;
  const tight = span < 7.5 * 60;
  const autoDur = veryTight ? 20 : tight ? 30 : 45;

  if (rawStart && rawEnd) {
    let ls = parseHHMM(rawStart, "12:30");
    let le = parseHHMM(rawEnd, "13:15");
    const minStart = dayWindow.startMin + 60;
    const maxEnd = dayWindow.endMin - 60;
    if (le <= ls) le = ls + autoDur;
    ls = Math.max(minStart, Math.min(ls, maxEnd - 15));
    le = Math.max(ls + 15, Math.min(le, maxEnd));
    if (le - ls > 90) le = ls + 90;
    return {
      startMin: snap5(ls),
      endMin: snap5(le),
      minutes: snap5(le) - snap5(ls),
      manual: true,
    };
  }

  const lunchDur = autoDur;
  const idealLunch = 12 * 60 + 30; // 12:30
  const lunchStart = snap5(
    Math.max(
      dayWindow.startMin + (veryTight ? 100 : 140),
      Math.min(idealLunch, dayWindow.endMin - lunchDur - (veryTight ? 90 : 140))
    )
  );
  return {
    startMin: lunchStart,
    endMin: lunchStart + lunchDur,
    minutes: lunchDur,
    manual: false,
  };
}

/**
 * Resolve morning break — manual if valid inside [dayStart, lunchStart], else auto slot.
 * @deprecated Prefer resolveBreakList for multiple breaks.
 */
function resolveBreakWindow(inputs = {}, dayWindow, lunchStart) {
  const list = resolveBreakList(inputs, dayWindow, {
    startMin: lunchStart,
    endMin: lunchStart,
  });
  const morning = list.filter((b) => b.endMin <= lunchStart);
  if (morning.length) return { ...morning[0], manual: true };
  const span = dayWindow.spanMin;
  const veryTight = span < 6 * 60;
  return { minutes: veryTight ? 10 : 15, manual: false };
}

/**
 * Parse 0–N manual breaks from inputs._breaks (JSON array) or legacy _breakStart/_breakEnd.
 * Breaks may sit in morning (before lunch) or afternoon (after lunch).
 */
function resolveBreakList(inputs = {}, dayWindow, lunch) {
  const lunchStart = lunch.startMin;
  const lunchEnd = lunch.endMin;
  const span = dayWindow.spanMin;
  const veryTight = span < 6 * 60;
  const autoDur = veryTight ? 10 : 15;
  const MAX = 4;

  let raw = [];
  const packed = inputs._breaks || inputs.breaks;
  if (Array.isArray(packed)) {
    raw = packed;
  } else if (typeof packed === "string" && packed.trim()) {
    try {
      const parsed = JSON.parse(packed);
      if (Array.isArray(parsed)) raw = parsed;
    } catch (_) {}
  }
  if (!raw.length) {
    const s = pickTiming(inputs, ["_breakStart", "breakStart"], "");
    const e = pickTiming(inputs, ["_breakEnd", "breakEnd"], "");
    if (s && e) raw = [{ start: s, end: e }];
  }

  const out = [];
  for (const row of raw.slice(0, MAX)) {
    const rs = String(row?.start || row?.startTime || "").trim();
    const re = String(row?.end || row?.endTime || "").trim();
    if (!rs || !re) continue;
    let bs = parseHHMM(rs, "10:30");
    let be = parseHHMM(re, "10:45");
    if (be <= bs) be = bs + autoDur;
    if (be - bs > 40) be = bs + 40;
    if (be - bs < 10) be = bs + 10;

    // Prefer morning; if starts after lunch, treat as afternoon break
    const isAfternoon = bs >= lunchStart;
    if (isAfternoon) {
      const minStart = lunchEnd + 10;
      const maxEnd = dayWindow.endMin - 25;
      bs = Math.max(minStart, Math.min(bs, maxEnd - 10));
      be = Math.max(bs + 10, Math.min(be, maxEnd));
      if (be <= bs || bs >= maxEnd) continue;
    } else {
      const minStart = dayWindow.startMin + 25;
      const maxEnd = lunchStart - 10;
      bs = Math.max(minStart, Math.min(bs, maxEnd - 10));
      be = Math.max(bs + 10, Math.min(be, maxEnd));
      if (be <= bs || bs >= lunchStart - 10) continue;
    }

    // Skip overlaps with lunch or earlier breaks
    if (bs < lunchEnd && be > lunchStart) continue;
    const overlap = out.some((b) => bs < b.endMin && be > b.startMin);
    if (overlap) continue;

    out.push({
      startMin: snap5(bs),
      endMin: snap5(be),
      minutes: snap5(be) - snap5(bs),
      manual: true,
      afternoon: isAfternoon,
    });
  }

  out.sort((a, b) => a.startMin - b.startMin);
  return out;
}

/**
 * Pack activity defs into [from, to], inserting fixed manual breaks as islands.
 * Returns { slots } with break keys break1..breakN for those in this window.
 */
function packWithBreaks(activityDefs, breaks, from, to, breakKeyOffset = 0) {
  const sorted = [...breaks].sort((a, b) => a.startMin - b.startMin)
    .filter((b) => b.startMin >= from && b.endMin <= to);
  const slots = {};

  if (!sorted.length) {
    return packBlock(activityDefs, from, to);
  }

  const gaps = [];
  let cursor = from;
  sorted.forEach((b, i) => {
    if (b.startMin > cursor + 2) gaps.push({ from: cursor, to: b.startMin });
    const key = `break${breakKeyOffset + i + 1}`;
    slots[key] = {
      key,
      startMin: b.startMin,
      endMin: b.endMin,
      time: formatRange(b.startMin, b.endMin),
      minutes: b.minutes,
      manual: true,
    };
    cursor = b.endMin;
  });
  if (cursor < to - 2) gaps.push({ from: cursor, to });

  if (!gaps.length || !activityDefs.length) {
    return { slots, cursor: to };
  }

  // Distribute activities across gaps (earlier gaps get earlier activities)
  const n = gaps.length;
  const chunks = Array.from({ length: n }, () => []);
  activityDefs.forEach((def, i) => {
    chunks[Math.min(n - 1, Math.floor((i * n) / activityDefs.length))].push(def);
  });
  // Ensure no empty middle gap swallows time — move one flex/fixed from a neighbor
  for (let i = 0; i < n; i++) {
    if (chunks[i].length) continue;
    const donor = chunks.find((c) => c.length > 1);
    if (donor) chunks[i].push(donor.pop());
    else chunks[i].push({ key: `_pad${i}`, flex: true, weight: 1, minutes: 15, min: 5 });
  }

  chunks.forEach((chunk, i) => {
    const gap = gaps[i];
    if (!chunk.length || gap.to <= gap.from) return;
    const packed = packBlock(chunk.filter((d) => !String(d.key).startsWith("_pad")), gap.from, gap.to);
    Object.assign(slots, packed.slots);
  });

  return { slots, cursor: to };
}

/**
 * Pack a list of slot defs into [from, to] with no gaps.
 * Fixed slots keep their minutes; flex slots share leftover time by weight.
 */
function packBlock(defs, from, to) {
  const span = Math.max(0, to - from);
  if (!defs.length || span <= 0) return { slots: {}, cursor: from };

  const flexDefs = defs.filter((d) => d.flex);
  const flexWeight = flexDefs.reduce((s, d) => s + (d.weight || 1), 0) || 1;
  let flexPool = Math.max(
    0,
    span - defs.reduce((s, d) => s + (d.flex ? 0 : d.minutes), 0)
  );

  const sized = defs.map((d) => {
    if (!d.flex) return { ...d, minutes: d.minutes };
    const share = Math.max(5, Math.round((flexPool * (d.weight || 1)) / flexWeight));
    return { ...d, minutes: share };
  });

  let used = sized.reduce((s, d) => s + d.minutes, 0);
  if (flexDefs.length && used !== span) {
    const delta = span - used;
    const lastFlex = [...sized].reverse().find((d) => d.flex);
    if (lastFlex) lastFlex.minutes = Math.max(5, lastFlex.minutes + delta);
    used = sized.reduce((s, d) => s + d.minutes, 0);
  }
  if (!flexDefs.length && used > span) {
    let over = used - span;
    const order = ["learning1", "learning2", "project", "mid", "sysdesign", "lunch"];
    for (const key of order) {
      if (over <= 0) break;
      const hit = sized.find((d) => d.key === key);
      if (!hit) continue;
      const cut = Math.min(over, Math.max(0, hit.minutes - (hit.min || 10)));
      hit.minutes -= cut;
      over -= cut;
    }
  }

  let cursor = from;
  const slots = {};
  sized.forEach((d, i) => {
    const isLast = i === sized.length - 1;
    let end = isLast ? to : snap5(cursor + d.minutes);
    if (!isLast && end > to - 5) end = Math.max(cursor + 5, to - 5);
    if (isLast) end = to;
    if (end <= cursor) end = Math.min(to, cursor + 5);
    slots[d.key] = {
      key: d.key,
      startMin: cursor,
      endMin: end,
      time: formatRange(cursor, end),
      minutes: end - cursor,
    };
    cursor = end;
  });

  return { slots, cursor };
}

/**
 * Continuous day map synced to Basics timing.
 * Lunch / break use manual times when provided; otherwise auto.
 * Retro always closes the class day.
 */
function buildDaySlotMap(inputs = {}, opts = {}) {
  const window = resolveDayWindow(inputs);
  const includeAgent = opts.includeAgent !== false && !opts.problemFirst;
  const includeGame = opts.includeGame !== false;
  const includeSd = opts.includeSd !== false;
  const includeMid = opts.includeMid !== false;
  const includeSpeak = opts.includeSpeak !== false;
  const includeHomework = opts.includeHomework !== false;
  const includePlacement = opts.includePlacement !== false;
  const includeMiniBuild = opts.includeMiniBuild !== false;

  const span = window.spanMin;
  const veryTight = span < 6 * 60;
  const tight = span < 7.5 * 60;

  const lunch = resolveLunchWindow(inputs, window);
  const lunchStart = lunch.startMin;
  const lunchEnd = lunch.endMin;
  const lunchDur = lunch.minutes;

  const breakList = resolveBreakList(inputs, window, lunch);
  const morningBreaks = breakList.filter((b) => !b.afternoon);
  const afternoonBreaks = breakList.filter((b) => b.afternoon);
  const breakWin = morningBreaks[0] || {
    minutes: veryTight ? 10 : 15,
    manual: false,
  };

  const retroDur = veryTight ? 15 : 25;
  const placeDur = includePlacement ? (veryTight ? 15 : 20) : 0;
  const miniDur = includeMiniBuild ? (veryTight ? 15 : 25) : 0;
  const gameDur = includeGame ? (veryTight ? 10 : 15) : 0;
  const agentDur = includeAgent ? (veryTight ? 15 : 20) : 0;
  const projectMax = veryTight ? 70 : tight ? 90 : 120;

  const afternoonBreakMins = afternoonBreaks.reduce((s, b) => s + b.minutes, 0);
  const afternoonSpan = Math.max(0, window.endMin - lunchEnd - afternoonBreakMins);
  const baseFixed = placeDur + gameDur + agentDur + miniDur + retroDur;
  const rawProject = Math.max(veryTight ? 35 : 50, afternoonSpan - baseFixed);
  let projectMins = Math.min(projectMax, rawProject);
  let spare = Math.max(0, afternoonSpan - baseFixed - projectMins);
  const learn3Max = veryTight ? 25 : 40;
  let learn3Mins = spare >= 20 ? Math.min(learn3Max, spare) : 0;
  spare -= learn3Mins;
  if (spare > 0) {
    projectMins += spare;
    spare = 0;
  }

  const afternoonDefs = [
    ...(includePlacement ? [{ key: "placement", minutes: placeDur }] : []),
    { key: "project", minutes: projectMins },
    ...(learn3Mins >= 20 ? [{ key: "learning3", minutes: learn3Mins }] : []),
    ...(includeGame ? [{ key: "game", minutes: gameDur }] : []),
    ...(includeAgent ? [{ key: "agent", minutes: agentDur }] : []),
    ...(includeMiniBuild ? [{ key: "profileFocus", minutes: miniDur }] : []),
    { key: "retro", minutes: retroDur },
  ];

  const standupDur = veryTight ? 10 : 15;
  const reviewDur = veryTight ? 15 : 20;
  const speakDur = includeSpeak ? (veryTight ? 10 : 15) : 0;
  const sdBase = includeSd ? (veryTight ? 25 : 35) : 0;
  const breakDur = breakWin.minutes || (veryTight ? 10 : 15);

  const morningDefs = [
    { key: "standup", minutes: standupDur },
    { key: "problemReview", minutes: reviewDur },
    ...(includeSd ? [{ key: "sysdesign", flex: true, weight: 8, minutes: sdBase, min: 20 }] : []),
    { key: "learning1", flex: true, weight: 12, minutes: 40, min: 20 },
    ...(includeMid ? [{ key: "mid", flex: true, weight: 9, minutes: 35, min: 20 }] : []),
    ...(includeSpeak ? [{ key: "speak", minutes: speakDur }] : []),
    { key: "learning2", flex: true, weight: 8, minutes: 30, min: 15 },
  ];

  let morningSlots = {};
  if (morningBreaks.length) {
    morningSlots = packWithBreaks(morningDefs, morningBreaks, window.startMin, lunchStart, 0).slots;
  } else {
    const withAutoBreak = [
      { key: "standup", minutes: standupDur },
      { key: "problemReview", minutes: reviewDur },
      ...(includeSd ? [{ key: "sysdesign", flex: true, weight: 8, minutes: sdBase, min: 20 }] : []),
      { key: "learning1", flex: true, weight: 12, minutes: 40, min: 20 },
      { key: "break1", minutes: breakDur },
      ...(includeMid ? [{ key: "mid", flex: true, weight: 9, minutes: 35, min: 20 }] : []),
      ...(includeSpeak ? [{ key: "speak", minutes: speakDur }] : []),
      { key: "learning2", flex: true, weight: 8, minutes: 30, min: 15 },
    ];
    morningSlots = packBlock(withAutoBreak, window.startMin, lunchStart).slots;
  }

  const lunchSlots = {
    lunch: {
      key: "lunch",
      startMin: lunchStart,
      endMin: lunchEnd,
      time: formatRange(lunchStart, lunchEnd),
      minutes: lunchDur,
      manual: !!lunch.manual,
    },
  };

  const morningBreakCount = Object.keys(morningSlots).filter((k) => /^break\d+$/.test(k)).length;
  let afternoonSlots = {};
  if (afternoonBreaks.length) {
    afternoonSlots = packWithBreaks(
      afternoonDefs,
      afternoonBreaks,
      lunchEnd,
      window.endMin,
      morningBreakCount
    ).slots;
  } else {
    afternoonSlots = packBlock(afternoonDefs, lunchEnd, window.endMin).slots;
  }

  const slots = {
    ...morningSlots,
    ...lunchSlots,
    ...afternoonSlots,
  };

  if (slots.retro) {
    slots.retro.endMin = window.endMin;
    slots.retro.time = formatRange(slots.retro.startMin, window.endMin);
    slots.retro.minutes = window.endMin - slots.retro.startMin;
  }

  if (includeHomework) {
    const hwStart = window.endMin;
    const hwEnd = snap5(window.endMin + 40);
    slots.homework = {
      key: "homework",
      startMin: hwStart,
      endMin: hwEnd,
      time: formatRange(hwStart, hwEnd),
      minutes: 40,
      tonight: true,
    };
  }

  return {
    window,
    slots,
    lunch,
    break: breakWin,
    breaks: breakList,
  };
}

module.exports = {
  parseHHMM,
  formatHHMM,
  formatRange,
  formatDuration,
  resolveDayWindow,
  resolveLunchWindow,
  resolveBreakWindow,
  resolveBreakList,
  buildDaySlotMap,
  timeSortKey,
};
