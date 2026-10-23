/**
 * Daily layout + homework overrides.
 * Stack: activity blueprint → content fill → Must apply (handled in forceOverride, applied last in prompts).
 *
 * Prefer _activityBlueprint.daily[] (ordered periods with times).
 * Fall back to _slotOverrides map. Missing both → keep generated default day.
 * Do NOT invent extra periods beyond the blueprint list.
 */

const DAILY_MARKER = "DAILY SCHEDULE ACTIVITY CRUD";
const DAILY_MARKER_LEGACY = "DAILY SCHEDULE CUSTOMISATION";
const HOMEWORK_MARKER = "TONIGHT'S HOMEWORK ACTIVITY CRUD";
const HOMEWORK_MARKER_LEGACY = "TONIGHT'S HOMEWORK CUSTOMISATION";
const FORCE_MARKER = "HARD USER OVERRIDE";

const DAILY_CATALOG = [
  "standup", "problem", "learning", "break", "sysdesign", "lunch",
  "coding", "project", "speak", "placement", "agent", "game", "profile", "close",
];

const HOMEWORK_CATALOG = ["leetcode", "exercism", "linkedin", "agent", "case"];

const SLOT_LABELS = {
  standup: "Stand-Up",
  problem: "Problem Review",
  learning: "Learning",
  break: "Break",
  sysdesign: "System Design",
  lunch: "Lunch",
  coding: "Coding Practice",
  project: "Project Build",
  speak: "Speak & Solve",
  placement: "Placement Prep",
  agent: "Agent Workbench",
  game: "Refresh Game",
  profile: "Mini Build",
  close: "Retrospective",
  retro: "Retrospective",
  leetcode: "LeetCode",
  exercism: "Exercism",
  linkedin: "LinkedIn",
  case: "Case study",
};

const DEFAULT_TIMES = {
  standup: ["09:00", "09:15"],
  problem: ["09:15", "09:45"],
  learning: ["09:45", "11:00"],
  break: ["11:00", "11:15"],
  sysdesign: ["11:15", "12:15"],
  lunch: ["12:15", "13:00"],
  coding: ["13:00", "14:00"],
  project: ["14:00", "15:30"],
  speak: ["15:30", "16:00"],
  placement: ["16:00", "16:30"],
  agent: ["16:30", "17:00"],
  game: ["17:00", "17:15"],
  profile: ["17:15", "17:45"],
  close: ["17:45", "18:00"],
};

function trimText(v) {
  return String(v || "").trim();
}

function truthyFlag(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

function parseJsonField(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "object" && !Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_) {
    return null;
  }
}

function hhmm(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return "";
  const h = String(Math.min(23, Math.max(0, parseInt(m[1], 10)))).padStart(2, "0");
  const min = String(Math.min(59, Math.max(0, parseInt(m[2], 10)))).padStart(2, "0");
  return `${h}:${min}`;
}

/**
 * Format plan-cell clocks as 12-hour IST — never UTC/GMT.
 * JSON start/end stay HH:MM (24h) for parsing.
 * Original cell shape: "9:00–9:15 AM IST" / "11:30 AM–12:15 PM IST"
 * Honours inputs._timeFormat ("12h") and inputs._timezone ("IST").
 */
function format12hParts(hhmm24) {
  const t = hhmm(hhmm24);
  if (!t) return null;
  let h = parseInt(t.slice(0, 2), 10);
  const m = t.slice(3, 5);
  const ap = h >= 12 ? "PM" : "AM";
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return { label: `${h12}:${m}`, ap };
}

function formatClockRange(start, end, inputs = {}) {
  const use12 = String(inputs._timeFormat || "12h").toLowerCase() !== "24h";
  const tz = "IST";
  const a24 = hhmm(start);
  const b24 = hhmm(end);
  if (!use12) {
    if (a24 && b24) return `${a24}–${b24} ${tz}`;
    if (a24) return `${a24} ${tz}`;
    if (b24) return `${b24} ${tz}`;
    return "";
  }
  const a = format12hParts(a24);
  const b = format12hParts(b24);
  if (a && b) {
    // Same meridian: "9:00–9:15 AM IST" / "2:00–2:30 PM IST"
    // Crossing noon: both ends with AM/PM — "11:30 AM–12:15 PM IST"
    if (a.ap === b.ap) return `${a.label}–${b.label} ${a.ap} ${tz}`;
    return `${a.label} ${a.ap}–${b.label} ${b.ap} ${tz}`;
  }
  if (a) return `${a.label} ${a.ap} ${tz}`;
  if (b) return `${b.label} ${b.ap} ${tz}`;
  return "";
}

/** Ensure a FE clock string uses original "… AM IST" shape. Prefer start/end when present. */
function normalizeClockCell(clock, start, end, inputs = {}) {
  const fromTimes = start && end ? formatClockRange(start, end, inputs) : "";
  if (fromTimes) return fromTimes;
  let c = String(clock || "").trim();
  if (!c || c === "—") return c;
  if (/tonight/i.test(c)) return "Tonight";
  c = c.replace(/\s*[–-]\s*/g, "–").replace(/\s+/g, " ").trim();
  if (!/\bIST\b/i.test(c) && /\b(AM|PM)\b/i.test(c)) c = `${c} IST`;
  return c;
}

function minutesOf(hh) {
  const t = hhmm(hh);
  if (!t) return 9999;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function isCatalogId(id) {
  return DAILY_CATALOG.includes(id) || id === "retro";
}

function isHomeworkCatalogId(id) {
  return HOMEWORK_CATALOG.includes(id);
}

function classifySlotId(activity) {
  const a = String(activity || "").toLowerCase();
  if (/standup|stand[\s-]?up/.test(a)) return "standup";
  if (/problem review|problem lab/.test(a)) return "problem";
  if (/learning|concept|subject/.test(a)) return "learning";
  if (/lunch/.test(a)) return "lunch";
  if (/refresh|game/.test(a)) return "game";
  if (/break|hydrate|stretch/.test(a) && !/lunch/.test(a)) return "break";
  if (/system design|architecture|framing/.test(a)) return "sysdesign";
  if (/coding practice|dsa|leetcode/.test(a) && !/homework/.test(a)) return "coding";
  if (/project build|dt playbook|implement|prototype/.test(a)) return "project";
  if (/speak/.test(a)) return "speak";
  if (/placement/.test(a)) return "placement";
  if (/agent/.test(a)) return "agent";
  if (/mini build|profile|interest/.test(a)) return "profile";
  if (/retro|retrospective|close/.test(a)) return "close";
  if (/homework|tonight/.test(a)) return "homework";
  return "";
}

function homeworkKindFromTitle(title = "") {
  const t = String(title || "").toLowerCase();
  if (/leetcode/.test(t)) return "leetcode";
  if (/exercism/.test(t)) return "exercism";
  if (/linkedin/.test(t)) return "linkedin";
  if (/agent/.test(t)) return "agent";
  if (/case/.test(t)) return "case";
  return "";
}

function contentFromDayRows(dayRows, slotId) {
  const matches = (dayRows || []).filter((r) => classifySlotId(r[2]) === slotId);
  if (!matches.length) return "";
  return (
    matches
      .map((r) => String(r[3] || "").trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)[0] || ""
  );
}

/**
 * Parse _activityBlueprint (preferred) or synthesize from _slotOverrides map.
 * Returns { daily: [...], dayStart, dayEnd, lunchStart, lunchEnd, breaks, numDays, ... } or null.
 */
function parseActivityBlueprint(inputs = {}) {
  const bp = parseJsonField(inputs._activityBlueprint);
  if (bp && Array.isArray(bp.daily) && bp.daily.length) {
    return {
      daily: bp.daily.filter((p) => p && typeof p === "object"),
      dayStart: hhmm(bp.dayStart) || hhmm(inputs._dailyStart) || "",
      dayEnd: hhmm(bp.dayEnd) || hhmm(inputs._dailyEnd) || "",
      lunchStart: hhmm(bp.lunchStart) || hhmm(inputs._lunchStart) || "",
      lunchEnd: hhmm(bp.lunchEnd) || hhmm(inputs._lunchEnd) || "",
      breaks: Array.isArray(bp.breaks) ? bp.breaks : [],
      startDate: String(bp.startDate || "").trim(),
      endDate: String(bp.endDate || "").trim(),
      numDays: Number(bp.numDays) || Number(inputs._numDays) || null,
    };
  }

  // Fallback: convert _slotOverrides map → ordered daily list
  const ov = parseJsonField(inputs._slotOverrides);
  if (!ov || !Object.keys(ov).length) return null;

  const daily = [];
  for (const id of DAILY_CATALOG) {
    const row = ov[id] || (id === "close" ? ov.retro : null);
    if (!row) continue;
    if (String(row.mode || "keep").toLowerCase() === "hide") continue;
    daily.push({
      id,
      title: trimText(row.title) || SLOT_LABELS[id] || id,
      notes: trimText(row.notes),
      start: hhmm(row.start) || (DEFAULT_TIMES[id] || [])[0] || "",
      end: hhmm(row.end) || (DEFAULT_TIMES[id] || [])[1] || "",
      mode: String(row.mode || "keep").toLowerCase(),
    });
  }
  Object.entries(ov).forEach(([id, row]) => {
    if (!row || typeof row !== "object") return;
    if (isCatalogId(id) && String(row.mode || "").toLowerCase() !== "add") return;
    if (String(row.mode || "").toLowerCase() === "hide") return;
    daily.push({
      id,
      title: trimText(row.title) || SLOT_LABELS[id] || "New activity",
      notes: trimText(row.notes),
      start: hhmm(row.start) || "",
      end: hhmm(row.end) || "",
      mode: "add",
    });
  });
  daily.sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
  if (!daily.length) return null;
  return {
    daily,
    dayStart: hhmm(inputs._dailyStart) || "",
    dayEnd: hhmm(inputs._dailyEnd) || "",
    lunchStart: hhmm(inputs._lunchStart) || "",
    lunchEnd: hhmm(inputs._lunchEnd) || "",
    breaks: [],
    startDate: "",
    endDate: "",
    numDays: Number(inputs._numDays) || null,
  };
}

function extractDtSurfaceBlocks(dtInstruction = "") {
  const text = String(dtInstruction || "");
  if (!text.trim()) {
    return { mustApply: "", dailyCustom: "", homeworkCustom: "", rest: "" };
  }

  const mustRe =
    /HARD\s+USER\s+OVERRIDE[\s\S]*?(?:---END MUST APPLY---|$)(?=(?:\n\s*DAILY SCHEDULE)|(?:\n\s*TONIGHT)|$)?/i;
  const dailyRe =
    /DAILY SCHEDULE (?:ACTIVITY CRUD|CUSTOMISATION)[\s\S]*?(?=(?:\n\s*TONIGHT'?S HOMEWORK)|(?:\n\s*HARD\s+USER\s+OVERRIDE)|$)/i;
  const hwRe =
    /TONIGHT'?S HOMEWORK (?:ACTIVITY CRUD|CUSTOMISATION)[\s\S]*?(?=(?:\n\s*DAILY SCHEDULE)|(?:\n\s*HARD\s+USER\s+OVERRIDE)|$)/i;

  const found = { mustApply: "", dailyCustom: "", homeworkCustom: "" };
  let rest = text;
  const must = text.match(mustRe);
  if (must) {
    found.mustApply = must[0].trim();
    rest = rest.replace(must[0], "");
  }
  const daily = text.match(dailyRe);
  if (daily) {
    found.dailyCustom = daily[0].trim();
    rest = rest.replace(daily[0], "");
  }
  const hw = text.match(hwRe);
  if (hw) {
    found.homeworkCustom = hw[0].trim();
    rest = rest.replace(hw[0], "");
  }
  return { ...found, rest: rest.replace(/\n{3,}/g, "\n\n").trim() };
}

function dailyCustomisationPromptSection(inputs = {}) {
  const bp = parseActivityBlueprint(inputs);
  if (bp && bp.daily.length) {
    const bits = [];
    if (bp.dayStart && bp.dayEnd) bits.push(`Day window ${bp.dayStart}–${bp.dayEnd}`);
    if (bp.lunchStart && bp.lunchEnd) bits.push(`Lunch ${bp.lunchStart}–${bp.lunchEnd}`);
    if (bp.breaks?.length) {
      bits.push(
        `Breaks ${bp.breaks
          .filter((b) => hhmm(b?.start) && hhmm(b?.end))
          .map((b) => `${hhmm(b.start)}–${hhmm(b.end)}`)
          .join(", ")}`
      );
    }
    if (bp.numDays) bits.push(`${bp.numDays} working days`);
    const lines = bp.daily.map((row, i) => {
      const clock = formatClockRange(row.start, row.end, inputs);
      const notes = row.notes ? ` Content: ${row.notes}` : "";
      return `${i + 1}. ${row.title || SLOT_LABELS[row.id] || row.id}${clock ? ` ${clock}` : ""}${notes}`;
    });
    return (
      `${DAILY_MARKER} (week table + day list — this list is the ONLY source of truth):\n` +
      (bits.length ? `Basics timing already applied: ${bits.join(" · ")}.\n` : "") +
      `Clocks in plan cells: 12-hour IST only (e.g. 9:00–9:15 AM IST). JSON start/end stay HH:MM 24h for parsing.\n` +
      `Build the daily plan using ONLY these periods, in this order, at these times. ` +
      `Do not add OKR, extra games, extra learning, or any period not listed. Do not start from a canned 9–6 day.\n` +
      `${lines.join("\n")}\n\n`
    );
  }
  const blocks = extractDtSurfaceBlocks(inputs._dtInstruction || "");
  return blocks.dailyCustom ? `${blocks.dailyCustom}\n\n` : "";
}

function homeworkCustomisationPromptSection(inputs = {}) {
  const overrides = parseJsonField(inputs._homeworkOverrides);
  if (overrides && Object.keys(overrides).length) {
    const lines = [];
    Object.entries(overrides).forEach(([id, row]) => {
      if (!row || typeof row !== "object") return;
      const name = SLOT_LABELS[id] || row.title || id;
      if (row.mode === "hide") lines.push(`- DELETE / omit "${name}".`);
      else if (row.mode === "add") {
        lines.push(`- CREATE homework "${row.title || "New task"}".${row.notes ? ` Content: ${row.notes}` : ""}`);
      } else if (row.mode === "replace") {
        lines.push(`- UPDATE "${name}" → "${row.title || name}".${row.notes ? ` Content: ${row.notes}` : ""}`);
      }
    });
    if (lines.length) {
      return (
        `${HOMEWORK_MARKER} (homework tab — source of truth):\n` +
        `Do not assign clock times to homework. Homework is after the daily window.\n` +
        `${lines.join("\n")}\n\n`
      );
    }
  }
  const blocks = extractDtSurfaceBlocks(inputs._dtInstruction || "");
  return blocks.homeworkCustom ? `${blocks.homeworkCustom}\n\n` : "";
}

function nonSdPlaceholder(notes, fallbackContent) {
  if (trimText(notes)) return trimText(notes);
  if (trimText(fallbackContent) && !/system design|architecture|high-level design/i.test(fallbackContent)) {
    return fallbackContent;
  }
  return (
    "System Design module is OFF for this plan.\n" +
    "▶ Use this period for project push, coding practice, or review — not System Design topics.\n" +
    "▶ Do not invent SD syllabus or diagrams."
  );
}

/**
 * Rebuild one day STRICTLY from activity blueprint periods (no extra columns).
 * Order = blueprint.daily order. Times = blueprint start/end (parsed as HH:MM, written as 12h IST).
 * Every period gets real Task / Content (never empty / TBD / today's concept).
 * Do not invent OKR / extra games / extra learning.
 */
function rebuildDayFromBlueprint(dayKey, dayRows, blueprint, inputs = {}) {
  const {
    resolvePeriodContent,
    normalizePeriodId,
    isWeakContent,
  } = require("./blueprintPeriodContent");

  const homeworkRows = (dayRows || []).filter((r) => classifySlotId(r[2]) === "homework");

  // Preserve blueprint order exactly — do not re-sort or inject canned periods
  const periods = (blueprint.daily || []).filter(
    (p) => String(p.mode || "keep").toLowerCase() !== "hide"
  );

  const out = [];
  for (const p of periods) {
    const id = String(p.id || "").trim() || "custom";
    const normId = normalizePeriodId(id, p.title);
    const def = DEFAULT_TIMES[normId] || DEFAULT_TIMES[id] || ["09:00", "09:30"];
    const start = hhmm(p.start) || def[0];
    const end = hhmm(p.end) || def[1];
    const clock = formatClockRange(start, end, inputs);

    let activity = trimText(p.title) || SLOT_LABELS[normId] || SLOT_LABELS[id] || id;
    const fromRows =
      contentFromDayRows(dayRows, normId) ||
      contentFromDayRows(dayRows, id) ||
      "";
    const notes = trimText(p.notes);
    const seed =
      notes ||
      fromRows ||
      "";

    let content = resolvePeriodContent(
      { id: normId, title: activity, notes },
      seed,
      { inputs, dayKey }
    );

    // Final guard — never ship weak cells
    if (isWeakContent(content, activity)) {
      content = resolvePeriodContent(
        { id: normId, title: activity, notes: "" },
        "",
        { inputs, dayKey }
      );
    }

    out.push([dayKey, clock, activity, content]);
  }

  // Homework after dayEnd — always Tonight, never clocks
  if (homeworkRows.length) {
    homeworkRows.forEach((r) => {
      const next = r.slice();
      next[1] = "Tonight";
      next[2] = next[2] || "Tonight's Homework";
      if (isWeakContent(next[3], next[2])) {
        next[3] = resolvePeriodContent(
          { id: "homework", title: next[2], notes: "" },
          "",
          { inputs, dayKey }
        );
      }
      out.push(next);
    });
  }

  return out;
}

function rebuildDayFromSlotOverrides(dayKey, dayRows, overrides, inputs = {}) {
  // Convert map → blueprint-like list then rebuild (only listed non-hide slots + adds)
  const daily = [];
  for (const id of DAILY_CATALOG) {
    const row = overrides[id] || (id === "close" ? overrides.retro : null);
    if (!row) {
      // Partial active map: keep existing LLM row for unlisted slots
      const existing = (dayRows || []).filter((r) => classifySlotId(r[2]) === id);
      existing.forEach((r) => {
        daily.push({
          id,
          title: r[2],
          notes: "",
          start: "",
          end: "",
          mode: "keep",
          _rawTime: r[1],
          _rawContent: r[3],
        });
      });
      continue;
    }
    if (String(row.mode || "keep").toLowerCase() === "hide") continue;
    daily.push({
      id,
      title: trimText(row.title) || SLOT_LABELS[id],
      notes: trimText(row.notes),
      start: hhmm(row.start),
      end: hhmm(row.end),
      mode: String(row.mode || "keep").toLowerCase(),
    });
  }
  Object.entries(overrides).forEach(([id, row]) => {
    if (!row || typeof row !== "object") return;
    if (isCatalogId(id) && String(row.mode || "").toLowerCase() !== "add") return;
    if (String(row.mode || "").toLowerCase() === "hide") return;
    daily.push({
      id,
      title: trimText(row.title) || "New activity",
      notes: trimText(row.notes),
      start: hhmm(row.start),
      end: hhmm(row.end),
      mode: "add",
    });
  });

  // If we have raw-preserved rows from partial map, emit them carefully
  const hasFullCatalogHints = Object.keys(overrides).some((k) => isCatalogId(k));
  if (hasFullCatalogHints && daily.every((d) => d.start || d._rawTime)) {
    const bp = { daily: daily.map((d) => ({ ...d, start: d.start || "", end: d.end || "" })) };
    // Prefer explicit times; for preserved LLM rows use rebuild with content injection
    const skipSd = truthyFlag(inputs._skipSystemDesign);
    const homeworkRows = (dayRows || []).filter((r) => classifySlotId(r[2]) === "homework");
    const out = [];
    const sorted = daily.slice().sort((a, b) => {
      const am = a.start ? minutesOf(a.start) : 9998;
      const bm = b.start ? minutesOf(b.start) : 9998;
      if (a._rawTime && !a.start) return -1;
      return am - bm;
    });
    for (const p of sorted) {
      if (p._rawTime && !p.start) {
        out.push([dayKey, p._rawTime, p.title, p._rawContent]);
        continue;
      }
      const def = DEFAULT_TIMES[p.id] || ["09:00", "09:30"];
      const start = hhmm(p.start) || def[0];
      const end = hhmm(p.end) || def[1];
      const clock = formatClockRange(start, end, inputs);
      let activity = p.title || SLOT_LABELS[p.id] || p.id;
      let content =
        trimText(p.notes) ||
        contentFromDayRows(dayRows, p.id) ||
        activity;
      if (skipSd && (p.id === "sysdesign" || /system design/i.test(activity))) {
        content = nonSdPlaceholder(p.notes, contentFromDayRows(dayRows, "project"));
      }
      out.push([dayKey, clock, activity, content]);
    }
    homeworkRows.forEach((r) => {
      const next = r.slice();
      next[1] = "Tonight";
      out.push(next);
    });
    return out;
  }

  return rebuildDayFromBlueprint(dayKey, dayRows, { daily }, inputs);
}

function applySlotOverridesToDailyRows(rows = [], inputs = {}) {
  // Template engine already built days from _dayTemplate (possibly Must-apply-patched).
  // Do not remash onto original blueprint and undo patched times/layout.
  if (truthyFlag(inputs._dayTemplateApplied)) return rows;

  const blueprint = parseActivityBlueprint(inputs);
  const overrides = parseJsonField(inputs._slotOverrides);

  // No layout hints → keep generated default day
  if (!blueprint && (!overrides || !Object.keys(overrides).length)) return rows;

  const groups = [];
  let cur = null;
  for (const row of rows || []) {
    if (!Array.isArray(row)) continue;
    const dayKey = row[0];
    if (!cur || cur.dayKey !== dayKey) {
      cur = { dayKey, rows: [] };
      groups.push(cur);
    }
    cur.rows.push(row);
  }

  const out = [];
  for (const g of groups) {
    if (blueprint && blueprint.daily.length) {
      // Blueprint is sole source of periods — do not add extras
      out.push(...rebuildDayFromBlueprint(g.dayKey, g.rows, blueprint, inputs));
    } else {
      out.push(...rebuildDayFromSlotOverrides(g.dayKey, g.rows, overrides, inputs));
    }
  }
  return out;
}

function extractHomeworkSections(content = "") {
  const text = String(content || "").trim();
  if (!text) return [];
  const parts = [];
  const re =
    /(^|\n)(LeetCode|Exercism|LinkedIn|Agent Workbench|Case study)[^\n]*\n([\s\S]*?)(?=\n(?:LeetCode|Exercism|LinkedIn|Agent Workbench|Case study)\b|$)/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const title = m[2].trim();
    const body = String(m[3] || "").trim();
    const kind = homeworkKindFromTitle(title) || title.toLowerCase();
    parts.push({ kind, title, body, raw: `${title}\n${body}`.trim() });
  }
  if (!parts.length && text) {
    parts.push({ kind: "task", title: "Task", body: text, raw: text });
  }
  return parts;
}

function applyHomeworkOverridesToContent(content = "", overrides = {}) {
  const ov = overrides && typeof overrides === "object" ? overrides : {};
  if (!Object.keys(ov).length) {
    return String(content || "")
      .replace(/\b\d{1,2}:\d{2}\s*(AM|PM)?\s*[–-]\s*\d{1,2}:\d{2}\s*(AM|PM)?(\s*IST)?/gi, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  const existing = extractHomeworkSections(content);
  const byKind = {};
  existing.forEach((p) => {
    if (!byKind[p.kind]) byKind[p.kind] = p;
  });

  const items = [];
  const pushItem = (id, row, fallback) => {
    const mode = String(row?.mode || "keep").toLowerCase();
    if (mode === "hide") return;
    let title = SLOT_LABELS[id] || id;
    let body = fallback?.body || "";
    if (mode === "replace" || mode === "add") {
      if (trimText(row.title)) title = trimText(row.title);
      if (trimText(row.notes)) body = trimText(row.notes);
    }
    body = String(body || "")
      .replace(/\b\d{1,2}:\d{2}\s*(AM|PM)?\s*[–-]\s*\d{1,2}:\d{2}\s*(AM|PM)?(\s*IST)?/gi, "")
      .trim();
    const sort = Number(row?.sort);
    items.push({
      id,
      sort: Number.isFinite(sort) ? sort : 999,
      text: body ? `${title}\n${body}` : title,
    });
  };

  for (const id of HOMEWORK_CATALOG) {
    const row = ov[id];
    if (!row) {
      if (byKind[id]) items.push({ id, sort: 999, text: byKind[id].raw });
      continue;
    }
    pushItem(id, row, byKind[id]);
  }

  Object.entries(ov).forEach(([id, row]) => {
    if (!row || typeof row !== "object") return;
    const mode = String(row.mode || "").toLowerCase();
    if (mode === "hide") return;
    const isCustom = !isHomeworkCatalogId(id);
    if (!isCustom && mode !== "add") return;
    pushItem(id, { ...row, mode: mode || "add" }, null);
  });

  items.sort((a, b) => a.sort - b.sort || String(a.id).localeCompare(String(b.id)));
  return items
    .map((i) => i.text)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function applyHomeworkOverridesToDailyRows(rows = [], inputs = {}) {
  const overrides = parseJsonField(inputs._homeworkOverrides);
  if (!overrides || !Object.keys(overrides).length) {
    return (rows || []).map((r) => {
      if (!Array.isArray(r) || !/homework/i.test(String(r[2] || ""))) return r;
      const next = r.slice();
      next[1] = "Tonight";
      return next;
    });
  }

  return (rows || []).map((r) => {
    if (!Array.isArray(r)) return r;
    if (!/homework/i.test(String(r[2] || ""))) return r;
    const next = r.slice();
    next[1] = "Tonight";
    next[3] = applyHomeworkOverridesToContent(next[3], overrides);
    return next;
  });
}

function applyScheduleOverridesToDailyRows(rows = [], inputs = {}) {
  let next = applySlotOverridesToDailyRows(rows, inputs);
  next = applyHomeworkOverridesToDailyRows(next, inputs);
  // When template+LLM already wrote content, do NOT post-process away rich sections.
  // Only backfill truly empty cells for non-template generations.
  if (!truthyFlag(inputs._dayTemplateApplied)) {
    try {
      const { ensureAllDailyRowsFilled } = require("./blueprintPeriodContent");
      next = ensureAllDailyRowsFilled(next, inputs);
    } catch (e) {
      console.warn("blueprintPeriodContent fill skipped:", e.message);
    }
  }
  return next;
}

function applyHomeworkOverridesToPlan(plan, inputs = {}) {
  if (!plan || !Array.isArray(plan.rows)) return plan;
  const overrides = parseJsonField(inputs._homeworkOverrides);
  return {
    ...plan,
    rows: plan.rows.map((r) => {
      if (!Array.isArray(r)) return r;
      const next = r.slice();
      next[1] = "Tonight";
      next[2] = next[2] || "Tonight's Homework";
      if (overrides && Object.keys(overrides).length) {
        next[3] = applyHomeworkOverridesToContent(next[3], overrides);
      }
      return next;
    }),
  };
}

module.exports = {
  DAILY_MARKER,
  DAILY_MARKER_LEGACY,
  HOMEWORK_MARKER,
  HOMEWORK_MARKER_LEGACY,
  FORCE_MARKER,
  DAILY_CATALOG,
  HOMEWORK_CATALOG,
  SLOT_LABELS,
  parseJsonField,
  parseActivityBlueprint,
  extractDtSurfaceBlocks,
  dailyCustomisationPromptSection,
  homeworkCustomisationPromptSection,
  applySlotOverridesToDailyRows,
  applyHomeworkOverridesToDailyRows,
  applyScheduleOverridesToDailyRows,
  applyHomeworkOverridesToPlan,
  classifySlotId,
  homeworkKindFromTitle,
  formatClockRange,
  normalizeClockCell,
  minutesOf,
  hhmm,
};
