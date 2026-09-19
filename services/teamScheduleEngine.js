const SKILL_TAGS = ['', 'Beginner', 'Novice', 'Intermediate', 'Advanced', 'Expert'];

function skillTagFor(level) {
  const lvl = Math.min(5, Math.max(1, Number(level) || 3));
  return SKILL_TAGS[lvl];
}

const PROJECT_ROLES = [
  { title: 'Lead Implementer',              short: 'Lead',        emoji: '🚀' },
  { title: 'Code Reviewer & Quality Lead',  short: 'Reviewer',    emoji: '🔍' },
  { title: 'Tester & Debugger',             short: 'Tester',      emoji: '🧪' },
  { title: 'Researcher & Docs Lead',        short: 'Researcher',  emoji: '📚' },
  { title: 'Integration & Support Lead',    short: 'Support',     emoji: '🔧' },
];

// Returns the named project role for a member at a given index
function projectRoleFor(memberIdx) {
  return PROJECT_ROLES[memberIdx % PROJECT_ROLES.length];
}

// Daily DRIVING duty: which member index is "driving the keyboard" today.
// Rotates 0→1→2→... so every member gets a turn leading the day's coding.
function dailyDriverIdx(dayIdx, memberCount) {
  return dayIdx % memberCount;
}

// ── PLACEMENT MICRO-PREP (8 min only — protect project energy) ───────────────
const { placementFor, enrichObjectRows, neatActivityTitle } = require("../utils/dayEngagementEnricher");
const { getStepForPlanDay } = require("../utils/dtPlaybookLookup");
const { homeworkBlock } = require("../utils/dayGapGenerator");

function placementFocusFor(member, dayIdx) {
  if (!member.targetCompany || !String(member.targetCompany).trim()) return null;
  return placementFor(String(member.targetCompany).trim(), dayIdx);
}

/** Resolve a clear DT phase label for standup / badges (never invent "Build"). */
function resolveDtPhaseLabel(dayBucket, dayIdx, activeStageKey, productPlanOrInputs) {
  if (dayBucket?.dtPhase && !/^build$/i.test(String(dayBucket.dtPhase).trim())) {
    return String(dayBucket.dtPhase).trim();
  }
  // Prefer phase already written into Stand-Up / Learning content
  for (const r of dayBucket?.rows || []) {
    const c = String(r.content || "");
    const m =
      c.match(/DT Phase(?:\s*today)?[:\s]+([^\n]+)/i) ||
      c.match(/Current DT Phase[:\s]+([^\n]+)/i);
    if (m && m[1] && !/^build$/i.test(m[1].trim())) return m[1].trim();
  }
  const step = getStepForPlanDay(dayIdx, activeStageKey || "empathize", productPlanOrInputs);
  if (step?.stage && step?.step) return `${step.stage} — ${step.step}`;
  if (step?.stage) return step.stage;
  return "Empathize & Define";
}

// ── BEGINNER SCAFFOLDING ──────────────────────────────────────────────────────
// DT Playbook stages that are purely conceptual — no coding yet.
// For these we give "think through" hints instead of code hints.
const CONCEPTUAL_STAGES = ['empathize', 'define', 'plan', 'prototype', 'evaluate', 'pitch', 'bmc'];

function isConceptualDay(dtPhase) {
  if (!dtPhase) return false;
  const p = String(dtPhase).toLowerCase();
  return CONCEPTUAL_STAGES.some(s => p.includes(s));
}

function beginnerHint(content, dtPhase) {
  const conceptual = isConceptualDay(dtPhase);
  if (conceptual) {
    return content + '\n▶ 💡 HOW TO START (Beginner): Read the task once. Open a blank doc/notebook. Write 3 bullet points answering the task in plain language before doing anything else.';
  }
  return content + '\n▶ 💡 HOW TO START (Beginner): Open your code editor. Write a comment explaining what you want to do. Then write the simplest possible version first — even if it only handles one case — and show it to your reviewer before adding more.';
}

function scaffoldRowsForBeginner(rows, dtPhase) {
  return rows.map(r => {
    const act = String(r.activity || '').toLowerCase();
    // Only scaffold implementation/learning/DSA rows, not breaks/lunch
    if (/project build|system design|learning|coding practice|implement|project|dsa/.test(act)) {
      return { ...r, content: beginnerHint(r.content, dtPhase) };
    }
    return r;
  });
}

// ── GROUP ACTIVITY BLOCKS ─────────────────────────────────────────────────────
// These are injected into EVERY member's rows so it's clear that all
// members are in the room together for these slots.

function groupStandupRow(members, driverName, projectPhase, dutyLines = []) {
  const memberList = members.map((m, i) => {
    const role = projectRoleFor(i);
    return `    ${role.emoji} ${m.name} — ${role.title}`;
  }).join('\n');
  const phaseLabel = (projectPhase && !/^build$/i.test(String(projectPhase).trim()))
    ? String(projectPhase).trim()
    : "Empathize & Define";
  const duties = (dutyLines || []).length
    ? `▶ Equal duties today (everyone ships something):\n${dutyLines.map((l) => `    ${l}`).join("\n")}\n`
    : "";
  return {
    time: '08:45 – 09:00 IST',
    activity: '🤝 Team Standup (ALL MEMBERS)',
    content:
      `▶ GROUP session — everyone attends together (first slot of the day).\n` +
      `▶ Today's main coder (keyboard): ${driverName} — others still have FULL equal tasks (review / test / docs / integrate).\n` +
      `▶ Current DT Phase: ${phaseLabel}\n` +
      `▶ Pace sync: Slow / Steady / Average / Fast members share this SAME day and SAME milestone. Fast learners add a stretch check; slower learners get a scaffolded first slice — Retro still happens together.\n` +
      `▶ Team roster:\n${memberList}\n` +
      duties +
      `▶ Each member shares (1 min): What I finished yesterday · My equal deliverable today · Any blocker\n` +
      `▶ Facilitator writes blockers on the shared board before work starts.`,
  };
}

function groupRetroRow(members) {
  // Pure Daily Retrospective only — no separate "Wrap-Up" slot.
  const memberList = members.map((m, i) => `${projectRoleFor(i).emoji} ${m.name}`).join(' · ');
  return {
    time: '04:00 – 04:30 IST',
    activity: '🔄 Daily Retrospective (ALL MEMBERS)',
    content:
      `▶ GROUP session — last slot of the day. Members: ${memberList}\n` +
      `▶ Facilitator rotates daily. Use a shared board / doc.\n` +
      `▶ ROUND-ROBIN (2 min per person — be specific, no vague answers):\n` +
      `   1. DONE — What exact output did I produce today? (file name, screen, doc section, or commit)\n` +
      `   2. LEARNED — What NEW concept or skill did I learn today that I did not know this morning?\n` +
      `   3. STUCK — What blocked me, and what do I need from the team tomorrow?\n` +
      `▶ TEAM CHECK (5 min):\n` +
      `   • Move board cards → Done / In-Progress / Blocked\n` +
      `   • Confirm Coding Log has today's platform + NEW problem title (no repeats)\n` +
      `   • Name tomorrow's first concrete task in one sentence\n` +
      `▶ Close: one improvement the team will try tomorrow. Zero after-hours homework.`,
  };
}

// Collaborative DT Playbook steps that benefit from a GROUP WORK slot
const GROUP_STEPS = ['pitch', 'empathy map', 'process flow', 'user actions', 'app state', 'features',
  'observation', 'interview', 'reiterate', 'bmc', 'customer sales pitch', 'final pitch'];

function isGroupStep(dayName) {
  if (!dayName) return false;
  const dn = String(dayName).toLowerCase();
  return GROUP_STEPS.some(s => dn.includes(s));
}

function groupActivityRow(dayName, members) {
  const memberList = members.map((m, i) => `${projectRoleFor(i).emoji} ${m.name}`).join(' · ');
  return {
    time: '09:00 – 10:30 IST',
    activity: '👥 Group Work Session (ALL MEMBERS)',
    content:
      `▶ GROUP session — all members work the SAME DT Playbook step together.\n` +
      `▶ Members: ${memberList}\n` +
      `▶ Today's DT step focus: ${dayName || "see day's DT Playbook activity"}\n` +
      `▶ How to run the session:\n` +
      `   1. Read the problem statement out loud (2 min) — make sure everyone understands WHO has the problem and WHY it matters\n` +
      `   2. Assign note-taker (rotate). Share screen. One types, others contribute\n` +
      `   3. Empathy / Research / Technical — cover each lens before jumping to code (see today's project row for the breakdown)\n` +
      `▶ Deliverable: one shared output (doc / Figma / whiteboard) the whole team agrees on.`,
  };
}

// ── EQUAL ROLE TASKS (every member works every day) ───────────────────────────
// Driver rotates for "main code", but Reviewer / Tester / Docs / Support always
// get concrete LEARN + DO work tied to the same problem slice — not idle support.

function extractSharedLearnTopic(rows) {
  for (const r of rows || []) {
    if (!/learning/i.test(String(r.activity || ""))) continue;
    const m =
      String(r.content || "").match(/▶\s*Learn(?:\s*Day\s*\d+)?:\s*([^\n]+)/i) ||
      String(r.content || "").match(/▶\s*Learn today:\s*([^\n]+)/i);
    if (m) return m[1].trim().slice(0, 90);
  }
  return "today's topic";
}

/** Pull Class topic / Pattern / day LC from Coding Practice so homework stays linked. */
function extractCodingPracticeLink(rows) {
  for (const r of rows || []) {
    if (!/coding practice/i.test(String(r.activity || ""))) continue;
    const c = String(r.content || "");
    const classTopic =
      (c.match(/▶\s*Class topic:\s*([^\n]+)/i) || [])[1] ||
      (c.match(/▶\s*Coding Practice\s*[—\-]\s*([^\n]+)/i) || [])[1] ||
      "";
    const pattern = (c.match(/▶\s*Pattern:\s*([^\n]+)/i) || [])[1] || "";
    const dayLcMatch = c.match(/LeetCode\s*#(\d+)/i);
    const dayNameMatch = c.match(/LeetCode\s*#\d+\s*[—\-]\s*([^(]+)/i);
    return {
      classTopic: String(classTopic || "").trim().slice(0, 80),
      pattern: String(pattern || "").trim().slice(0, 60),
      dayLc: dayLcMatch ? dayLcMatch[1] : null,
      dayName: dayNameMatch ? dayNameMatch[1].trim().slice(0, 60) : "",
    };
  }
  return { classTopic: "", pattern: "", dayLc: null, dayName: "" };
}

function extractProblemHint(rows) {
  for (const r of rows || []) {
    if (!/problem review|project build/i.test(String(r.activity || ""))) continue;
    const m =
      String(r.content || "").match(/▶\s*Your problem:\s*"([^"]+)"/i) ||
      String(r.content || "").match(/▶\s*Build[^\n]*?:\s*"([^"]+)"/i) ||
      String(r.content || "").match(/"([^"]{20,160})"/);
    if (m) return m[1].trim().slice(0, 160);
  }
  return "the uploaded problem";
}

/**
 * Build equal, role-specific LEARN + DO pack for one member for one day.
 */
function buildRoleDayPack({ projectRole, isDriver, memberName, driverName, learnTopic, problemHint, dtPhase }) {
  const role = projectRole?.short || "Lead";
  const topic = learnTopic || "today's topic";
  const problem = problemHint || "the uploaded problem";
  const phase = dtPhase || "current DT step";
  const driver = driverName || "the main coder";

  // Shared: everyone still understands the same problem + topic
  const sharedLearn = [
    `▶ Shared topic (whole team): ${topic}`,
    `▶ Problem slice: "${problem}"`,
    `▶ DT Phase: ${phase}`,
  ];

  if (isDriver || role === "Lead") {
    return {
      dailyRole: isDriver ? "Main coder today (keyboard driver)" : "Lead Implementer (pair with today's driver)",
      learnExtra: [
        ...sharedLearn,
        `▶ YOUR learn focus (Implementer): how to APPLY "${topic}" in a small working change.`,
        `▶ Read 1 short example, then sketch 3 steps you will code/write.`,
      ],
      projectExtra: [
        `▶ ${memberName} — ROLE: Lead Implementer ${isDriver ? "(MAIN CODER TODAY)" : ""}`,
        `▶ YOUR equal deliverable today:`,
        `▶ 1) Implement the smallest piece that uses "${topic}" on "${problem}"`,
        `▶ 2) Leave a clear handoff note for the Reviewer (what changed + where)`,
        `▶ 3) Ask Reviewer + Tester to check before Retro`,
        `▶ Done when: one file/notes artifact runs or is complete + handoff written`,
      ],
      profileExtra: [
        `▶ Interests / Goals — ${memberName}`,
        `▶ Spend a short session on one Interest or Goal from your Inputs.`,
        `▶ Connect it to today's DT Playbook Step and your Implementer deliverable.`,
        `▶ Reference links: use Learning / Project Build links already on today's plan.`,
      ],
    };
  }

  if (role === "Reviewer") {
    return {
      dailyRole: "Code Reviewer & Quality Lead (equal load — review today's build)",
      learnExtra: [
        ...sharedLearn,
        `▶ YOUR learn focus (Reviewer): review checklist for "${topic}" — correctness, naming, edge cases, readability.`,
        `▶ Write 5 review questions you will ask ${driver}'s work today.`,
      ],
      projectExtra: [
        `▶ ${memberName} — ROLE: Code Reviewer & Quality Lead`,
        `▶ While ${driver} builds, YOU do equal work (not waiting idle):`,
        `▶ 1) LEARN: draft a review checklist for "${topic}" (5 bullets)`,
        `▶ 2) REVIEW TARGET: whatever ${driver} ships today for "${problem}"`,
        `▶ 3) Check: Does it match the problem? Uses "${topic}"? Any bug/edge case?`,
        `▶ 4) Write: 2 strengths + 2 must-fix issues (with file/line or section)`,
        `▶ 5) Approve OR request 1 rework before Retro`,
        `▶ Done when: review notes saved (notes/review-day.md) and shared with ${driver}`,
      ],
      profileExtra: [
        `▶ Interests / Goals — ${memberName}`,
        `▶ Spend a short session on one Interest or Goal from your Inputs.`,
        `▶ Connect it to today's review checklist and DT Playbook Step.`,
        `▶ Reference links: use Learning / Project Build links already on today's plan.`,
      ],
    };
  }

  if (role === "Tester") {
    return {
      dailyRole: "Tester & Debugger (equal load — test today's build)",
      learnExtra: [
        ...sharedLearn,
        `▶ YOUR learn focus (Tester): write test cases for "${topic}" on the problem (happy path + 2 fails).`,
        `▶ Define: Input → Expected result for 3 cases.`,
      ],
      projectExtra: [
        `▶ ${memberName} — ROLE: Tester & Debugger`,
        `▶ Equal work today (parallel to coding):`,
        `▶ 1) LEARN: write 3 test cases for "${topic}" tied to "${problem}"`,
        `▶ 2) TEST TARGET: the artifact ${driver} produces today`,
        `▶ 3) Run/manual-check each case → Pass / Fail / Blocked`,
        `▶ 4) Log bugs: Steps · Expected · Actual (short)`,
        `▶ 5) Retest once after a small fix if time allows`,
        `▶ Done when: test log saved (notes/test-day.md) with Pass/Fail marks`,
      ],
      profileExtra: [
        `▶ Interests / Goals — ${memberName}`,
        `▶ Spend a short session on one Interest or Goal from your Inputs.`,
        `▶ Connect it to today's test cases and DT Playbook Step.`,
        `▶ Reference links: use Learning / Project Build links already on today's plan.`,
      ],
    };
  }

  if (role === "Researcher") {
    return {
      dailyRole: "Researcher & Docs Lead (equal load — docs + clarity)",
      learnExtra: [
        ...sharedLearn,
        `▶ YOUR learn focus (Docs): explain "${topic}" in plain English for the team README.`,
        `▶ Write: What it is · Why our problem needs it · How we use it today.`,
      ],
      projectExtra: [
        `▶ ${memberName} — ROLE: Researcher & Docs Lead`,
        `▶ Equal work today:`,
        `▶ 1) Document today's shared topic "${topic}" in notes/docs-day.md`,
        `▶ 2) Capture what ${driver} built for "${problem}" in 5 lines (user-facing)`,
        `▶ 3) List 2 open questions / assumptions to validate`,
        `▶ 4) Update team board: Done / In progress / Blocked for this day`,
        `▶ Done when: docs file exists and team can read it in 60 sec`,
      ],
      profileExtra: [
        `▶ Interests / Goals — ${memberName}`,
        `▶ Spend a short session on one Interest or Goal from your Inputs.`,
        `▶ Connect it to today's docs and DT Playbook What to Learn.`,
        `▶ Reference links: use Learning / Project Build links already on today's plan.`,
      ],
    };
  }

  // Support / Integration
  return {
    dailyRole: "Integration & Support Lead (equal load — wire pieces together)",
    learnExtra: [
      ...sharedLearn,
      `▶ YOUR learn focus (Integration): where "${topic}" plugs into Client → Logic → Store for the problem.`,
      `▶ Sketch 3 boxes and the arrow that today's change touches.`,
    ],
    projectExtra: [
      `▶ ${memberName} — ROLE: Integration & Support Lead`,
      `▶ Equal work today:`,
      `▶ 1) Map how today's "${topic}" connects to the rest of "${problem}"`,
      `▶ 2) Help ${driver} with setup/errors (env, run steps, missing file)`,
      `▶ 3) Produce integration note: What connects · What is still missing`,
      `▶ 4) Smoke-check: can a teammate run/open the artifact in 2 minutes?`,
      `▶ Done when: integration note saved + smoke-check result logged`,
    ],
    profileExtra: [
      `▶ Interests / Goals — ${memberName}`,
      `▶ Spend a short session on one Interest or Goal from your Inputs.`,
      `▶ Connect it to today's integration note and DT Playbook Real Project Task.`,
      `▶ Reference links: use Learning / Project Build links already on today's plan.`,
    ],
  };
}

function applyRolePackToRows(rows, pack, memberName) {
  return (rows || []).map((r) => {
    const act = String(r.activity || "").toLowerCase();
    let content = String(r.content || "");

    if (/project build|project push|implement/i.test(act) && pack.projectExtra?.length) {
      // Role pack FIRST so equal deliverable is obvious, then keep core project checklist
      const cleaned = content.replace(
        /^▶ (Team member|Role today|Daily Duty|How to follow|[A-Za-z ]+ — Project Role)[^\n]*\n?/gm,
        ""
      );
      content = `${pack.projectExtra.join("\n")}\n▶ Shared project checklist (same problem for everyone):\n${cleaned}`;
    }

    if (/^(capability|interests?|domain)$|peer review/i.test(act) && pack.profileExtra?.length) {
      content = [...pack.profileExtra, content].join("\n");
    }

    if (/stand-?up|standup/i.test(act) && pack.dailyRole) {
      content = content
        .replace(/▶ Role today:[^\n]*/i, `▶ Role today: ${pack.dailyRole}`)
        .replace(/▶ Daily Duty:[^\n]*/i, "");
      if (!/Role today:/i.test(content)) {
        content += `\n▶ Role today: ${pack.dailyRole}`;
      }
    }

    return { ...r, content };
  });
}

// ── PATH 1: ROWS-BASED ────────────────────────────────────────────────────────

function parseDailyRows(rawRows, activeStageKey = "empathize", productPlanOrInputs = null) {
  if (!Array.isArray(rawRows) || !rawRows.length) return [];
  const byDay = new Map();
  const order = [];
  for (const row of rawRows) {
    if (!Array.isArray(row) || row.length < 4) continue;
    let dayId, dayName, time, activity, content;
    if (row.length >= 5) {
      [dayId, dayName, time, activity, content] = row;
    } else {
      [dayId, time, activity, content] = row;
      dayName = null;
    }
    if (!byDay.has(dayId)) {
      byDay.set(dayId, { dayId, dayName: dayName || dayId, rows: [] });
      order.push(dayId);
    } else if (dayName && !byDay.get(dayId).dayName) {
      byDay.get(dayId).dayName = dayName;
    }
    byDay.get(dayId).rows.push({ time: String(time || ''), activity: String(activity || ''), content: String(content || '') });
  }
  return order.map((dayId, idx) => {
    const bucket = byDay.get(dayId);
    const wMatch = String(dayId).match(/Week\s*(\d+)/i) || String(dayId).match(/\bW(\d+)\b/i);
    const dMatch = String(dayId).match(/\bD(\d+)\b/i);
    const week   = wMatch ? Number(wMatch[1]) : Math.ceil((idx + 1) / 5);
    const dayNum = dMatch ? Number(dMatch[1]) : idx + 1;
    const dtPhase = resolveDtPhaseLabel(bucket, idx, activeStageKey, productPlanOrInputs);
    return { ...bucket, week, dayNum, dtPhase };
  });
}

function stampPaceOnRows(rows, member) {
  const { formatPaceSlotLine } = require("../utils/academicLevel");
  const learn = formatPaceSlotLine(member, "learning");
  const project = formatPaceSlotLine(member, "project");
  const coding = formatPaceSlotLine(member, "coding");
  const assess = String(member?.assessment || "").trim().slice(0, 70);
  return rows.map((r) => {
    const act = String(r.activity || "");
    let extra = "";
    if (/^learning$/i.test(act)) extra = learn;
    else if (/project build/i.test(act)) extra = project;
    else if (/coding practice/i.test(act)) extra = coding;
    let content = String(r.content || "");
    if (extra) {
      content = /▶ Pace \(/i.test(content)
        ? content.replace(/▶ Pace \([^)]+\):[^\n]*/i, extra)
        : content
          ? `${content}\n${extra}`
          : extra;
    }
    if (/speak/i.test(act) && assess && !/From Assess:/i.test(content)) {
      content = `${content}\n▶ From Assess: fold "${assess}" into your last sentence.`;
    }
    return { ...r, content };
  });
}

/**
 * Personalise a day's rows for ONE member:
 * - Equal role pack (learn + do) so Reviewer/Tester/Docs are never idle
 * - Rotating main coder, everyone still ships a deliverable
 */
function personaliseRows(baseRows, member, projectRole, dailyRole, placementFocus, dayIdx, allMembers, dayBucket, memberIdx = 0) {
  let rows = stampPaceOnRows(
    baseRows.map(r => ({ ...r, activity: neatActivityTitle(r.activity), content: String(r.content || "") })),
    member
  );

  const driverIdx = dailyDriverIdx(dayIdx, allMembers.length);
  const driverName = allMembers[driverIdx]?.name || allMembers[0]?.name;
  const isDriver = memberIdx === driverIdx;
  const learnTopic = extractSharedLearnTopic(rows);
  const problemHint = extractProblemHint(rows);

  const pack = buildRoleDayPack({
    projectRole,
    isDriver,
    memberName: member.name,
    driverName,
    learnTopic,
    problemHint,
    dtPhase: dayBucket.dtPhase,
  });

  // Stand-up lists equal duties for ALL members
  const dutyLines = allMembers.map((m, i) => {
    const role = m.projectRole || projectRoleFor(i);
    const p = buildRoleDayPack({
      projectRole: role,
      isDriver: i === driverIdx,
      memberName: m.name,
      driverName,
      learnTopic,
      problemHint,
      dtPhase: dayBucket.dtPhase,
    });
    return `${role.emoji || "•"} ${m.name}: ${p.dailyRole}`;
  });

  const standupBase = groupStandupRow(allMembers, driverName, dayBucket.dtPhase, dutyLines);
  const standupIdx = rows.findIndex(r => /standup|stand.up|kickoff/i.test(r.activity));
  if (standupIdx !== -1) {
    rows[standupIdx] = {
      ...standupBase,
      activity: "Stand-Up",
      content: `${standupBase.content}\n▶ Role today: ${pack.dailyRole}`,
    };
  } else {
    rows.unshift({
      ...standupBase,
      activity: "Stand-Up",
      content: `${standupBase.content}\n▶ Role today: ${pack.dailyRole}`,
    });
  }

  if (isGroupStep(dayBucket.dayName)) {
    const groupRow = { ...groupActivityRow(dayBucket.dayName, allMembers), activity: "Group Work" };
    const implIdx = rows.findIndex(r => /project build|system design|learning/i.test(r.activity));
    if (implIdx !== -1) rows.splice(implIdx, 0, groupRow);
    else rows.splice(1, 0, groupRow);
  }

  // Apply equal role LEARN + PROJECT + PEER packs
  rows = applyRolePackToRows(rows, pack, member.name);

  const implRow = rows.find(r => r.activity === "Project Build" || /project|dt playbook|implement/i.test(r.activity));
  if (implRow) implRow.activity = "Project Build";

  const retroIdx = rows.findIndex(r => /retro/i.test(r.activity));
  const teamRetro = { ...groupRetroRow(allMembers), activity: "Retrospective" };
  if (retroIdx !== -1) rows[retroIdx] = teamRetro;
  else rows.push(teamRetro);

  rows = enrichObjectRows(rows, dayIdx, memberIdx, {
    targetCompany: member.targetCompany,
    placementFocus,
    theme: dayBucket.theme || null,
    inputs: {
      ...(dayBucket.inputs || {}),
      _themeByWeek: dayBucket.themeByWeek || {},
      collegeYear: member.collegeYear,
      semester: member.semester,
      schoolGrade: member.schoolGrade,
      college: member.college,
      department: member.department,
      skillLevel: member.skillLevel,
      leetcodeUsername: member.leetcodeUsername || "",
      interest: member.interest || "",
      capability: member.capability || "",
      difficulties: member.difficulties || "",
      dislikes: member.dislikes || "",
      domain: member.domain || "",
      assessment: member.assessment || "",
      studyMedium: member.studyMedium || "auto",
      targetCompany: member.targetCompany || "",
      targetRole: member.targetRole || "",
    },
    weekNum: dayBucket.week,
    config: parseAssessmentConfig({
      ...(dayBucket.inputs || {}),
      collegeYear: member.collegeYear,
      semester: member.semester,
      schoolGrade: member.schoolGrade,
      college: member.college,
      department: member.department,
      skillLevel: member.skillLevel,
    leetcodeUsername: member.leetcodeUsername || "",
    }),
  });

  // Replace shared homework with member + year/semester calibrated homework
  const dayId =
    dayBucket.dayId ||
    `Week ${dayBucket.week || 1} - ${dayBucket.dayName || "Monday"}`;
  const codingLink = extractCodingPracticeLink(rows);
  const classTopic = codingLink.classTopic || learnTopic || "today's topic";
  const absKey = String(dayIdx);
  const hwInputs = {
    ...(dayBucket.inputs || {}),
    collegeYear: member.collegeYear,
    semester: member.semester,
    schoolGrade: member.schoolGrade,
    college: member.college,
    department: member.department,
    skillLevel: member.skillLevel,
    leetcodeUsername: member.leetcodeUsername || "",
    interest: member.interest || "",
    capability: member.capability || "",
    difficulties: member.difficulties || "",
    dislikes: member.dislikes || "",
    domain: member.domain || "",
    assessment: member.assessment || "",
    studyMedium: member.studyMedium || "auto",
    _memberIdx: memberIdx,
    _teamMembers: JSON.stringify(allMembers),
    _skipDsa: dayBucket.inputs?._skipDsa,
    _dayLcByAbs: {
      ...(dayBucket.inputs?._dayLcByAbs || {}),
      [absKey]: {
        lc: codingLink.dayLc,
        name: codingLink.dayName,
        pattern: codingLink.pattern || "",
        dsaTopic: classTopic,
        learnLabel: learnTopic || classTopic,
      },
    },
    _dayTopicByAbs: {
      ...(dayBucket.inputs?._dayTopicByAbs || {}),
      [absKey]: {
        dsaTopic: classTopic,
        learnLabel: learnTopic || classTopic,
        pattern: codingLink.pattern || "",
        dayLc: codingLink.dayLc,
        dayName: codingLink.dayName,
      },
    },
  };
  const memberPicks = pickForDay(
    dayIdx,
    parseAssessmentConfig(hwInputs),
    memberIdx,
    member
  );
  if (codingLink.dayLc) {
    memberPicks.leetcode = {
      ...(memberPicks.leetcode || {}),
      lc: codingLink.dayLc,
      name: codingLink.dayName || memberPicks.leetcode?.name,
      pattern: codingLink.pattern || memberPicks.leetcode?.pattern,
    };
  }
  const hwContent = homeworkBlock({
    picks: memberPicks,
    gap: {
      learnTopic: learnTopic || classTopic,
      dsaLink: classTopic,
    },
    learnLabel: learnTopic || classTopic,
    dayIdx,
    dayKey: dayId,
    inputs: hwInputs,
    member,
    memberIdx,
    skipDsa: Boolean(dayBucket.inputs?._skipDsa),
    themeDsa: classTopic,
  });
  const hwIdx = rows.findIndex((r) => /homework/i.test(String(r.activity || "")));
  const hwRow = { time: "Tonight", activity: "Tonight's Homework", content: hwContent };
  if (hwIdx !== -1) rows[hwIdx] = hwRow;
  else rows.push(hwRow);

  if (member.skillLevel <= 2) {
    rows = scaffoldRowsForBeginner(rows, dayBucket.dtPhase);
  }

  return rows;
}

function generateTeamScheduleFromRows(dailyRows, members, opts = {}) {
  if (!Array.isArray(dailyRows) || !dailyRows.length) {
    throw new Error('No daily rows available — generate the main plan first.');
  }
  if (!Array.isArray(members) || !members.length) {
    throw new Error('At least one team member is required.');
  }

  const activeStageKey = opts.activeDTStage || opts._activeDTStage || "empathize";

  const memberMeta = members.map((m, i) => ({
    id:            String(m._id || m.id),
    name:          m.name,
    skillLevel:    m.skillLevel,
    targetRole:    m.targetRole || '',
    targetCompany: m.targetCompany || '',
    collegeYear:   m.collegeYear != null ? Number(m.collegeYear) : null,
    semester:      m.semester != null ? Number(m.semester) : null,
    schoolGrade:   m.schoolGrade != null ? Number(m.schoolGrade) : null,
    college:       m.college || '',
    department:    m.department || '',
    skillTag:      skillTagFor(m.skillLevel),
    projectRole:   projectRoleFor(i),
  }));

  const parsedDays = parseDailyRows(dailyRows, activeStageKey, opts);

  const themeByWeek = {};
  (opts.themes || []).forEach((t) => {
    if (t && t.week != null) themeByWeek[Number(t.week)] = t;
  });
  if (opts.themeByWeek && typeof opts.themeByWeek === "object") {
    Object.assign(themeByWeek, opts.themeByWeek);
  }

  const schedule = parsedDays.map((dayBucket, dayIdx) => {
    const driverIdx = dailyDriverIdx(dayIdx, memberMeta.length);
    const theme = themeByWeek[dayBucket.week] || null;
    const bucketWithTheme = {
      ...dayBucket,
      theme,
      themeByWeek,
      inputs: opts.inputs || {},
    };

    const assignments = memberMeta.map((member, i) => {
      const projectRole = member.projectRole;
      const isDriver = i === driverIdx;
      // Equal load: driver codes; others review / test / docs / integrate the SAME day
      const packPreview = buildRoleDayPack({
        projectRole,
        isDriver,
        memberName: member.name,
        driverName: memberMeta[driverIdx]?.name,
        learnTopic: extractSharedLearnTopic(dayBucket.rows),
        problemHint: extractProblemHint(dayBucket.rows),
        dtPhase: dayBucket.dtPhase,
      });
      const dailyRole = packPreview.dailyRole;
      const placFocus = placementFocusFor(member, dayIdx);

      return {
        memberId:       member.id,
        name:           member.name,
        projectRole:    projectRole.title,
        dailyRole,
        skillLevel:     member.skillLevel,
        placementFocus: placFocus,
        rows:           personaliseRows(
          dayBucket.rows, member, projectRole, dailyRole, placFocus, dayIdx, memberMeta, bucketWithTheme, i
        ),
      };
    });

    return {
      day:      dayBucket.dayNum,
      dayId:    dayBucket.dayId,
      dayName:  dayBucket.dayName,
      week:     dayBucket.week,
      dtPhase:  dayBucket.dtPhase || null,
      baseTask: null,
      driverName: memberMeta[driverIdx]?.name,   // NEW: who's driving today
      assignments,
    };
  });

  return { members: memberMeta, schedule };
}

// ── PATH 2: SCHEDULE-BASED (fallback) ────────────────────────────────────────

function focusFor(role, d) {
  return d.implement || d.dtPlaybookActivity || "today's task";
}

// Unique coding suggestions — prefer RAG LeetCode from assessment picks
const { pickForDay, parseAssessmentConfig, formatProjectBreakdown } = require("../utils/assessmentPicker");

function codingPracticeFor(dayIdx, dsaHint, assessmentPicks) {
  if (assessmentPicks?.leetcode) {
    const p = assessmentPicks.leetcode;
    return (
      `▶ Platform today: LeetCode (RAG — real problem from leetcode.com)\n` +
      `▶ MANDATORY NEW problem: ${p.label}\n` +
      `▶ Pattern: ${p.pattern}\n` +
      `▶ Open: ${p.url}\n` +
      `▶ Process: read twice → pseudocode on paper → code → submit → log result\n` +
      `▶ Coding Log: Date | LeetCode #${p.lc} | ${p.name} | ${p.difficulty} | Result | Minutes`
    );
  }
  const dsa = dsaHint && !/^none/i.test(String(dsaHint).trim()) ? String(dsaHint).trim() : "today's DSA topic";
  return (
    `▶ Platform today: LeetCode\n` +
    `▶ Open: https://leetcode.com/problemset/\n` +
    `▶ Pick ONE Easy/Medium problem matching: ${dsa}\n` +
    `▶ Use only a real LeetCode title that exists on the site (do not invent numbers).\n` +
    `▶ Process: read twice → pseudocode → code → submit → log result\n` +
    `▶ Coding Log: Date | Platform | Problem Title | Topic | Result (AC/WA/TLE) | Minutes`
  );
}

function buildProblemGuide(d, techStack) {
  const phase = (d.dtPhase && !/^build$/i.test(String(d.dtPhase)))
    ? d.dtPhase
    : resolveDtPhaseLabel({ rows: [], dtPhase: d.dtPhase }, 0, "empathize");
  const step  = d.dtPlaybookActivity || d.step || d.implement || "today's DT step";
  const pb    = d.problemBreakdown || {};
  const stack = techStack || pb.technical?.recommendedStack || null;

  let stackLines = '';
  if (stack && typeof stack === 'object') {
    stackLines =
      `▶ TECH STACK TO USE TODAY (stick to these — do not invent new tools):\n` +
      (stack.frontend   ? `   • Frontend: ${stack.frontend}\n` : '') +
      (stack.backend    ? `   • Backend: ${stack.backend}\n` : '') +
      (stack.database   ? `   • Database: ${stack.database}\n` : '') +
      (stack.aiComponent ? `   • AI/ML: ${stack.aiComponent}\n` : '') +
      (stack.deployment ? `   • Deploy: ${stack.deployment}\n` : '');
  } else if (typeof stack === 'string' && stack.trim()) {
    stackLines = `▶ TECH STACK TO USE TODAY: ${stack}\n`;
  } else {
    stackLines =
      `▶ TECH STACK TO USE TODAY: use only the stack named in your problem statement / weekly plan.\n` +
      `   Break it into sub-topics before coding: (1) UI screen or CLI, (2) data shape, (3) one core function.\n`;
  }

  return (
    `▶ DT PHASE: ${phase}\n` +
    `▶ TODAY'S DT STEP: ${step}\n` +
    `▶ PROBLEM BREAKDOWN — follow all four lenses before / while you work:\n` +
    `   ▸ EMPATHY — Who is hurt by this problem today? Write 2 sentences as the user (feelings + failed workaround).\n` +
    `     ${pb.empathyNote || pb.empathy?.userPersona || 'Name the persona, their context, and the emotion (frustrated / overwhelmed / hopeful).'}\n` +
    `   ▸ RESEARCH — What is known vs unknown?\n` +
    `     ${pb.researchNote || 'List 1 known fact + 1 unknown. Name 1 competitor/gap if relevant. Run one search query.'}\n` +
    `   ▸ TECHNICAL — What will you build with the stack?\n` +
    `     ${pb.technicalNote || 'Name the exact module/file/screen you will touch. Split into 2–3 sub-topics and finish one first.'}\n` +
    `   ▸ GUIDE — What does "done" look like today?\n` +
    `     ${pb.guideNote || pb.guide?.doneWhen || 'You are done when you can point to one concrete output (doc section, sketch, or working function) and explain it in 60 seconds.'}\n` +
    stackLines +
    `▶ Task: ${d.implement || d.dtPlaybookActivity || "Complete today's DT Playbook step for THIS problem statement"}\n` +
    (d.learn ? `▶ Learn first: ${d.learn}\n` : '') +
    (d.reflection ? `▶ Reflect: ${d.reflection}\n` : '')
  );
}

function buildDayRows(member, projectRole, dailyRole, d, assignment, dayIdx, allMembers, assessmentConfig, memberIdx = 0) {
  const dsa       = d.dsaOfTheDay && !/^none/i.test(String(d.dsaOfTheDay).trim()) ? d.dsaOfTheDay : null;
  const placement = assignment.placementFocus;
  const driverName = allMembers[dailyDriverIdx(dayIdx, allMembers.length)]?.name || allMembers[0]?.name;
  const techStack  = d.techStack || d.recommendedStack || null;
  const cfg = assessmentConfig || parseAssessmentConfig({
    collegeYear: member.collegeYear,
    semester: member.semester,
    schoolGrade: member.schoolGrade,
    college: member.college,
    department: member.department,
    skillLevel: member.skillLevel,
    leetcodeUsername: member.leetcodeUsername || "",
  });
  const picks = pickForDay(dayIdx, cfg, memberIdx, member);

  const rows = [
    {
      ...groupStandupRow(allMembers, driverName, d.dtPhase),
      activity: "Stand-Up",
      content:
        groupStandupRow(allMembers, driverName, d.dtPhase).content +
        `\n▶ Role today: ${projectRole.title} · Duty: ${dailyRole}`,
    },
  ];

  if (isGroupStep(d.dtPlaybookActivity || d.step || '')) {
    rows.push({ ...groupActivityRow(d.dtPlaybookActivity || d.step, allMembers), activity: "Group Work" });
  }

  // Learn BEFORE Project Build (same flow as solo daily: concepts → then apply)
  if (d.learn) {
    rows.push({
      time: '09:00 – 10:30 IST',
      activity: 'Learning',
      content:
        `▶ Concept: ${d.learn}\n` +
        `▶ Why: You need this idea for today's project step.\n` +
        `▶ Outcome: You can explain it in simple words and give one example.`
    });
  } else {
    rows.push({
      time: '09:00 – 10:30 IST',
      activity: 'Learning',
      content:
        `▶ Review the problem statement through today's DT lens (${d.dtPhase || "current stage"}).\n` +
        `▶ BUILD HOOK: write 1 concrete note of what you will apply in Project Build after lunch.`,
    });
  }

  rows.push({
    time: '10:30 – 10:45 IST',
    activity: 'Break',
  });

  if (picks.pm) {
    rows.push({
      time: '10:45 – 11:00 IST',
      activity: 'Speak & Solve',
      content:
        `▶ Skill: ${picks.pm.skill}\n▶ ${picks.pm.text}\n` +
        `▶ Answer out loud (3 min): assumptions → approach → conclusion`,
    });
  }

  rows.push({
    time: '11:00 – 12:15 IST',
    activity: 'Coding Practice',
    content: (dsa ? `▶ DSA: ${dsa}\n` : '') + codingPracticeFor(dayIdx, dsa, picks),
  });

  rows.push({
    time: '12:15 – 01:00 IST',
    activity: 'Lunch',
  });

  rows.push({
    time: '01:00 – 02:30 IST',
    activity: 'Project Build',
    content:
      `▶ ${member.name} — Project Role: ${projectRole.title}\n` +
      `▶ Daily Duty: ${dailyRole}\n` +
      `▶ APPLY morning Learning first — only then implement.\n` +
      buildProblemGuide(d, techStack),
  });

  if (picks.agentWorkbench) {
    rows.push({
      time: '02:30 – 02:45 IST',
      activity: 'Agent Workbench',
      content: picks.agentWorkbench.notes,
    });
  }

  rows.push({
    time: '02:45 – 03:30 IST',
    activity: 'Project Build',
    content:
      `▶ Continue the SAME feature from the morning Learning hooks — do not start a second project.\n` +
      `▶ Continue breakdown tasks with stack from the problem statement / weekly plan only.`,
  });

  rows.push({
    time: placement ? '3:35 PM – 4:00 PM IST' : '3:30 PM – 4:00 PM IST',
    activity: 'Mini Build',
    content:
      `▶ Mini Build\n` +
      `▶ Heading: Map your interest onto today's problem\n` +
      `▶ Build one tiny demo or notes piece that links your interest to the Problem Statement.\n` +
      `▶ Reference links:\n` +
      `   · Website: freeCodeCamp — learn to code — https://www.freecodecamp.org/learn/\n` +
      `   · YouTube: How to learn programming (beginner) — https://www.youtube.com/watch?v=zOjov-2OZ0E\n` +
      `▶ Done when: you can show a tiny demo or notes page linking interest → problem.`,
  });

  rows.push({ ...groupRetroRow(allMembers), activity: "Retrospective" });

  // Per-member Tonight's Homework — year/semester/member calibrated (not shared)
  const dayId =
    d.dayId ||
    `Week ${Number.isFinite(d.week) ? d.week : Math.ceil((dayIdx + 1) / 5)} - ${["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"][dayIdx % 5]}`;
  const classTopic = d.dsaOfTheDay || d.learn || "today's topic";
  const absKey = String(dayIdx);
  const dayLc = picks?.leetcode?.lc
    ? {
        lc: picks.leetcode.lc,
        name: picks.leetcode.name || "",
        pattern: picks.leetcode.pattern || "",
        dsaTopic: classTopic,
        learnLabel: d.learn || classTopic,
        url: picks.leetcode.url || "",
      }
    : null;
  const hwInputs = {
    collegeYear: member.collegeYear,
    semester: member.semester,
    schoolGrade: member.schoolGrade,
    college: member.college,
    department: member.department,
    skillLevel: member.skillLevel,
    leetcodeUsername: member.leetcodeUsername || "",
    interest: member.interest || "",
    capability: member.capability || "",
    difficulties: member.difficulties || "",
    dislikes: member.dislikes || "",
    domain: member.domain || "",
    assessment: member.assessment || "",
    studyMedium: member.studyMedium || "auto",
    _memberIdx: memberIdx,
    _teamMembers: JSON.stringify(allMembers),
    _assessmentConfig: assessmentConfig || undefined,
    _dayLcByAbs: dayLc ? { [absKey]: dayLc } : {},
    _dayTopicByAbs: {
      [absKey]: {
        dsaTopic: classTopic,
        learnLabel: d.learn || classTopic,
        pattern: dayLc?.pattern || picks?.leetcode?.pattern || "",
        dayLc: dayLc?.lc || null,
        dayName: dayLc?.name || "",
      },
    },
  };
  rows.push({
    time: "Tonight",
    activity: "Tonight's Homework",
    content: homeworkBlock({
      picks,
      gap: { learnTopic: d.learn || classTopic, dsaLink: classTopic },
      learnLabel: d.learn || classTopic,
      dayIdx,
      dayKey: dayId,
      inputs: hwInputs,
      member,
      memberIdx,
      skipBanks: false,
      themeDsa: classTopic,
    }),
  });

  // Inject product speak, refresh game, 8-min placement, deep breakdown, neat titles
  let enriched = enrichObjectRows(rows, dayIdx, memberIdx, {
    config: cfg,
    targetCompany: member.targetCompany,
    placementFocus: placement,
  });

  if (member.skillLevel <= 2) {
    enriched = scaffoldRowsForBeginner(enriched, d.dtPhase);
  }
  return stampPaceOnRows(enriched, member);
}

function generateTeamSchedule(dailySchedule, members) {
  if (!Array.isArray(dailySchedule) || !dailySchedule.length) {
    throw new Error("This problem statement has no dailySchedule yet — generate its schedule before dividing it across a team.");
  }
  if (!Array.isArray(members) || !members.length) {
    throw new Error('At least one team member is required.');
  }

  const memberMeta = members.map((m, i) => ({
    id:            String(m._id),
    name:          m.name,
    skillLevel:    m.skillLevel,
    targetRole:    m.targetRole || '',
    targetCompany: m.targetCompany || '',
    collegeYear:   m.collegeYear != null ? Number(m.collegeYear) : null,
    semester:      m.semester != null ? Number(m.semester) : null,
    schoolGrade:   m.schoolGrade != null ? Number(m.schoolGrade) : null,
    college:       m.college || '',
    department:    m.department || '',
    skillTag:      skillTagFor(m.skillLevel),
    projectRole:   projectRoleFor(i),
  }));

  const schedule = dailySchedule
    .slice()
    .sort((a, b) => (a.day || 0) - (b.day || 0))
    .map((d, dayIdx) => {
      const driverIdx = dailyDriverIdx(dayIdx, memberMeta.length);

      const assignments = memberMeta.map((member, i) => {
        const projectRole = member.projectRole;
        const dailyRole   = i === driverIdx ? 'Driving (main coder today)' : `Supporting as ${projectRole.short}`;
        const placFocus   = placementFocusFor(member, dayIdx);
        const assignment  = {
          memberId:       member.id,
          name:           member.name,
          projectRole:    projectRole.title,
          dailyRole,
          skillLevel:     member.skillLevel,
          focus:          focusFor(projectRole.title, d),
          placementFocus: placFocus,
        };
        assignment.rows = buildDayRows(member, projectRole, dailyRole, d, assignment, dayIdx, memberMeta, null, i);
        return assignment;
      });

      return {
        day:        d.day,
        week:       Number.isFinite(d.week) ? d.week : Math.ceil((dayIdx + 1) / 5),
        dtPhase:    d.dtPhase,
        baseTask:   d.implement || d.dtPlaybookActivity,
        dsaOfTheDay: d.dsaOfTheDay,
        driverName: memberMeta[driverIdx]?.name,
        assignments,
      };
    });

  return { members: memberMeta, schedule };
}

module.exports = { generateTeamSchedule, generateTeamScheduleFromRows, skillTagFor };