const { callLLM } = require("../utils/llm");

const DT_PHASE_DETAILS = {
  "Empathize & Define": "conduct user research, create personas, define opportunity/problem using empathy maps and problem statements",
  "Plan": "design user actions, app state, feature selection, inclusion/accessibility considerations, UI/UX wireframes",
  "Prototype": "sketch screens, create storyboard, refine app behavior, design style guide, build interactive Figma prototype",
  "Evaluate": "app pitch to peers, user testing observation, post-testing interview, gather feedback and iterate",
  "Pitch & BMC": "Business Model Canvas analysis, customer sales pitch, pitch deck for mentors/industry/alumni",
};

function parseTotalWeeks(timeline) {
  const match = String(timeline || "").match(/(\d+)/);
  const weeks = match ? parseInt(match[1], 10) : 4;
  return Math.min(Math.max(weeks, 1), 12); // sane bounds
}

/**
 * Generates and returns a dailySchedule array for a problem statement that
 * doesn't have one yet. Does NOT save it — caller decides when to persist.
 * Throws if the LLM can't produce a valid schedule.
 */
async function backfillDailySchedule(ps) {
  const totalWeeks = parseTotalWeeks(ps.timeline);
  const totalDays = totalWeeks * 5;
  const phases = ps.dtPhases?.length ? ps.dtPhases : Object.keys(DT_PHASE_DETAILS);
  const phaseBlock = phases.map(p => `- ${p}: ${DT_PHASE_DETAILS[p] || p}`).join("\n");

  const prompt = `
You are a mentor at SNS Innovation Hub. A student project already exists with this brief:

TITLE: ${ps.title}
DESCRIPTION: ${ps.description}
OBJECTIVES: ${(ps.objectives || []).join("; ") || "N/A"}
DIFFICULTY: ${ps.difficulty || "intermediate"}
TOTAL DURATION: ${totalWeeks} week(s), ${totalDays} working days (5 days/week)

DESIGN THINKING PHASES TO COVER, IN ORDER, SPREAD EVENLY ACROSS THE ${totalDays} DAYS:
${phaseBlock}

Produce a day-by-day schedule for this EXACT project (use the title/description above — don't invent a new project).

Return ONLY valid JSON — no markdown, no trailing commas:
{
  "dailySchedule": [
    {
      "day": 1,
      "week": 1,
      "dtPhase": "Empathize & Define",
      "dtPlaybookActivity": "Specific activity for day 1 of THIS project",
      "learn": "What to learn today",
      "dsaOfTheDay": "None — or a specific concept if applicable",
      "implement": "A concrete 2-hour task for a ${ps.difficulty || "intermediate"} student, specific to this project",
      "reflection": "A reflection question for today"
    }
  ]
}

IMPORTANT:
- dailySchedule must have EXACTLY ${totalDays} entries
- One DT step focus per day — no bundling multiple phases into one day
- Every day must be different — different activity, different output
- Everything must be specific to the project described above, not generic
`.trim();

  const attempt = async () => {
    const raw = await callLLM(prompt, 4096);
    return Array.isArray(raw?.dailySchedule) ? raw.dailySchedule : [];
  };

  let schedule = await attempt();
  if (schedule.length !== totalDays) {
    schedule = await attempt(); // one retry
  }

  if (!schedule.length) {
    throw new Error(
      "Couldn't generate a day-by-day schedule for this problem statement right now. Please try again."
    );
  }

  return schedule;
}

module.exports = { backfillDailySchedule };
