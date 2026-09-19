const axios = require("axios");

// ── LLM caller ────────────────────────────────────────────────────────────────
async function callLLM(prompt, maxTokens = 2000) {
  const response = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      model:       "openai/gpt-4o-mini",
      messages:    [{ role: "user", content: prompt }],
      temperature: 0.4,
      max_tokens:  maxTokens,
    },
    {
      headers: {
        Authorization: "Bearer " + process.env.OPENROUTER_API_KEY,
        "Content-Type": "application/json",
      },
    }
  );
  const raw = response.data.choices?.[0]?.message?.content || "";
  return raw.replace(/```json\s*/gi, "").replace(/```\s*$/gi, "").trim();
}

// ── Safe JSON parser: strips markdown fences, fixes trailing commas ───────────
function safeParseJSON(raw) {
  let text = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*$/gi, "")
    .trim();

  // Remove trailing commas before } or ]
  text = text.replace(/,\s*([}\]])/g, "$1");

  try {
    return JSON.parse(text);
  } catch (e) {
    // Last resort: find the first { ... } block
    const start = text.indexOf("{");
    const end   = text.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch (_) {}
    }
    throw new Error("JSON parse failed: " + e.message + "\nRaw: " + text.slice(0, 300));
  }
}

// ── Lecture Notes + Activity + Worksheet + Assessment generator ───────────────
async function generateLectureContent({ subject, topic, syllabusText, blueprint, type }) {
  const blueprintHint = blueprint
    ? `\nExam Blueprint:\nPart A: ${blueprint.pattern?.partA?.count} ${blueprint.pattern?.partA?.type} (${blueprint.pattern?.partA?.marks} marks each)\nPart B: ${blueprint.pattern?.partB?.count} ${blueprint.pattern?.partB?.type} (${blueprint.pattern?.partB?.marks} marks each)\nPart C: ${blueprint.pattern?.partC?.count} ${blueprint.pattern?.partC?.type} (${blueprint.pattern?.partC?.marks} marks each)`
    : "";

  const syllabusSample = syllabusText && syllabusText.trim()
    ? `\nSyllabus content (for reference):\n${syllabusText.slice(0, 2000)}`
    : "\n⚠️ No syllabus provided – generate general but detailed content based on standard curriculum.\n";

  const generateParts = [];
  if (type === "all" || type === "notes")      generateParts.push("lectureNotes");
  if (type === "all" || type === "activity")   generateParts.push("activity");
  if (type === "all" || type === "worksheet")  generateParts.push("worksheet");
  if (type === "all" || type === "assessment") generateParts.push("assessment");

  const prompt = `You are an expert academic content creator for engineering colleges.

Subject: ${subject}
Topic: ${topic}
${syllabusSample}
${blueprintHint}

Generate the following for this specific topic (NOT generic — derive everything from the syllabus above):

${generateParts.includes("lectureNotes") ? `
LECTURE NOTES:
- Clear explanation of the core concept (3-5 sentences)
- Key definitions (2-3)
- Important formula or rule with example
- Step-by-step worked example
- Common mistakes students make
- Connection to real-world application` : ""}

${generateParts.includes("activity") ? `
CLASSROOM ACTIVITY:
- Activity name and objective
- Duration (minutes)
- Step-by-step instructions for students
- Materials needed
- Expected learning outcome
- How to evaluate (rubric: 3 criteria)` : ""}

${generateParts.includes("worksheet") ? `
WORKSHEET (student practice):
- 3 short-answer questions (increasing difficulty), each with a model answer
- 1 problem-solving question with steps and a worked answer
- 1 application/real-world question with a model answer
- Answer hints (not full answers)` : ""}

${generateParts.includes("assessment") ? `
ASSESSMENT / QUIZ:
- 3 MCQ questions with 4 options each (mark correct answer index as "correct": 0-3)
- 2 short-answer questions (2-mark each), each with a model answer
- 1 long-answer question matching exam blueprint pattern, with a model answer
- Marking scheme` : ""}

Return ONLY valid JSON with NO trailing commas:
{
  "subject": "${subject}",
  "topic": "${topic}"${generateParts.includes("lectureNotes") ? `,
  "lectureNotes": {
    "explanation": "",
    "definitions": [],
    "formula": "",
    "workedExample": "",
    "commonMistakes": [],
    "realWorldApplication": ""
  }` : ""}${generateParts.includes("activity") ? `,
  "activity": {
    "name": "",
    "objective": "",
    "duration": 0,
    "instructions": [],
    "materials": [],
    "learningOutcome": "",
    "rubric": []
  }` : ""}${generateParts.includes("worksheet") ? `,
  "worksheet": {
    "shortAnswerQuestions": [{ "question": "", "answer": "" }],
    "problemSolving": { "question": "", "answer": "" },
    "applicationQuestion": { "question": "", "answer": "" },
    "hints": []
  }` : ""}${generateParts.includes("assessment") ? `,
  "assessment": {
    "mcq": [],
    "shortAnswer": [{ "question": "", "answer": "" }],
    "longAnswer": { "question": "", "answer": "" },
    "markingScheme": ""
  }` : ""}
}`;

  try {
    const raw    = await callLLM(prompt, 3000);
    return safeParseJSON(raw);
  } catch (err) {
    throw new Error("AI content generation failed: " + err.message);
  }
}

// ── Faculty Assistant activity generator ──────────────────────────────────────
// Split into two LLM calls so neither exceeds token limits:
//   Call 1 → steps (with facultyNotes) + worksheet (with answers) + rubric + meta
//   Call 2 → differentiated instruction (3 tiers)
// Results are merged before returning.
// ─────────────────────────────────────────────────────────────────────────────
async function generateFacultyActivity({ subject, topic, duration, learningOutcome, syllabusText }) {
  const syllabusSample = syllabusText
    ? `\nSyllabus (reference):\n${syllabusText.slice(0, 1500)}`
    : "";

  const context = `Subject: ${subject}
Topic: ${topic}
Duration: ${duration} minutes
${learningOutcome ? `Desired learning outcome: ${learningOutcome}` : ""}
${syllabusSample}`;

  // ── CALL 1: Core activity — steps with faculty notes + worksheet with answers ──
  const prompt1 = `You are an experienced engineering college faculty assistant.

${context}

Generate a detailed classroom activity plan for this topic. Return ONLY valid JSON, no markdown, no trailing commas.

RULES:
- "steps" must have 4-6 steps that fill exactly ${duration} minutes total.
- Each step MUST include "facultyNotes" with:
    • "conceptToExplain": full paragraph of the theory/concept to deliver at this step — enough that an unprepared faculty member can speak from it directly.
    • "keyPointsToEmphasize": array of 3-5 bullet strings to stress verbally.
    • "boardWork": what to write/draw on the board (formulas, diagrams, tables).
    • "analogyOrExample": a concrete real-world analogy or worked example.
    • "anticipatedQuestions": array of {question, answer} objects for likely student questions.
    • "transitionToNext": a sentence the faculty says to move to the next step.
- "worksheet" questions MUST include "modelAnswer" and "gradingHints" for every question.
- "practiceProblems" MUST include "solution" and "stepByStepSolution" (array of strings).

{
  "subject": "${subject}",
  "topic": "${topic}",
  "activity": {
    "title": "",
    "type": "",
    "duration": ${duration},
    "objective": "",
    "prerequisites": [],
    "steps": [
      {
        "step": 1,
        "time": "",
        "instruction": "",
        "facultyRole": "",
        "studentRole": "",
        "facultyNotes": {
          "conceptToExplain": "",
          "keyPointsToEmphasize": [],
          "boardWork": "",
          "analogyOrExample": "",
          "anticipatedQuestions": [
            { "question": "", "answer": "" }
          ],
          "transitionToNext": ""
        }
      }
    ],
    "materials": [],
    "learningOutcome": "",
    "assessmentRubric": [
      { "criterion": "", "excellent": "", "satisfactory": "", "needsWork": "" }
    ],
    "worksheet": {
      "questions": [
        {
          "questionNumber": 1,
          "question": "",
          "type": "",
          "marks": 0,
          "modelAnswer": "",
          "gradingHints": ""
        }
      ],
      "practiceProblems": [
        {
          "problem": "",
          "solution": "",
          "stepByStepSolution": []
        }
      ]
    }
  }
}`;

  // ── CALL 2: Differentiated instruction — 3 learner tiers ──────────────────
  const prompt2 = `You are an experienced engineering college faculty assistant.

${context}

Generate ONLY the differentiatedInstruction section for this topic's classroom activity.
Return ONLY valid JSON, no markdown, no trailing commas.

Three tiers required:
1. emergingLearners  — students below expected level / struggling with prerequisites
2. gradeLevelLearners — students meeting expected outcomes for this topic
3. advancedLearners  — students who grasp concepts quickly and need enrichment

{
  "differentiatedInstruction": {
    "emergingLearners": {
      "description": "Students who are below expected level or struggling with foundational concepts",
      "modifications": [],
      "scaffoldingStrategies": [],
      "simplifiedTasks": [],
      "additionalSupport": ""
    },
    "gradeLevelLearners": {
      "description": "Students meeting expected learning outcomes for this topic",
      "coreActivities": [],
      "reinforcementStrategies": [],
      "checkForUnderstanding": ""
    },
    "advancedLearners": {
      "description": "Students who demonstrate mastery quickly and need enrichment",
      "extensionTasks": [],
      "higherOrderQuestions": [],
      "connectionToAdvancedTopics": "",
      "leadershipOpportunities": ""
    }
  }
}`;

  try {
    // Run both calls in parallel
    const [raw1, raw2] = await Promise.all([
      callLLM(prompt1, 4000),
      callLLM(prompt2, 1500),
    ]);

    const part1 = safeParseJSON(raw1);
    const part2 = safeParseJSON(raw2);

    // Merge differentiated instruction into the activity object
    part1.activity.differentiatedInstruction = part2.differentiatedInstruction;

    return part1;
  } catch (err) {
    throw new Error("Faculty activity generation failed: " + err.message);
  }
}

module.exports = { generateLectureContent, generateFacultyActivity };