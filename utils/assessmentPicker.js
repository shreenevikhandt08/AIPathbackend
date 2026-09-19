const {
  DEFAULT_ASSESSMENT_CONFIG,
} = require("../data/assessmentBanks");
const {
  REFRESH_GAMES,
} = require("../data/engagementBanks");
const {
  resolveAcademicProfile,
  academicPickSeed,
  filterLeetCodeForProfile,
  rotateCaseBank,
} = require("./academicLevel");

const ALL_BANKS_OFF = {
  leetcode: false,
  pm: false,
  cases: false,
  company: false,
  iae: false,
  certifications: false,
  analyticsVidhya: false,
  agentWorkbench: false,
};

function parseAssessmentConfig(inputs) {
  const skipBanks =
    inputs?._skipAssessmentBanks === true ||
    inputs?._skipAssessmentBanks === "true" ||
    inputs?._skipAssessmentBanks === 1;

  const raw = inputs?._assessmentConfig;
  let cfg = null;
  if (!raw) {
    return {
      ...DEFAULT_ASSESSMENT_CONFIG,
      banks: skipBanks ? { ...ALL_BANKS_OFF } : { ...DEFAULT_ASSESSMENT_CONFIG.banks },
      problem: inputs?.problem || "",
      problemStatement: inputs?.problemStatement || "",
      collegeYear: inputs?.collegeYear ?? null,
      semester: inputs?.semester ?? null,
      schoolGrade: inputs?.schoolGrade ?? null,
      college: inputs?.college || "",
      department: inputs?.department || "",
      skillLevel: inputs?.skillLevel ?? null,
      _academicProfile: inputs?._academicProfile || null,
      _agentRagPack: inputs?._agentRagPack || null,
      _assessmentRagPack: inputs?._assessmentRagPack || null,
    };
  }
  try {
    cfg = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return {
      ...DEFAULT_ASSESSMENT_CONFIG,
      banks: skipBanks ? { ...ALL_BANKS_OFF } : { ...DEFAULT_ASSESSMENT_CONFIG.banks },
      problem: inputs?.problem || "",
      problemStatement: inputs?.problemStatement || "",
      _agentRagPack: inputs?._agentRagPack || null,
      _assessmentRagPack: inputs?._assessmentRagPack || null,
    };
  }

  // Explicit all-off from Inputs toggle — do not merge defaults back on
  if (skipBanks) {
    return {
      ...DEFAULT_ASSESSMENT_CONFIG,
      ...cfg,
      banks: { ...ALL_BANKS_OFF, ...(cfg.banks || {}) , ...ALL_BANKS_OFF },
      problem: inputs?.problem || cfg.problem || "",
      problemStatement: inputs?.problemStatement || cfg.problemStatement || "",
      _agentRagPack: inputs?._agentRagPack || cfg._agentRagPack || null,
      _assessmentRagPack: inputs?._assessmentRagPack || cfg._assessmentRagPack || null,
    };
  }

  return {
    ...DEFAULT_ASSESSMENT_CONFIG,
    ...cfg,
    banks: { ...DEFAULT_ASSESSMENT_CONFIG.banks, ...(cfg.banks || {}) },
    problem: inputs?.problem || cfg.problem || "",
    problemStatement: inputs?.problemStatement || cfg.problemStatement || "",
    collegeYear: inputs?.collegeYear ?? cfg.collegeYear ?? null,
    semester: inputs?.semester ?? cfg.semester ?? null,
    schoolGrade: inputs?.schoolGrade ?? cfg.schoolGrade ?? null,
    college: inputs?.college || cfg.college || "",
    department: inputs?.department || cfg.department || "",
    skillLevel: inputs?.skillLevel ?? cfg.skillLevel ?? null,
    _academicProfile: inputs?._academicProfile || cfg._academicProfile || null,
    _agentRagPack: inputs?._agentRagPack || cfg._agentRagPack || null,
    _assessmentRagPack: inputs?._assessmentRagPack || cfg._assessmentRagPack || null,
    _solvedLc: inputs?._solvedLc || cfg._solvedLc || null,
    _solvedLcByUser: inputs?._solvedLcByUser || cfg._solvedLcByUser || null,
    leetcodeUsername: inputs?.leetcodeUsername || cfg.leetcodeUsername || "",
    inputs,
  };
}

/**
 * Pick 2 or 3 "random" weekdays (Mon–Fri index 0–4) for refresh games.
 * Deterministic per week so regenerating the same plan stays stable.
 */
function refreshGameDaysForWeek(weekNum) {
  const w = Math.max(0, Number(weekNum) || 0);
  const count = 2 + ((w * 7 + 3) % 2); // 2 or 3 days
  const days = [];
  let seed = (w * 17 + 11) % 5;
  let guard = 0;
  while (days.length < count && guard < 12) {
    if (!days.includes(seed)) days.push(seed);
    seed = (seed * 31 + 17 + w + guard) % 5;
    guard += 1;
  }
  // Fallback if collision loop failed
  while (days.length < count) {
    const d = days.length % 5;
    if (!days.includes(d)) days.push(d);
    else days.push((d + 2) % 5);
  }
  return days.slice(0, count).sort((a, b) => a - b);
}

function shouldHaveRefreshGame(dayIdx) {
  // Mon=0, Wed=2 → Refresh Game; Tue/Thu → break; Fri → no forced game
  const dow = Math.max(0, Number(dayIdx) || 0) % 5;
  return dow === 0 || dow === 2;
}

/**
 * Deterministic picks for a working-day index (0-based).
 * Offsets by memberIdx + academic year/semester so cohorts never share
 * the same LeetCode / case study rotation.
 * @param {number} dayIdx
 * @param {object} config
 * @param {number} memberIdx
 * @param {object|null} academicOrMember — profile, member, or { profile, member }
 */
function pickForDay(dayIdx, config, memberIdx = 0, academicOrMember = null) {
  const cfg = config || DEFAULT_ASSESSMENT_CONFIG;
  const banks = cfg.banks || {};
  const m = Math.max(0, Number(memberIdx) || 0);
  const rag = cfg._assessmentRagPack || null;
  const out = {};

  let member = null;
  let profile = null;
  if (academicOrMember) {
    if (academicOrMember.profile) profile = academicOrMember.profile;
    if (academicOrMember.member) member = academicOrMember.member;
    else if (
      academicOrMember.collegeYear != null ||
      academicOrMember.semester != null ||
      academicOrMember.schoolGrade != null ||
      academicOrMember.skillLevel != null
    ) {
      member = academicOrMember;
    } else if (academicOrMember.band || academicOrMember.kind) {
      profile = academicOrMember;
    }
  }
  if (!profile) {
    profile = resolveAcademicProfile(
      {
        collegeYear: cfg.collegeYear,
        semester: cfg.semester,
        schoolGrade: cfg.schoolGrade,
        college: cfg.college,
        department: cfg.department,
        skillLevel: cfg.skillLevel,
        _academicProfile: cfg._academicProfile,
      },
      member
    );
  }
  const seed = academicPickSeed(profile, m);
  out._academic = {
    year: profile.collegeYear,
    semester: profile.semester,
    schoolGrade: profile.schoolGrade,
    kind: profile.kind,
    label:
      profile.kind === "school"
        ? profile.yearLabel
        : `${profile.yearLabel} · ${profile.semesterLabel}`,
    seed,
    memberIdx: m,
  };

  if (banks.leetcode !== false) {
    let rawLc = Array.isArray(rag?.leetcode) ? rag.leetcode.slice() : [];
    if (!rawLc.length) {
      try {
        const { VERIFIED_LEETCODE } = require("../data/verifiedLeetCodePool");
        rawLc = VERIFIED_LEETCODE.slice();
      } catch (_) {
        rawLc = [];
      }
    }
    const usedPlan = Array.isArray(cfg._planUsedLc)
      ? cfg._planUsedLc.map(String)
      : Array.isArray(cfg.inputs?._planUsedLc)
        ? cfg.inputs._planUsedLc.map(String)
        : [];
    if (rawLc.length) {
      const { solvedPackForPicker, isSolvedProblem } = require("./leetcodeSolved");
      const solved = solvedPackForPicker(cfg, member);
      let pool = filterLeetCodeForProfile(rawLc, profile, m).filter(
        (p) => !usedPlan.includes(String(p.lc)) && !isSolvedProblem(p, solved)
      );
      // Prefer unused + unsolved; if exhausted, recycle unused-in-plan only
      if (!pool.length) {
        pool = filterLeetCodeForProfile(rawLc, profile, m).filter(
          (p) => !isSolvedProblem(p, solved)
        );
      }
      if (!pool.length) pool = filterLeetCodeForProfile(rawLc, profile, m);
      if (pool.length) {
        const p = pool[(dayIdx + seed) % pool.length] || pool[0];
        if (p) {
          out.leetcode = {
            platform: "LeetCode",
            lc: p.lc,
            name: p.name,
            difficulty: p.difficulty,
            pattern: p.pattern,
            url: p.url || `https://leetcode.com/problems/${slugify(p.name)}/`,
            label: `LeetCode #${p.lc} — ${p.name} (${p.difficulty})`,
            source: p.source || "rag",
          };
          out._markLcUsed = String(p.lc);
        }
      }
    }
  }

  if (banks.pm !== false) {
    const pmList = Array.isArray(rag?.pm) ? rag.pm : [];
    const q = pmList.length ? pmList[(dayIdx + m * 2 + seed) % pmList.length] : null;
    if (q) {
      out.pm = {
        id: q.id,
        category: q.category,
        skill: q.skill,
        text: q.text,
        label: `3C / ${q.category} (${q.skill}): ${q.text}`,
        source: "rag",
      };
    }
  }

  if (banks.cases !== false) {
    const caseListRaw = Array.isArray(rag?.cases) ? rag.cases : [];
    const caseList = caseListRaw.length ? rotateCaseBank(caseListRaw, profile, m) : [];
    const d = Math.max(0, Number(dayIdx) || 0);
    const caseIdx = caseList.length ? (d * 3 + seed) % caseList.length : 0;
    const c = caseList[caseIdx];
    if (c) {
      out.caseStudy = {
        id: c.id,
        title: c.title,
        theme: c.theme,
        link: c.link || null,
        label: `Case Study — ${c.title} [${c.theme}]`,
        memberSpecific: true,
        source: "rag",
      };
    }
  }

  // Daily product speak — RAG only
  {
    const prodList = Array.isArray(rag?.products) ? rag.products : [];
    const prod = prodList.length ? prodList[(dayIdx + m * 3 + seed) % prodList.length] : null;
    if (prod) {
      out.product = {
        name: prod.name,
        category: prod.category,
        prompt: prod.prompt,
        label: `Product of the Day — ${prod.name} (${prod.category})`,
        source: "rag",
      };
    }
  }

  // Refresh game only 2–3 random days per week (not every day)
  if (shouldHaveRefreshGame(dayIdx) && REFRESH_GAMES.length) {
    const g = REFRESH_GAMES[(dayIdx + seed) % REFRESH_GAMES.length];
    out.game = {
      name: g.name,
      minutes: g.minutes,
      how: g.how,
      label: `Refresh Game — ${g.name} (${g.minutes} min)`,
    };
  }

  // Deep project breakdown for today — RAG only
  {
    const bdList = Array.isArray(rag?.projectBreakdown) ? rag.projectBreakdown : [];
    const bd = bdList.length ? bdList[(dayIdx + seed) % bdList.length] : null;
    if (bd) {
      out.projectBreakdown = {
        focus: bd.focus,
        tasks: bd.tasks,
        doneWhen: bd.doneWhen,
        source: "rag",
      };
    }
  }

  // Motivation — unique within plan from themed pool
  {
    const { pickMotivationQuote } = require("../data/motivationQuotes");
    const weekNum = Math.floor(Math.max(0, dayIdx) / 5) + 1;
    const usedMot = Array.isArray(cfg._planUsedMotivation) ? cfg._planUsedMotivation : [];
    const quote = pickMotivationQuote(dayIdx + seed, weekNum, usedMot);
    out.motivation = quote;
    out._markMotivationUsed = quote;
  }

  if (banks.analyticsVidhya) {
    out.analyticsVidhya = {
      label: "Analytics Vidhya / AI certification progress",
      notes: cfg.avCourseNotes || "Complete today's assigned AV module section (15–20 min) and log progress.",
    };
  }

  if (banks.agentWorkbench !== false) {
    const { formatAgentWorkbenchTask } = require("../data/agentWorkbenchBanks");
    const { getAgentRagTask } = require("./enrichAgentWorkbenchRag");
    // Prefer PDF/question-bank RAG pack → then dedicated agent web RAG
    const agentPack =
      rag?.agentTasks?.length
        ? { tasks: rag.agentTasks, sources: rag.sources, mode: rag.mode || "bank-rag" }
        : cfg._agentRagPack;
    const ragTask = getAgentRagTask(agentPack, dayIdx + seed);
    const problem = cfg.problem || cfg.problemStatement || "";
    out.agentWorkbench = {
      label: ragTask?.title
        ? `SNS Agent Workbench (RAG) — ${ragTask.title}`
        : "SNS Agent Workbench (web RAG)",
      ragTask,
      notes: formatAgentWorkbenchTask(null, cfg.agentWorkbenchNotes || "", problem, ragTask, dayIdx + seed),
    };
  }

  if (banks.company) {
    out.companyPrep = true;
  }

  if (banks.certifications) {
    out.certifications = {
      label: "Global / AI certification practice",
      notes: "10–12 min on your active certification practice set — one topic only.",
    };
  }

  if (banks.iae) {
    out.iae = {
      label: "IAE / PYQ practice",
      notes: "Solve 1 important or previous-year question from uploaded IAE material for today's subject (12 min).",
    };
  }

  return out;
}

function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function formatProjectBreakdown(bd) {
  if (!bd) return "";
  // Shape the SAME learn→implement feature — never a parallel chore list.
  return (
    `▶ BUILD DELIVERABLE SHAPE — focus: ${bd.focus}\n` +
    `▶ Use ONLY if each item advances TODAY's learned concepts inside ONE pipeline (A→B→C).\n` +
    `▶ Skip any checklist item that would start a second unrelated mini-project.\n` +
    bd.tasks.map((t, i) => `   ${i + 1}. ${t}`).join("\n") + "\n" +
    `▶ Done when: ${bd.doneWhen}`
  );
}

/** Prompt block injected into daily schedule LLM generation */
function buildAssessmentPromptBlock(dayIdx, inputs, memberIdx = 0, member = null) {
  const cfg = parseAssessmentConfig(inputs);
  const picks = pickForDay(dayIdx, cfg, memberIdx, member);
  const lines = [
    `\nASSESSMENT + ENGAGEMENT FOR THIS DAY (use EXACT names — do not invent alternatives):\n`,
  ];
  if (picks._academic?.label) {
    lines.push(`▶ ACADEMIC LEVEL: ${picks._academic.label} — pick difficulty & cases for THIS level only.\n`);
  }

  if (picks.leetcode) {
    lines.push(
      `▶ CODING (MANDATORY):\n` +
      `  ${picks.leetcode.label} | Pattern: ${picks.leetcode.pattern}\n` +
      `  URL: ${picks.leetcode.url}\n`
    );
  }

  if (picks.pm) {
    lines.push(
      `▶ 3C / PRODUCT ASSESSMENT:\n  ${picks.pm.label}\n` +
      `  Guide: 2 min think → 3 min structured answer → 1 peer question.\n`
    );
  }

  if (picks.product) {
    lines.push(
      `▶ SPEAK & SOLVE — only 2 items (Practice question + Product of the Day):\n` +
      `  Product: ${picks.product.label}\n` +
      `  Speak prompt (90 sec): ${picks.product.prompt}\n` +
      `  Do not add a third speak task. Day 1: no "last night's homework" wording.\n`
    );
  }

  if (picks.game || picks.caseStudy) {
    lines.push(
      `▶ REFRESH — student picks ONE (not both; not inside Project Build):\n` +
      (picks.game
        ? `  Option A — Hollywood / game: ${picks.game.name} (${picks.game.minutes} min)\n`
        : `  Option A — Hollywood / classroom game\n`) +
      (picks.caseStudy
        ? `  Option B — Case study chat: ${picks.caseStudy.label}\n`
        : `  Option B — Case study chat\n`)
    );
  }

  if (picks.projectBreakdown) {
    lines.push(
      formatProjectBreakdown(picks.projectBreakdown) + "\n" +
      `▶ Reminder: Project Build content must be Steps A→E implementing TODAY's Learning/DSA — ` +
      `breakdown focus only shapes that same pipeline.\n`
    );
  }

  lines.push(`▶ MOTIVATION BOOST (read aloud at standup): "${picks.motivation}"\n`);

  if (picks.analyticsVidhya) lines.push(`▶ AI (Analytics Vidhya): ${picks.analyticsVidhya.notes}\n`);
  if (picks.agentWorkbench) lines.push(`▶ AGENT WORKBENCH: ${picks.agentWorkbench.notes}\n`);
  if (picks.iae) lines.push(`▶ IAE: ${picks.iae.notes}\n`);
  if (picks.certifications) lines.push(`▶ CERTIFICATIONS: ${picks.certifications.notes}\n`);
  if (picks.companyPrep) {
    lines.push(
      `▶ COMPANY-SPECIFIC: include a SHORT Placement Micro-Prep (10–12 min only) for the dream company — not a long session.\n`
    );
  }

  if (cfg.enrichFromLinks) {
    lines.push(
      `▶ ENRICH FROM LINKS: If case/cert URL or uploaded PDF text exists in inputs, use it. Do not invent sources.\n`
    );
  }

  return { block: lines.join(""), picks, config: cfg };
}

module.exports = {
  parseAssessmentConfig,
  pickForDay,
  buildAssessmentPromptBlock,
  formatProjectBreakdown,
  shouldHaveRefreshGame,
  refreshGameDaysForWeek,
};
