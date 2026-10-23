/**
 * Server-side guard for the activity layout.
 *
 * The browser fits the daily activities to Basics → Timing before it sends them. This module makes
 * sure the server never trusts a stale or hand-edited layout: if the blueprint overlaps, leaves the
 * class day, or ignores the Basics lunch / break, it is re-fitted before the plan is generated.
 *
 * The first half (up to "enforceBasicsTiming") is the same algorithm as
 * AIPathfrontend/src/utils/dayLayout.js — keep the two in sync (a test compares them).
 */
const MIN_BLOCK = 5;

/** Default centre of Lunch / Break inside the default 9:00–18:00 day (as a fraction of the day). */
const LUNCH_RATIO = 217.5 / 540; // 12:15–13:00
const BREAK_RATIO = 127.5 / 540; // 11:00–11:15

function hhmmToMin(raw) {
  const m = String(raw == null ? "" : raw).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

function minToHHMM(total) {
  const t = Math.max(0, Math.min(23 * 60 + 59, Math.round(Number(total) || 0)));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

const snap = (n, step = 5) => Math.round(n / step) * step;
const overlaps = (a, b) => a.start < b.end && a.end > b.start;

/**
 * Pour flowing activities into the free gaps between fixed blocks.
 *
 * @param {{dayStart:number, dayEnd:number, items:Array}} args
 *   items: [{ id, weight?, fixed?, start?, end? }] in the order flowing items should appear.
 *   Items with fixed=true must carry start/end and keep them.
 * @returns {{placed:Object, warnings:string[], unplaced:string[]}}
 */
function flowIntoGaps({ dayStart, dayEnd, items }) {
  const warnings = [];
  const placed = {};
  const list = Array.isArray(items) ? items : [];

  const isFixed = (it) =>
    it.fixed && Number.isFinite(it.start) && Number.isFinite(it.end) && it.end > it.start;
  const fixed = list.filter(isFixed);
  const flow = list.filter((it) => !isFixed(it));
  fixed.forEach((it) => {
    placed[it.id] = { start: it.start, end: it.end };
  });
  if (!flow.length) return { placed, warnings, unplaced: [] };

  // Free gaps = window minus fixed blocks
  const blocks = fixed
    .map((f) => [Math.max(dayStart, f.start), Math.min(dayEnd, f.end)])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const gaps = [];
  let cursor = dayStart;
  blocks.forEach(([a, b]) => {
    if (a - cursor >= MIN_BLOCK) gaps.push({ start: cursor, end: a });
    cursor = Math.max(cursor, b);
  });
  if (dayEnd - cursor >= MIN_BLOCK) gaps.push({ start: cursor, end: dayEnd });

  const free = gaps.reduce((n, g) => n + (g.end - g.start), 0);
  if (!gaps.length || free <= 0) {
    warnings.push("No free time is left in the day for the remaining activities.");
    return { placed, warnings, unplaced: flow.map((f) => f.id) };
  }

  // Weight → ideal interval on the "free-time line"
  const w = flow.map((it) => Math.max(10, Number(it.weight) || 30));
  const W = w.reduce((n, x) => n + x, 0);
  let acc = 0;
  const ideal = w.map((x) => {
    const a = acc;
    acc += x;
    return [(free * a) / W, (free * acc) / W];
  });
  let line = 0;
  gaps.forEach((g) => {
    g.fs = line;
    line += g.end - g.start;
    g.fe = line;
    g.rows = [];
  });

  // Each flowing item goes to the gap holding most of its ideal interval
  flow.forEach((_, i) => {
    let best = 0;
    let bestOv = -1;
    gaps.forEach((g, gi) => {
      const ov = Math.min(ideal[i][1], g.fe) - Math.max(ideal[i][0], g.fs);
      if (ov > bestOv + 1e-9) {
        bestOv = ov;
        best = gi;
      }
    });
    gaps[best].rows.push(i);
  });

  // Never leave a real gap (>=10 min) empty if a neighbour can spare an item
  gaps.forEach((g, gi) => {
    if (g.rows.length || g.end - g.start < 10) return;
    let moved = false;
    for (let pj = gi - 1; pj >= 0 && !moved; pj -= 1) {
      if (gaps[pj].rows.length >= 2) {
        g.rows.unshift(gaps[pj].rows.pop());
        moved = true;
      }
    }
    for (let nj = gi + 1; nj < gaps.length && !moved; nj += 1) {
      if (gaps[nj].rows.length >= 2) {
        g.rows.push(gaps[nj].rows.shift());
        moved = true;
      }
    }
  });

  // Fill each gap completely, sizes proportional to weights
  gaps.forEach((g) => {
    const rows = g.rows;
    if (!rows.length) return;
    const L = g.end - g.start;
    const n = rows.length;
    const ws = rows.map((i) => w[i]);
    const Wg = ws.reduce((x, y) => x + y, 0);
    const tooTight = L < MIN_BLOCK * n;
    if (tooTight) {
      warnings.push(
        `Only ${L} min between ${minToHHMM(g.start)} and ${minToHHMM(g.end)} for ${n} activities — remove one or widen the day.`
      );
    }
    let cum = 0;
    let prev = g.start;
    rows.forEach((ri, k) => {
      cum += ws[k];
      let end;
      if (k === n - 1) {
        end = g.end;
      } else if (tooTight) {
        end = g.start + Math.round((L * (k + 1)) / n);
      } else {
        end = snap(g.start + (L * cum) / Wg);
        const remaining = n - 1 - k;
        end = Math.max(prev + MIN_BLOCK, Math.min(end, g.end - remaining * MIN_BLOCK));
      }
      placed[flow[ri].id] = { start: prev, end };
      prev = end;
    });
  });

  const unplaced = flow.filter((it) => !placed[it.id]).map((it) => it.id);
  return { placed, warnings, unplaced };
}

/**
 * Decide where Lunch and Break(s) sit.
 *
 * @param {{dayStart:number, dayEnd:number, lunch?:{start,end}, breaks?:Array<{id?,start,end}>,
 *          wantLunch?:boolean, wantBreak?:boolean, avoid?:Array<{start,end}>}} args
 *   lunch / breaks are the times the user gave (Basics). If absent they are placed automatically
 *   at the same relative spot as the default timetable (so a 9–6 day is unchanged).
 * @returns {{lunch:null|{start,end,auto}, breaks:Array<{id?,start,end,auto}>}}
 */
function planRestBlocks({
  dayStart,
  dayEnd,
  lunch = null,
  breaks = [],
  wantLunch = true,
  wantBreak = true,
  avoid = [],
}) {
  const span = Math.max(60, dayEnd - dayStart);
  const inWindow = (b) =>
    b &&
    Number.isFinite(b.start) &&
    Number.isFinite(b.end) &&
    b.end > b.start &&
    b.start >= dayStart &&
    b.end <= dayEnd;

  const out = { lunch: null, breaks: [] };
  // Locked activities: auto-placed rest blocks must steer around them
  const locked = (avoid || []).filter(
    (b) => b && Number.isFinite(b.start) && Number.isFinite(b.end) && b.end > b.start
  );
  const taken = [];

  if (wantLunch && inWindow(lunch)) {
    out.lunch = { start: lunch.start, end: lunch.end, auto: false };
    taken.push(out.lunch);
  }
  (breaks || [])
    .filter(inWindow)
    .sort((a, b) => a.start - b.start)
    .forEach((b) => {
      if (taken.some((t) => overlaps(t, b))) return;
      const blk = { id: b.id, start: b.start, end: b.end, auto: false };
      out.breaks.push(blk);
      taken.push(blk);
    });

  const auto = (ratio, dur) => {
    const base = snap(dayStart + ratio * span - dur / 2);
    for (let off = 0; off <= 240; off += 5) {
      for (const sgn of off ? [-1, 1] : [1]) {
        const s = base + sgn * off;
        const blk = { start: s, end: s + dur };
        if (blk.start < dayStart + 15 || blk.end > dayEnd - 15) continue;
        if (taken.some((t) => overlaps(t, blk))) continue;
        if (locked.some((t) => overlaps(t, blk))) continue;
        return { ...blk, auto: true };
      }
    }
    return null;
  };

  if (wantLunch && !out.lunch) {
    out.lunch = auto(LUNCH_RATIO, span >= 360 ? 45 : 30);
    if (out.lunch) taken.push(out.lunch);
  }
  if (wantBreak && !out.breaks.length) {
    const b = auto(BREAK_RATIO, 15);
    if (b) out.breaks.push(b);
  }
  return out;
}

/**
 * Report problems in a finished layout.
 * @param {Array<{id,label?,start,end}>} rows visible rows with minute times
 * @returns {{overlaps:Array<{a,b}>, outside:string[], idle:Array<{start,end}>}}
 */
function inspectLayout({ dayStart, dayEnd, rows, idleThreshold = 30 }) {
  const ok = (rows || [])
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
    .sort((a, b) => a.start - b.start);
  const result = { overlaps: [], outside: [], idle: [] };
  ok.forEach((r, i) => {
    if (r.start < dayStart || r.end > dayEnd) result.outside.push(r.id);
    const next = ok[i + 1];
    if (next && next.start < r.end) result.overlaps.push({ a: r.id, b: next.id });
  });
  let cursor = dayStart;
  ok.forEach((r) => {
    if (r.start - cursor >= idleThreshold) result.idle.push({ start: cursor, end: r.start });
    cursor = Math.max(cursor, r.end);
  });
  if (dayEnd - cursor >= idleThreshold) result.idle.push({ start: cursor, end: dayEnd });
  return result;
}

/* ── Enforcement ─────────────────────────────────────────────────────────────────────────── */

function parseJson(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch (_) {
    return null;
  }
}

const isLunchPeriod = (p) => String(p.id || "") === "lunch" || /^\s*lunch\s*$/i.test(String(p.title || ""));
const isBreakPeriod = (p) =>
  String(p.id || "") === "break" ||
  /^basics_break_/.test(String(p.id || "")) ||
  /^\s*(break|tea|snack)(\s*\d+)?\s*$/i.test(String(p.title || ""));

/**
 * Re-fit inputs._dayTemplate / inputs._activityBlueprint to the Basics window when they disagree.
 * Mutates `inputs`. Returns { changed, reason }.
 */
function enforceBasicsTiming(inputs) {
  if (!inputs || typeof inputs !== "object") return { changed: false };
  const { formatClockRange } = require("./scheduleOverrides");

  const bp = parseJson(inputs._activityBlueprint);
  const tpl = parseJson(inputs._dayTemplate);
  const tplList = Array.isArray(tpl) ? tpl : tpl && Array.isArray(tpl.periods) ? tpl.periods : null;
  const bpList = bp && Array.isArray(bp.daily) ? bp.daily : null;
  const list = tplList && tplList.length ? tplList : bpList;
  if (!list || !list.length) return { changed: false };

  let dayStart = hhmmToMin(inputs._dailyStart || (bp && bp.dayStart));
  let dayEnd = hhmmToMin(inputs._dailyEnd || (bp && bp.dayEnd));
  if (dayStart == null || dayEnd == null || dayEnd <= dayStart) return { changed: false };

  const pair = (a, b) => {
    const s = hhmmToMin(a);
    const e = hhmmToMin(b);
    return s != null && e != null && e > s ? { start: s, end: e } : null;
  };
  const lunch = pair(inputs._lunchStart || (bp && bp.lunchStart), inputs._lunchEnd || (bp && bp.lunchEnd));
  const rawBreaks = parseJson(inputs._breaks) || (bp && bp.breaks) || [];
  const breaks = (Array.isArray(rawBreaks) ? rawBreaks : [])
    .map((b) => pair(b && b.start, b && b.end))
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  const periods = list
    .filter((p) => p && typeof p === "object")
    .map((p, i) => ({
      ref: p,
      i,
      key: String(p.id || p.title || i),
      start: hhmmToMin(p.start),
      end: hhmmToMin(p.end),
    }));

  // 1) is anything wrong?
  let reason = "";
  const timed = periods.filter((p) => p.start != null && p.end != null && p.end > p.start);
  timed.forEach((p) => {
    if (p.start < dayStart || p.end > dayEnd) reason = reason || `"${p.key}" is outside the class day`;
  });
  const sorted = [...timed].sort((a, b) => a.start - b.start);
  sorted.forEach((p, k) => {
    const n = sorted[k + 1];
    if (n && n.start < p.end) reason = reason || `"${p.key}" overlaps "${n.key}"`;
  });
  const lunchP = periods.find((p) => isLunchPeriod(p.ref));
  if (lunch && lunchP && (lunchP.start !== lunch.start || lunchP.end !== lunch.end)) {
    reason = reason || "lunch does not match Basics";
  }
  const breakPs = periods.filter((p) => isBreakPeriod(p.ref));
  breaks.forEach((b, k) => {
    const p = breakPs[k];
    if (p && (p.start !== b.start || p.end !== b.end)) reason = reason || `break ${k + 1} does not match Basics`;
  });
  if (!reason) return { changed: false };

  // 2) re-fit: rest blocks from Basics (or auto), everything else flows
  const rest = planRestBlocks({
    dayStart,
    dayEnd,
    lunch,
    breaks: breaks.map((b, k) => (breakPs[k] ? { id: breakPs[k].key, ...b } : null)).filter(Boolean),
    wantLunch: !!lunchP,
    wantBreak: breakPs.length > 0 && !breaks.length,
  });
  const items = [];
  const used = new Set();
  if (lunchP && rest.lunch) {
    items.push({ id: lunchP.key, fixed: true, start: rest.lunch.start, end: rest.lunch.end });
    used.add(lunchP.key);
  }
  rest.breaks.forEach((b, k) => {
    const p = b.id ? breakPs.find((x) => x.key === b.id) : breakPs[k];
    if (!p) return;
    items.push({ id: p.key, fixed: true, start: b.start, end: b.end });
    used.add(p.key);
  });
  periods
    .filter((p) => !used.has(p.key))
    .sort((a, b) => (a.start != null ? a.start : 99999 + a.i) - (b.start != null ? b.start : 99999 + b.i))
    .forEach((p) => {
      const dur = p.start != null && p.end != null && p.end > p.start ? p.end - p.start : 30;
      items.push({ id: p.key, weight: dur });
    });

  const { placed } = flowIntoGaps({ dayStart, dayEnd, items });
  periods.forEach((p) => {
    const t = placed[p.key];
    if (!t) return;
    p.ref.start = minToHHMM(t.start);
    p.ref.end = minToHHMM(t.end);
    if (p.ref.clock != null) p.ref.clock = formatClockRange(p.ref.start, p.ref.end, inputs).replace(/\s*IST$/, "");
  });

  const write = (key, value) => {
    inputs[key] = typeof inputs[key] === "string" ? JSON.stringify(value) : value;
  };
  if (tplList && tplList.length) write("_dayTemplate", tpl);
  if (bpList && bpList.length && bpList !== tplList) {
    // keep the blueprint's own copy aligned too
    bpList.forEach((p) => {
      const t = placed[String(p.id || p.title)];
      if (t) {
        p.start = minToHHMM(t.start);
        p.end = minToHHMM(t.end);
        if (p.clock != null) p.clock = formatClockRange(p.start, p.end, inputs).replace(/\s*IST$/, "");
      }
    });
  }
  if (bp) write("_activityBlueprint", bp);
  return { changed: true, reason };
}

module.exports = {
  MIN_BLOCK,
  LUNCH_RATIO,
  BREAK_RATIO,
  hhmmToMin,
  minToHHMM,
  flowIntoGaps,
  planRestBlocks,
  inspectLayout,
  enforceBasicsTiming,
};
