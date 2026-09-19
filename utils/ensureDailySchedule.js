const { DT_PLAYBOOK } = require('./dtPlaybookStructure');
const { callLLM } = require('./llm');
const PHASE_LABEL_LOOKUP = {
  empathize: 'Empathize & Define',
  plan: 'Plan',
  prototype: 'Prototype',
  evaluate: 'Evaluate',
  pitch: 'Pitch & BMC',
};

const CODING_ROTATION = [
  { platform: 'HackerRank',    examples: ['Compare the Triplets', 'Diagonal Difference', 'Plus Minus'] },
  { platform: 'LeetCode',      examples: ['Best Time to Buy and Sell Stock', 'Maximum Subarray', 'Move Zeroes'] },
  { platform: 'Exercism',      examples: ['Hamming', 'Raindrops', 'Isogram'] },
  { platform: 'CodeChef',      examples: ['FLOW001', 'FLOW004', 'HS08TEST'] },
  { platform: 'GeeksForGeeks', examples: ['Missing number in array', 'Leaders in an array', "Kadane's Algorithm"] },
];

function parseTotalWeeks(statement) {
  if (statement.weeklyDeliverables && Object.keys(statement.weeklyDeliverables).length) {
    return Object.keys(statement.weeklyDeliverables).length;
  }
  const match = String(statement.timeline || '').match(/\d+/);
  return match ? Number(match[0]) : 4;
}

function activePhaseLabels(statement) {
  const ids = Array.isArray(statement.dtPhases) && statement.dtPhases.length
    ? statement.dtPhases
    : ['empathize', 'plan', 'prototype', 'evaluate'];
  return ids.map(id => PHASE_LABEL_LOOKUP[id] || id);
}

function flattenSteps(phaseLabels) {
  return DT_PLAYBOOK
    .filter(week => phaseLabels.includes(week.stage))
    .flatMap(week => week.steps.map(step => ({ stage: week.stage, ...step })));
}

function stepLine(dayNum, step) {
  if (!step) {
    return `Day ${dayNum} — DT Playbook steps for the selected phases are already complete. ` +
           `This is an APPLIED BUILD/ITERATION day — extend and polish the existing project. Do NOT repeat earlier steps.`;
  }
  return (
    `Day ${dayNum} — Phase: "${step.stage}" | Step: "${step.step}" | ` +
    `What to learn: ${step.whatToLearn} | ` +
    `Real task: ${step.realProjectTask} | ` +
    `DSA today: ${step.dsaConcept === 'NA' ? 'NONE (no algorithmic fit at this stage — do not invent one)' : step.dsaConcept}` +
    (step.discussionPrompt ? ` | Discussion: "${step.discussionPrompt}"` : '')
  );
}

function extractTechStackHint(statement) {
  const pb = statement.problemBreakdown;
  const stack = pb?.technical?.recommendedStack;
  if (stack && typeof stack === 'object') {
    return [
      stack.frontend && `Frontend: ${stack.frontend}`,
      stack.backend && `Backend: ${stack.backend}`,
      stack.database && `Database: ${stack.database}`,
      stack.aiComponent && `AI: ${stack.aiComponent}`,
      stack.deployment && `Deploy: ${stack.deployment}`,
    ].filter(Boolean).join(' | ');
  }
  if (statement.aiDetails) return statement.aiDetails;
  return 'Use only the stack implied by the problem statement deliverables — name frontend, backend, and data store explicitly in each day.';
}

async function generateWeekChunk(statement, weekNum, dayNumbers, flatDTSteps) {
  const table = dayNumbers.map(dayNum => stepLine(dayNum, flatDTSteps[dayNum - 1])).join('\n');
  const techHint = extractTechStackHint(statement);
  const codingHints = dayNumbers.map((dayNum, i) => {
    const rot = CODING_ROTATION[(dayNum - 1) % CODING_ROTATION.length];
    return `Day ${dayNum}: platform=${rot.platform}; suggest from [${rot.examples.join(', ')}] or other NEW unsolved titles — never reuse earlier days`;
  }).join('\n');

  const prompt = `
You are a mentor at SNS Innovation Hub. A project problem statement already exists — you are ONLY filling in
ONE WEEK (${dayNumbers.length} days) of its day-by-day DT Playbook schedule, not creating a new project and not
generating any other week.

PROJECT TITLE: ${statement.title}
DESCRIPTION: ${statement.description}
DIFFICULTY: ${statement.difficulty || 'intermediate'}
TECH STACK TO USE (mention clearly every day): ${techHint}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SNS DT PLAYBOOK — EXACT DAY-BY-DAY TABLE FOR WEEK ${weekNum} ONLY (MANDATORY)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Follow this verbatim, one step per day. Do not combine, skip, or reorder steps. Do not invent a DSA topic on a day marked NONE.

${table}

CONTENT QUALITY RULES (a third person with NO prior knowledge must be able to follow):
1. Break the problem statement into Empathy + Research + Technical + Guide for EVERY day.
2. Name the TECH STACK pieces the student must use today and split the work into 2–3 named SUB-TOPICS.
3. "learn" must be NEW learning for that day — do not repeat the same explanation from a previous day.
4. Coding practice must use a DIFFERENT platform/problem each day (see rotation below). Never recycle "Two Sum" / "Solve Me First".
5. "implement" must be a concrete beginner checklist (open X → write Y → done when Z).
6. End-of-day reflection is a mini retrospective (DONE / LEARNED / STUCK) — do NOT write a separate "wrap-up".

CODING ROTATION FOR THIS WEEK:
${codingHints}

Return ONLY valid JSON — no markdown, no trailing commas, no commentary:
{
  "dailySchedule": [
    {
      "day": ${dayNumbers[0]},
      "week": ${weekNum},
      "dtPhase": "Empathize & Define",
      "dtPlaybookActivity": "specific to THIS project, elaborating the day's step",
      "learn": "NEW concept for today, broken into 2-3 named sub-topics",
      "dsaOfTheDay": "None — ... OR the DSA concept with a NEW named practice problem",
      "implement": "concrete 2-hour beginner checklist for THIS project using the tech stack",
      "reflection": "DONE / LEARNED / STUCK prompts specific to this day",
      "techStackToday": "which stack layers to touch today",
      "problemBreakdown": {
        "empathyNote": "who hurts, what they feel, failed workaround — tied to THIS problem",
        "researchNote": "1 known + 1 unknown + 1 search/competitor action",
        "technicalNote": "exact files/modules + sub-topics using the tech stack",
        "guideNote": "You are done when: [testable criterion]",
        "codingPractice": {
          "platform": "HackerRank",
          "problemName": "Compare the Triplets",
          "alternativeChoices": ["Diagonal Difference", "Plus Minus"],
          "difficulty": "Easy",
          "whyThisProblem": "why this NEW problem fits today's learning"
        }
      }
    }
  ]
}
dailySchedule must have EXACTLY ${dayNumbers.length} entries, for days ${dayNumbers.join(', ')}, each with "week": ${weekNum}.
Every day MUST include problemBreakdown with all four notes + codingPractice with a UNIQUE problemName.
`.trim();

  const raw = await callLLM(prompt, 4096);
  const days = Array.isArray(raw?.dailySchedule) ? raw.dailySchedule : [];
  if (days.length !== dayNumbers.length) {
    throw new Error(`Week ${weekNum}: AI returned ${days.length}/${dayNumbers.length} days`);
  }
  return days;
}

// Generates and returns a dailySchedule array (does NOT save it — caller persists).
async function generateDailyScheduleForStatement(statement) {
  const totalWeeks = parseTotalWeeks(statement);
  const totalDays = totalWeeks * 5;
  const phaseLabels = activePhaseLabels(statement);
  const flatDTSteps = flattenSteps(phaseLabels);

  const weekChunks = Array.from({ length: totalWeeks }, (_, w) => {
    const weekNum = w + 1;
    const dayNumbers = [1, 2, 3, 4, 5].map(d => w * 5 + d).filter(d => d <= totalDays);
    return { weekNum, dayNumbers };
  });

  const generateOneWeek = async ({ weekNum, dayNumbers }) => {
    try {
      return await generateWeekChunk(statement, weekNum, dayNumbers, flatDTSteps);
    } catch (err) {
      // one retry per week — cheap, since each call is small
      return generateWeekChunk(statement, weekNum, dayNumbers, flatDTSteps);
    }
  };

  const weekResults = await Promise.all(weekChunks.map(generateOneWeek));
  const schedule = weekResults.flat();

  if (schedule.length !== totalDays) {
    throw new Error(`AI generated ${schedule.length}/${totalDays} days across ${totalWeeks} week(s) — please try again.`);
  }
  return schedule;
}

module.exports = { generateDailyScheduleForStatement };
