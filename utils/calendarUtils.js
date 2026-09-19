const axios = require("axios");
const TN_KEYWORDS = [
  "pongal", "republic", "independence", "gandhi", "diwali", "dussehra",
  "navratri", "christmas", "new year", "eid", "bakrid", "muharram",
  "tamil", "aadi", "karthigai", "thiruvalluvar", "uzhavar", "milad",
  "good friday", "easter", "ambedkar", "labour", "may day",
];

function toLocalISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toDisplayDate(isoDate) {
  if (!isoDate) return isoDate;
  const [y, m, d] = isoDate.split("-");
  return `${d}-${m}-${y}`;
}

// Convert "DD-MM-YYYY" user input → "YYYY-MM-DD" for internal use
function toISODate(ddmmyyyy) {
  if (!ddmmyyyy) return ddmmyyyy;
  // If already ISO format
  if (/^\d{4}-\d{2}-\d{2}$/.test(ddmmyyyy)) return ddmmyyyy;
  const [d, m, y] = ddmmyyyy.split("-");
  return `${y}-${m}-${d}`;
}

// ── Fetch Indian public holidays from Nager.Date API ─────────────────────────
async function fetchIndiaHolidays(year) {
  try {
    const url = `https://date.nager.at/api/v3/PublicHolidays/${year}/IN`;
    const res = await axios.get(url, { timeout: 5001 });
    const holidays = res.data || [];

    return holidays
      .filter((h) => {
        const name = (h.name || "").toLowerCase();
        const isNational = h.counties === null;
        const isTNRelated = TN_KEYWORDS.some((kw) => name.includes(kw));
        return isNational || isTNRelated;
      })
      .map((h) => ({
        date: h.date,   // stored as "YYYY-MM-DD"
        name: h.name,
      }));
  } catch (err) {
    console.warn("⚠️  Could not fetch holidays from Nager.Date:", err.message);
    return [];
  }
}

// ── Build a flat list of every working day between start and end ──────────────
// startDate / endDate must be "YYYY-MM-DD"
function buildCalendarMap(startDate, endDate, holidayList = []) {
  const holidaySet = {};
  holidayList.forEach((h) => {
    holidaySet[h.date] = h.name;
  });

  const map = [];
  const current = new Date(startDate + "T00:00:00");
  const end     = new Date(endDate   + "T00:00:00");

  let weekNum = 1;
  let prevDay = null;

  while (current <= end) {
    const dayName = current.toLocaleDateString("en-US", { weekday: "long" });

    if (dayName !== "Saturday" && dayName !== "Sunday") {
      const dateStr     = toLocalISO(current);
      const isHoliday   = !!holidaySet[dateStr];
      const holidayName = holidaySet[dateStr] || null;

      map.push({
        week:        weekNum,
        date:        dateStr,          // YYYY-MM-DD internally
        displayDate: toDisplayDate(dateStr),  // DD-MM-YYYY for display
        day:         dayName,
        isHoliday,
        holidayName,
      });
    }

    if (dayName === "Saturday") {
      weekNum++;
    }

    prevDay = dayName;
    current.setDate(current.getDate() + 1);
  }

  return map;
}

// ── Summarise the calendar into per-week stats ────────────────────────────────
function summariseCalendar(calMap) {
  const byWeek = {};

  for (const entry of calMap) {
    if (!byWeek[entry.week]) {
      byWeek[entry.week] = {
        week:        entry.week,
        startDate:   entry.date,
        endDate:     entry.date,
        workingDays: 0,
        holidays:    [],
        examDays:    [],
        isMockWeek:  false,
      };
    }
    const w = byWeek[entry.week];
    w.endDate = entry.date;

    if (entry.isHoliday) {
      w.holidays.push({ date: entry.date, name: entry.holidayName });
    } else if (entry.isExam) {
      (entry.examSessions || []).forEach((s) => {
        w.examDays.push({ date: entry.date, name: s.name, examType: s.examType, session: s.session });
      });
      w.workingDays++;
    } else {
      w.workingDays++;
    }
  }

  return Object.values(byWeek).sort((a, b) => a.week - b.week);
}

// ── Auto-schedule exam subjects into FN/AN sessions within an exam's date range ──
// exam: { name, examType, startDate, endDate, subjects?: string[], subjectCount?: number }
// calMap: full course calendar (used to find working, non-holiday days in range)
//
// Behaviour:
// - Only working days (not Sat/Sun/holiday) within [startDate, endDate] are usable.
// - subjects = exam.subjects (array of names) if provided, else
//              Array(exam.subjectCount || workingDays.length) of generic names.
// - If subjects.length <= workingDays.length:
//     1 subject per day, filling the FIRST N days (consecutive, compressed).
//     Remaining days in the range are left free (not flagged as exam days).
// - If subjects.length > workingDays.length:
//     Fill FN session for every day first (left → right), then AN session,
//     until all subjects are placed.
// - If subjects.length > workingDays.length * 2:
//     Returns { error: ... } — not enough days even with FN+AN doubling.
//
// Returns: {
//   sessions: [{ date, session: "FN"|"AN", name, examType, subjectIndex }],
//   usedDays: [date,...],   // dates actually used for this exam
//   error: string|null
// }
function scheduleExamSessions(calMap, exam) {
  // The user elects a specific startDate — that day IS the exam day.
  // We only extend into the full range when subjects overflow beyond what
  // a single day (FN + AN = 2 slots) can hold.
  // Priority: startDate first, then remaining range days in date order.
  const electedEntry = calMap.find((e) => e.date === exam.startDate && !e.isHoliday);
  const rangeDays = calMap
    .filter((e) => !e.isHoliday && e.date > exam.startDate && e.date <= (exam.endDate || exam.startDate))
    .map((e) => e.date)
    .sort();
  const workingDays = electedEntry
    ? [exam.startDate, ...rangeDays]
    : rangeDays; // elected day was a holiday — fall back to range

  const hasSubjects = (Array.isArray(exam.subjects) && exam.subjects.length > 0) ||
                      (exam.subjectCount && exam.subjectCount > 0);
  if (!hasSubjects) {
    return {
      sessions: [],
      usedDays: [],
      error: null,
      noSubjects: true,   // flag for caller
    };
  }

  const subjects = Array.isArray(exam.subjects) && exam.subjects.length > 0
    ? exam.subjects
    : Array.from(
        { length: exam.subjectCount || workingDays.length || 1 },
        (_, i) => `${exam.name} - Subject ${i + 1}`
      );

  if (workingDays.length === 0) {
    return { sessions: [], usedDays: [], error: `${exam.name}: no working days available in selected range.` };
  }

  if (subjects.length > workingDays.length * 2) {
    return {
      sessions: [],
      usedDays: [],
      error: `${exam.name}: ${subjects.length} subjects don't fit in ${workingDays.length} day(s) ` +
             `even with forenoon/afternoon sessions (max ${workingDays.length * 2}). Select more days.`,
    };
  }

  const sessions = [];
  const usedDaySet = new Set();

  if (subjects.length <= workingDays.length) {
    // 1 subject per day, compressed to the first N days
    subjects.forEach((subj, i) => {
      const date = workingDays[i];
      usedDaySet.add(date);
      sessions.push({ date, session: "FN", name: subj, examType: exam.examType, subjectIndex: i });
    });
  } else {
    // Fill FN across all days first, then AN
    let idx = 0;
    for (let d = 0; d < workingDays.length && idx < subjects.length; d++) {
      usedDaySet.add(workingDays[d]);
      sessions.push({ date: workingDays[d], session: "FN", name: subjects[idx], examType: exam.examType, subjectIndex: idx });
      idx++;
    }
    for (let d = 0; d < workingDays.length && idx < subjects.length; d++) {
      usedDaySet.add(workingDays[d]);
      sessions.push({ date: workingDays[d], session: "AN", name: subjects[idx], examType: exam.examType, subjectIndex: idx });
      idx++;
    }
  }

  return {
    sessions,
    usedDays: [...usedDaySet].sort(),
    error: null,
  };
}

// ── Mark exam days on the calendar map ───────────────────────────────────────
// scheduledSessions: flat array of { date, session, name, examType, subjectIndex }
// (output of scheduleExamSessions, combined across all exams)
// Dates must be in "YYYY-MM-DD"
function markExamDays(calMap, scheduledSessions = []) {
  const byDate = {};
  scheduledSessions.forEach((s) => {
    if (!byDate[s.date]) byDate[s.date] = [];
    byDate[s.date].push(s);
  });

  return calMap.map((entry) => {
    const daySessions = (byDate[entry.date] || [])
      .slice()
      .sort((a, b) => (a.session === "FN" ? -1 : 1) - (b.session === "FN" ? -1 : 1));

    return {
      ...entry,
      isExam:      daySessions.length > 0,
      examSessions: daySessions.map((s) => ({ session: s.session, name: s.name, examType: s.examType })),
      // Backward-compat single-value fields (first session of the day)
      examName: daySessions.length > 0 ? daySessions[0].name : null,
      examType: daySessions.length > 0 ? daySessions[0].examType : null,
    };
  });
}

// ── Detect which week numbers a set of dates falls in ──────────────────────────
// usedDays: array of "YYYY-MM-DD" dates (e.g. exam.usedDays from scheduleExamSessions)
function getExamWeekNumbers(calMap, usedDays = []) {
  const dateSet = new Set(usedDays);
  const weeks = new Set();
  calMap.forEach((entry) => {
    if (dateSet.has(entry.date)) {
      weeks.add(entry.week);
    }
  });
  return [...weeks].sort((a, b) => a - b);
}

// ── Find the week immediately before a given week number ─────────────────────
function getPreviousWeekNumber(weekNum) {
  return Math.max(1, weekNum - 1);
}

// ── Abbreviate a subject name to a compact short form ────────────────────────
// Tries known acronyms first; falls back to initials of significant words.
function abbrevSubject(name) {
  const KNOWN = {
    "data structures": "DS",
    "data structures and algorithms": "DSA",
    "data structures & algorithms": "DSA",
    "algorithms": "Algo",
    "operating systems": "OS",
    "computer networks": "CN",
    "database management systems": "DBMS",
    "database management": "DBMS",
    "web development": "WebDev",
    "web technologies": "WebTech",
    "software engineering": "SE",
    "object oriented programming": "OOP",
    "object-oriented programming": "OOP",
    "machine learning": "ML",
    "artificial intelligence": "AI",
    "deep learning": "DL",
    "natural language processing": "NLP",
    "computer organization": "CO",
    "computer organization and architecture": "COA",
    "theory of computation": "TOC",
    "discrete mathematics": "DM",
    "mathematics": "Math",
    "digital electronics": "DE",
    "microprocessors": "MP",
    "system design": "SD",
    "cloud computing": "Cloud",
    "cybersecurity": "CySec",
    "cyber security": "CySec",
    "information security": "InfoSec",
    "java programming": "Java",
    "python programming": "Python",
  };
  const lower = (name || "").trim().toLowerCase();
  if (KNOWN[lower]) return KNOWN[lower];
  const skip = new Set(["and", "of", "the", "for", "in", "to", "a", "&"]);
  const initials = lower
    .split(/[\s\-\/]+/)
    .filter((w) => w.length > 0 && !skip.has(w))
    .map((w) => w[0].toUpperCase())
    .join("");
  return initials.length > 1 ? initials : (name || "").slice(0, 5);
}

// ── Build a human-readable calendar summary string for LLM prompts ────────────
// exams: validated exams, each augmented with `usedDays` (from scheduleExamSessions)
function buildCalendarSummary(calMap, exams = []) {
  const weeks = summariseCalendar(calMap);

  // Compute which weeks are IA weeks, AU weeks, and mock week
  const auExam  = exams.find((ex) => ex.examType === "AU");
  const iaExams = exams.filter((ex) => ex.examType && ex.examType.startsWith("IA"));

  // AU exam week numbers
  let auWeekNums = [];
  if (auExam) {
    if (auExam.usedDays && auExam.usedDays.length > 0) {
      auWeekNums = getExamWeekNumbers(calMap, auExam.usedDays);
    } else {
      const auRangeDays = calMap
        .filter(e => !e.isHoliday && e.date >= auExam.startDate && e.date <= (auExam.endDate || auExam.startDate))
        .map(e => e.date);
      auWeekNums = getExamWeekNumbers(calMap, auRangeDays);
    }
  }

  // Mock week = week just before the first AU exam week
  const mockWeekNum = auWeekNums.length > 0 ? getPreviousWeekNumber(auWeekNums[0]) : null;

  // IA exam week numbers per exam
  const iaWeekMap = {};
  for (const ia of iaExams) {
    iaWeekMap[ia.name] = getExamWeekNumbers(calMap, ia.usedDays || []);
  }

  const lines = weeks.map((w) => {
    const isMockWeek = mockWeekNum === w.week;
    const isAUWeek   = auWeekNums.includes(w.week);
    const isIAWeek   = Object.values(iaWeekMap).some((wks) => wks.includes(w.week));

    const holidayNote = w.holidays.length > 0
      ? ` ⚠️  Holidays: ${w.holidays.map((h) => `${toDisplayDate(h.date)} (${h.name})`).join(", ")}.`
      : "";

    // examNote: normal exam sessions OR, for AU with no subjects, show the date range
    const examNote = w.examDays && w.examDays.length > 0
      ? ` 📝 Exams: ${w.examDays.map((e) => `${toDisplayDate(e.date)} ${e.session ? `(${e.session}) ` : ""}(${abbrevSubject(e.name)} — ${e.examType || "Exam"})`).join(", ")}.`
      : isAUWeek && auExam && (!auExam.usedDays || auExam.usedDays.length === 0)
        ? ` 📝 AU Exam period: ${toDisplayDate(auExam.startDate)} → ${toDisplayDate(auExam.endDate || auExam.startDate)} — 3-hr exam each day, student goes home after exam.`
        : "";

    let weekTypeNote = "";
    if (isMockWeek) weekTypeNote = " 🔵 MOCK EXAM WEEK (prep for AU).";
    else if (isAUWeek) weekTypeNote = " 🔴 AU (University) EXAM WEEK.";
    else if (isIAWeek) {
      const iaName = Object.entries(iaWeekMap).find(([, wks]) => wks.includes(w.week))?.[0];
      weekTypeNote = ` 🟠 ${iaName || "IA"} EXAM WEEK.`;
    }

    const loadNote = w.workingDays <= 2
      ? " 🔴 Very short week — assign only 1 topic per subject."
      : w.workingDays === 3
      ? " 🟡 Short week — reduce content load."
      : "";

    return (
      `Week ${w.week} | ${toDisplayDate(w.startDate)} → ${toDisplayDate(w.endDate)} | ` +
      `${w.workingDays} working day(s)${weekTypeNote}${holidayNote}${examNote}${loadNote}`
    );
  });

  return lines.join("\n");
}

// ── Get the actual date string for a specific week + day name ─────────────────
function getDateForWeekDay(calMap, weekNum, dayName) {
  const entry = calMap.find(
    (e) => e.week === weekNum && e.day === dayName
  );
  return entry ? entry.date : null;
}

// ── Check if a specific week+day is a holiday ─────────────────────────────────
function isHolidayDay(calMap, weekNum, dayName) {
  const entry = calMap.find(
    (e) => e.week === weekNum && e.day === dayName
  );
  return entry ? entry.isHoliday : false;
}

// ── Get working days for a week (excluding holidays) ─────────────────────────
function getWorkingDaysForWeek(calMap, weekNum) {
  return calMap.filter((e) => e.week === weekNum && !e.isHoliday);
}

// ── One-shot: build full calendar (holidays + exams + weekly summary) ─────────
// All incoming dates must be "YYYY-MM-DD"
// exams: [{ name, examType, startDate, endDate, subjects?: string[], subjectCount?: number }]
async function buildFullCalendar(startDate, endDate, exams = []) {
  const year    = new Date(startDate).getFullYear();
  const endYear = new Date(endDate).getFullYear();

  let holidays = await fetchIndiaHolidays(year);
  if (endYear !== year) {
    const moreHolidays = await fetchIndiaHolidays(endYear);
    holidays = [...holidays, ...moreHolidays];
  }

  // Validate and clamp exam dates to course range
  const validatedExams = exams
    .filter((ex) => ex.name && ex.startDate)
    .map((ex) => ({
      ...ex,
      startDate: ex.startDate < startDate ? startDate : ex.startDate,
      endDate:   ex.endDate
        ? (ex.endDate > endDate ? endDate : ex.endDate)
        : (ex.startDate > endDate ? endDate : ex.startDate),
    }));

  let calMap = buildCalendarMap(startDate, endDate, holidays);

  // Schedule each exam's subjects into FN/AN sessions within its range
  const examErrors = [];
  const allSessions = [];
  const examsWithUsedDays = validatedExams.map((ex) => {
    const { sessions, usedDays, error, noSubjects } = scheduleExamSessions(calMap, ex);
    if (error) examErrors.push(error);

    let finalUsedDays = usedDays;
    // If no subjects were provided (user only gave date range),
    // treat the whole range as exam days to capture correct week numbers
    // and create generic sessions for those days.
    if (noSubjects) {
      const rangeDays = calMap
        .filter(e => !e.isHoliday && e.date >= ex.startDate && e.date <= (ex.endDate || ex.startDate))
        .map(e => e.date);
      finalUsedDays = rangeDays;
      // Create generic sessions (one per day, FN session) for these days
      rangeDays.forEach(date => {
        allSessions.push({
          date,
          session: "FN",
          name: `${ex.examType === "AU" ? "AU" : "IA"} Exam`,
          examType: ex.examType,
          subjectIndex: 0
        });
      });
    } else {
      allSessions.push(...sessions);
    }
    return { ...ex, usedDays: finalUsedDays, noSubjects };
  });

  calMap = markExamDays(calMap, allSessions);

  // Compute derived metadata (IA weeks, AU weeks, mock week)
  const auExam = examsWithUsedDays.find((ex) => ex.examType === "AU");
  let auWeekNums = [];
  if (auExam) {
    auWeekNums = getExamWeekNumbers(calMap, auExam.usedDays);
  }
  const mockWeekNum = auWeekNums.length > 0 ? getPreviousWeekNumber(auWeekNums[0]) : null;

  const iaExams = examsWithUsedDays.filter((ex) => ex.examType && ex.examType.startsWith("IA"));
  const iaWeekNumsSet = new Set();
  for (const ia of iaExams) {
    getExamWeekNumbers(calMap, ia.usedDays).forEach(w => iaWeekNumsSet.add(w));
  }
  const iaWeekNums = [...iaWeekNumsSet].sort((a, b) => a - b);

  const weeklySummary = summariseCalendar(calMap);
  const calendarSummaryText = buildCalendarSummary(calMap, examsWithUsedDays);

  return {
    calMap,
    weeklySummary,
    calendarSummaryText,
    examErrors,
    meta: {
      iaWeekNums,
      auWeekNums,
      mockWeekNum,
      totalWeeks: weeklySummary.length,
    },
  };
}

module.exports = {
  fetchIndiaHolidays,
  buildCalendarMap,
  summariseCalendar,
  buildCalendarSummary,
  getDateForWeekDay,
  isHolidayDay,
  getWorkingDaysForWeek,
  markExamDays,
  scheduleExamSessions,
  buildFullCalendar,
  toDisplayDate,
  toISODate,
  getExamWeekNumbers,
  getPreviousWeekNumber,
  abbrevSubject,
};