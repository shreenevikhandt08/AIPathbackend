/**
 * Soft post-LLM connectivity enforcer — beginner-plain English.
 */

const { isNonCodeDtDay } = require("./dtPlaybookLookup");

function asText(cell) {
  if (Array.isArray(cell)) return cell.filter((x) => typeof x === "string").join("\n");
  return String(cell || "");
}

function setContent(row, lines) {
  const next = [...row];
  next[3] = lines.filter(Boolean).join("\n");
  return next;
}

function activityOf(row) {
  return String(row?.[2] || "").toLowerCase();
}

function findRows(rows, pred) {
  return rows
    .map((row, idx) => ({ row, idx }))
    .filter(({ row }) => pred(activityOf(row)));
}

/** Keep Learning as Concept / Why / Outcome / two links — drop extra drills. */
function sanitizeLearningContent(content) {
  const raw = String(content || "").replace(/\\n/g, "\n");
  const lines = raw
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let concept = "";
  let why = "";
  let outcome = "";
  const links = [];

  for (const line of lines) {
    const text = line.replace(/^▶\s*/, "").replace(/^[·•]\s*/, "").trim();
    if (/^concept\s*:/i.test(text)) {
      concept = text
        .replace(/^concept\s*:\s*/i, "")
        .replace(/\s*\(also[^)]*\)/i, "")
        .replace(/\s*[—–-]\s*same idea.*$/i, "")
        .trim();
      continue;
    }
    if (/^(why|purpose)\s*:/i.test(text)) {
      why = text.replace(/^(why|purpose)\s*:\s*/i, "").trim();
      continue;
    }
    if (/^outcome\s*:/i.test(text)) {
      outcome = text.replace(/^outcome\s*:\s*/i, "").trim();
      continue;
    }
    if (
      /^(links?|helpful links|subject today|heading|topics today|transition|done when|practice \d)/i.test(
        text
      ) ||
      /how it links|build hook|from your upload|ctrl\+f|shared topic|your learn focus|motivation:/i.test(
        line
      )
    ) {
      continue;
    }
    if (/https?:\/\//i.test(line) || /website\s*:|youtube\s*:|video\s*:/i.test(line)) {
      const cleaned = `   · ${text.replace(/^website\s*\/\s*article\s*:/i, "Website:")}`;
      if (!links.some((x) => x === cleaned)) links.push(cleaned);
    }
  }

  if (!concept) {
    const heading = lines.find((l) =>
      /heading:|learn today:|learn day|new learning:|one topic today:/i.test(l)
    );
    if (heading) {
      concept = heading
        .replace(/^▶\s*/, "")
        .replace(/^(heading|learn today|learn day\s*\d+|new learning|one topic today)\s*:\s*/i, "")
        .replace(/^deepen\s*[—–-]\s*/i, "")
        .trim();
    }
  }

  const out = [
    `▶ Concept: ${concept || "today's concept"}`,
    `▶ Why: ${why || "You need this idea to take the next step on your project."}`,
    `▶ Outcome: ${outcome || "You can explain this idea in simple words and give one example."}`,
  ];
  const few = links.slice(0, 2);
  if (few.length) {
    out.push("▶ Links:");
    out.push(...few);
  }
  return out.join("\n");
}

function sanitizeLearningRow(row) {
  if (Array.isArray(row)) {
    if (!/learning/i.test(String(row[2] || ""))) return row;
    const next = [...row];
    next[3] = sanitizeLearningContent(row[3]);
    return next;
  }
  if (!/learning/i.test(String(row?.activity || ""))) return row;
  return { ...row, content: sanitizeLearningContent(row.content) };
}

function ensureLearningHooks(row) {
  return sanitizeLearningRow(row);
}

function pickLabeled(lines, re) {
  for (const line of lines) {
    const text = line.replace(/^▶\s*/, "").replace(/^[·•]\s*/, "").trim();
    if (re.test(text)) return text.replace(re, "").trim();
  }
  return "";
}

function sanitizeWorkBrief(content, kind = "project") {
  const raw = String(content || "").replace(/\\n/g, "\n");
  const lines = raw
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const concept =
    pickLabeled(lines, /^concept\s*:\s*/i) ||
    pickLabeled(lines, /^heading\s*:\s*/i) ||
    pickLabeled(lines, /^dt playbook step\s*:\s*/i) ||
    (kind === "problem" ? "today's problem piece" : "today's project step");
  const purpose =
    pickLabeled(lines, /^(purpose|why)\s*:\s*/i) ||
    (kind === "problem"
      ? "Understand the problem before you build."
      : "Turn learning into a real product step.");
  const connect =
    pickLabeled(lines, /^connect\s*:\s*/i) ||
    "Problem, Learning, and Project use the same idea today.";
  const doit =
    pickLabeled(lines, /^(do|task|today'?s project task)\s*:\s*/i) ||
    pickLabeled(lines, /^real project task\s*:\s*/i) ||
    (kind === "problem"
      ? "Read the problem and write a one-sentence version."
      : "Do one small technical step and record it.");
  const docs =
    pickLabeled(lines, /^docs?\s*:\s*/i) ||
    (lines.find((l) => /\bPRD\b|\bSAD\b/i.test(l)) || "").replace(/^▶\s*/, "") ||
    "Docs: update PRD; add SAD when architecture starts.";
  const outcome =
    pickLabeled(lines, /^(outcome|done when)\s*:\s*/i) ||
    "One clear written update (PRD/SAD) finished today.";

  const clip = (s, n) => {
    const t = String(s || "").replace(/\s+/g, " ").trim();
    return t.length <= n ? t : `${t.slice(0, n - 1).replace(/\s+\S*$/, "")}…`;
  };

  return [
    `▶ Concept: ${clip(concept.replace(/^project build\s*[—–-]\s*/i, ""), 90)}`,
    `▶ Purpose: ${clip(purpose, 120)}`,
    `▶ Connect: ${clip(connect, 120)}`,
    `▶ Do: ${clip(doit, 150)}`,
    `▶ ${/^docs/i.test(docs) ? clip(docs, 120) : `Docs: ${clip(docs, 110)}`}`,
    `▶ Outcome: ${clip(outcome, 120)}`,
  ].join("\n");
}

function isProblemActivity(a) {
  return /problem review|problem lab/i.test(String(a || ""));
}

function isProjectActivity(a) {
  const t = String(a || "").toLowerCase();
  if (/mini build|project push|break|lunch|review|placement|speak|homework|learning/.test(t)) {
    return false;
  }
  return /project build|dt playbook|implement/.test(t) || /^project$/.test(t.trim());
}

function sanitizeWorkRow(row, kind) {
  const apply = (act) =>
    kind === "problem" ? isProblemActivity(act) : isProjectActivity(act);
  if (Array.isArray(row)) {
    if (!apply(row[2])) return row;
    const next = [...row];
    next[3] = sanitizeWorkBrief(row[3], kind);
    return next;
  }
  if (!apply(row?.activity)) return row;
  return { ...row, content: sanitizeWorkBrief(row.content, kind) };
}

function ensureProjectPipeline(row) {
  return sanitizeWorkRow(row, "project");
}

function ensureRetroConnectivity(row, nonCode) {
  const text = asText(row[3]);
  if (/End of day|LEARNED:|FINISHED:|TOMORROW:/i.test(text)) return row;
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const extra = [
    `▶ End of day — write 4 lines: LEARNED / FINISHED / LINKED to uploaded problem / TOMORROW first step`,
  ];
  return setContent(row, [...lines, ...extra]);
}

function extractLearnTopic(learningText) {
  const t = String(learningText || "");
  const m =
    t.match(/▶\s*Concept:\s*([^\n]+)/i) ||
    t.match(/▶\s*Learn(?:\s*Day\s*\d+)?:\s*([^\n]+)/i) ||
    t.match(/▶\s*Learn today:\s*([^\n]+)/i);
  return m ? m[1].trim().slice(0, 80) : null;
}

function enforceDayConnectivity(dayRows, ctx = {}) {
  if (!Array.isArray(dayRows) || !dayRows.length) return dayRows;
  const theme = ctx.theme || {};
  const dtStep = ctx.dtStep || null;
  const nonCode = isNonCodeDtDay(dtStep);

  let out = dayRows.map((r) => (Array.isArray(r) ? [...r] : r));

  findRows(out, (a) => a.includes("learning")).forEach(({ idx }) => {
    out[idx] = sanitizeLearningRow(out[idx]);
  });

  // Pull morning learn topic so Project must apply the SAME topic on the problem
  const learnRows = findRows(out, (a) => a.includes("learning"));
  const learnTopic =
    (learnRows[0] && extractLearnTopic(asText(learnRows[0].row[3]))) ||
    dtStep?.step ||
    null;

  findRows(out, (a) => a.includes("project") || a.includes("dt playbook") || a.includes("build")).forEach(({ idx }) => {
    if (/break|lunch|refresh|game|peer|retro|placement|speak|review|mini build|project push/i.test(activityOf(out[idx]))) return;
    out[idx] = sanitizeWorkRow(out[idx], "project");
  });
  findRows(out, (a) => a.includes("problem")).forEach(({ idx }) => {
    out[idx] = sanitizeWorkRow(out[idx], "problem");
  });
  void learnTopic;
  if (nonCode) {
    findRows(out, (a) => a.includes("system design") || a.includes("integration") || a.includes("framing")).forEach(({ idx }) => {
      const text = asText(out[idx][3]);
      // Keep real System Design teaching blocks intact
      if (/SYSTEM DESIGN CONCEPT|Concepts to cover|Today's SD angle|▶ Topic:|▶ Learn:/i.test(text)) return;
      if (/SAME notes file|Continue the SAME/i.test(text)) return;
      if (/git\s*(push|commit)|npm\s+start|write\s+code/i.test(text)) {
        out[idx] = setContent(out[idx], [
          `▶ Continue the SAME notes file from Project Build`,
          `▶ Add 2 lines linked to the uploaded problem`,
          `▶ Write 1 open question`,
          `▶ Save again in notes/`,
        ]);
      }
    });
  }

  findRows(out, (a) => a.includes("retro")).forEach(({ idx }) => {
    out[idx] = ensureRetroConnectivity(out[idx], nonCode);
  });

  return out;
}

module.exports = {
  enforceDayConnectivity,
  ensureLearningHooks,
  ensureProjectPipeline,
  sanitizeLearningContent,
  sanitizeLearningRow,
};
