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

function countHttps(lines = []) {
  return lines.filter((l) => /https?:\/\//i.test(String(l))).length;
}

function hasWebsiteLine(lines = []) {
  return lines.some((l) => /website\s*:|article\s*:/i.test(String(l)) && /https?:\/\//i.test(String(l)));
}

function hasYoutubeLine(lines = []) {
  return lines.some(
    (l) =>
      (/youtube\s*:|video\s*:/i.test(String(l)) || /youtu(\.be|be\.com)/i.test(String(l))) &&
      /https?:\/\//i.test(String(l))
  );
}

function extractWatchUrl(line = "") {
  const m = String(line).match(/https?:\/\/(?:www\.)?youtube\.com\/watch\?v=[\w-]{11}[^\s)\]"']*/i);
  return m ? m[0] : "";
}

function extractArticleUrl(line = "") {
  const m = String(line).match(/https?:\/\/[^\s)\]"']+/i);
  if (!m) return "";
  const u = m[0];
  if (/youtube\.com|youtu\.be/i.test(u)) return "";
  if (/geeksforgeeks\.org\/\?s=/i.test(u) || /\/search\?/i.test(u)) return "";
  return u;
}

/**
 * Inject curated YouTube watch?v= + Article when Learning is missing real URLs.
 * Output format matches dayTemplateEngine: ▶ YouTube: … / ▶ Article: …
 */
function ensureMandatoryLearningLinks(topic, existingLinks = [], opts = {}) {
  const out = [...(existingLinks || [])]
    .map((l) => String(l || "").trim())
    .filter(Boolean)
    // Drop banned search URLs
    .filter(
      (l) =>
        !/geeksforgeeks\.org\/\?s=/i.test(l) &&
        !/youtube\.com\/results\?search_query=/i.test(l)
    );

  let yt = "";
  let article = "";
  for (const line of out) {
    if (!yt) yt = extractWatchUrl(line);
    if (!article && /article\s*:|website\s*:/i.test(line)) article = extractArticleUrl(line);
    if (!article) {
      const u = extractArticleUrl(line);
      if (u) article = u;
    }
  }

  if (!yt || !article) {
    try {
      const { pickResourcesForTopic } = require("./learningResources");
      const { isWatchYoutubeStrict, DEFAULT_PAIR } = require("../data/curatedLearningLinks");
      const pair = pickResourcesForTopic(
        topic || "today's concept",
        "",
        null,
        {
          dayIdx: Number(opts.dayIdx) || 0,
          seenUrls:
            opts.inputs?._seenResourceUrls instanceof Set
              ? opts.inputs._seenResourceUrls
              : null,
        }
      );
      if (!yt) {
        yt =
          pair?.youtube?.url && isWatchYoutubeStrict(pair.youtube.url)
            ? pair.youtube.url
            : DEFAULT_PAIR.youtube.url;
      }
      if (!article) {
        const web = String(pair?.web?.url || DEFAULT_PAIR.web.url);
        article =
          web && !/geeksforgeeks\.org\/\?s=/i.test(web) && !/\/search\?/i.test(web)
            ? web
            : DEFAULT_PAIR.web.url;
      }
    } catch (_) {
      if (!yt) yt = "https://www.youtube.com/watch?v=a7sEoEvT8l8";
      if (!article) article = "https://www.freecodecamp.org/learn/";
    }
  }

  // Always return the two required lines in the persisted format
  return [
    `▶ YouTube: ${yt}`,
    `▶ Article: ${article}`,
  ];
}

/** Keep Learning as Concept / Why / Outcome / two links — drop extra drills. */
function sanitizeLearningContent(content, opts = {}) {
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
    if (
      /https?:\/\//i.test(line) ||
      /website\s*:|youtube\s*:|video\s*:|article\s*:/i.test(line)
    ) {
      if (/geeksforgeeks\.org\/\?s=/i.test(line) || /youtube\.com\/results\?search_query=/i.test(line)) {
        continue;
      }
      const yt = extractWatchUrl(line);
      if (yt) {
        const cleaned = `▶ YouTube: ${yt}`;
        if (!links.some((x) => x === cleaned)) links.push(cleaned);
        continue;
      }
      const art = extractArticleUrl(line);
      if (art) {
        const cleaned = `▶ Article: ${art}`;
        if (!links.some((x) => x === cleaned)) links.push(cleaned);
      }
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

  const topic = opts.topic || concept || "today's concept";
  const requireLinks =
    opts.requireLearningLinks === true ||
    opts.requireLearningLinks === "true" ||
    (opts.requireLearningLinks !== false &&
      opts.requireLearningLinks !== "false" &&
      opts.inputs?._requireLearningLinks !== false &&
      opts.inputs?._requireLearningLinks !== "false");
  // When _requireLearningLinks=true, never skip inject
  const force =
    opts.inputs?._requireLearningLinks === true ||
    opts.inputs?._requireLearningLinks === "true" ||
    requireLinks;
  const few = force
    ? ensureMandatoryLearningLinks(topic, links, opts)
    : links.slice(0, 2).map((l) => {
        const yt = extractWatchUrl(l);
        if (yt) return `▶ YouTube: ${yt}`;
        const art = extractArticleUrl(l);
        if (art) return `▶ Article: ${art}`;
        return l;
      });

  const keepLine = (re) => {
    const hit = lines.find((l) => re.test(l.replace(/^▶\s*/, "").replace(/^[·•]\s*/, "")));
    return hit ? `▶ ${hit.replace(/^[·•]\s*/, "").replace(/^▶\s*/, "")}` : "";
  };
  const problemLine = keepLine(/^problem \(short\)\s*:/i);
  const doLine = keepLine(/^do this\s*:/i);
  const buildsOn = keepLine(/^builds on\s*:/i);
  const feedsNext = keepLine(/^feeds next\s*:/i);
  const deliverables = lines.filter((l) => /(deliverable|done when)\s*:/i.test(l));
  const done = deliverables.length
    ? deliverables[deliverables.length - 1]
        .replace(/^[·•]\s*/, "")
        .replace(/^▶\s*/, "▶ ")
        .replace(/done when:/i, "Deliverable:")
    : "";
  const out = [
    problemLine,
    `▶ Concept: ${concept || "today's concept"}`,
    `▶ Why: ${why || "You need this idea to take the next step on your project."}`,
    `▶ Outcome: ${outcome || "You can explain this idea in simple words and give one example."}`,
    doLine,
    ...few,
    buildsOn,
    feedsNext,
    done,
  ].filter(Boolean);
  return out.join("\n");
}

function isLearningActivity(activity = "") {
  const a = String(activity || "").toLowerCase();
  return /\blearning\b/.test(a) || /\btheory\b/.test(a) || /^learn\b/.test(a);
}

function sanitizeLearningRow(row, opts = {}) {
  if (Array.isArray(row)) {
    if (!isLearningActivity(row[2])) return row;
    const next = [...row];
    next[3] = sanitizeLearningContent(row[3], opts);
    return next;
  }
  if (!isLearningActivity(row?.activity)) return row;
  return { ...row, content: sanitizeLearningContent(row.content, opts) };
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

/** Template-engine cells already carry Problem / DT labels / Deliverable — never flatten them. */
function isRichWorkContent(content) {
  const t = asText(content);
  return /Problem \(short\)|Real Project Task:|DT Playbook page\s*\d/i.test(t) && /Deliverable:/i.test(t);
}

function sanitizeWorkRow(row, kind) {
  const apply = (act) =>
    kind === "problem" ? isProblemActivity(act) : isProjectActivity(act);
  if (Array.isArray(row)) {
    if (!apply(row[2])) return row;
    if (isRichWorkContent(row[3])) return row;
    const next = [...row];
    next[3] = sanitizeWorkBrief(row[3], kind);
    return next;
  }
  if (!apply(row?.activity)) return row;
  if (isRichWorkContent(row.content)) return row;
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

  const linkOpts = {
    inputs: ctx.inputs || {},
    dayIdx: Number(ctx.dayIdx) || 0,
    topic: ctx.learnTopic || theme.learnTopic || "",
    requireLearningLinks:
      ctx.requireLearningLinks === true ||
      ctx.requireLearningLinks === "true" ||
      ctx.inputs?._requireLearningLinks === true ||
      ctx.inputs?._requireLearningLinks === "true" ||
      (ctx.requireLearningLinks !== false &&
        ctx.inputs?._requireLearningLinks !== false &&
        ctx.inputs?._requireLearningLinks !== "false"),
  };
  findRows(out, (a) => isLearningActivity(a)).forEach(({ idx }) => {
    const topicHint =
      linkOpts.topic ||
      extractLearnTopic(asText(out[idx][3])) ||
      dtStep?.step ||
      "today's concept";
    out[idx] = sanitizeLearningRow(out[idx], { ...linkOpts, topic: topicHint });
    // Belt-and-braces: dayTemplateEngine inject for renamed titles
    try {
      const { ensureLearningProjectLinks, pickCuratedLinks } = require("./dayTemplateEngine");
      const links = pickCuratedLinks(topicHint, linkOpts.dayIdx, linkOpts.inputs);
      const content = ensureLearningProjectLinks(
        asText(out[idx][3]),
        { id: "learning", title: out[idx][2] },
        links,
        linkOpts.inputs,
        out[idx][2]
      );
      out[idx] = setContent(out[idx], content.split("\n"));
    } catch (_) {
      /* optional */
    }
  });

  // Pull morning learn topic so Project must apply the SAME topic on the problem
  const learnRows = findRows(out, (a) => isLearningActivity(a));
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
      if (isRichWorkContent(text)) return;
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
  ensureMandatoryLearningLinks,
};
