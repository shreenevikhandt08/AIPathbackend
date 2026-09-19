/**
 * Deterministic day enrichment — does NOT rely on the LLM.
 * Ensures every day has: neat activity titles, deep project breakdown,
 * short placement prep, product speak, motivation; refresh game only on
 * 2–3 random days per week (see assessmentPicker.shouldHaveRefreshGame).
 */

const { pickForDay, parseAssessmentConfig, formatProjectBreakdown } = require("./assessmentPicker");
const { pickFullTrack, formatFullPlacement } = require("./placementDayTracks");
const { sanitizeLearningRow } = require("./connectivityEnforcer");

/** Neat Activity column labels — short, no emoji, no company/product names */
function neatActivityTitle(raw) {
  const a = String(raw || "").toLowerCase();
  if (/standup|stand[\s-]?up|kickoff|kick[\s-]?off|opening|morning brief/.test(a)) return "Stand-Up";
  if (/problem review|problem statement review/.test(a)) return "Problem Review";
  if (/lunch/.test(a)) return "Lunch";
  if (/refresh|hollywoodlywood|bollywood|pictionary|hot seat|emoji empathy|stack shuffle|two truths|pitch relay|🎮/.test(a)) {
    return "Refresh Game";
  }
  // Product Speak is folded into Speak & Solve — never a separate activity label
  if (/product speak|product of the day|🗣️/.test(a)) return "Speak & Solve";
  if (/placement|dream company|target company|🎯/.test(a)) return "Placement Prep";
  if (/retro|retrospective|reflect/.test(a)) return "Retrospective";
  if (/mini build|interest build|side build/.test(a)) return "Mini Build";
  if (/peer review|board update|connectivity check|capability|interests?|goals?|domain/.test(a)) {
    return "Mini Build";
  }
  if (/agent workbench|🤖/.test(a)) return "Agent Workbench";
  if (/3c|speak\s*&\s*solve|🎤|aptitude/.test(a)) return "Speak & Solve";
  if (/dsa|leetcode|coding practice|🧮|problem solving/.test(a)) return "Coding Practice";
  if (/system design|architecture|🏗️/.test(a)) return "System Design";
  if (/project micro|project push|micro-push|🛠️ project/.test(a) && /push|micro/.test(a)) return "Project Push";
  if (/dt playbook|project build|implement|💻|prototype|wireframe/.test(a) || /project/.test(a)) {
    return "Project Build";
  }
  if (/homework|tonight'?s prep|tonight'?s homework|home work/.test(a)) return "Tonight's Homework";
  if (/problem lab/.test(a)) return "Problem Lab";
  if (/learning|📖|📚|concept|subject/.test(a)) return "Learning";
  if (/short break|break|☕|🧘|hydrate/.test(a)) return "Break";
  if (/group|workshop|discussion/.test(a)) return "Group Work";
  // Strip leading emoji / symbols for anything else
  const cleaned = String(raw || "")
    .replace(/^[\s\p{Emoji_Presentation}\p{Extended_Pictographic}🎯🗣️🎮🔄💻📚📖🧮🏗️🛠️☕🧘🍽️🎤🤖⚡★☆•\-–—]+/gu, "")
    .replace(/\s*[—–-]\s*.+$/, "") // drop " — Company / product" suffixes
    .trim();
  return cleaned || "Activity";
}

function contentStr(c) {
  if (Array.isArray(c)) return c.filter((x) => typeof x === "string" && x.trim()).join("\n");
  return String(c || "");
}

/** Make sure Learning rows name the uploaded syllabus subject (weekly already does). */
function injectSubjectsIntoLearning(rows, dayIdx, opts = {}) {
  const weekThemes = opts.inputs?._themeByWeek || {};
  const theme =
    opts.theme ||
    weekThemes[opts.weekNum] ||
    Object.values(weekThemes)[0] ||
    null;
  const subjects = Array.isArray(theme?.subjects) ? theme.subjects.filter((s) => s?.name) : [];
  if (!subjects.length) return rows;

  const sub = subjects[Math.max(0, Number(dayIdx) || 0) % subjects.length];
  const subjectLine = `▶ Subject today: ${sub.name}${sub.topic ? ` — ${sub.topic}` : ""}`;

  return (rows || []).map((r) => {
    if (!/learning/i.test(String(r.activity || ""))) return r;
    let content = contentStr(r.content);
    if (/▶\s*Subject today:/i.test(content)) return r;

    if (/▶\s*Learn(?:\s*Day|\s*today)?:/i.test(content)) {
      content = content.replace(
        /(▶\s*Learn(?:\s*Day\s*\d+)?:\s*[^\n]+)/i,
        `$1\n${subjectLine}`
      );
    } else if (/▶\s*NEW learning:/i.test(content)) {
      content = content.replace(/(▶\s*NEW learning:\s*[^\n]+)/i, `$1\n${subjectLine}`);
    } else {
      content = `${subjectLine}\n${content}`;
    }

    content = content.replace(
      /(▶\s*Learn(?:\s*Day\s*\d+)?:\s*)([^\n]+)/i,
      (full, prefix, topic) => {
        if (new RegExp(String(sub.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(topic)) {
          return full;
        }
        return `${prefix}${sub.name}: ${sub.topic || topic}`;
      }
    );
    return { ...r, content };
  });
}

function ensureMotivation(content, motivation) {
  if (/motivation/i.test(content)) return content;
  return `${content}\n▶ Motivation: "${motivation}"`;
}

function resolveTeamMode(opts = {}) {
  if (opts.team === true) return true;
  if (opts.team === false) return false;
  const inputs = opts.inputs || {};
  if (inputs._isTeam === true || inputs._isTeam === "true" || inputs._isTeam === 1) return true;
  if (inputs._isTeam === false || inputs._isTeam === "false" || inputs._isTeam === 0) return false;
  try {
    const raw = inputs._teamMembers ?? inputs.teamMembers;
    const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(arr)) {
      return arr.filter((m) => m && String(m.name || "").trim()).length >= 2;
    }
  } catch (_) {}
  return false;
}

function ensureDtActivation(content, picks = {}, opts = {}) {
  let out = String(content || "");
  const team = resolveTeamMode(opts);

  // Detect gap-driven / already structured standups (solo or team)
  const alreadyStructured =
    /Personal (kickoff|standup|check-in)|Day 1 personal|Final-day personal|Team (kickoff|standup|check-in)|Day 1 team|Final-day team|DONE\s*\/\s*TODAY\s*\/\s*STUCK|Write:\s*(DONE|TODAY|what |one |which )/i.test(
      out
    ) || /DONE:\s*|TODAY:\s*|STUCK:\s*|Board:\s*/i.test(out);

  if (alreadyStructured) {
    if (!team) {
      out = out
        .replace(/\bTeam check-in\b/gi, "Personal check-in")
        .replace(/\bTeam standup\b/gi, "Personal standup")
        .replace(/\bDay 1 team kickoff\b/gi, "Day 1 personal kickoff")
        .replace(/\bFinal-day team standup\b/gi, "Final-day personal standup")
        .replace(/▶\s*Peer check:[^\n]*/gi, "")
        .replace(/▶\s*Structure \(2 min\/person\):[^\n]*/gi, "▶ Write: DONE · TODAY · STUCK")
        .replace(/\beach person\b/gi, "you")
        .replace(/\bteammates?\b/gi, "you")
        .replace(/\b2 min\/person\b/gi, "2 min");
    }
    if (picks.motivation) out = ensureMotivation(out, picks.motivation);
    return out;
  }

  const heading = team ? "Team check-in" : "Personal check-in";
  out =
    `▶ Heading: ${heading}\n` +
    `▶ 1) DONE: one thing I finished (or "nothing yet")\n` +
    `▶ 2) TODAY: one thing I will finish\n` +
    `▶ 3) STUCK: one confusion (or "none")\n` +
    out;
  if (picks.motivation) out = ensureMotivation(out, picks.motivation);
  return out;
}

function ensureBreakdown(content, bd) {
  if (!bd) return content;
  if (/DEEP PROJECT BREAKDOWN|BUILD DELIVERABLE SHAPE|PIPELINE GOAL/i.test(content)) return content;
  // Append as deliverable shape AFTER the learn→implement content so it doesn't
  // replace connected Steps A→E with a disconnected chore dump at the top.
  return `${content}\n${formatProjectBreakdown(bd)}`;
}

function placementFor(company, dayIdx) {
  if (!company) return null;
  const track = pickFullTrack(String(company).trim(), dayIdx, "");
  return {
    company: String(company).trim(),
    type: track.name,
    minutes: 20,
    task: formatFullPlacement(company, dayIdx, ""),
  };
}

/**
 * Enrich object-shaped rows [{ time, activity, content }, ...]
 */
function isGapDrivenDay(rows) {
  return (rows || []).some((r) => {
    const c = String(r.content || "");
    const a = String(r.activity || "");
    const t = String(r.time || "");
    return (
      /tonight'?s homework/i.test(a) ||
      /▶\s*Tonight'?s Homework/i.test(c) ||
      /▶\s*Mini Build/i.test(c) ||
      /▶\s*Retrospective/i.test(c) ||
      /▶\s*Problem Review/i.test(c) ||
      /▶\s*DT Playbook today:/i.test(c) ||
      /▶ Learn Day|▶ Build Day|▶ Homework \(tonight\)|▶ Today's class window:/i.test(c) ||
      /\b(AM|PM)\s+IST\b/i.test(t)
    );
  });
}

function richerRow(a, b) {
  if (!a) return b;
  if (!b) return a;
  return String(b.content || "").length > String(a.content || "").length ? b : a;
}

/**
 * Hard rule: keep at most one Placement and one Mini Build, both above Retro.
 * Do not inject missing ones — day generator rotates them by weekday.
 */
function finalizeDayOrder(rows) {
  let placement = null;
  let mini = null;
  let retro = null;
  let homework = null;
  const rest = [];

  (rows || []).forEach((r) => {
    const a = String(r.activity || "");
    if (/homework|tonight/i.test(a)) homework = richerRow(homework, r);
    else if (/retrospective/i.test(a)) retro = richerRow(retro, r);
    else if (/mini build|^(interests|goals|capability|domain)$/i.test(a)) mini = richerRow(mini, r);
    else if (/placement/i.test(a)) placement = richerRow(placement, r);
    else rest.push(r);
  });

  const body = [...rest, placement, mini]
    .filter(Boolean)
    .sort((a, b) => timeSortKey(a.time) - timeSortKey(b.time));

  if (homework) homework = { ...homework, time: "Tonight" };

  return [...body, ...(retro ? [retro] : []), ...(homework ? [homework] : [])];
}

function enrichObjectRows(rows, dayIdx, memberIdx = 0, opts = {}) {
  const picks = pickForDay(
    dayIdx,
    opts.config || parseAssessmentConfig(opts.inputs || {}),
    memberIdx,
    opts.member || opts.inputs || null
  );
  const company = opts.targetCompany || opts.inputs?.targetCompany || opts.inputs?._targetCompany || "";
  const plac = opts.placementFocus || placementFor(company, dayIdx);

  let out = (rows || []).map((r) => ({
    time: r.time,
    activity: neatActivityTitle(r.activity),
    content: contentStr(r.content),
  }));

  const preserveTimes = isGapDrivenDay(out) || opts.preserveTimes === true;

  // Drop wrap-up duplicates
  out = out.filter((r) => !/wrap[\s-]?up/i.test(r.activity));

  // Stand-Up includes DT Activation + micro-teach + motivation
  const teamMode = resolveTeamMode(opts);
  const su = out.find((r) => r.activity === "Stand-Up");
  if (su) su.content = ensureDtActivation(su.content, picks, { team: teamMode, inputs: opts.inputs });
  else if (!preserveTimes) {
    out.unshift({
      time: "08:45 – 09:00 IST",
      activity: "Stand-Up",
      content: ensureDtActivation(
        `▶ Board: Done / Today / Blocked (1 line each).`,
        picks,
        { team: teamMode, inputs: opts.inputs }
      ),
    });
  }

  // Deep project breakdown on Project Build (or System Design if no project row)
  // Case study does NOT belong in Project Build — it lives in Refresh (choice A/B).
  let projectRow = out.find((r) => r.activity === "Project Build");
  if (!projectRow) projectRow = out.find((r) => r.activity === "System Design");
  if (projectRow) {
    projectRow.content = ensureBreakdown(projectRow.content, picks.projectBreakdown);
    // Strip any leftover case-study lines from older generators / LLM rows
    projectRow.content = String(projectRow.content || "")
      .split(/\n/)
      .filter((line) => !/case study/i.test(line))
      .join("\n")
      .trim();
  }

  // Product Speak — fold into Speak & Solve only (never a second row / never duplicate Qs)
  out = out.filter((r) => r.activity !== "Product Speak");
  if (picks.product) {
    const speak = out.find((r) => r.activity === "Speak & Solve");
    if (speak && !/Product of the Day/i.test(speak.content)) {
      speak.content =
        `${speak.content}\n` +
        `▶ 2) Product of the Day\n` +
        `   Product: ${picks.product.name} (${picks.product.category})\n` +
        `   Speak ~90 seconds: ${picks.product.prompt}\n` +
        `   End with 1 lesson for your own problem.`;
    }
  }

  // Refresh Game — Hollywood OR Case study (student chooses one)
  if (!preserveTimes) {
    out = out.filter((r) => r.activity !== "Refresh Game");
    if (picks.game || picks.caseStudy) {
      const game = picks.game;
      const cs = picks.caseStudy;
      const gameRow = {
        time: "02:15 – 02:25 IST",
        activity: "Refresh Game",
        content: [
          `▶ Refresh (optional)`,
          `▶ Pick ONE: game, short case, or rest.`,
          `▶ Option A — ${game ? `${game.name} (${game.minutes || 10} min)` : "Hollywood (Tech Edition) (10 min)"}`,
          game?.how ? `   ${game.how}` : `   YES/NO questions to guess a tech title.`,
          `▶ Option B — ${cs ? cs.title : "short product story"} → 1 insight for today's problem`,
          cs?.link ? `   ${cs.link}` : null,
          `▶ Option C — Rest.`,
        ].filter(Boolean).join("\n"),
      };
      const breakIdx = out.findIndex(
        (r) => r.activity === "Break" && /02:1[0-9]|02:15|02:20/.test(String(r.time || ""))
      );
      if (breakIdx !== -1) out[breakIdx] = gameRow;
      else {
        const sdIdx = out.findIndex((r) => r.activity === "System Design");
        if (sdIdx !== -1) out.splice(sdIdx, 0, gameRow);
        else {
          const retroIdx = out.findIndex((r) => r.activity === "Retrospective");
          if (retroIdx !== -1) out.splice(Math.max(0, retroIdx - 1), 0, gameRow);
          else out.push(gameRow);
        }
      }
    }
  }

  // Placement — keep rich LinkedIn/learning content from gap-driven days; only inject if missing
  if (!preserveTimes) {
    const existingPlac = out.find((r) => r.activity === "Placement Prep");
    const richPlac = existingPlac && /Placement Prep Day|Placement micro Day|LinkedIn|LEARN first|Learn first/i.test(existingPlac.content || "");
    if (!richPlac) {
      out = out.filter((r) => r.activity !== "Placement Prep");
      if (plac) {
        const placRow = {
          time: "03:15 – 03:35 IST",
          activity: "Placement Prep",
          content: plac.task,
        };
        const pushIdx = out.findIndex((r) => r.activity === "Project Push");
        if (pushIdx !== -1) out[pushIdx] = placRow;
        else {
          const profileIdx = out.findIndex((r) =>
            /^(Interests|Goals|Capability|Domain)$/i.test(String(r.activity || ""))
          );
          if (profileIdx !== -1) out.splice(profileIdx, 0, placRow);
          else {
            const retroIdx = out.findIndex((r) => r.activity === "Retrospective");
            if (retroIdx !== -1) out.splice(retroIdx, 0, placRow);
            else out.push(placRow);
          }
        }
      }
    }
  }

  // Do not force 04:30 close when the day already uses the student's custom timing
  if (!preserveTimes) {
    ensureAfternoonClose(out, picks);
  }

  out = out.map((r) => sanitizeLearningRow(r));

  // SNS Agent Workbench — enrich content, but do not rewrite custom slot times
  if (picks.agentWorkbench || out.some((r) => r.activity === "Agent Workbench")) {
    const { formatAgentWorkbenchTask } = require("../data/agentWorkbenchBanks");
    const fromPicks = String(picks.agentWorkbench?.notes || "");
    const fullyDefined =
      /▶\s*Task:/i.test(fromPicks) &&
      /▶\s*What to build:/i.test(fromPicks) &&
      /▶\s*How to do it:/i.test(fromPicks) &&
      /▶\s*Success check:/i.test(fromPicks) &&
      !/https?:\/\//i.test(fromPicks);
    const content = fullyDefined
      ? fromPicks
      : formatAgentWorkbenchTask(null, "", "", picks.agentWorkbench?.ragTask || null, dayIdx);

    const existingAgent = out.find((r) => r.activity === "Agent Workbench");
    if (existingAgent) {
      if (!/▶\s*Task:/i.test(existingAgent.content || "")) {
        existingAgent.content = content;
      }
    } else if (!preserveTimes) {
      out = out.filter((r) => r.activity !== "Agent Workbench");
      const agentRow = {
        time: "02:25 – 02:45 IST",
        activity: "Agent Workbench",
        content,
      };
      const sdIdx = out.findIndex((r) =>
        /system design|problem framing|integration/i.test(r.activity)
      );
      if (sdIdx !== -1) {
        out[sdIdx].time = "02:45 – 03:15 IST";
        out.splice(sdIdx, 0, agentRow);
      } else {
        const gameIdx = out.findIndex(
          (r) => r.activity === "Refresh Game" || (r.activity === "Break" && /02:1/.test(String(r.time || "")))
        );
        if (gameIdx !== -1) out.splice(gameIdx + 1, 0, agentRow);
        else {
          const projectIdx = out.findIndex((r) => r.activity === "Project Build");
          if (projectIdx !== -1) out.splice(projectIdx + 1, 0, agentRow);
          else out.push(agentRow);
        }
      }
    }
  }

  // Final neat pass — keep Placement + Mini Build above Retrospective
  const neat = out.map((r) => ({
    ...r,
    activity: neatActivityTitle(r.activity),
    content: contentStr(r.content),
  }));
  return finalizeDayOrder(neat);
}

/** Ensure personal Interests/Goals + Retrospective exist (no Peer Review / Capability dump). */
function ensureAfternoonClose(out, picks = {}) {
  let profile = out.find((r) => /^(Interests|Goals|Capability|Domain)$/i.test(String(r.activity || "")));
  let retro = out.find((r) => r.activity === "Retrospective");

  // Drop legacy Peer Review rows if any remain
  for (let i = out.length - 1; i >= 0; i--) {
    if (/peer review/i.test(String(out[i].activity || ""))) out.splice(i, 1);
  }

  // Do not force Mini Build every day — gap generator rotates Placement / Mini Build by weekday

  if (!retro) {
    out.push({
      time: "4:00 PM – 4:30 PM IST",
      activity: "Retrospective",
      content:
        `▶ End of day — write 4 lines in your notebook:\n` +
        `▶ 1) LEARNED (1 sentence)\n` +
        `▶ 2) FINISHED (file name)\n` +
        `▶ 3) LINKED to Problem Statement (1 sentence)\n` +
        `▶ 4) TOMORROW first step\n` +
        (picks.motivation ? `▶ Motivation: "${picks.motivation}"` : `▶ Done when: 4 lines are written.`),
    });
  }
}

/** Parse "9:00 AM – 10:30 AM IST" (also supports legacy 24h / 01–07 PM labels) */
function timeSortKey(t) {
  try {
    return require("./dayTimeSlots").timeSortKey(t);
  } catch (_) {
    const m = String(t || "").match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!m) return 9999;
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const ap = (m[3] || "").toUpperCase();
    if (ap === "PM" && h < 12) h += 12;
    else if (ap === "AM" && h === 12) h = 0;
    else if (!ap && h >= 1 && h <= 7) h += 12;
    return h * 60 + min;
  }
}

/**
 * Enrich array-shaped plan rows [dayKey, time, activity, content]
 */
function enrichArrayRows(allRows, inputs = {}) {
  if (!Array.isArray(allRows) || !allRows.length) return allRows;
  const cfg = parseAssessmentConfig(inputs);
  const company =
    inputs.targetCompany ||
    inputs._targetCompany ||
    inputs.dreamCompany ||
    "";

  const groups = [];
  let cur = null;
  for (const row of allRows) {
    if (!Array.isArray(row)) continue;
    const dayKey = row[0];
    if (!cur || cur.dayKey !== dayKey) {
      cur = { dayKey, rows: [] };
      groups.push(cur);
    }
    cur.rows.push({
      time: row[1],
      activity: row[2],
      content: contentStr(row[3]),
    });
  }

  const { enforceObjectDayContinuity } = require("./scheduleContinuity");
  const { getStepForPlanDay } = require("./dtPlaybookLookup");
  const themeByWeek = inputs._themeByWeek || {};
  const out = [];
  groups.forEach((g, dayIdx) => {
    const weekMatch = String(g.dayKey || "").match(/Week\s+(\d+)/i);
    const weekNum = weekMatch ? Number(weekMatch[1]) : 1;
    const theme = themeByWeek[weekNum] || {
      project: inputs.problem || "today's project",
      dsa: "",
      systemDesign: "",
      subjects: [],
      week: weekNum,
    };

    let enriched = enrichObjectRows(g.rows, dayIdx, 0, {
      config: cfg,
      inputs,
      targetCompany: company,
      theme,
      weekNum,
    });

    // Gap-driven days already have clean continuous cells + custom timing — do NOT remash
    const alreadyGapDriven = isGapDrivenDay(enriched) || enriched.some((r) =>
      /PROBLEM SLICE|KNOWLEDGE GAP|LEARN TODAY|SYSTEM DESIGN CONCEPT|DSA CONCEPT TODAY|Problem Lab|Build on YOUR problem|▶ Topic:|▶ Learn today:|▶ Learn Day|▶ Subject today:|▶ DT Playbook today:|▶ Tonight'?s Homework|▶ Mini Build|▶ Problem Review/i.test(
        String(r.content || "")
      )
    );
    const denseOk =
      enriched.length >= 12 &&
      enriched.some((r) => /project build/i.test(String(r.activity || ""))) &&
      enriched.some((r) => /retrospective/i.test(String(r.activity || "")));

    if (!alreadyGapDriven && !denseOk) {
      const activeStage = inputs._activeDTStage || inputs.activeDTStage || null;
      const dtStep = getStepForPlanDay(dayIdx, activeStage, inputs);
      enriched = enforceObjectDayContinuity(enriched, {
        dayIdx,
        theme,
        dtStep,
        includeAgent: cfg.banks?.agentWorkbench !== false,
        agentNotes: cfg.agentWorkbenchNotes || "",
        hasCompany: Boolean(company) || cfg.banks?.company === true,
        company: company || "target company",
        inputs,
      });
    }

    enriched = enriched.map((r) => sanitizeLearningRow(r));

    enriched.forEach((r) => {
      out.push([g.dayKey, r.time, r.activity, r.content]);
    });
  });
  return out;
}

module.exports = {
  neatActivityTitle,
  enrichObjectRows,
  enrichArrayRows,
  placementFor,
};
