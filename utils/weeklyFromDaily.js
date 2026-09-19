/**
 * Weekly Schedule — professional overview of EACH week's daily plan.
 *
 * Columns:
 *  - Subjects Covered  → what THIS week learnt (from daily Learning / DT / DSA / SD)
 *  - Project Milestone → what THIS week builds
 *  - Exam Focus        → what must be completed / revised THIS week (clear checklist)
 *
 * Never dump other weeks' chapter trackers into a single week's Subjects cell.
 */

function weekNumFromDayId(dayId) {
  const m = String(dayId || "").match(/Week\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

function dayNameFromDayId(dayId) {
  const m = String(dayId || "").match(
    /\b(Monday|Tuesday|Wednesday|Thursday|Friday)\b/i
  );
  return m ? m[1] : null;
}

const DANGLING_TAIL =
  /\b(a|an|the|for|to|of|in|on|or|and|with|by|as|at|from|into|that|which|who|their|its|your|based|e\.g|eg)$/i;

function softClipAtWord(text, max = 220) {
  let t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  let slice = t.slice(0, max);
  let sp = slice.lastIndexOf(" ");
  t = (sp > 40 ? slice.slice(0, sp) : slice).trim();
  while (DANGLING_TAIL.test(t)) {
    t = t.replace(DANGLING_TAIL, "").trim();
  }
  return t;
}

/** True when a clip left a half-thought (trailing connector, arrow, open paren, etc.). */
function looksIncomplete(text) {
  const s = String(text || "").trim();
  if (!s || s.length < 12) return true;
  if (/\([^)]*$/.test(s)) return true; // open (
  if (/["“][^"”]*$/.test(s)) return true; // open quote
  if (/[+\-–—→,:;/|]\s*$/.test(s)) return true;
  if (DANGLING_TAIL.test(s)) return true;
  if (/\b(based|define what|write 2|for each|for your)\s*$/i.test(s)) return true;
  return false;
}

/** Map long playbook / LLM tasks to short COMPLETE weekly goals. */
function rewriteMilestone(raw) {
  const s = String(raw || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (/empathy map|Says\s*\/\s*Thinks|Says\/Thinks\/Does\/Feels/i.test(s)) {
    return "Fill a 4-quadrant empathy map (Says / Thinks / Does / Feels) and save notes.";
  }
  if (/possible stacks|language\s*\+\s*UI|tech stack ideas|tech-stack-ideas/i.test(s)) {
    return "Write 2–3 stack options (language + UI + storage) as suggestions only.";
  }
  if (/state change|pending\s*→|app state|status:\s*pending/i.test(s)) {
    return "Define state changes for each user action (e.g. pending → done) and save notes.";
  }
  if (/cluster.*feature|MVP|must-have|named features/i.test(s)) {
    return "Cluster user actions into 4–6 named features; mark each MVP or Later.";
  }
  if (/similar products|2 real apps/i.test(s)) {
    return "Compare 2 similar apps: what works and what misses for your case.";
  }
  if (/process flow|journey the user|5–8 boxes/i.test(s)) {
    return "Sketch the user journey (5–8 steps) and mark where it breaks.";
  }
  if (/focus sentence|needs a way to/i.test(s)) {
    return "Write one clear focus sentence for the user need and save it.";
  }
  if (/pitch among peers|3-minute talk/i.test(s)) {
    return "Give a 3-minute pitch and log 2 peer questions.";
  }
  if (/problem identification|rewrite the uploaded problem|own words/i.test(s)) {
    return "Rewrite the problem in your own words (5–8 clear lines).";
  }
  if (/audience|main user|persona/i.test(s) && /describ|name|frustration/i.test(s)) {
    return "Describe one main user: role, daily frustration, and current workaround.";
  }
  if (/my ideas|8 one-line ideas/i.test(s)) {
    return "Write 8 one-line ideas and star your favourite 2.";
  }
  return "";
}

/**
 * Weekly milestone must be a COMPLETE short sentence — never "… UI +" or "… based".
 */
function shortCompleteMilestone(raw, max = 110) {
  let s = String(raw || "")
    .replace(/^▶\s*/, "")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";

  if (/PROBLEM\s*STATEMENT/i.test(s) || /for:\s*["“]?PROBLEM/i.test(s)) {
    s = s.split(/\s+for:\s*/i)[0] || "Explore stack options for the uploaded problem.";
  }
  s = s.replace(/["“][^"”]{40,}["”]/g, "the uploaded problem");
  s = s.replace(/\bPROBLEM\s*STATEMENT\s*:?\s*.+$/i, "the uploaded problem");

  const rewritten = rewriteMilestone(s);
  if (rewritten) return rewritten;

  // Prefer first full sentence when it is already complete and short enough
  const sentence = s.match(/^(.+?[.!?])(?:\s|$)/);
  if (sentence && sentence[1].length >= 24 && sentence[1].length <= max && !looksIncomplete(sentence[1])) {
    return sentence[1].trim();
  }

  if (s.length <= max && !looksIncomplete(s)) {
    return /[.!?]$/.test(s) ? s : `${s}.`;
  }

  // Too long / incomplete after clip → rewrite or repair to a finished thought
  let clipped = softClipAtWord(s, max).replace(/…$/g, "").trim();
  while (looksIncomplete(clipped) && clipped.length > 24) {
    clipped = clipped.replace(/\s+\S+$/, "").trim();
  }
  if (!looksIncomplete(clipped) && clipped.length >= 24) {
    return /[.!?]$/.test(clipped) ? clipped : `${clipped}.`;
  }

  return rewriteMilestone(s) || "Finish this week's Project Build deliverable (see daily).";
}

function cleanTopic(raw, max = 120) {
  let s = String(raw || "")
    .replace(/^▶\s*/, "")
    .replace(/^Learn(?:\s*Day\s*\d+)?:\s*/i, "")
    .replace(/^Topic(?:\s*Day\s*\d+)?:\s*/i, "")
    .replace(/^DSA(?:\s*Day\s*\d+)?:\s*/i, "")
    .replace(/^Build(?:\s*Day\s*\d+)?[^:]*:\s*/i, "")
    .replace(/^System Design:\s*/i, "")
    .replace(/^Heading:\s*/i, "")
    .replace(/^Deepen\s*[—–-]\s*/i, "")
    .replace(/^Deepen\s*\(multi-skill\)\s*[—–-]?\s*/i, "")
    .replace(/^Multi-skill\s*Learning\s*[—–-]?\s*/i, "")
    .replace(/\(multi-skill\)\s*[—–-]?\s*/gi, "")
    .replace(/^SD\s*·\s*/i, "")
    .replace(/^DT:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  s = s.replace(/^Day\s*\d+\s*[-:–]\s*/i, "");
  // Drop meta lines that are not real topics
  if (/^(week tracker|chapter tracker|helpful links|done when|start from|tip:)/i.test(s)) return "";
  if (/^you have finished/i.test(s)) return "";
  if (/^multi-skill/i.test(s)) return "";
  return softClipAtWord(s, max);
}

function cleanMilestonePoint(raw) {
  return shortCompleteMilestone(raw, 120);
}

function uniqShort(arr, limit = 8) {
  const out = [];
  const seen = new Set();
  for (const x of arr) {
    const t = cleanTopic(x);
    if (!t || t.length < 3) continue;
    const key = t.toLowerCase().slice(0, 48);
    if (seen.has(key)) continue;
    if ([...seen].some((k) => key.includes(k.slice(0, 18)) || k.includes(key.slice(0, 18)))) {
      continue;
    }
    seen.add(key);
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

function bullets(lines) {
  return (lines || [])
    .map((l) => String(l || "").trim())
    .filter(Boolean)
    .map((s) => (s.startsWith("▶") ? s : `▶ ${s}`))
    .join("\n");
}

/** Compact inline list for weekly overview cells */
function joinOverview(items, sep = " · ", max = 4, eachMax = 42) {
  return (items || [])
    .filter(Boolean)
    .slice(0, max)
    .map((t) => softClipAtWord(t, eachMax))
    .join(sep);
}

/** Subject line: prefer short "Name — topic" */
function subjectOverviewBit(name, topic) {
  const n = softClipAtWord(String(name || "").trim(), 28);
  const t = softClipAtWord(String(topic || "").trim(), 36);
  if (!n) return "";
  if (!t || /^topics?$/i.test(t)) return n;
  // Drop repeated name inside topic
  if (t.toLowerCase().startsWith(n.toLowerCase())) return softClipAtWord(t, 48);
  return `${n} — ${t}`;
}

function extractLearnTopic(content) {
  const text = String(content || "");
  const learn =
    text.match(/▶\s*Concept:\s*(.+)/i) ||
    text.match(/▶\s*One topic today:\s*([^\n]+)/i) ||
    text.match(/▶\s*Learn(?:\s*Day\s*\d+)?:\s*([^\n]+)/i) ||
    text.match(/▶\s*Learn today:\s*([^\n]+)/i) ||
    text.match(/▶\s*Heading:\s*(?:Deepen\s*[—–-]?\s*)?([^\n]+)/i);
  return learn ? cleanTopic(learn[1]) : "";
}

function extractDtStep(content) {
  const text = String(content || "");
  const step =
    text.match(/▶\s*DT Playbook Step:\s*([^\n]+)/i) ||
    text.match(/▶\s*Related DT Playbook Step:\s*([^\n]+)/i) ||
    text.match(/▶\s*Related DT Step:\s*([^\n]+)/i);
  return step ? cleanTopic(step[1], 80) : "";
}

function extractDtPage(content) {
  const m = String(content || "").match(/DT Playbook page\s+(\d+)/i);
  return m ? m[1] : null;
}

function extractProjectTask(content) {
  const text = String(content || "");
  const task =
    text.match(/▶\s*Today'?s project task[^:]*:\s*([^\n]+)/i) ||
    text.match(/▶\s*Real Project Task[^:]*:\s*([^\n]+)/i) ||
    text.match(/▶\s*Heading:\s*Project Build[^\n]*—\s*([^\n]+)/i) ||
    text.match(/▶\s*Heading:\s*([^\n]+)/i);
  return task ? cleanMilestonePoint(task[1]) : "";
}

function extractDoneWhen(content) {
  const m = String(content || "").match(/▶\s*Done when:\s*([^\n]+)/i);
  return m ? softClipAtWord(m[1].replace(/^▶\s*/, ""), 140) : "";
}

function extractSdTitle(content) {
  const text = String(content || "");
  const sd =
    text.match(/▶\s*Heading:\s*([^\n]+)/i) ||
    text.match(/▶\s*Lesson\s*\d+:\s*([^\n]+)/i) ||
    text.match(/▶\s*Topic(?:\s*Day\s*\d+)?:\s*([^\n]+)/i) ||
    text.match(/▶\s*Learn:\s*([^\n]+)/i);
  return sd ? cleanTopic(sd[1], 100) : "";
}

function extractDsaTitle(content) {
  const text = String(content || "");
  const dsa =
    text.match(/▶\s*Heading:\s*([^\n]+)/i) ||
    text.match(/▶\s*DSA(?:\s*Day\s*\d+)?:\s*([^\n]+)/i);
  return dsa ? cleanTopic(dsa[1], 100) : "";
}

function extractPlacementFocus(content) {
  const text = String(content || "");
  // Prefer track name from "Placement Prep — Introduce yourself (HR) (~20 min)"
  const named =
    text.match(/▶\s*Placement(?:\s*Prep)?\s*[—–:-]\s*(?:Day\s*\d+\s*:\s*)?([^\n]+)/i) ||
    text.match(/▶\s*Heading:\s*([^\n]+)/i);
  if (named) {
    let s = cleanTopic(named[1], 90);
    // Strip timings / duration notes — overview only
    s = s
      .replace(/\(~\s*\d+\s*min\)/gi, "")
      .replace(/\(\s*\d+\s*[–-]\s*\d+\s*min\)/gi, "")
      .replace(/\b\d+\s*[–-]\s*\d+\s*min\b/gi, "")
      .replace(/\b\d+\s*min\b/gi, "")
      .replace(/\bDay\s*\d+\s*:?\s*/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    if (s.length >= 3) return s;
  }
  const learn = text.match(/▶\s*LEARN \(interview\):\s*([^\n]+)/i);
  if (learn) {
    // Keep short theme from learn line (first clause)
    return cleanTopic(learn[1].split(/[.—–]/)[0], 70);
  }
  return "";
}

function extractHomeworkMustDo(content) {
  const text = String(content || "");
  const out = [];
  const lc = text.match(/LeetCode[\s\S]{0,80}?#(\d+)\s*[—–-]\s*([^\n(]+)/i);
  if (lc) out.push(`LeetCode #${lc[1]} — ${cleanTopic(lc[2], 60)}`);
  const agent = text.match(/Agent Workbench\n([^\n]+)/i);
  if (agent) out.push(`Agent: ${cleanTopic(agent[1], 70)}`);
  const cs = text.match(/Case Study\n([^\n]+)/i);
  if (cs) out.push(`Case study: ${cleanTopic(cs[1], 70)}`);
  return out;
}

function themeForWeek(themes, week) {
  return (themes || []).find((t) => Number(t.week) === Number(week)) || null;
}

function examQuestionsForSubjects(subjectNames, examAnalysis, limit = 4) {
  if (!examAnalysis || typeof examAnalysis !== "object") return [];
  const out = [];
  const names = subjectNames.length ? subjectNames : Object.keys(examAnalysis);
  for (const name of names) {
    const topics = examAnalysis[name];
    if (!Array.isArray(topics)) continue;
    for (const t of topics) {
      const q = t?.question || t?.q || t?.text;
      if (q) out.push(`${name}: ${softClipAtWord(String(q), 110)}`);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

function truthyFlag(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

function resolveWeeklyFlags(inputs = {}) {
  const flags = {
    skipDsa: truthyFlag(inputs._skipDsa),
    skipSd: truthyFlag(inputs._skipSystemDesign),
    skipSubjects: truthyFlag(inputs._skipSubjects),
    skipQuestions: truthyFlag(inputs._skipQuestions),
    skipBanks: truthyFlag(inputs._skipAssessmentBanks),
  };
  try {
    const em =
      typeof inputs._enabledModules === "string"
        ? JSON.parse(inputs._enabledModules)
        : inputs._enabledModules;
    if (em && typeof em === "object") {
      if (em.dsa === false) flags.skipDsa = true;
      if (em.systemDesign === false) flags.skipSd = true;
      if (em.subjects === false) flags.skipSubjects = true;
      if (em.questions === false) flags.skipQuestions = true;
      if (em.assessmentBanks === false) flags.skipBanks = true;
    }
  } catch {
    /* ignore */
  }
  return flags;
}

function emptyBucket(week) {
  return {
    week,
    dayIds: new Set(),
    byDay: {}, // dayName -> { learn, dt, dtPage, project, projectDone, sd, dsa, placement, homework[], review }
    learnTopics: [],
    dsaTopics: [],
    sdTopics: [],
    dtSteps: [],
    projectDeliverables: [],
    placement: [],
    examHints: [],
    homeworkMust: [],
    fridayReview: false,
    activities: new Set(),
  };
}

function ensureDay(bucket, dayName) {
  if (!dayName) return null;
  if (!bucket.byDay[dayName]) {
    bucket.byDay[dayName] = {
      learn: "",
      dt: "",
      dtPage: null,
      project: "",
      projectDone: "",
      sd: "",
      dsa: "",
      placement: "",
      homework: [],
      review: false,
    };
  }
  return bucket.byDay[dayName];
}

/**
 * Subjects Covered — tight overview (max ~4 lines).
 * One labeled line per group; concepts joined inline (not a long bullet tree).
 */
function buildSubjectsCovered(bucket, theme, flags) {
  const lines = [];
  const learnt = uniqShort(bucket.learnTopics, 4);
  const dt = uniqShort(bucket.dtSteps, 4);
  const sdDaily = !flags.skipSd ? uniqShort(bucket.sdTopics, 3) : [];
  const dsaDaily = !flags.skipDsa ? uniqShort(bucket.dsaTopics, 3) : [];

  const subjectBits = [];
  const sdPoints = [...sdDaily];
  const dsaPoints = [...dsaDaily];

  if (!flags.skipSubjects && Array.isArray(theme?.subjects) && theme.subjects.length) {
    theme.subjects.forEach((s) => {
      const name = String(s.name || "").trim();
      if (!name) return;
      const topic = cleanTopic(s.topic || "", 48);
      if (/system design/i.test(name)) {
        if (flags.skipSd) return;
        const bit = topic || "core concepts";
        if (!sdPoints.some((p) => p.toLowerCase() === bit.toLowerCase())) sdPoints.push(bit);
        return;
      }
      if (/data structures|algorithms|\bdsa\b/i.test(name)) {
        if (flags.skipDsa) return;
        const bit = topic || "patterns";
        if (!dsaPoints.some((p) => p.toLowerCase() === bit.toLowerCase())) dsaPoints.push(bit);
        return;
      }
      const bit = subjectOverviewBit(name, topic);
      if (bit) subjectBits.push(bit);
    });
  }

  if (!subjectBits.length && learnt.length) {
    learnt.forEach((t) => subjectBits.push(softClipAtWord(t, 48)));
  }

  if (subjectBits.length) {
    lines.push(`Subjects: ${joinOverview(subjectBits, " · ", 4, 52)}`);
  }
  if (dt.length) {
    lines.push(`DT: ${joinOverview(dt, " → ", 4, 36)}`);
  }
  if (sdPoints.length) {
    lines.push(`System Design: ${joinOverview(sdPoints, " · ", 3, 40)}`);
  }
  if (dsaPoints.length) {
    lines.push(`DSA: ${joinOverview(dsaPoints, " · ", 3, 40)}`);
  }

  if (!lines.length) {
    lines.push("See daily Learning for this week");
  }
  return lines.slice(0, 4);
}

/**
 * Exam Focus — short checklist (few lines, no nested · trees).
 */
function buildExamFocus(bucket, theme, flags, examAnalysis) {
  const lines = [];
  const questionsEnabled = !flags.skipQuestions;
  const learnt = uniqShort(bucket.learnTopics, 2);
  const projects = uniqShort(
    Object.values(bucket.byDay)
      .map((d) => d.project)
      .filter(Boolean)
      .concat(bucket.projectDeliverables),
    2
  );
  const dt = uniqShort(bucket.dtSteps, 3);
  const sd = !flags.skipSd ? uniqShort(bucket.sdTopics, 2) : [];

  if (learnt.length) {
    lines.push(`Notes: finish "${cleanTopic(learnt[0], 55)}"`);
  } else {
    lines.push("Notes: finish this week's Learning pages");
  }

  if (dt.length) {
    lines.push(`DT: wrap ${joinOverview(dt, " → ", 3, 32)}`);
  }

  if (projects.length) {
    lines.push(`Project: ${shortCompleteMilestone(projects[0], 85)}`);
  } else {
    lines.push("Project: finish this week's Project Build deliverable");
  }

  if (sd.length) {
    lines.push(`System Design: notes on ${joinOverview(sd, " · ", 2, 36)}`);
  }

  if (!flags.skipBanks) {
    const pl = uniqShort(bucket.placement, 2);
    if (pl.length) lines.push(`Placement: ${joinOverview(pl, " · ", 2, 40)}`);
  }

  if (questionsEnabled) {
    const themeSubjects =
      !flags.skipSubjects && Array.isArray(theme?.subjects) ? theme.subjects : [];
    const subjectNames = themeSubjects.map((s) => s.name).filter(Boolean);
    const examQ = examQuestionsForSubjects(subjectNames, examAnalysis, 1);
    if (examQ.length) {
      lines.push(examQ[0]);
    } else if (bucket.examHints.length) {
      lines.push(uniqShort(bucket.examHints, 1)[0]);
    } else if (!bucket.placement.length && lines.length < 4) {
      lines.push("Revise this week's topics before next week");
    }
  } else if (!bucket.placement.length && lines.length < 4) {
    lines.push("Revise Learning notes before next week");
  }

  return lines.slice(0, 5);
}

function buildMilestonePoints(bucket, theme) {
  const raw = Object.values(bucket.byDay)
    .map((d) => d.project)
    .filter(Boolean)
    .concat(bucket.projectDeliverables);

  const out = [];
  const seen = new Set();
  for (const x of raw) {
    const t = shortCompleteMilestone(x, 110);
    if (!t || t.length < 12) continue;
    const key = t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 48);
    if (seen.has(key)) continue;
    // Skip near-duplicates
    if ([...seen].some((k) => key.includes(k.slice(0, 20)) || k.includes(key.slice(0, 20)))) {
      continue;
    }
    seen.add(key);
    out.push(t);
    if (out.length >= 3) break;
  }

  if (out.length) return out;

  const goal = shortCompleteMilestone(theme?.projectTask || theme?.project || "", 110);
  return goal ? [goal] : ["Finish this week's Project Build deliverable (see daily)."];
}

/**
 * @param {Array} dailyRows
 * @param {object} opts - { themes, examAnalysis, inputs }
 */
function buildWeeklyFromDailyRows(dailyRows, opts = {}) {
  const themes = opts.themes || [];
  const examAnalysis = opts.examAnalysis || null;
  const inputs = opts.inputs || {};
  const flags = resolveWeeklyFlags(inputs);
  const questionsEnabled = !flags.skipQuestions;

  const byWeek = new Map();

  for (const row of dailyRows || []) {
    if (!Array.isArray(row) || row.length < 4) continue;
    const week = weekNumFromDayId(row[0]);
    if (!week) continue;
    if (!byWeek.has(week)) byWeek.set(week, emptyBucket(week));

    const b = byWeek.get(week);
    const dayId = String(row[0]);
    b.dayIds.add(dayId);
    const dayName = dayNameFromDayId(dayId);
    const day = ensureDay(b, dayName);

    const activity = String(row[2] || "");
    const content = String(row[3] || "");
    const act = activity.toLowerCase();
    b.activities.add(act);

    if (/learning/i.test(act)) {
      const topic = extractLearnTopic(content);
      if (topic) {
        b.learnTopics.push(topic);
        if (day && !day.learn) day.learn = topic;
      }
      const dt = extractDtStep(content);
      if (dt) {
        b.dtSteps.push(dt);
        if (day && !day.dt) day.dt = dt;
      }
      const page = extractDtPage(content);
      if (page && day && !day.dtPage) day.dtPage = page;
    } else if (/problem lab|problem review/i.test(act)) {
      const dt = extractDtStep(content);
      if (dt) {
        b.dtSteps.push(dt);
        if (day && !day.dt) day.dt = dt;
      }
      const page = extractDtPage(content);
      if (page && day && !day.dtPage) day.dtPage = page;
    } else if (/coding practice|\bdsa\b/i.test(act)) {
      if (flags.skipDsa) continue;
      const dsa = extractDsaTitle(content);
      if (dsa) {
        b.dsaTopics.push(dsa);
        if (day) day.dsa = dsa;
      }
    } else if (/system design/i.test(act)) {
      if (flags.skipSd) continue;
      const sd = extractSdTitle(content);
      if (sd) {
        b.sdTopics.push(sd);
        if (day) day.sd = sd;
      }
    } else if (/project build|project push|implement/i.test(act)) {
      const task = extractProjectTask(content);
      if (task) {
        b.projectDeliverables.push(task);
        if (day && !day.project) day.project = task;
      }
      const done = extractDoneWhen(content);
      if (done && day) day.projectDone = done;
      // checklist steps as secondary milestones
      for (const m of content.matchAll(/▶\s*\d+\)\s*([^\n]+)/g)) {
        const p = cleanMilestonePoint(m[1]);
        if (p) b.projectDeliverables.push(p);
      }
    } else if (/weekly review/i.test(act)) {
      b.fridayReview = true;
      if (day) day.review = true;
    } else if (/internal assessment|au exam|mock|exam/i.test(act)) {
      if (!questionsEnabled) continue;
      const m = content.match(/▶\s*([^\n]{10,})/);
      if (m) b.examHints.push(cleanTopic(m[1]));
    } else if (/placement/i.test(act)) {
      if (flags.skipBanks) continue;
      const pl = extractPlacementFocus(content);
      if (pl) {
        b.placement.push(pl);
        if (day) day.placement = pl;
      }
    } else if (/homework/i.test(act)) {
      const hw = extractHomeworkMustDo(content);
      b.homeworkMust.push(...hw);
      if (day) day.homework.push(...hw);
    }
  }

  const dailyWeeks = [...byWeek.keys()];
  if (!dailyWeeks.length) {
    for (const t of themes) {
      const w = Number(t.week);
      if (!w || byWeek.has(w)) continue;
      byWeek.set(w, emptyBucket(w));
    }
  }

  const columns = ["Week", "Days", "Subjects Covered", "Project Milestone", "Exam Focus"];
  const weekNums = [...byWeek.keys()].sort((a, b) => a - b);

  const rows = weekNums.map((week) => {
    const b = byWeek.get(week);
    const theme = themeForWeek(themes, week);
    const dayCount = b.dayIds.size || 5;

    return [
      `Week ${week}`,
      `${dayCount} working days`,
      bullets(buildSubjectsCovered(b, theme, flags)),
      bullets(buildMilestonePoints(b, theme)),
      bullets(buildExamFocus(b, theme, flags, examAnalysis)),
    ];
  });

  return {
    module: "weekly",
    title: "Weekly Schedule (from Daily · respects Include toggles)",
    columns,
    rows,
    source: "daily-only",
    flags,
  };
}

module.exports = {
  buildWeeklyFromDailyRows,
  weekNumFromDayId,
  examQuestionsForSubjects,
  resolveWeeklyFlags,
};
