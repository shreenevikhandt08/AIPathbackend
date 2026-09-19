const path     = require("path");
const fs       = require("fs");
const multer   = require("multer");
const pdfParse = require("pdf-parse");
const mammoth  = require("mammoth");
const XLSX     = require("xlsx");
const jwt      = require("jsonwebtoken");

const Subject          = require("../models/Subject");
const { callLLM }      = require("../utils/llm");
const { buildFullCalendar, toDisplayDate, abbrevSubject } = require("../utils/calendarUtils");
const { generateDailyPlan, polishDailyPlan } = require("../utils/dailyPlanGenerator");
const { enrichMissingDsaSd } = require("../utils/enrichDsaSdFromProblem");

const JWT_SECRET = process.env.JWT_SECRET || "academic_planner_secret_key";

const FALLBACK_TOTAL_WEEKS = 13; // last-resort only, when there's no numDays and no calendar at all
const DAY_NAMES   = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Exam config resolution ──────────────────────────────────────────────────
// IA/AU/Mock exam weeks are OPT-IN: they only exist if the user explicitly
// built a calendar with exam dates (calendarMeta present with iaWeekNums /
// auWeekNums). Previously this fell back to hardcoded weeks [4,8,10]/12/13 —
// a fixed college-semester assumption — any time calendarMeta was missing,
// which silently injected fake exam days into every plan.
function resolveExamConfig(calendarMeta) {
  const iaWeekSet = calendarMeta?.iaWeekNums?.length ? new Set(calendarMeta.iaWeekNums) : new Set();
  const auWeekSet = calendarMeta?.auWeekNums?.length ? new Set(calendarMeta.auWeekNums) : new Set();
  const mockWeekNum = calendarMeta?.mockWeekNum ?? null;
  return { iaWeekSet, auWeekSet, mockWeekNum, examsEnabled: iaWeekSet.size > 0 || auWeekSet.size > 0 };
}

// ── File upload ───────────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// ── Business logic ────────────────────────────────────────────────────────────
async function extractText(filePathOrBuffer, filename) {
  const ext = path.extname(filename).toLowerCase();
  const buf = Buffer.isBuffer(filePathOrBuffer)
    ? filePathOrBuffer
    : fs.readFileSync(filePathOrBuffer);
  try {
    if (ext === ".pdf")  { const d = await pdfParse(buf); return d.text; }
    if (ext === ".docx" || ext === ".doc") { const r = await mammoth.extractRawText({ buffer: buf }); return r.value; }
    if (ext === ".txt"  || ext === ".csv") return buf.toString("utf8");
    if (ext === ".xlsx" || ext === ".xls") {
      const wb = XLSX.read(buf, { type: "buffer" });
      return wb.SheetNames.map((name) => {
        const sheet = wb.Sheets[name];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        return `--- Sheet: ${name} ---\n${csv}`;
      }).join("\n\n");
    }
    if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"].includes(ext)) {
      // No OCR in this stack — keep a clear marker so the LLM knows evidence was attached
      return `[Image attached: ${filename}] Visual profile / evidence uploaded. Use any accompanying typed notes; treat this as supporting proof of skills/goals.`;
    }
    return "[Unsupported: " + filename + "]";
  } catch (e) { return "[Error: " + e.message + "]"; }
}

// ── Step 1 (DSA/DT Playbook mode) ────────────────────────────────────────────
// The generic extractSubjects() below is built for traditional college
// syllabi and asks the LLM to find "distinct subjects being taught" — when
// fed a DSA topic list (e.g. "Arrays, Dynamic Programming, Graph Theory..."),
// it was splitting EACH topic into its own fake "subject" (hence logs like
// "Extracted 6 subjects" for a single DSA syllabus). In DSA/DT mode there
// are really only ever 1-2 actual subjects — DSA, and System Design if the
// user provided one — each broken into real, named weekly subtopics.
async function extractDSASubjects(dsaSyllabus, systemDesign, totalWeeks = FALLBACK_TOTAL_WEEKS, opts = {}) {
  const skipDsa = opts.skipDsa === true;
  const skipSd = opts.skipSd === true;
  const parts = [];
  if (!skipDsa && dsaSyllabus) parts.push({ name: "Data Structures & Algorithms", content: dsaSyllabus });
  if (!skipSd && systemDesign) parts.push({ name: "System Design", content: systemDesign });

  if (parts.length === 0) {
    // Only stub subjects that are still enabled — never re-add toggled-off DSA/SD
    if (!skipDsa) {
      parts.push({
        name: "Data Structures & Algorithms",
        content: "Arrays, Hash Maps, Trees, Graphs, Sorting, Searching — map each topic to the project feature of the week.",
      });
    }
    if (!skipSd) {
      parts.push({
        name: "System Design",
        content: "Requirements, architecture, data model, APIs, auth, caching — grounded in the project statement.",
      });
    }
    // Both off — return empty; caller may still have supporting college subjects
    if (parts.length === 0) return [];
  }

  const prompt = `
You are an expert curriculum planner. Below are one or two subject syllabi.
DO NOT split a syllabus into multiple subjects — each block below is EXACTLY ONE subject.
Your only job is to break EACH subject's content into exactly ${totalWeeks} weekly units/subtopics,
using the REAL subtopic names present in (or clearly implied by) the content — ordered from
foundational to advanced. Do not invent topics unrelated to the given content, and do not use
vague generic phase labels like "Introduction & Theory" as a whole unit — name the actual concept
(e.g. "Arrays & Two-Pointer Technique", "Binary Search Trees", "Dijkstra's Algorithm").

${parts.map((p, i) => `SUBJECT ${i + 1} NAME: "${p.name}"\nSUBJECT ${i + 1} CONTENT:\n${p.content.slice(0, 3000)}`).join("\n\n")}

Return ONLY valid JSON (no markdown, no explanation):
{
  "subjects": [
    { "name": "<exact subject name given above>", "units": ["<Week 1 subtopic>", "<Week 2 subtopic>", ... exactly ${totalWeeks} entries] }
  ]
}

Rules:
- Return EXACTLY ${parts.length} subject${parts.length > 1 ? "s" : ""} — one per block above, same names.
- Each subject MUST have exactly ${totalWeeks} "units" entries.
- Units must be specific, real subtopic names — not phase labels, not repeated text.
`;

  const result = await callLLM(prompt, 3500);

  if (result && Array.isArray(result.subjects) && result.subjects.length > 0) {
    result.subjects.forEach((s) => {
      if (!Array.isArray(s.units)) s.units = [];
      while (s.units.length < totalWeeks) {
        const last = s.units[s.units.length - 1] || (s.name + " — Advanced Topics");
        s.units.push(last + " (continued)");
      }
      s.units = s.units.slice(0, totalWeeks);
    });
    console.log(`✅ DSA Mode: extracted ${result.subjects.length} subject(s) — ${result.subjects.map(s => s.name).join(", ")}`);
    result.subjects.forEach(s => console.log(`   • ${s.name} weekly subtopics: ${s.units.join(" | ")}`));
    return result.subjects;
  }

  throw new Error("DSA subject extraction failed: LLM returned no usable subjects");
}

// ── LLM Call — robust JSON extraction ────────────────────────────────────────
async function extractSubjects(syllabusText, programDescription, totalWeeks = FALLBACK_TOTAL_WEEKS) {
  const contextHint = syllabusText
    ? "Syllabus content:\n" + syllabusText
    : "Program description:\n" + (programDescription || "General academic bootcamp");

  const prompt = `
You are an expert academic curriculum analyst.

Analyze the content below and extract the DISTINCT SUBJECTS being taught.

${contextHint}

For EACH subject, break its syllabus into exactly ${totalWeeks} UNITS/TOPICS — one unit
per week of a ${totalWeeks}-week program — ordered from foundational to advanced, fully
derived from the content (do not invent unrelated topics).

Return ONLY valid JSON (no markdown, no explanation):
{
  "subjects": [
    {
      "name": "<subject name>",
      "units": [
        "<Week 1 topic/unit name>",
        "<Week 2 topic/unit name>",
        ... exactly ${totalWeeks} entries, one per week
      ]
    }
  ]
}

Rules:
- Identify between 3 and 8 subjects total.
- Each subject MUST have exactly ${totalWeeks} "units" entries.
- Units should be SPECIFIC topic/concept names with enough detail that a teacher can teach them in one week (prefer "Binary Search — iterative + recursive + complexity", not just "Searching").
- For each unit, prefer concrete syllabus language from the upload when available.
- Do not repeat the same unit text across weeks for a subject.
`;

  const result = await callLLM(prompt, 4000);

  if (result && Array.isArray(result.subjects) && result.subjects.length > 0) {
    result.subjects.forEach((s) => {
      if (!Array.isArray(s.units)) s.units = [];
      while (s.units.length < totalWeeks) {
        const last = s.units[s.units.length - 1] || (s.name + " — Advanced Topics");
        s.units.push(last + " (continued)");
      }
      s.units = s.units.slice(0, totalWeeks);
    });
    console.log("✅ Extracted " + result.subjects.length + " subjects from syllabus");
    return result.subjects;
  }

  throw new Error("Subject extraction failed: LLM returned no usable subjects");
}

// ── Step 2: Build per-week themes with cumulative knowledge enforcement ───────
//
// KEY PRINCIPLE: The project milestone for Week N can ONLY use concepts that
// have been taught in Weeks 1..N. The LLM receives a running "knowledge ledger"
// that grows each week, so it cannot invent auth, databases, APIs, etc. before
// those subjects have actually been taught.
//
async function generateWeekThemes(subjects, syllabusText, programDescription, totalWeeks = FALLBACK_TOTAL_WEEKS) {
  // Build the per-week subject→topic mapping
  const subjectWeekLines = [];
  for (let w = 0; w < totalWeeks; w++) {
    const line = subjects
      .map((s) => {
        const tag =
          s.sentiment === "like" ? " [LIKED]" : s.sentiment === "dislike" ? " [DISLIKED]" : "";
        return `${s.name}${tag}: ${s.units[w]}`;
      })
      .join(" | ");
    subjectWeekLines.push("Week " + (w + 1) + " -> " + line);
  }

  // Build a cumulative knowledge table so the LLM sees exactly what is known by each week
  // Format:  "By end of Week N, students know: SubjA topics 1..N, SubjB topics 1..N, ..."
  const cumulativeKnowledgeLines = [];
  for (let w = 0; w < totalWeeks; w++) {
    const knownTopics = subjects.map((s) => {
      const learned = s.units.slice(0, w + 1).join(", ");
      return s.name + " [" + learned + "]";
    }).join(" | ");
    cumulativeKnowledgeLines.push("End of Week " + (w + 1) + ": " + knownTopics);
  }

  const contextHint = syllabusText
    ? "Syllabus / program content:\n" + syllabusText.slice(0, 3000)
    : "Program description:\n" + (programDescription || "General academic bootcamp");

  const projectHint = programDescription
    ? "\n━━━ THE ACTUAL PROJECT (verbatim from the user) ━━━\n" + programDescription.slice(0, 1500) +
      "\n━━━ END PROJECT STATEMENT ━━━\n" +
      "The 'project', 'projectTask', 'dsa', and 'systemDesign' fields you generate below MUST reuse " +
      "this problem statement's actual domain name, entities, processes, and terminology in your own " +
      "words — do not invent a generic or unrelated project. If the statement names specific things " +
      "(a company, a process, a role, a machine, a workflow step), use those exact names, not a " +
      "generic stand-in.\n"
    : "";

  const prompt = `
You are an expert academic planner designing a ${totalWeeks}-week project-integrated curriculum.

${contextHint}
${projectHint}

━━━ WEEK-BY-WEEK SUBJECT TOPICS (fixed — do not change) ━━━
${subjectWeekLines.join("\n")}

━━━ CUMULATIVE KNOWLEDGE LEDGER ━━━
This shows EXACTLY what students know by the END of each week.
The project milestone for Week N MUST use ONLY concepts listed under "End of Week N" below.
Do NOT reference any technology, concept, or library that is NOT in the ledger for that week.

${cumulativeKnowledgeLines.join("\n")}

━━━ YOUR TASK ━━━
For EACH of the ${totalWeeks} weeks, generate:
  1. dsa        — A DSA topic that can be taught using ONLY concepts known by that week
  2. systemDesign — A system design concept explainable with ONLY concepts known by that week,
       framed using an actual entity/process from the project statement above where possible
       (e.g. "queues" explained via the project's own workflow, not a generic example)
  3. project    — The project milestone for that week. STRICT RULES:
       • The milestone must be a specific, buildable feature of the project domain above — name
         the actual entity/process/screen from the problem statement it builds, not a generic label
       • It must use ONLY the subjects and topics listed in "End of Week N" in the ledger
       • It must NOT assume any tool/technology/concept not yet taught
       • It must build INCREMENTALLY on the previous week's milestone (Week 1 is the foundation)
       • Name the specific thing built: e.g. "CLI menu using switch-case from Week 1 Programming fundamentals"
         NOT generic: "Build login module" (impossible if auth was never taught)
       • Coding language is ANY language the team chose (Python / Java / JS / C / C++ / Go / etc.) —
         NEVER force C or any single language unless the week's tech ledger already chose it
       • For very early weeks (weeks 1-3) when only foundational subjects are taught,
         the milestone should be a simple program/document/diagram that directly applies
         that week's subject topics — even if it seems basic
  4. projectTask — The SPECIFIC coding/implementation task for a single day this week.
       Same rules as project — must only use known concepts, and must name the actual
       entity/process from the problem statement, not a generic placeholder.
       Be concrete and language-agnostic: "Write a function that reads 3 menu items from the user
       and prints them back — apply today's Programming topic: Variables & I/O
       (use the team's chosen language from the Empathy tech-stack decision)"
  5. tech       — Tools/technologies students can USE this week (only from what is taught so far,
       plus the tech stack decided in Empathy). Never invent a forced language like "C only".

Return ONLY valid JSON (no markdown, no explanation):
{
  "weeks": [
    {
      "week": 1,
      "days": "Day 1-5",
      "dsa": "<DSA topic using only known concepts>",
      "systemDesign": "<system design concept using only known concepts>",
      "project": "<specific milestone using only this week's cumulative knowledge>",
      "projectTask": "<specific single-day coding task — names the exact concept applied>",
      "tech": "<tools/tech available this week only>"
    }
  ]
}

CRITICAL RULES:
- Exactly ${totalWeeks} week objects, weeks numbered 1 to ${totalWeeks}.
- Do NOT use: databases, APIs, authentication, web frameworks, React, Node.js, SQL
  UNLESS those subjects appear in the cumulative knowledge ledger for that week.
- Project milestones must form a logical incremental build:
  each week's output is the INPUT to next week's milestone.
- If Week 1 subjects are only foundational (e.g. Programming, Math, Communication) —
  the Week 1 milestone is a small terminal/CLI or docs artifact in the team's chosen
  language from Empathy Tech Stack Choice — never invent "C only" unless C was chosen.
- projectTask must be concrete enough that a beginner can open a text editor and start.${programDescription ? "\n- Every dsa/systemDesign/project/projectTask value must be traceable back to a real detail in the project statement above — if you catch yourself writing something that could apply to ANY project, rewrite it using this project's actual wording." : ""}
`;

  const result = await callLLM(prompt, 4000);

  let weeks;
  if (result && Array.isArray(result.weeks) && result.weeks.length >= totalWeeks) {
    weeks = result.weeks.slice(0, totalWeeks);
  } else if (result && Array.isArray(result.weeks) && result.weeks.length > 0) {
    console.warn("⚠️  Only " + result.weeks.length + " weeks returned — padding to " + totalWeeks);
    weeks = result.weeks;
    while (weeks.length < totalWeeks) {
      const last = weeks[weeks.length - 1];
      weeks.push({
        week:         weeks.length + 1,
        days:         "Day " + (weeks.length * 5 + 1) + "-" + (weeks.length * 5 + 5),
        dsa:          last.dsa,
        systemDesign: last.systemDesign,
        project:      "Extend and refine Week " + last.week + " deliverable",
        projectTask:  last.projectTask || "Continue implementing the Week " + last.week + " feature",
        tech:         last.tech,
      });
    }
  } else {
    throw new Error("Week theme generation failed: LLM returned no usable weeks");
  }

  // Build the cumulative knowledge string per week for downstream use
  const cumulativeByWeek = [];
  for (let w = 0; w < totalWeeks; w++) {
    const known = subjects.map((s) => {
      return s.name + ": " + s.units.slice(0, w + 1).join(", ");
    }).join(" | ");
    cumulativeByWeek.push(known);
  }

  return weeks.map((w, i) => ({
    week:             i + 1,
    days:             w.days || ("Day " + (i * 5 + 1) + "-" + (i * 5 + 5)),
    subjects:         subjects.map((s) => ({ name: s.name, topic: s.units[i] })),
    dsa:              w.dsa,
    systemDesign:     w.systemDesign,
    project:          w.project,
    projectTask:      w.projectTask || w.project,   // concrete daily task
    tech:             w.tech,
    cumulativeKnowledge: cumulativeByWeek[i],       // passed to daily prompt
  }));
}

// ── Step 3: Analyze question papers ──────────────────────────────────────────
async function analyzeQuestionPapers(questionsText, subjects) {
  if (!questionsText || !questionsText.trim()) return null;

  const subjectNames = subjects.map((s) => s.name).join(", ");

  const prompt = `
You are an expert exam-pattern analyst. Below is the RAW TEXT extracted from
multiple uploaded question papers (IA1, IA2, IA3, University Exams, PYQs, etc).

QUESTION PAPER TEXT:
${questionsText.slice(0, 12000)}

The course subjects are: ${subjectNames}

TASK:
1. For EACH subject, identify the topics/concepts that appear most frequently
   or carry the highest marks across these question papers.
2. Rank them by importance (most frequently asked / highest weightage first).
3. For each important topic, provide the EXACT question names or question patterns
   that have appeared — e.g. "Explain Dijkstra's algorithm with example (10 marks, asked 4 times)",
   "Write a C program to implement Binary Search Tree insertion and deletion (15 marks)".

Return ONLY valid JSON (no markdown, no explanation):
{
  "subjects": [
    {
      "name": "<subject name>",
      "importantTopics": [
        {
          "topic": "<specific topic/concept name>",
          "reason": "<short reason / frequency note>",
          "sampleQuestions": [
            "<Exact or near-exact question as it appeared in the paper — include marks if visible>",
            "<Another sample question from papers for this topic>"
          ]
        }
      ]
    }
  ]
}

Rules:
- Include 5-10 important topics per subject.
- For sampleQuestions: write them as they appeared (or close paraphrase). Include marks weightage if visible.
- Be SPECIFIC: "Explain Paging with a neat diagram (10 marks)" not just "Paging".
- If no questions found for a subject, return empty importantTopics array.
`;

  try {
    const result = await callLLM(prompt, 4000);
    if (result && Array.isArray(result.subjects)) {
      const map = {};
      result.subjects.forEach((s) => { map[s.name] = s.importantTopics || []; });
      console.log("✅ Question paper analysis complete for " + result.subjects.length + " subjects");
      return map;
    }
  } catch (e) {
    console.error("Question paper analysis failed:", e.message);
  }
  return null;
}

function getExamFocus(subjectName, weekTopic, examAnalysis) {
  const topics = examAnalysis?.[subjectName];
  if (topics && topics.length > 0) {
    const top = topics.slice(0, 3).map((t) => t.topic).join("; ");
    return weekTopic + " | PYQ Focus: " + top;
  }
  return weekTopic;
}

// ── Get detailed exam questions for weekly plan ───────────────────────────────
function getDetailedExamQuestions(subjectName, examAnalysis) {
  const topics = examAnalysis?.[subjectName];
  if (!topics || topics.length === 0) return null;
  return topics.slice(0, 5).map((t) => {
    const qs = (t.sampleQuestions || []).slice(0, 2).join(" | ");
    return t.topic + (qs ? " → " + qs : "") + " (" + (t.reason || "") + ")";
  }).join("\n    ");
}

// ── Distribute IA exams ───────────────────────────────────────────────────────
async function refineExistingPlan(existingPlan, userFeedback, module, opts = {}) {
  if (!existingPlan || !existingPlan.rows) throw new Error("No existing plan to refine");
  const surface =
    module === "weekly" ? "weekly" : module === "homework" ? "homework" : "daily";
  let lessonsBlock = "";
  try {
    const { recordFeedbackLessons, attachEngineLessons } = require("../utils/engineLessons");
    if (userFeedback && String(userFeedback).trim().length >= 8) {
      await recordFeedbackLessons(userFeedback, {
        surface,
        userId: opts.userId || null,
      });
    }
    const bag = await attachEngineLessons({}, surface === "homework" ? "daily" : surface);
    lessonsBlock = String(bag._engineLessonsBlock || "").trim();
  } catch (e) {
    console.warn("Engine lessons on refine skipped:", e.message);
  }
  if (module === "daily") return await refineDailyPlan(existingPlan, userFeedback, lessonsBlock);
  if (module === "weekly") return await refineWeeklyPlan(existingPlan, userFeedback, lessonsBlock);
  if (module === "homework") return await refineHomeworkPlan(existingPlan, userFeedback, lessonsBlock, opts);
  return existingPlan;
}

async function refineDailyPlan(existingPlan, userFeedback, lessonsBlock = "") {
  const refinementPrompt = `
You are an academic schedule refinement expert. Modify the EXISTING daily schedule based on user feedback.

EXISTING SCHEDULE (${existingPlan.rows.length} rows):
${JSON.stringify(existingPlan.rows.slice(0, 10), null, 2)}...

USER FEEDBACK: "${userFeedback}"
${lessonsBlock ? `\n${lessonsBlock}\n` : ""}
RULES:
1. DO NOT regenerate from scratch — ONLY modify rows mentioned in feedback
2. KEEP same subjects, topics, overall structure
3. Preserve all IST time slots
4. MAINTAIN 4-subjects-per-day rule
5. MAINTAIN college-hours-only (08:45–04:30)
6. MAINTAIN daily coding practice rotation
7. Keep project sessions with beginner step-by-step guide
8. Stand-Up: if the plan is SOLO (one student), NEVER write "Team check-in", teammates, classmate, or "each person". Use Personal standup / Personal check-in only. Team wording only if content already clearly shows 2+ named members.
9. Coding Practice / LeetCode: keep short (pattern + one problem + Apply + Done). Do not add long step dumps.
10. Obey ENGINE QUALITY LESSONS — do not reintroduce past mistakes
11. Return ONLY valid JSON — NO string concatenation, NO JS operators

Return ONLY valid JSON:
{
  "module": "daily",
  "title": "${existingPlan.title}",
  "columns": ${JSON.stringify(existingPlan.columns)},
  "rows": [/* modified rows, EXACT same count: ${existingPlan.rows.length} */]
}
`;
  const refined = await callLLM(refinementPrompt, 4500);
  if (refined.rows && refined.rows.length === existingPlan.rows.length) {
    console.log("✅ Daily plan refined successfully");
    return refined;
  }
  console.warn("Refinement returned different row count, using original");
  return existingPlan;
}

async function refineWeeklyPlan(existingPlan, userFeedback, lessonsBlock = "") {
  const refinementPrompt = `
You are an academic plan refinement expert. Modify the EXISTING weekly plan based on feedback.

EXISTING WEEKLY PLAN:
${JSON.stringify(existingPlan, null, 2)}

USER FEEDBACK: "${userFeedback}"
${lessonsBlock ? `\n${lessonsBlock}\n` : ""}
RULES:
1. DO NOT change subject names or weekly topics
2. Keep exactly ${existingPlan.rows.length} rows
3. ONLY refine content based on feedback
4. Obey ENGINE QUALITY LESSONS — do not reintroduce past mistakes
5. Return ONLY valid JSON — NO string concatenation

Return ONLY valid JSON with EXACT same structure:
{
  "module": "weekly",
  "title": "${existingPlan.title}",
  "columns": ${JSON.stringify(existingPlan.columns)},
  "rows": [/* same number of rows */]
}
`;
  const refined = await callLLM(refinementPrompt, 4500);
  if (refined.rows && refined.rows.length === existingPlan.rows.length) {
    console.log("✅ Weekly plan refined successfully");
    return refined;
  }
  return existingPlan;
}

async function refineHomeworkPlan(existingPlan, userFeedback, lessonsBlock = "", opts = {}) {
  const focusDay = String(opts.focusDayKey || "").trim();
  const sampleRows = existingPlan.rows.slice(0, 12);
  const refinementPrompt = `
You refine Tonight's Homework plans for a campus academic planner.

EXISTING HOMEWORK PLAN (${existingPlan.rows.length} rows). Each row is [Day, Time, Activity, Content].
Activity is usually "Tonight's Homework". Content is multi-line tasks (LeetCode, Case study, Agent Workbench, LinkedIn, Exercism…).

SAMPLE / STRUCTURE:
${JSON.stringify({ title: existingPlan.title, columns: existingPlan.columns, rows: sampleRows }, null, 2)}

USER FEEDBACK: "${String(userFeedback || "").replace(/"/g, "'")}"
${focusDay ? `\nFOCUS NIGHT (prioritize this day key): ${focusDay}\n` : ""}
${lessonsBlock ? `\n${lessonsBlock}\n` : ""}

RULES:
1. DO NOT invent a brand-new plan from scratch — refine content based on feedback.
2. Keep EXACTLY ${existingPlan.rows.length} rows. Keep Day / Time / Activity unless feedback asks to change them.
3. Keep task title first lines detectable: LeetCode, Case study, Agent Workbench, LinkedIn, Exercism.
4. Keep Learning → SD → LC → Case → Project connectivity when present.
5. Prefer short, clear beginner wording.
6. Agent Workbench: keep FULL bank/RAG task definition (Problem + What to build + Steps 1–N + Done when). Never paste the student's long problem essay into "Problem". Only a short "Product glance" line (max ~12 words) may mention their product.
7. LeetCode: sweet and small — Why + Link + Do + Apply + Done. No long multi-step dumps.
8. Obey ENGINE QUALITY LESSONS — do not reintroduce past mistakes.
9. Return ONLY valid JSON — no markdown fences.

Return ONLY:
{
  "module": "homework",
  "title": ${JSON.stringify(existingPlan.title || "Tonight's Homework")},
  "columns": ${JSON.stringify(existingPlan.columns || ["Day", "Time", "Activity", "Content"])},
  "rows": [/* EXACT same count: ${existingPlan.rows.length} */]
}
`;
  const refined = await callLLM(refinementPrompt, 4500);
  if (refined?.rows && refined.rows.length === existingPlan.rows.length) {
    console.log("✅ Homework plan refined successfully");
    return {
      module: "homework",
      title: refined.title || existingPlan.title || "Tonight's Homework",
      columns: refined.columns || existingPlan.columns || ["Day", "Time", "Activity", "Content"],
      rows: refined.rows,
    };
  }
  console.warn("Homework refinement returned different row count, using original");
  return existingPlan;
}

// ── Polish (formatting-only refine, content untouched) ─────────────────────
function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function buildWeeklyPolishPrompt(rows, columns) {
  return `
You are a formatting editor for a weekly academic plan overview.
Each row is [${columns.join(", ")}].

TASK: Rewrite ONLY "${columns[2]}", "${columns[3]}", "${columns[4]}" text to be cleaner and more scannable:
- Break run-on sentences into short bullet points, one idea per line, each line starting with "▶ "
- Join lines with "\\n"
- Fix awkward phrasing, spacing, capitalization

STRICT RULES — DO NOT VIOLATE:
1. DO NOT change, add, or remove any subject name, topic, milestone, or exam-focus detail — same facts, better formatting only
2. Copy "${columns[0]}" and "${columns[1]}" back EXACTLY as given — do not touch them
3. Return EXACTLY ${rows.length} row(s), same order
4. Return ONLY valid JSON, no markdown fences, no commentary

EXISTING ROWS:
${JSON.stringify(rows)}

Return ONLY:
{ "rows": [ ["${columns[0]} value", "${columns[1]} value", "polished ${columns[2]}", "polished ${columns[3]}", "polished ${columns[4]}"], ... ] }
`;
}

async function polishWeeklyPlan(existingPlan) {
  if (!existingPlan?.rows?.length) throw new Error("No existing weekly plan to polish");
  const columns = existingPlan.columns || ["Week", "Days", "Subjects Covered", "Project Milestone", "Exam Focus"];
  const batches = chunkArray(existingPlan.rows, 6); // keep each call well under the 4096-token cap
  const polishedRows = [];

  for (const batch of batches) {
    try {
      const prompt = buildWeeklyPolishPrompt(batch, columns);
      const result = await callLLM(prompt, 3500);
      if (Array.isArray(result.rows) && result.rows.length === batch.length) {
        const safeRows = result.rows.map((r, i) => [
          batch[i][0],
          batch[i][1],
          (r && typeof r[2] === "string" && r[2].trim()) ? r[2] : batch[i][2],
          (r && typeof r[3] === "string" && r[3].trim()) ? r[3] : batch[i][3],
          (r && typeof r[4] === "string" && r[4].trim()) ? r[4] : batch[i][4],
        ]);
        polishedRows.push(...safeRows);
      } else {
        console.warn("Weekly polish batch mismatch, keeping original rows for this batch");
        polishedRows.push(...batch);
      }
    } catch (err) {
      console.error("Weekly polish batch failed:", err.message);
      polishedRows.push(...batch);
    }
    await wait(300);
  }

  return { ...existingPlan, columns, rows: polishedRows };
}

async function polishExistingPlan(existingPlan, module) {
  if (!existingPlan || !existingPlan.rows) throw new Error("No existing plan to polish");
  if (module === "daily")  return await polishDailyPlan(existingPlan);
  if (module === "weekly") return await polishWeeklyPlan(existingPlan);
  throw new Error("Invalid module");
}

async function polish(req, res) {
  try {
    const { module, existingPlan } = req.body;
    if (!existingPlan) return res.status(400).json({ success: false, error: "Missing existingPlan" });
    const polishedPlan = await polishExistingPlan(existingPlan, module);
    res.json({ success: true, plan: polishedPlan });
  } catch (err) {
    console.error("Polish failed:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

// ── Generate daily plan ───────────────────────────────────────────────────────
async function stampWeekLabels(plan, inputs) {
  if (!plan || !Array.isArray(plan.rows)) return plan;
  const calendarMeta = inputs?.calendarMeta;
  const { iaWeekSet, auWeekSet, mockWeekNum } = resolveExamConfig(calendarMeta);

  plan.rows = plan.rows.map((row, idx) => {
    const weekNum = idx + 1;
    const isIA   = iaWeekSet.has(weekNum);
    const isMock = weekNum === mockWeekNum;
    const isAU   = auWeekSet.has(weekNum);
    let label = `Week ${weekNum}`;
    if (isIA)   label += "\n🟠 IA Exam Week";
    if (isMock) label += "\n🔵 Mock Exam Week";
    if (isAU)   label += "\n🔴 AU Exam Week";
    const rest = row.slice(1).map((cell) =>
      typeof cell === "string" ? cell.replace(/\\n/g, "\n") : cell
    );
    return [label, ...rest];
  });
  return plan;
}


// ── Weekly Plan Prompt ────────────────────────────────────────────────────────
function buildProjectEstimationPrompt(inputs, themes, activeStageKey) {
  const projectStatement = (inputs?.problem || "").trim();
  const numDays = Number(inputs?._numDays) || (themes.length * 5);
  const dailyStart = inputs?._dailyStart || "09:00";
  const dailyEnd = inputs?._dailyEnd || "18:00";
  let teamSize = 1;
  try {
    if (Number(inputs?._teamSize) > 0) teamSize = Number(inputs._teamSize);
    else if (Array.isArray(inputs?.teamMembers) && inputs.teamMembers.length) teamSize = inputs.teamMembers.length;
    else if (typeof inputs?._teamMembers === "string" && inputs._teamMembers.trim()) {
      const parsed = JSON.parse(inputs._teamMembers);
      if (Array.isArray(parsed) && parsed.length) teamSize = parsed.length;
    }
  } catch (_) { /* keep 1 */ }
  teamSize = Math.max(1, teamSize);
  const weekSummaries = (themes || []).slice(0, 16).map((t) =>
    `Week ${t.week}: project=${t.project} | task=${t.projectTask || ""} | tech=${t.tech} | dsa=${t.dsa}`
  ).join("\n");

  return (
    `You are a project coach for engineering students. Keep estimation SHORT and easy.\n\n` +
    `PROBLEM / PROJECT:\n${projectStatement.slice(0, 2500) || "(infer from week themes)"}\n\n` +
    `CONSTRAINTS:\n` +
    `- ~${numDays} working days (${themes.length} weeks), daily ${dailyStart}–${dailyEnd} IST\n` +
    `- Team size: ~${teamSize}\n` +
    `- Week themes:\n${weekSummaries}\n\n` +
    `Return ONLY valid JSON with these fields (nothing else):\n` +
    `{\n` +
    `  "module": "estimation",\n` +
    `  "title": "Project Estimation Overview",\n` +
    `  "summary": "<2–3 short plain sentences: what you build, size, fits timeline?>",\n` +
    `  "totalEffortHours": <number>,\n` +
    `  "confidence": "low|medium|high",\n` +
    `  "snapshot": {\n` +
    `    "totalWeeks": ${themes.length},\n` +
    `    "totalHours": <same as totalEffortHours>,\n` +
    `    "hoursPerWeek": <realistic college hours/week>,\n` +
    `    "confidence": "low|medium|high"\n` +
    `  },\n` +
    `  "modules": [\n` +
    `    { "name": "<feature from this problem>", "priority": "P0|P1|P2", "hours": <n>, "doneWhen": "<one tickable check>" }\n` +
    `  ],\n` +
    `  "milestones": [\n` +
    `    { "week": 1, "deliverable": "<what finishes this week>" }\n` +
    `  ]\n` +
    `}\n\n` +
    `Rules:\n` +
    `- Plain English. No jargon.\n` +
    `- Exactly 4–6 modules. Milestones for weeks 1–${Math.min(themes.length, 10)} only.\n` +
    `- P0=must, P1=should, P2=nice. Hours realistic for college days.\n` +
    `- Specific to THIS problem — no generic SaaS filler.\n` +
    `- Do NOT include phases, teamRoles, assumptions, or outOfScope.\n`
  );
}

async function generateProjectEstimation(inputs, themes) {
  const prompt = buildProjectEstimationPrompt(inputs || {}, themes || [], inputs?._activeDTStage);
  const result = await callLLM(prompt, 3500);
  if (!result || typeof result !== "object") {
    throw new Error("Estimation LLM returned empty result");
  }

  const phases = Array.isArray(result.phases) ? result.phases : [];
  const modules = Array.isArray(result.modules) ? result.modules : [];
  const teamRoles = Array.isArray(result.teamRoles) ? result.teamRoles : [];
  const milestones = Array.isArray(result.milestones) ? result.milestones : [];
  const assumptions = Array.isArray(result.assumptions) ? result.assumptions : [];
  const outOfScope = Array.isArray(result.outOfScope) ? result.outOfScope : [];
  const totalEffortHours = result.totalEffortHours ?? result.snapshot?.totalHours ?? null;
  const confidence = result.confidence || result.snapshot?.confidence || "medium";
  const summary = result.summary || result.plainSummary || "";
  const confidenceWhy = result.confidenceWhy || result.snapshot?.confidenceWhy || "";
  const totalWeeks = result.snapshot?.totalWeeks || (themes || []).length || milestones.length || null;
  const hoursPerWeek = result.snapshot?.hoursPerWeek
    || (totalEffortHours && totalWeeks ? Math.round(Number(totalEffortHours) / Number(totalWeeks)) : null);

  // Flatten rows for Excel / CSV — labelled sections, not opaque dumps
  const rows = [
    ["At a glance", `Total ${totalEffortHours ?? "?"}h · ${totalWeeks ?? "?"} weeks · ~${hoursPerWeek ?? "?"}h/week · Confidence: ${confidence}`],
    ["In plain English", summary],
    ...(confidenceWhy ? [["Why this confidence", confidenceWhy]] : []),
    ...phases.map((p, i) => [
      `Stage ${i + 1}: ${p.name || ""}`,
      [
        p.weeks || (p.days != null ? `${p.days} days` : ""),
        p.hours != null ? `${p.hours}h` : "",
        p.whatYouDo ? `What you do: ${p.whatYouDo}` : "",
        p.youFinishWhen ? `Finish when: ${p.youFinishWhen}` : (Array.isArray(p.outcomes) ? p.outcomes.join("; ") : ""),
      ].filter(Boolean).join("\n"),
    ]),
    ...modules.map((m) => [
      `Build: ${m.name || ""}`,
      `${m.priority || "P1"} · ${m.hours ?? "?"}h\nDone when: ${m.doneWhen || ""}`,
    ]),
    ...milestones.map((m) => [
      `Week ${m.week ?? ""} checkpoint`,
      `Finish: ${m.deliverable || m.finishThis || ""}\nDemo: ${m.demo || m.showDemoOf || ""}`,
    ]),
    ...teamRoles.map((r) => [
      `Role: ${r.role || ""}`,
      `${r.focus || ""}${r.hoursPerWeek != null ? `\n~${r.hoursPerWeek}h/week` : ""}`,
    ]),
    ...(assumptions.length ? [["We assumed", assumptions.join("\n")]] : []),
    ...(outOfScope.length ? [["Not included", outOfScope.join("\n")]] : []),
  ];

  return {
    module: "estimation",
    title: result.title || "Project Estimation Overview",
    summary,
    plainSummary: summary,
    confidenceWhy,
    totalEffortHours,
    confidence,
    snapshot: {
      totalWeeks,
      totalHours: totalEffortHours,
      hoursPerWeek,
      teamSize: result.snapshot?.teamSize || null,
      confidence,
      confidenceWhy,
    },
    phases,
    modules,
    teamRoles,
    milestones,
    assumptions,
    outOfScope,
    columns: ["Section", "Detail"],
    rows,
  };
}

// ── Weekly Plan Prompt ────────────────────────────────────────────────────────
function buildWeeklyPrompt(themes, inputs = {}, examAnalysis = null, focusOverride = "") {
  const totalWeeks    = themes.length;
  const calendarMeta  = inputs?.calendarMeta;
  const calMap        = inputs?.calMap || null;
  const { iaWeekSet, auWeekSet, mockWeekNum, examsEnabled } = resolveExamConfig(calendarMeta);
  const allSubjects   = themes[0]?.subjects || [];
  // The raw problem statement the user actually uploaded/typed — shown directly
  // to this LLM call too, not just the per-week milestone paraphrase, so the
  // final "Project Milestone" column stays anchored to the real project.
  const projectStatement = (inputs?.problem || "").trim();

  const dayRangeLabels = {};
  if (calMap) {
    let runningDay = 1;
    for (const theme of themes) {
      const workingDaysThisWeek = calMap.filter((e) => e.week === theme.week).length;
      const startDay = runningDay;
      const endDay   = runningDay + Math.max(workingDaysThisWeek, 1) - 1;
      dayRangeLabels[theme.week] = `Day ${startDay}-${endDay}`;
      runningDay = endDay + 1;
    }
  }

  // ── IA/AU date strings ──────────────────────────────────────────────────────
  const iaDateStrings = {};
  if (calMap && calendarMeta?.iaWeekNums) {
    const iaWeeksList = [...calendarMeta.iaWeekNums].sort((a, b) => a - b);
    iaWeeksList.forEach((wk, idx) => {
      const iaDays = calMap.filter(e => !e.isHoliday && e.week === wk);
      if (iaDays.length > 0) {
        const s = iaDays[0].displayDate;
        const e = iaDays[iaDays.length - 1].displayDate;
        iaDateStrings[wk] = { label: `IA${idx + 1}`, dates: s === e ? s : `${s} to ${e}` };
      }
    });
  }

  const getAUDateRange = () => {
    if (!calMap) return null;
    const auDays = calMap.filter(e => !e.isHoliday && auWeekSet.has(e.week));
    if (auDays.length === 0) return null;
    const s = auDays[0].displayDate;
    const e = auDays[auDays.length - 1].displayDate;
    return s === e ? s : `${s} to ${e}`;
  };
  const auDateStr = getAUDateRange();

  // ── Build week lines with DETAILED exam questions ──────────────────────────
  const weekLines = themes.map((t) => {
    const isIA   = iaWeekSet.has(t.week);
    const isMock = t.week === mockWeekNum;
    const isAU   = auWeekSet.has(t.week);

    const subjectTopics = t.subjects.map((s) => s.name + ": " + s.topic).join(" | ");

    // Project details: concise weekly completion target
    const projectDetail =
      `Milestone: ${t.project}\n` +
      `    Weekly progress to complete: ${t.projectTask || t.project}\n` +
      `    Keep milestone SHORT: 3–5 bullets only (Goal, Complete, Done when) — no project-link lines\n` +
      `    Knowledge fence (only use these): ${(t.cumulativeKnowledge || "subjects taught so far").slice(0, 300)}`;

    // Detailed exam questions per subject
    const examDetail = t.subjects.map((s) => {
      const detailed = getDetailedExamQuestions(s.name, examAnalysis);
      if (detailed) return s.name + ":\n      " + detailed;
      return s.name + ": " + getExamFocus(s.name, s.topic, examAnalysis);
    }).join("\n    ");

    let tag = "";
    if (isIA) {
      const iaInfo = iaDateStrings[t.week];
      const dateHint = iaInfo ? ` [${iaInfo.label} EXAM DATES: ${iaInfo.dates}]` : "";
      tag = ` [🟠 IA EXAM WEEK${dateHint}]`;
    }
    if (isMock) tag = " [🔵 MOCK EXAM & FINAL DEMO WEEK]";
    if (isAU) {
      const dateHint = auDateStr ? ` [AU EXAM DATES: ${auDateStr}]` : "";
      tag = ` [🔴 AU (UNIVERSITY) EXAM WEEK${dateHint}]`;
    }

    const daysLabel = dayRangeLabels[t.week] || t.days;
    return "Week " + t.week + " | " + daysLabel + tag +
      "\n  Subjects & Topics: " + subjectTopics +
      "\n  Project (knowledge-fenced):\n    " + projectDetail +
      "\n  DSA: " + t.dsa +
      "\n  System Design: " + t.systemDesign +
      "\n  Tech: " + t.tech +
      "\n  Exam Focus (detailed from PYQ analysis):\n    " + examDetail;
  }).join("\n\n");

  return (
    "You are an expert Academic Program Manager.\n\n" +
    `Generate a ${totalWeeks}-week study plan.\n` +
    "EVERY week MUST cover ALL subjects listed for that week.\n\n" +
    (projectStatement
      ? "━━━ THE ACTUAL PROJECT (verbatim from the user) ━━━\n" + projectStatement.slice(0, 1500) +
        "\n━━━ END PROJECT STATEMENT ━━━\n" +
        "Every 'Project Milestone' cell must be EXACTLY 3–5 important bullets (Goal / Complete / Done when)\n" +
        "for THIS project — no project-link lines, no long essays.\n\n"
      : "") +
    "Week-by-week data:\n" + weekLines + "\n\n" +
    (inputs.calendarSummary
      ? "CALENDAR SUMMARY:\n" + inputs.calendarSummary + "\n\n"
      : examsEnabled
        ? `IA weeks=[${Array.from(iaWeekSet).join(",")}], Mock week=${mockWeekNum}, AU weeks=[${Array.from(auWeekSet).join(",")}]\n`
        : "No exams configured — pure self-learning / project-driven schedule, no exam weeks.\n") +
    (focusOverride ? "\nUSER REQUESTED CHANGE: " + focusOverride + "\n" : "") +
    "\n" +
    "OUTPUT: Return ONLY valid JSON (no markdown, no explanation):\n" +
    "{\n" +
    '  "module": "weekly",\n' +
    `  "title": "${totalWeeks}-Week Weekly Study Plan",\n` +
    '  "columns": ["Week", "Days", "Subjects Covered", "Project Milestone", "Exam Focus"],\n' +
    '  "rows": [\n' +
    '    ["Week 1", "Day 1-5", "DSA: Arrays — two pointer\\nDBMS: ER — entities", "• Goal: ...\\n• Complete: ...\\n• Done when: ...", "SubjectA:\\n• Q: ..."],\n' +
    `    ... all ${totalWeeks} rows\n` +
    "  ]\n" +
    "}\n\n" +
    "COLUMN RULES:\n\n" +
    "COLUMN 1 — Week label:\n" +
    "  Regular: 'Week X'\n" +
    "  IA week: 'Week X\\n(IA Week)'\n" +
    "  Mock week: 'Week X\\n(Mock Week)'\n" +
    "  AU week: 'Week X\\n(AU Week)'\n\n" +
    "COLUMN 2 — Days: 'Day X-Y' format\n\n" +
    "COLUMN 3 — Subjects Covered (TIGHT OVERVIEW — max 4 lines):\n" +
    "  One labeled line per group. Join concepts on the SAME line (not nested bullets).\n" +
    "  '▶ Subjects: Compiler Design — Syntax · Networks — Security\\n▶ DT: Pitch → User Actions\\n▶ System Design: Real-time Processing\\n▶ DSA: Arrays'\n" +
    "  FORBIDDEN: long bullet trees; repeating DT:/System Design: per concept; ·-joined mega-paragraphs without labels.\n\n" +
    "COLUMN 4 — Project Milestone (IMPORTANT POINTS ONLY — keep short):\n" +
    "  Purpose: what MUST be completed this week on the actual project.\n" +
    "  Format: EXACTLY 3–5 short bullet points. Use \\n between bullets.\n" +
    "  Include ONLY:\n" +
    "  • Goal: named feature/module to finish this week\n" +
    "  • Complete: 1–2 concrete deliverables (screens/files/flows)\n" +
    "  • Done when: one clear completion check / demo\n" +
    "  Optional 4th–5th bullet: next week starts with …\n" +
    "  FORBIDDEN: project-link lines, learn→apply essays, Mon–Fri logs, long lists, vague 'continue project'.\n" +
    "  Do NOT write 'Project link', 'Apply subject', or DSA/SD mapping inside this column.\n\n" +
    "COLUMN 5 — Exam Focus (keep focused):\n" +
    "  Subject-wise, short bullets. Prefer real PYQ text from the analysis.\n" +
    "  For REGULAR weeks: 2–3 questions / drills per subject max.\n" +
    "  For IA weeks: '⚠️ IA EXAM: [dates]' + key Qs per subject.\n" +
    "  For Mock weeks: '🔵 MOCK WEEK' + key patterns.\n" +
    "  For AU weeks: '⚠️ AU EXAM: [dates]' + high-marks Qs.\n" +
    "  Never leave Exam Focus as only a topic name.\n\n" +
    "CRITICAL RULES:\n" +
    `- Total rows = ${totalWeeks}\n` +
    "- Use actual subject names and topics from the data (no placeholders)\n" +
    "- No markdown inside JSON — use plain text with \\n for line breaks\n" +
    "- NO JavaScript string concatenation (no + operators) in the JSON\n" +
    "- Project Milestone = EXACTLY 3–5 short bullets (Goal / Complete / Done when) — no project links\n" +
    "- Subjects Covered = max 4 labeled lines (Subjects / DT / System Design / DSA) with concepts joined inline\n" +
    "- Put subject names / Goal / Done when as clear label prefixes (Label:) so the UI can bold them\n"
  );
}
// ── Auth (now MongoDB-backed instead of users.json) ────────────────────────────
async function saveSubjectsForUser(req, subjects, syllabusText) {
  try {
    const authHeader = req.headers?.authorization;
    if (!authHeader?.startsWith("Bearer ")) return;
    const decoded = jwt.verify(authHeader.split(" ")[1], JWT_SECRET);

    const ops = subjects.map(s => ({
      updateOne: {
        filter: { userId: decoded.id, name: s.name },
        update: {
          $set: {
            userId: decoded.id,
            name: s.name,
            units: s.units || [],
            syllabusText: (syllabusText || "").slice(0, 5001),
            source: "planner",
          },
        },
        upsert: true,
      },
    }));
    if (ops.length > 0) await Subject.bulkWrite(ops);
  } catch (_) {
    // Invalid/missing token — not fatal, just skip persistence
  }
}

async function buildPlanContext(inputs, req = null) {
  // Hands-on short syllabus file when Subjects upload is empty / huge PDFs avoided
  try {
    const { ensureSyllabusFromHandsOnFile } = require("../utils/loadCollegeSyllabusInput");
    inputs = await ensureSyllabusFromHandsOnFile(inputs || {});
  } catch (_) {
    /* optional */
  }

  // Weeks are just a 5-day grouping convenience for the underlying generator.
  // The real unit of input is "N days" (numDays), so derive week count from
  // that first. Only fall back to the 13-week default if neither a calendar
  // nor a day count was ever provided.
  const requestedDays = Number(inputs?._numDays) || null;
  const totalWeeks =
    inputs?.calendarMeta?.totalWeeks ||
    (requestedDays ? Math.max(1, Math.ceil(requestedDays / 5)) : FALLBACK_TOTAL_WEEKS);
  const projectStatement = inputs?.problem || "";

  // ── Mode: DSA/DT + optional supporting subject syllabus ───────────────────
  const isDSAMode = inputs?._plannerMode === "dsa_dt_playbook";

  // Problem-only path: RAG-fill missing DSA / System Design from the web + problem
  if (isDSAMode && (inputs?.problem || "").trim()) {
    try {
      const { enriched } = await enrichMissingDsaSd(inputs, totalWeeks);
      Object.assign(inputs, enriched);
    } catch (e) {
      console.warn("DSA/SD RAG enrich skipped:", e.message);
    }
  }

  let syllabusText;
  if (isDSAMode) {
    const dsaPart  = inputs?.dsaSyllabus   || "";
    const sdPart   = inputs?.systemDesign  || "";
    const subPart  = inputs?.syllabus      || "";
    const capPart  = inputs?.capability    || "";
    const intPart  = inputs?.interest      || "";
    const assessPart = inputs?.assessment  || "";
    syllabusText = [
      dsaPart  ? "=== DSA SYLLABUS ===\n" + dsaPart  : "",
      sdPart   ? "=== SYSTEM DESIGN SYLLABUS ===\n" + sdPart : "",
      subPart  ? "=== SUPPORTING SUBJECT SYLLABUS ===\n" + subPart : "",
      capPart  ? "=== STUDENT CAPABILITY ===\n" + capPart : "",
      intPart  ? "=== STUDENT INTERESTS ===\n" + intPart : "",
      assessPart ? "=== ASSESSMENT & GOALS ===\n" + assessPart : "",
      inputs?._dtInstruction ? "=== 3P DT PLAYBOOK INSTRUCTIONS ===\n" + inputs._dtInstruction : "",
      inputs?._activeDTStage ? "=== ACTIVE DT STAGE KEY ===\n" + inputs._activeDTStage : "",
      inputs?._productStageBlock ? "=== PRODUCT CHECKPOINTS ===\n" + inputs._productStageBlock : "",
      inputs?._dsaSdRagMeta ? "=== DSA/SD SOURCE ===\n" + JSON.stringify(inputs._dsaSdRagMeta) : "",
    ].filter(Boolean).join("\n\n");
    console.log(
      "🎯 3P DSA/DT Mode — " +
      (dsaPart ? "DSA " : "DSA(RAG) ") +
      (sdPart ? "+ SD " : "+ SD(RAG) ") +
      (subPart ? "+ supporting subjects" : "")
    );
  } else {
    syllabusText = [
      inputs?.syllabus || "",
      inputs?._productStageBlock ? "=== PRODUCT CHECKPOINTS ===\n" + inputs._productStageBlock : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  console.log(`Building plan context for ${totalWeeks} weeks`);
  console.log(`Project domain: ${projectStatement.slice(0, 80)}...`);
  console.log(`Active DT stage: ${inputs?._activeDTStage || "(none)"}`);

  const skipDsaFlag =
    inputs?._skipDsa === true ||
    inputs?._skipDsa === "true" ||
    inputs?._skipDsa === 1;
  const skipSdFlag =
    inputs?._skipSystemDesign === true ||
    inputs?._skipSystemDesign === "true" ||
    inputs?._skipSystemDesign === 1;

  let subjects;
  if (isDSAMode) {
    subjects = await extractDSASubjects(
      inputs?.dsaSyllabus || "",
      inputs?.systemDesign || "",
      totalWeeks,
      { skipDsa: skipDsaFlag, skipSd: skipSdFlag }
    );
    // If user uploaded college subject syllabus, extract and MERGE as supporting subjects
    if ((inputs?.syllabus || "").trim().length > 40) {
      try {
        const supporting = await extractSubjects(inputs.syllabus, projectStatement, totalWeeks);
        const existing = new Set(subjects.map((s) => String(s.name).toLowerCase()));
        supporting.forEach((s) => {
          if (!existing.has(String(s.name).toLowerCase())) subjects.push(s);
        });
        console.log(`✅ Merged ${supporting.length} supporting subject(s) from syllabus upload`);
      } catch (e) {
        console.warn("Supporting subject extract skipped:", e.message);
      }
    }
  } else {
    subjects = await extractSubjects(syllabusText, projectStatement, totalWeeks);
  }

  const skipSubjectsFlag =
    inputs?._skipSubjects === true ||
    inputs?._skipSubjects === "true" ||
    inputs?._skipSubjects === 1;
  const skipQuestionsFlag =
    inputs?._skipQuestions === true ||
    inputs?._skipQuestions === "true" ||
    inputs?._skipQuestions === 1;

  // Strip DSA / SD / Subjects if those Includes are OFF
  if (skipDsaFlag) {
    subjects = (subjects || []).filter((s) => !/data structures|algorithms|\bdsa\b/i.test(String(s.name || "")));
  }
  if (skipSdFlag) {
    subjects = (subjects || []).filter((s) => !/system design/i.test(String(s.name || "")));
  }
  if (skipSubjectsFlag) {
    // Keep only DSA/SD subjects if those toggles are still ON; drop college subjects
    subjects = (subjects || []).filter((s) => {
      const name = String(s.name || "");
      const isDsa = /data structures|algorithms|\bdsa\b/i.test(name);
      const isSd = /system design/i.test(name);
      return (isDsa && !skipDsaFlag) || (isSd && !skipSdFlag);
    });
  }

  // Per-subject include / like / dislike (solo + team)
  try {
    const { applySubjectPreferencesToPlan } = require("../utils/subjectPreferences");
    subjects = applySubjectPreferencesToPlan(subjects || [], inputs || {});
    if (inputs?._subjectPreferencesBlock) {
      console.log("📌 Subject preferences applied");
    }
  } catch (e) {
    console.warn("Subject preferences skipped:", e.message);
  }

  let themes = await generateWeekThemes(subjects, syllabusText, projectStatement, totalWeeks);
  // Keep week themes aligned with Include toggles (weekly/daily must not invent OFF tracks)
  themes = (themes || []).map((t) => ({
    ...t,
    dsa: skipDsaFlag ? "" : t.dsa,
    systemDesign: skipSdFlag ? "" : t.systemDesign,
    subjects: (t.subjects || []).filter((s) => {
      const name = String(s?.name || "");
      if (skipDsaFlag && /data structures|algorithms|\bdsa\b/i.test(name)) return false;
      if (skipSdFlag && /system design/i.test(name)) return false;
      if (skipSubjectsFlag && !/data structures|algorithms|\bdsa\b|system design/i.test(name)) return false;
      return true;
    }),
  }));
  const examAnalysis = skipQuestionsFlag
    ? null
    : await analyzeQuestionPapers(inputs?.questions || "", subjects);
  if (req) await saveSubjectsForUser(req, subjects, syllabusText);
  return { subjects, themes, examAnalysis, isDSAMode };
}

// ── /api/generate ─────────────────────────────────────────────────────────────


// ── Route handlers ────────────────────────────────────────────────────────────

async function generate(req, res) {
  try {
    const { module, inputs, feedback, existingPlan } = req.body;
    const userId = req.user?.id || req.user?._id || null;
    let plan;
    if (existingPlan && feedback && feedback.trim()) {
      plan = await refineExistingPlan(existingPlan, feedback, module, { userId });
    } else {
      const { themes, examAnalysis } = await buildPlanContext(inputs || {}, req);
      if (module === "daily") {
        plan = await generateDailyPlan(inputs || {}, themes, examAnalysis, feedback || "", inputs?.calendarMeta, inputs?.calMap || null);
      } else if (module === "weekly") {
        // Weekly ALWAYS follows daily — never invent a separate LLM weekly plan
        const dailyRows = req.body.dailyRows || inputs?._dailyRows || null;
        if (!Array.isArray(dailyRows) || !dailyRows.length) {
          return res.status(400).json({
            success: false,
            error: "Weekly schedule follows Daily only. Generate Daily first (or send dailyRows).",
          });
        }
        if (feedback && String(feedback).trim().length >= 8) {
          try {
            const { recordFeedbackLessons, attachEngineLessons } = require("../utils/engineLessons");
            await recordFeedbackLessons(feedback, { surface: "weekly", userId });
            // Keep lessons warm even though weekly is derived from daily
            await attachEngineLessons(inputs || {}, "weekly");
          } catch (_) {}
        } else {
          try {
            const { attachEngineLessons } = require("../utils/engineLessons");
            await attachEngineLessons(inputs || {}, "weekly");
          } catch (_) {}
        }
        const { buildWeeklyFromDailyRows } = require("../utils/weeklyFromDaily");
        plan = buildWeeklyFromDailyRows(dailyRows, {
          themes,
          examAnalysis,
          inputs: inputs || {},
        });
      } else {
        return res.status(400).json({ error: "Invalid module" });
      }
    }
    res.json({ success: true, plan });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

async function generateAll(req, res) {
  console.log("=== /api/generate-all called ===");
  console.log("Body received:", JSON.stringify(req.body).slice(0, 200));

  const { inputs, existingPlans, feedback } = req.body;
  const repoMode = String(inputs?._repoMode || "generate_new").toLowerCase();
  // existing | generate_new | existing_regen | manual

  const _meta = inputs?.calendarMeta;
  const _map  = inputs?.calMap;
  console.log("📅 calendarMeta:", _meta ? JSON.stringify(_meta) : "❌ MISSING");
  console.log("🗓️  calMap:", _map ? `✅ ${_map.length} entries` : "❌ MISSING");
  console.log("📦 repoMode:", repoMode);
  if (_map) {
    const examE = _map.filter(e => e.isExam);
    console.log(`   isExam entries: ${examE.length}`);
    examE.slice(0, 3).forEach(e =>
      console.log(`   • week=${e.week} day=${e.day} date=${e.date} sessions=${JSON.stringify(e.examSessions)}`)
    );
  }

  const plans = {}, errors = {};
  let ctx;
  let repoMeta = { mode: repoMode, reused: false, regenerated: false, matchId: null };

  const {
    resolveRepoSeed,
    bumpUseCount,
  } = require("./scheduleRepoController");
  const { buildWeeklyFromDailyRows } = require("../utils/weeklyFromDaily");

  const PART_LABELS = {
    homework: "Homework / Tonight's Homework",
    dsa: "DSA / Coding / LeetCode practice",
    system_design: "System Design",
    problem_review: "Problem Review / Problem Lab / Problem Statement",
    learning: "Learning / Lecture / Subjects / Learn today",
    project_build: "Project Build / Mini Build / DT build",
    standup: "Stand-Up / check-in / Team check-in / Personal standup",
    assessment: "Assessment / Speak & Solve / Refresh",
    dt_playbook: "DT Playbook / Design Thinking / Empathy / Ideate",
    peer_review: "Peer Review / Pitch Among Peers",
    career: "Career / Placement / Dream company / Resume",
    leetcode: "LeetCode / Coding Problems",
    capability: "Capability / Strengths practice",
    interest: "Interests / Goals practice",
  };

  const buildPartialRegenFeedback = (parts, extraFeedback) => {
    const list = Array.isArray(parts) ? parts.filter(Boolean) : [];
    const labels = list.map((p) => PART_LABELS[p] || p).filter(Boolean);
    const extra = String(extraFeedback || "").trim();
    if (!labels.length) {
      return (
        extra ||
        "Adapt this existing schedule to the current problem, timing, and modules. Keep the overall day structure where it still fits; regenerate portions that no longer match."
      );
    }
    return [
      "PARTIAL REGENERATE — follow strictly:",
      `1) ONLY rewrite the Content column for rows whose Activity matches these parts: ${labels.join("; ")}.`,
      "2) Keep Day, Time, and Activity EXACTLY the same for EVERY row.",
      "3) For rows that are NOT in the selected parts, copy Content EXACTLY from the existing schedule — do not rewrite them.",
      "4) Keep the exact same number of rows.",
      "5) Align rewritten parts to the current problem statement and modules.",
      extra ? `6) Extra user note: ${extra}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  };

  const deriveWeekly = (dailyPlan) => {
    if (!dailyPlan?.rows?.length) return null;
    try {
      return buildWeeklyFromDailyRows(dailyPlan.rows, {
        themes: ctx?.themes || [],
        examAnalysis: ctx?.examAnalysis || null,
        inputs: inputs || {},
      });
    } catch (err) {
      console.error("weekly derive failed:", err.message);
      return null;
    }
  };

  // Explicit refine path (feedback on existingPlans) — unchanged
  if (existingPlans && feedback && feedback.trim()) {
    console.log("Refining existing plans with feedback");
    const userId = req.user?.id || req.user?._id || null;
    try {
      if (existingPlans.weekly) {
        plans["weekly"] = await refineExistingPlan(existingPlans.weekly, feedback, "weekly", { userId });
      }
    } catch (err) { console.error("Weekly refinement failed:", err.message); errors["weekly"] = err.message; }
    try {
      if (existingPlans.daily) {
        plans["daily"] = await refineExistingPlan(existingPlans.daily, feedback, "daily", { userId });
      }
    } catch (err) { console.error("Daily refinement failed:", err.message); errors["daily"] = err.message; }
    if (Object.keys(plans).length > 0) return res.json({ success: true, plans, errors, repo: repoMeta });
  }

  // ── Repository: Use Existing (NO AI / NO tokens) ──────────────────────────
  if (repoMode === "existing" || repoMode === "use_existing") {
    try {
      const seedInputs = {
        ...(inputs || {}),
        _userId: req.user?.id || req.user?._id || null,
        _repoMode: repoMode,
      };
      const { doc: match, matchType } = await resolveRepoSeed(seedInputs);
      if (match?.plan?.rows?.length) {
        await bumpUseCount(match);
        plans.daily = match.plan;
        plans.weekly = match.weekly?.rows?.length
          ? match.weekly
          : deriveWeekly(match.plan);
        if (!plans.weekly) errors.weekly = "Weekly could not be derived from repository plan";
        plans.homework = match.homework?.rows?.length || match.homework?.nights?.length
          ? match.homework
          : { module: "homework", title: "Tonight's Homework", rows: (match.plan.rows || []).filter((r) => /homework/i.test(String(r[2] || ""))) };
        repoMeta = {
          mode: "existing",
          reused: true,
          regenerated: false,
          matchId: String(match._id),
          matchType: matchType || "exact",
          title: match.title || "",
          tokensUsed: false,
        };
        console.log("📦 Reused schedule from repository (no AI):", match._id, matchType);
        return res.json({ success: true, plans, errors, repo: repoMeta });
      }
      return res.status(404).json({
        success: false,
        error:
          "No schedule for your campus cohort yet. Use “Generate new” once — it saves for your campus/dept/year so others in the same cohort can reuse it.",
        repo: { mode: "existing", reused: false, tokensUsed: false },
      });
    } catch (err) {
      console.error("repo existing lookup failed:", err.message);
      return res.status(500).json({
        success: false,
        error: "Repository lookup failed: " + err.message,
        repo: { mode: "existing", reused: false },
      });
    }
  }

  // ── Repository: Use Existing + Regenerate (selected seed + optional parts) ─
  if (
    repoMode === "existing_regen" ||
    repoMode === "use_existing_regen" ||
    repoMode === "manual" ||
    repoMode === "pick_manual" ||
    repoMode === "manual_select"
  ) {
    const isManual =
      repoMode === "manual" ||
      repoMode === "pick_manual" ||
      repoMode === "manual_select";
    try {
      const seedInputs = {
        ...(inputs || {}),
        _userId: req.user?.id || req.user?._id || null,
        _repoMode: repoMode,
      };
      if (isManual && !(inputs?._repoEntryId || inputs?.repoEntryId)) {
        return res.status(400).json({
          success: false,
          error: "Pick a friend’s schedule first, then generate.",
          repo: { mode: "manual", reused: false },
        });
      }
      const { doc: match, matchType } = await resolveRepoSeed(seedInputs);
      if (match?.plan?.rows?.length) {
        const userId = req.user?.id || req.user?._id || null;
        let parts = inputs?._repoRegenParts;
        if (typeof parts === "string") {
          try { parts = JSON.parse(parts); } catch { parts = String(parts).split(",").map((s) => s.trim()); }
        }
        const regenFeedback = buildPartialRegenFeedback(
          parts,
          [feedback, inputs?._repoAdaptNote].filter(Boolean).join("\n")
        );
        plans.daily = await refineExistingPlan(match.plan, regenFeedback, "daily", { userId });
        plans.weekly = deriveWeekly(plans.daily);
        if (!plans.weekly) errors.weekly = "Weekly could not be derived after regenerate";
        const hwRows = (plans.daily.rows || []).filter((r) => /homework/i.test(String(r[2] || "")));
        plans.homework = hwRows.length
          ? { module: "homework", title: "Tonight's Homework", rows: hwRows }
          : match.homework || null;
        await bumpUseCount(match);
        // Do not auto-save — user clicks “Save to repository” when ready
        repoMeta = {
          mode: isManual ? "manual" : "existing_regen",
          reused: true,
          regenerated: true,
          matchId: String(match._id),
          matchType: matchType || (isManual ? "manual" : "exact"),
          title: match.title || "",
          tokensUsed: true,
          saved: false,
          parts: Array.isArray(parts) ? parts : [],
        };
        console.log("📦 Regenerated from repository seed:", match._id, "mode:", repoMeta.mode, "parts:", parts);
        return res.json({ success: true, plans, errors, repo: repoMeta });
      }
      return res.status(404).json({
        success: false,
        error: isManual
          ? "That schedule was not found on your campus. Pick another, or ask your friend to save theirs to the repository."
          : "No cohort schedule to customise yet. Generate new first for your campus/dept/year, then reuse + regenerate.",
        repo: { mode: isManual ? "manual" : "existing_regen", reused: false },
      });
    } catch (err) {
      console.error("repo regenerate failed:", err.message);
      return res.status(500).json({
        success: false,
        error: "Repository regenerate failed: " + err.message,
        repo: { mode: isManual ? "manual" : "existing_regen", reused: false },
      });
    }
  }

  // ── Generate New (default) — then auto-save into repository ───────────────
  try {
    console.log("Step 1: Extracting subjects + building week themes...");
    ctx = await buildPlanContext(inputs || {}, req);
    console.log("Step 1 OK: " + ctx.subjects.length + " subjects, " + ctx.themes.length + " weeks");
  } catch (err) {
    console.error("Step 1 FAILED:", err.message);
    return res.status(500).json({ success: false, error: "Setup failed: " + err.message });
  }

  // Daily first — weekly is ONLY a summary of daily (respects Include toggles)
  // Engine lessons are attached inside generateDailyPlan on every NEW generation
  try {
    console.log("Step 2: Generating daily plan (with engine lessons)...");
    plans["daily"] = await generateDailyPlan(inputs || {}, ctx.themes, ctx.examAnalysis, feedback || "", inputs?.calendarMeta, inputs?.calMap || null);
    console.log("Step 2 OK: daily done, rows:", plans["daily"].rows.length);
  } catch (err) {
    console.error("Step 2 FAILED:", err.message);
    errors["daily"] = err.message;
  }

  try {
    console.log("Step 3: Building weekly from daily (no invent)...");
    if (plans["daily"]?.rows?.length) {
      const derived = buildWeeklyFromDailyRows(plans["daily"].rows, {
        themes: ctx.themes,
        examAnalysis: ctx.examAnalysis,
        inputs: inputs || {},
      });
      if (derived.rows?.length) {
        plans["weekly"] = derived;
        console.log("Step 3 OK: weekly from daily (" + derived.rows.length + " weeks)");
      } else {
        errors["weekly"] = "Weekly could not be derived from daily rows";
      }
    } else {
      errors["weekly"] = "Daily plan missing — weekly follows daily only";
    }
  } catch (err) {
    console.error("Step 3 FAILED:", err.message);
    errors["weekly"] = err.message;
  }

  // Repository save is manual only — client calls POST /api/schedule-repo/save
  // via the “Save to repository” button. Do not auto-upsert after generate.

  try {
    const { audit } = require("../utils/auditLog");
    const modules = Object.keys(plans).filter((k) => plans[k]);
    audit(req, {
      entity: "plan",
      action: "plan.generate",
      summary: repoMeta.reused
        ? "Schedule loaded from repository"
        : "First generated daily schedule",
      meta: {
        modules,
        dailyRows: plans.daily?.rows?.length || 0,
        weeklyRows: plans.weekly?.rows?.length || 0,
        changeType: "Initial Plan",
        trigger: "initial_generate",
        changedBy: repoMeta.reused && !repoMeta.regenerated ? "System" : "AI",
        reason: repoMeta.reused
          ? repoMeta.regenerated
            ? "Reused repository schedule with regenerate"
            : "Reused repository schedule"
          : "First generated daily schedule",
        areas: ["plan", "daily", "weekly", "homework"],
        repoMode: repoMeta.mode,
        repoReused: Boolean(repoMeta.reused),
      },
    });
  } catch (_) {}

  res.json({
    success: true,
    plans,
    errors,
    repo: repoMeta,
    testingReport: plans.daily?.testingReport || null,
  });
}

async function refine(req, res) {
  try {
    const { module, existingPlan, feedback, focusDayKey } = req.body;
    if (!existingPlan || !feedback)
      return res.status(400).json({ success: false, error: "Missing existingPlan or feedback" });
    const userId = req.user?.id || req.user?._id || null;
    const refinedPlan = await refineExistingPlan(existingPlan, feedback, module, {
      userId,
      focusDayKey: focusDayKey || "",
    });
    res.json({ success: true, plan: refinedPlan });
  } catch (err) {
    console.error("Refinement failed:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

async function calendar(req, res) {
  try {
    const { startDate, endDate, exams } = req.body;
    if (!startDate || !endDate)
      return res.status(400).json({ error: "startDate and endDate are required" });
    if (startDate > endDate)
      return res.status(400).json({ error: "startDate must be before endDate" });
    const invalidExams = (exams || []).filter(ex => {
      if (!ex.startDate) return false;
      return ex.startDate < startDate || ex.startDate > endDate ||
             (ex.endDate && ex.endDate > endDate);
    });
    if (invalidExams.length > 0)
      return res.status(400).json({
        error: `Exam dates out of course range: ${invalidExams.map(e => e.name).join(", ")}. Course runs ${toDisplayDate(startDate)} to ${toDisplayDate(endDate)}.`
      });
    const result = await buildFullCalendar(startDate, endDate, exams || []);
    res.json(result);
  } catch (err) {
    console.error("Calendar build error:", err.message);
    res.status(500).json({ error: "Failed to build calendar" });
  }
}

async function uploadFiles(req, res) {
  try {
    const s3 = require("../utils/s3Storage");
    const UploadedFile = require("../models/UploadedFile");
    const { mergePlannerFileMeta } = require("./uploadController");
    const mongoose = require("mongoose");

    const extracted = {};
    const stored = {};
    const rawUserId = req.user?.id || req.user?._id || null;
    const email = req.user?.email || "";
    const ownerId =
      rawUserId && mongoose.Types.ObjectId.isValid(String(rawUserId))
        ? String(rawUserId)
        : null;

    for (const file of req.files || []) {
      const buffer = file.buffer || (file.path ? fs.readFileSync(file.path) : null);
      if (!buffer) continue;
      const text = await extractText(buffer, file.originalname);
      if (!extracted[file.fieldname]) extracted[file.fieldname] = [];
      extracted[file.fieldname].push({ filename: file.originalname, content: text });

      let meta = null;
      try {
        meta = await s3.uploadBuffer({
          buffer,
          contentType: file.mimetype,
          originalName: file.originalname,
          field: file.fieldname,
          userId: ownerId || rawUserId || "guest",
          email,
        });
        if (meta?.skipped) {
          console.warn("[upload] S3 skipped:", meta.reason);
        }
      } catch (e) {
        console.warn("[upload] S3 failed:", e.code || e.name, e.message);
        meta = { skipped: true, reason: e.code || e.name || "upload-failed" };
      }

      if (meta && !meta.skipped) {
        if (!stored[file.fieldname]) stored[file.fieldname] = [];
        const row = {
          filename: meta.originalName,
          storedName: meta.storedName,
          url: meta.url,
          publicUrl: meta.publicUrl,
          key: meta.key,
          bucket: meta.bucket,
          size: meta.size,
          type: meta.contentType,
          uploadedAt: meta.uploadedAt,
        };
        stored[file.fieldname].push(row);
        try {
          await UploadedFile.create({
            userId: ownerId,
            email,
            field: file.fieldname,
            originalName: meta.originalName,
            storedName: meta.storedName,
            bucket: meta.bucket,
            key: meta.key,
            url: meta.url,
            publicUrl: meta.publicUrl,
            contentType: meta.contentType,
            size: meta.size,
            uploadedAt: meta.uploadedAt,
          });
        } catch (e) {
          console.warn("[upload] Mongo file meta failed:", e.message);
        }
      }

      if (file.path) {
        try { fs.unlinkSync(file.path); } catch (_) {}
      }
    }

    if (ownerId && Object.keys(stored).length) {
      try {
        await mergePlannerFileMeta(ownerId, stored);
      } catch (e) {
        console.warn("[upload] planner input merge failed:", e.message);
      }
    }

    res.json({
      success: true,
      extracted,
      stored,
      storage: s3.isConfigured() ? "s3" : "extract-only",
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { generate, generateAll, refine, polish, calendar, uploadFiles, upload };