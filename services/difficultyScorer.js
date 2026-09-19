const axios = require("axios");

async function detectDifficulty(subjects) {
  // subjects = [{ name, syllabusText }]
  const subjectDescriptions = subjects.map((s, i) =>
    `${i + 1}. Subject: ${s.name}\nSyllabus/Content: ${(s.syllabusText || "").slice(0, 800)}`
  ).join("\n\n");

  const prompt = `You are an expert academic difficulty assessor.

Analyze the following subjects based on their syllabus content and assign a difficulty score.

${subjectDescriptions}

Score each subject on a scale of 1-10:
- 1-3: Easy (simple recall, basic concepts, language/soft skills)
- 4-6: Medium (application, moderate computation, problem solving)
- 7-10: Hard (complex algorithms, heavy math, abstract concepts, multi-step problems)

Return ONLY valid JSON:
{
  "subjects": [
    {
      "name": "<subject name>",
      "score": <1-10 numeric>,
      "label": "Easy|Medium|Hard",
      "reason": "<one sentence why this difficulty>"
    }
  ]
}`;

  try {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
         model:"openai/gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 1000,
      },
      {
        headers: {
          Authorization: "Bearer " + process.env.OPENROUTER_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    const raw     = response.data.choices?.[0]?.message?.content || "";
    const cleaned = raw.replace(/```json\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed  = JSON.parse(cleaned);
    return parsed.subjects || subjects.map(s => ({ name: s.name, score: 5, label: "Medium", reason: "Default" }));
  } catch (err) {
    console.error("Difficulty detection failed:", err.message);
    // Fallback: return Medium for all
    return subjects.map(s => ({ name: s.name, score: 5, label: "Medium", reason: "Auto-detection failed" }));
  }
}

// ── Compatibility score between two difficulty labels ─────────────────────────
const COMPATIBILITY_TABLE = {
  "Hard-Hard":     0,
  "Hard-Medium":   3,
  "Hard-Easy":     10,
  "Medium-Medium": 8,
  "Medium-Easy":   9,
  "Easy-Easy":     10,
};

function compatibility(labelA, labelB) {
  const key1 = `${labelA}-${labelB}`;
  const key2 = `${labelB}-${labelA}`;
  return COMPATIBILITY_TABLE[key1] ?? COMPATIBILITY_TABLE[key2] ?? 5;
}

// ── Difficulty-aware IA exam scheduler ────────────────────────────────────────
// Follows the spec's exact algorithm:
//   Priority 1: One subject per day, in the GIVEN order (not re-sorted) —
//               "keep existing schedule unchanged" when subjects fit the days.
//   Priority 2: If subjects > days, the overflow subjects are placed into the
//               AN slot of whichever day has the highest compatibility score,
//               checking days in order (Day1, Day2, Day3...) the way the
//               spec's worked example walks through "Check Day1, Hard already? Yes...".
//   Priority 3: Hard+Hard is avoided unless there's truly no other option.
const DEFAULT_RULES = {
  maxHardPerDay:      1,
  maxSubjectsPerDay:  2,
  allowHardWithEasy:  true,
  allowHardWithHard:  false,
};

function buildDifficultyAwareSchedule(subjects, examDays, userConstraints = {}) {
  const RULES = { ...DEFAULT_RULES, ...userConstraints };

  // Priority 1 — Fixed FN allocation: subjects keep their given order, one per day.
  // This matches the spec's example exactly:
  //   Day1 FN Maths, Day2 FN Physics, Day3 FN Chemistry, Day4 FN English
  const schedule = Array.from({ length: examDays }, (_, i) => ({
    day: i + 1,
    label: `Day ${i + 1}`,
    slots: { FN: null, AN: null },
  }));

  const firstBatch = subjects.slice(0, examDays);
  const overflow    = subjects.slice(examDays); // Priority 2 candidates (e.g. Python, DSA)

  firstBatch.forEach((subj, i) => { schedule[i].slots.FN = subj; });

  // Priority 2 — Place overflow subjects one at a time into the best AN slot.
  // For each overflow subject, walk the days IN ORDER (Day1 → Day2 → ...) and
  // pick the day with the highest compatibility score against its FN subject,
  // exactly like the spec's "Check Day1...Check Day2...Check Day3...Check Day4" trace.
  for (const subj of overflow) {
    let bestDay = null;
    let bestScore = -1;

    for (const day of schedule) {
      if (day.slots.AN) continue; // AN slot already taken — move to next day
      const fnSubj = day.slots.FN;
      if (!fnSubj) { bestDay = day; bestScore = 99; break; } // empty FN, e.g. extra exam days
      const score = compatibility(fnSubj.label || "Medium", subj.label || "Medium");
      const wouldBeHardHard = fnSubj.label === "Hard" && subj.label === "Hard";

      // Priority 3 — skip Hard+Hard unless it's the only option left
      if (wouldBeHardHard && !RULES.allowHardWithHard) continue;

      if (score > bestScore) { bestScore = score; bestDay = day; }
    }

    if (bestDay) {
      bestDay.slots.AN = subj;
    } else {
      // No day satisfies Priority 3 — Priority 2 fallback: allow Hard+Hard only now
      const fallbackDay = schedule.find(d => !d.slots.AN);
      if (fallbackDay) {
        fallbackDay.slots.AN = subj;
      } else {
        // All days have both FN+AN filled — extend with a new exam day
        const extra = { day: schedule.length + 1, label: `Day ${schedule.length + 1}`, slots: { FN: subj, AN: null } };
        schedule.push(extra);
      }
    }
  }

  // Build readable output
  const result = schedule.map(d => ({
    day:          d.label,
    FN:           d.slots.FN ? { name: d.slots.FN.name, difficulty: d.slots.FN.label || "Medium", score: d.slots.FN.score || 5 } : null,
    AN:           d.slots.AN ? { name: d.slots.AN.name, difficulty: d.slots.AN.label || "Medium", score: d.slots.AN.score || 5 } : null,
    compatibility: d.slots.FN && d.slots.AN ? compatibility(d.slots.FN.label || "Medium", d.slots.AN.label || "Medium") : null,
    warning:       d.slots.FN?.label === "Hard" && d.slots.AN?.label === "Hard" ? "⚠️ Hard+Hard combination" : null,
  }));

  return {
    schedule: result,
    rules:    RULES,
    summary:  `${subjects.length} subjects scheduled across ${result.length} exam days (${firstBatch.length} fixed FN, ${overflow.length} overflow placed by compatibility)`,
  };
}

module.exports = { detectDifficulty, buildDifficultyAwareSchedule, compatibility };
