/**
 * Extract / normalize Tonight's Homework rows from a daily-shaped plan.
 * Shared by sync APIs and generators.
 * Aligns LeetCode problem + link with the same day's Learning / Coding Practice.
 */

const {
  leetcodeUrl,
  buildLeetCodeProblemUrl,
  isExactLeetCodeProblemUrl,
  isBareLeetCodeUrl,
  repairLeetCodeUrlsInContent,
} = require("./leetcodeUrl");

function parseDayKey(raw) {
  const m = String(raw || "").match(
    /Week\s*(\d+)\s*[-–]\s*(\w+)(?:\s*\((\d{2})-(\d{2})-(\d{4})\))?/i
  );
  if (!m) return null;
  const date = m[3] ? `${m[5]}-${m[4]}-${m[3]}` : null;
  return { week: parseInt(m[1], 10), dayName: m[2], date };
}

function isHomeworkActivity(activity) {
  return /homework/i.test(String(activity || ""));
}

const TASK_TITLE_RE =
  /^(leetcode(?:\s+practice)?|exercism(?:\s+practice)?|linkedin(?:\s+article)?|agent workbench|case study(?:\s+review)?)\b/i;

function inferKind(title = "") {
  const t = String(title).toLowerCase();
  if (t.includes("exercism")) return "exercism";
  if (t.includes("leetcode")) return "leetcode";
  if (t.includes("agent")) return "agent";
  if (t.includes("linkedin")) return "linkedin";
  if (t.includes("case")) return "case";
  return "task";
}

function leetcodeUrlFromName(name = "", existing = "") {
  if (existing && isExactLeetCodeProblemUrl(existing)) {
    return buildLeetCodeProblemUrl({ url: existing });
  }
  return buildLeetCodeProblemUrl({ name, url: existing }) || "";
}

/**
 * Pull Learning topic + Coding Practice LC from the same dayId in daily rows.
 */
function extractDayScheduleContext(rows = [], dayId = "") {
  const id = String(dayId || "");
  const dayRows = (rows || []).filter(
    (r) => Array.isArray(r) && String(r[0] || "") === id
  );
  const ctx = {
    learnTopic: "",
    learnUrl: "",
    codingLc: "",
    codingName: "",
    codingUrl: "",
    codingPattern: "",
  };

  for (const r of dayRows) {
    const act = String(r[2] || "");
    const c = String(r[3] || "");
    if (/^learning$/i.test(act) || /^learn\b/i.test(act)) {
      const heading =
        c.match(/Heading:\s*(.+)/i)?.[1] ||
        c.match(/What to Learn[:\s]+(.+)/i)?.[1] ||
        c.match(/▶\s*Heading:\s*(.+)/i)?.[1];
      if (heading) ctx.learnTopic = String(heading).replace(/\s+/g, " ").trim().slice(0, 70);
      const web =
        c.match(/Website[^:\n]*:\s*[^\n—–-]+[—–-]\s*(https?:\/\/\S+)/i)?.[1] ||
        c.match(/(https?:\/\/(?!www\.youtube)[^\s)]+)/i)?.[0];
      if (web) ctx.learnUrl = web.replace(/[.,;:!?)]+$/g, "");
    }
    if (/coding practice/i.test(act)) {
      const hit =
        c.match(/LeetCode\s*#\s*(\d+)\s*[—–-]\s*([^\n(]+)/i) ||
        c.match(/#\s*(\d+)\s*[—–-]\s*([^\n(]+)/);
      if (hit) {
        ctx.codingLc = hit[1];
        ctx.codingName = String(hit[2] || "").trim();
      }
      const url = (c.match(/https?:\/\/leetcode\.com\/problems\/[\w-]+\/?/i) || [])[0];
      if (url) ctx.codingUrl = url.replace(/[.,;:!?)]+$/g, "");
      const pat = c.match(/Pattern[:\s]+([^\n]+)/i)?.[1];
      if (pat) ctx.codingPattern = String(pat).trim().slice(0, 50);
      if (!ctx.codingUrl && ctx.codingName) {
        ctx.codingUrl = leetcodeUrlFromName(ctx.codingName);
      }
    }
  }
  return ctx;
}

/**
 * Rewrite homework LeetCode block so Problem + Link + Class match today's schedule.
 */
function alignHomeworkContentToDaily(content = "", dayCtx = {}) {
  let text = String(content || "");
  if (!text.trim()) return text;

  const hasLc = /^leetcode\b/im.test(text);
  if (!hasLc) return text;

  // Fix bare / incomplete leetcode URLs using Problem / Tonight name
  const problemLine =
    text.match(/^Problem:\s*(.+)$/im)?.[1] ||
    text.match(/^Tonight:\s*(.+)$/im)?.[1] ||
    "";
  const hwLc =
    text.match(/^Problem:\s*#\s*(\d+)/im)?.[1] ||
    text.match(/^Tonight:\s*#\s*(\d+)/im)?.[1] ||
    "";
  const nameFromProblem = String(problemLine)
    .replace(/^#\d+\s*[—–-]?\s*/i, "")
    .replace(/\([^)]*\)\s*$/g, "")
    .trim();

  const repaired = repairLeetCodeUrlsInContent(text);
  text = repaired.content;
  if (nameFromProblem && /Link:\s*https?:\/\/leetcode\.com/i.test(text)) {
    const exact =
      leetcodeUrlFromName(nameFromProblem) ||
      (dayCtx.codingUrl && isExactLeetCodeProblemUrl(dayCtx.codingUrl)
        ? dayCtx.codingUrl
        : "");
    if (exact) {
      text = text.replace(
        /^(Link:\s*)(https?:\/\/(?:www\.)?leetcode\.com\/\S*)/gim,
        (full, pfx, url) =>
          isBareLeetCodeUrl(url) || !isExactLeetCodeProblemUrl(url)
            ? `${pfx}${exact}`
            : full
      );
    }
  }

  // Use daytime Coding Practice URL only when it's the SAME LC number
  if (
    dayCtx.codingUrl &&
    /leetcode\.com\/problems\/[\w-]+/i.test(dayCtx.codingUrl) &&
    hwLc &&
    dayCtx.codingLc &&
    String(hwLc) === String(dayCtx.codingLc)
  ) {
    text = text.replace(
      /(^LeetCode[^\n]*\n[\s\S]*?^Link:\s*)(https?:\/\/\S+)/im,
      `$1${dayCtx.codingUrl}`
    );
  }

  // Upgrade Tonight: → Problem: for parsers
  text = text.replace(/^Tonight:\s*(#\d+\s*[—–-].+)$/im, "Problem: $1");

  // If homework Problem is missing but we have day Coding Practice, inject alignment
  if (dayCtx.codingLc && dayCtx.codingName) {
    if (!/^Problem:\s*/im.test(text)) {
      text = text.replace(
        /^(LeetCode[^\n]*)/im,
        `$1\nProblem: #${dayCtx.codingLc} — ${dayCtx.codingName}`
      );
      if (dayCtx.codingUrl) {
        text = text.replace(
          /(^LeetCode[^\n]*\n[\s\S]*?^Link:\s*)(https?:\/\/\S+)/im,
          `$1${dayCtx.codingUrl}`
        );
      }
    }
  }

  if (dayCtx.learnTopic) {
    if (/^Class today:/im.test(text)) {
      text = text.replace(/^Class today:\s*.+$/im, `Class today: ${dayCtx.learnTopic}`);
    } else {
      text = text.replace(
        /^(LeetCode[^\n]*\n)/im,
        `$1Class today: ${dayCtx.learnTopic}\n`
      );
    }
    const pat = dayCtx.codingPattern || "today's pattern";
    const dayBit = dayCtx.codingLc
      ? `Coding Practice #${dayCtx.codingLc}${dayCtx.codingName ? ` — ${dayCtx.codingName}` : ""} (pattern “${pat}”)`
      : `Coding Practice on pattern “${pat}”`;
    const howBlock = [
      `How it connects to today's learning:`,
      `1) Learning: you studied “${dayCtx.learnTopic}”.`,
      `2) Day slot: ${dayBit}.`,
      `3) Tonight: this LeetCode drills that SAME part so practice continues class.`,
    ].join("\n");

    if (/^How it connects to today's learning:/im.test(text)) {
      text = text.replace(
        /^How it connects to today's learning:[\s\S]*?(?=^(?:How it connects to project|Why|Why this problem|Link|Do|Apply|Done when):)/im,
        `${howBlock}\n`
      );
    } else if (/^Connects to:/im.test(text)) {
      text = text.replace(/^Connects to:\s*.+$/im, howBlock);
    } else if (/^Schedule connection:/im.test(text)) {
      text = text.replace(/^Schedule connection:\s*.+$/im, howBlock);
    } else {
      text = text.replace(/^(Pattern:\s*.+)$/im, `$1\n${howBlock}`);
      if (!/^How it connects to today's learning:/im.test(text)) {
        text = text.replace(/^(LeetCode[^\n]*\n)/im, `$1${howBlock}\n`);
      }
    }

    // Ensure project-implementation bridge is present
    if (!/^How it connects to project implementation:/im.test(text)) {
      const pat = dayCtx.codingPattern || "today's pattern";
      const projectLines = [
        `How it connects to project implementation:`,
        `1) Pattern “${pat}” is a building block for implementing your product.`,
        `2) Project hook: after solve, write where this pattern fits in your feature / data / flow (2 lines).`,
        `3) Implementation note: name the file or screen you would touch next.`,
      ].join("\n");
      if (/^Why this problem:/im.test(text)) {
        text = text.replace(/^(Why this problem:)/im, `${projectLines}\n$1`);
      } else if (/^Why:/im.test(text)) {
        text = text.replace(/^(Why:)/im, `${projectLines}\n$1`);
      } else if (/^Link:/im.test(text)) {
        text = text.replace(/^(Link:)/im, `${projectLines}\n$1`);
      } else {
        text = `${text}\n${projectLines}`;
      }
    }
  }

  return text;
}

function pickHeadline(rest, title) {
  return (
    rest.find((l) => /^problem\s*:/i.test(l))?.replace(/^problem\s*:\s*/i, "").trim() ||
    rest.find((l) => /^tonight\s*:/i.test(l))?.replace(/^tonight\s*:\s*/i, "").trim() ||
    rest.find((l) => /^case\s*:/i.test(l))?.replace(/^case\s*:\s*/i, "").trim() ||
    rest.find((l) => /^#\d+/.test(l)) ||
    rest.find((l) => /^week\s+\d+/i.test(l)) ||
    rest[0] ||
    title
  );
}

function parseHomeworkTasks(content) {
  const raw = String(content || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return [];

  const lines = raw
    .split("\n")
    .map((l) => l.replace(/^[▶•\-–—*▸▪\s]+/, "").trim())
    .filter((l) => l && !/^tonight'?s homework\b/i.test(l));

  const starts = [];
  lines.forEach((line, i) => {
    if (TASK_TITLE_RE.test(line)) starts.push(i);
  });

  if (!starts.length) {
    return lines
      .filter((l) => /^(leetcode|exercism|linkedin|agent|case)\b/i.test(l))
      .slice(0, 5)
      .map((line, index) => {
        const url = (line.match(/https?:\/\/\S+/i) || [])[0] || "";
        const title = line.replace(url, "").replace(/\s*[—–-]\s*$/, "").trim();
        return {
          index,
          title,
          kind: inferKind(title),
          problem: title,
          body: "",
          doneWhen: "",
          url,
          done: false,
        };
      });
  }

  return starts.slice(0, 5).map((start, idx) => {
    const end = idx + 1 < starts.length ? starts[idx + 1] : lines.length;
    const chunk = lines.slice(start, end);
    const title = chunk[0] || "";
    const bodyLines = chunk.slice(1);
    let url = "";
    const rest = [];
    bodyLines.forEach((line) => {
      const m = line.match(/^(?:link\s*:\s*)?(https?:\/\/\S+)/i);
      if (m && !url) {
        url = m[1].replace(/[.,;:!?)]+$/g, "");
        return;
      }
      const bare = (line.match(/https?:\/\/\S+/i) || [])[0];
      if (bare && !url && /link\s*:/i.test(line)) {
        url = bare.replace(/[.,;:!?)]+$/g, "");
        return;
      }
      rest.push(line);
    });

    const problem = pickHeadline(rest, title);
    const doneWhenLine = rest.find((l) => /^done when\s*:/i.test(l));
    const doneWhen = doneWhenLine
      ? doneWhenLine.replace(/^done when\s*:\s*/i, "").trim()
      : "";

    // Repair incomplete LC URLs from problem name
    if (/leetcode/i.test(title) && (!url || isBareLeetCodeUrl(url) || !isExactLeetCodeProblemUrl(url))) {
      url = leetcodeUrlFromName(problem, url) || leetcodeUrl({ name: problem, url });
    }

    const body = rest
      .filter(
        (l) =>
          !/^done when\s*:/i.test(l) &&
          l !== problem &&
          !/^problem\s*:/i.test(l) &&
          !/^tonight\s*:/i.test(l)
      )
      .join("\n")
      .trim();

    return {
      index: idx,
      title,
      kind: inferKind(title),
      problem,
      body,
      doneWhen,
      url,
      done: false,
    };
  });
}

/**
 * From daily plan rows → homework night payloads (aligned to that day's schedule)
 */
function extractHomeworkNightsFromRows(rows = []) {
  const nights = [];
  for (const row of rows || []) {
    if (!Array.isArray(row) || row.length < 4) continue;
    if (!isHomeworkActivity(row[2])) continue;
    const dayId = String(row[0] || "");
    const parsed = parseDayKey(dayId) || { week: 1, dayName: "Monday", date: null };
    const dayCtx = extractDayScheduleContext(rows, dayId);
    const content = alignHomeworkContentToDaily(String(row[3] ?? ""), dayCtx);
    nights.push({
      dayId,
      week: parsed.week,
      dayName: parsed.dayName,
      date: parsed.date,
      time: String(row[1] || ""),
      activity: String(row[2] || "Tonight's Homework"),
      content,
      tasks: parseHomeworkTasks(content),
      schedule: {
        learnTopic: dayCtx.learnTopic || "",
        codingLc: dayCtx.codingLc || "",
        codingName: dayCtx.codingName || "",
      },
    });
  }
  return nights;
}

/** Flatten HomeworkNight docs → UI plan rows */
function nightsToPlanRows(nights = []) {
  return (nights || []).map((n) => [
    n.dayId,
    n.time || "",
    n.activity || "Tonight's Homework",
    n.content || "",
  ]);
}

module.exports = {
  parseDayKey,
  isHomeworkActivity,
  parseHomeworkTasks,
  extractHomeworkNightsFromRows,
  nightsToPlanRows,
  extractDayScheduleContext,
  alignHomeworkContentToDaily,
};
