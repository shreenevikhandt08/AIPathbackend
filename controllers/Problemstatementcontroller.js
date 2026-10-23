const ProblemStatement = require("../models/Problemstatement");
const { callLLM }       = require("../utils/llm");
const { getYCUnicornProblems } = require("../utils/ycSearch");
const { DT_PLAYBOOK, getExactPlaybookQuestions } = require("../utils/dtPlaybookStructure");
const {
  fingerprintStatement,
  fingerprintFromParts,
  isFingerprintTaken,
  extractProvenance,
  matchInspiration,
  loadAllFingerprintsFromDb,
  findByFingerprint,
} = require("../utils/problemStatementFingerprint");
const { lookupDuplicates } = require("../utils/problemStatementOwners");

const FIVE_PILLARS = [
  "Center for Creativity (CFC)",
  "Center for Learning and Teaching (CLT)",
  "Skill and Career Development (SCD)",
  "Industry Institute Partnership Cell (IIPC)",
  "Social Responsibility Initiatives (SRI)",
];

const DT_PHASE_DETAILS = {
  empathize: "Empathize & Define: conduct user research, create personas, define opportunity/problem using empathy maps and problem statements",
  plan:      "Plan: design user actions, app state, feature selection, inclusion/accessibility considerations, UI/UX wireframes",
  prototype: "Prototype: sketch screens, create storyboard, refine app behavior, design style guide, build interactive Figma prototype",
  evaluate:  "Evaluate: app pitch to peers, user testing observation, post-testing interview, gather feedback and iterate",
  pitch:     "Pitch & BMC: Business Model Canvas analysis, customer sales pitch, pitch deck for mentors/industry/alumni",
};

// ── POST /api/problem-statement/generate ─────────────────────────────────────
exports.generateStatements = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      clubs           = [],   // [{ name, type }]
      count           = 3,
      difficulty      = "intermediate",
      timeline        = "4 weeks",
      selectedWeeks   = [4],  // multi-select array of week values
      pillars         = [],   // names of selected pillars
      dtPhases        = [],   // selected DT playbook phase ids
      aiIntegration   = true, // always default ON
      problemContext  = "",   // YC/unicorn inspired seed
      courseModules   = [],   // [{ moduleName, concepts }] - learning connectivity
      uniqueOnly      = true,
      excludeFingerprints = [],
      company: bodyCompany = "",
      year: bodyYear = "",
      sourceKind: bodySourceKind = "",
      sourceLabel: bodySourceLabel = "",
      detailed       = false,
      minWords       = 60,
    } = req.body;
    const wantDetailed = detailed === true || detailed === "true";
    const wordFloor = Number(minWords) || (wantDetailed ? 280 : 60);

    // Subjects are NO LONGER REQUIRED - removed subjects validation
    // User provides course modules instead to establish learning connectivity

    const technicalClubs    = clubs.filter(c => c.type === "technical").map(c => c.name);
    const nonTechnicalClubs = clubs.filter(c => c.type === "non-technical").map(c => c.name);

    // Build learning module context if provided, otherwise keep generic
    const learningBlock = courseModules.length > 0
      ? `COURSE MODULES AVAILABLE:\n${courseModules.map(m => `- ${m.moduleName}: ${(m.concepts || []).join(", ")}`).join("\n")}`
      : "No specific course modules provided — design generically applicable projects";

    const clubBlock = [
      technicalClubs.length    ? `Technical Clubs: ${technicalClubs.join(", ")}` : "",
      nonTechnicalClubs.length ? `Non-Technical Clubs: ${nonTechnicalClubs.join(", ")}` : "",
    ].filter(Boolean).join("\n");

    // Build DT phase guidance block
    const activePillars = pillars.length ? pillars : FIVE_PILLARS;
    const activeDTPhases = dtPhases.length
      ? dtPhases.map(id => DT_PHASE_DETAILS[id] || id).join("\n")
      : Object.values(DT_PHASE_DETAILS).join("\n");

  
    const weeksArray = Array.isArray(selectedWeeks) && selectedWeeks.length ? selectedWeeks : [4];
    const totalWeeks = weeksArray.reduce((a, b) => a + b, 0);
    const phaseIds = dtPhases.length ? dtPhases : ["empathize", "plan", "prototype", "evaluate"];
    const phaseLabelLookup = {
      empathize: "Empathize & Define",
      plan: "Plan",
      prototype: "Prototype",
      evaluate: "Evaluate",
      pitch: "Pitch & BMC",
    };
    const activePhaseLabels = phaseIds.map(id => phaseLabelLookup[id] || id);

    let weekToPhaseMap = [];
    if (weeksArray.length > 1 && weeksArray.length === activePhaseLabels.length) {
      weekToPhaseMap = weeksArray.map((w, i) => ({ weeks: w, phase: activePhaseLabels[i] }));
    } else {
      const perPhase = Math.max(1, Math.round(totalWeeks / activePhaseLabels.length));
      let remaining = totalWeeks;
      weekToPhaseMap = activePhaseLabels.map((phase, i) => {
        const isLast = i === activePhaseLabels.length - 1;
        const w = isLast ? remaining : Math.min(perPhase, remaining);
        remaining -= w;
        return { weeks: Math.max(1, w), phase };
      });
    }

    const weeklyScheduleHint = `
Total duration: ${totalWeeks} weeks, structured as:
${weekToPhaseMap.map(m => `- ${m.phase}: ${m.weeks} week(s)`).join("\n")}
Number weeks sequentially 1..${totalWeeks} across the WHOLE project (do not restart numbering per phase).
Key each entry in "weeklyDeliverables" exactly as "Week <n> (<Phase Label>)", e.g. "Week 1 (Empathize & Define)",
using the phase each week falls under per the breakdown above.`.trim();

   
    const totalDays  = totalWeeks * 5;
    const flatDTSteps = DT_PLAYBOOK
      .filter(week => activePhaseLabels.includes(week.stage))
      .flatMap(week => week.steps.map(step => ({
        stage: week.stage,
        weekNumber: week.week,
        stageGoal: week.goal,
        ...step,
      })));

    const dayStepTable = Array.from({ length: totalDays }, (_, i) => {
      const step = flatDTSteps[i];
      const dayNum = i + 1;
      if (!step) {
        return `Day ${dayNum} — DT Playbook steps for the selected phases are already complete. ` +
               `This is an APPLIED BUILD/ITERATION day — extend and polish the existing project. Do NOT repeat earlier steps.`;
      }
      return (
        `Day ${dayNum} — Phase: "${step.stage}" | Step: "${step.step}" | ` +
        `What to learn: ${step.whatToLearn} | ` +
        `DSA today: ${step.dsaConcept === "NA" ? "NONE (no algorithmic fit at this stage — do not invent one)" : step.dsaConcept}` +
        (step.discussionPrompt ? ` | Discussion question to open with: "${step.discussionPrompt}"` : "") +
        (() => {
          const exact = getExactPlaybookQuestions(step);
          return exact.length
            ? ` | Playbook worksheet wording (use this — do not paraphrase): ${exact.map(q => `"${q}"`).join(" / ")}`
            : "";
        })()
      );
    }).join("\n");

    const numStatements = Math.min(count, 5);

    const descriptionRule = wantDetailed
      ? `DESCRIPTION MUST BE FULL AND DETAILED — 280–450 words with labeled sections (Context, Users, Workaround, Why now, Product, Constraints, Metric, Analog).`
      : `DESCRIPTION MUST BE SHORT AND SWEET — 3 to 6 sentences (~${wordFloor}–120 words). Cover only: who has the pain, what fails today, what to build, one success metric, analog company + year. No multi-paragraph essay.`;

    const prompt = `
You are a mentor at SNS Innovation Hub helping a BEGINNER engineering student do their first AI project using the SNS Design Thinking Playbook.

Generate 1 project problem statement. It must include a crystal-clear DAY-BY-DAY schedule for the full project.

${problemContext ? `PROJECT INSPIRATION (YC/Unicorn context):\n${problemContext}\n` : ""}
${learningBlock}
${clubBlock ? `CLUBS: ${clubBlock}` : ""}
PILLARS: ${activePillars.slice(0,3).join(", ")}
DIFFICULTY: ${difficulty} | TIMELINE: ${timeline} | TOTAL WEEKS: ${totalWeeks}
STATEMENT LENGTH: ${descriptionRule}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SNS DT PLAYBOOK — EXACT DAY-BY-DAY TABLE (MANDATORY)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Below is the EXACT, pre-computed mapping of calendar day → DT Playbook step. This is not a
suggestion — you MUST follow it verbatim, one step per day:
- Do NOT combine two or more steps into the same day (e.g. do not do "Empathize + Define + Ideate" together on Day 1).
- Do NOT skip a step or reorder the sequence.
- Do NOT invent a DSA topic on a day marked "NONE".
- If a day says "APPLIED BUILD/ITERATION day", do not repeat any earlier DT step — extend the existing project instead.

${dayStepTable}

For EACH day's JSON entry (see schema below), generate content SPECIFIC to that one day's step only:
- "dtPhase" = the Phase listed for that day above
- "dtPlaybookActivity" = start by quoting the exact "Playbook worksheet wording" given above for that day verbatim, then add one sentence applying it to THIS project's problem — do not paraphrase the playbook wording itself
- "dsaOfTheDay" = exactly what's listed above for that day ("None — ..." if marked NONE)
- "learn" / "implement" / "reflection" = written specifically for that one step, grounded in the project's actual problem statement
- If the day's step includes a discussion question above, "implement" or "reflection" must open with the student answering that question in their own words BEFORE any task.

CONNECTIVITY RULE — each day must show:
  LEARN → DSA → PROJECT (the student sees how today's concept connects to their project)
  Example Day: Learn "what is an array" → DSA: write a Python list of 5 user pain points → Project: store your empathy map responses in that list

${aiIntegration ? `AI INTEGRATION: Each project uses GenAI meaningfully. Introduce AI tools only in Prototype week — not on Day 1.` : ""}

CODING PRACTICE RULE (applies everywhere a coding problem is referenced — dailySchedule, codingPlatforms, everything):
- Always name a REAL, actual, currently-existing problem on the named platform (e.g. LeetCode "Two Sum", "Valid Parentheses", "Contains Duplicate"; HackerRank "Solve Me First", "Simple Array Sum") that matches the day's DSA topic and difficulty.
- Give 2–3 named choices, not just one, so the student can pick.
- NEVER reuse the same problem from a previous day. Every day must have a DIFFERENT named problem.
- NEVER output just a bare difficulty word ("Easy") or a placeholder like "LC-1"/"Problem 3" with no real name.
- Rotate platforms across days: Monday→HackerRank, Tuesday→LeetCode, Wednesday→Exercism, Thursday→CodeChef, Friday→GeeksForGeeks. Never use the same platform two days in a row.

PROBLEM STATEMENT BREAKDOWN RULE — for EACH day's "problemBreakdown" field, provide ALL of the following stages. This is mandatory, not optional:

  ▸ EMPATHY STAGE — "Who hurts and how bad?":
    • Name the exact user persona: age, role, context, daily struggle related to this problem.
    • Describe what they currently do (workaround) and why it fails them.
    • Empathy prompt: "If I spent 1 day with this user, what would I observe?"
    • Emotion: what does the user FEEL — frustrated, overwhelmed, embarrassed, hopeful?
    • Quote: write 1 fictional but realistic user quote that captures their pain.

  ▸ RESEARCH STAGE — "What do we know and not know?":
    • List 3 things already known about this problem space (facts, data, existing tools).
    • List 3 unknowns that need to be discovered through user interviews or observation.
    • Name 2 existing solutions/competitors and their limitations.
    • Suggest: search query the student should run to find real data (e.g. "impact of X on Y site:scholar.google.com").

  ▸ TECHNICAL STAGE — "How do we build this?":
    • Recommended tech stack for THIS specific problem:
        - Frontend: [name the specific framework/language and WHY it fits this problem]
        - Backend: [name the specific framework and WHY — e.g. "FastAPI because this needs a fast ML inference endpoint"]
        - Database: [SQL/NoSQL and specific db, WHY — e.g. "MongoDB because user profiles are document-like and schema-free"]
        - AI/ML component (if aiIntegration=true): [specific model/API, e.g. "OpenAI GPT-4o for chat, or Hugging Face sentence-transformers for semantic search"] + why this choice
        - Deployment: [specific platform, e.g. "Render or Railway for backend, Vercel for frontend, free tier"]
    • Architecture in 3 lines: describe the data flow from user input → processing → output.
    • Biggest technical challenge: name the #1 hard engineering problem this project must solve.
    • Beginner entry point: "On Day 1, a complete beginner should start by doing exactly: [very specific first step]"

  ▸ GUIDE STAGE — "What does the student do TODAY?":
    • Give the specific task for THIS day's DT step in 3 bullet points that a beginner can act on immediately.
    • End with: "You will know you are done when: [specific, testable completion criterion]"

Return ONLY valid JSON — no markdown, no trailing commas:
{
  "statements": [
    {
      "title": "Specific startup-style project title",
      "description": ${wantDetailed
        ? `"Full detailed problem statement (280–450 words)"`
        : `"Short 3–6 sentence problem statement: who has the pain, what fails today, what to build, one success metric, analog company + year."`},
      "objectives": ["Obj 1", "Obj 2", "Obj 3"],
      "deliverables": ["Final deliverable 1", "Final deliverable 2", "Final deliverable 3"],
      "timeline": "${timeline}",
      "teamSize": "3-5 students",
      "difficulty": "${difficulty}",
      "pillars": ["Pillar 1", "Pillar 2"],
      "dtPhases": ${JSON.stringify(dtPhases.length ? dtPhases : ["empathize","plan","prototype","evaluate"])},
      "aiIntegration": ${aiIntegration},
      "aiDetails": "Exactly how GenAI is used — which tool, which feature, which week it is introduced",
      "involvedClubs": ["Club name"],
      "tags": ["tag1", "tag2", "GenAI", "DT-Playbook"],
      "weeklyDeliverables": {
        "Week 1 (Empathize & Define)": ["Fill empathy map", "Define problem statement"],
        "Week 2 (Plan)": ["User action list", "UI wireframe"],
        "Week 3 (Prototype)": ["Figma prototype", "System design diagram"],
        "Week 4 (Evaluate & Pitch)": ["User test report", "Final pitch deck"]
      },
      "problemBreakdown": {
        "empathy": {
          "userPersona": "Name, age, role, and daily context of the primary user",
          "currentWorkaround": "What they do today and why it fails them",
          "empathyPrompt": "If I spent 1 day with this user, I would observe...",
          "userEmotion": "frustrated / overwhelmed / hopeful / embarrassed — choose the strongest",
          "userQuote": "A realistic quote capturing their exact pain in their own words"
        },
        "research": {
          "knownFacts": ["Fact 1 with source", "Fact 2", "Fact 3"],
          "unknowns": ["Unknown 1 — investigate via user interview", "Unknown 2", "Unknown 3"],
          "existingSolutions": [
            { "name": "Competitor A", "limitation": "Why it still fails users" },
            { "name": "Competitor B", "limitation": "Why it still fails users" }
          ],
          "suggestedSearchQuery": "Exact search query to find real data on this problem"
        },
        "technical": {
          "recommendedStack": {
            "frontend": "Framework + specific reason why it fits this project",
            "backend": "Framework + specific reason (e.g. FastAPI for ML speed)",
            "database": "DB name + specific reason (SQL vs NoSQL justified)",
            "aiComponent": "Model or API name + why this specific choice (if aiIntegration=true)",
            "deployment": "Platform + reason + cost (free tier or not)"
          },
          "architectureFlow": "User input → [Step 1 processing] → [Step 2] → Output shown to user",
          "biggestTechnicalChallenge": "The #1 hardest engineering problem this project must solve",
          "beginnerEntryPoint": "On Day 1, a complete beginner should start by doing EXACTLY: [very specific first action]"
        },
        "guide": {
          "todayTask": ["Specific action 1 a beginner can do RIGHT NOW", "Specific action 2", "Specific action 3"],
          "doneWhen": "You will know you are done today when: [specific, testable criterion]"
        }
      },
      "dailySchedule": [
        {
          "day": 1,
          "week": 1,
          "dtPhase": "Empathize & Define",
          "dtPlaybookActivity": "SNS Playbook p.8 — \"Brainstorm a list of opportunities, problems, or challenges you care about.\" Applied here: write 5 real problems you or your friends face every day.",
          "learn": "What is Design Thinking and why we start with the user — read the SNS Playbook overview (p.7)",
          "dsaOfTheDay": "None — today is pure observation and design thinking. No coding yet.",
          "implement": "Write 5 real problems you or your friends face every day. Pick the most important one.",
          "reflection": "Who is actually suffering from this problem and why hasn't anyone fixed it yet?",
          "problemBreakdown": {
            "empathyNote": "Observe today — do NOT jump to solutions. Your goal is to understand, not to build.",
            "researchNote": "Search for real data: look up news articles, Reddit posts, or Quora questions about this problem.",
            "technicalNote": "No coding today. Instead, sketch the architecture on paper: what are the 3 main parts of a solution?",
            "guideNote": "Done when: you have written 5 real problems AND circled the ONE you will focus on, with a 1-sentence reason why.",
            "codingPractice": {
              "platform": "HackerRank",
              "problemName": "Compare the Triplets",
              "alternativeChoices": ["Diagonal Difference", "Plus Minus"],
              "difficulty": "Easy",
              "whyThisProblem": "Practice basic arrays and I/O — foundation for storing observation notes as lists"
            }
          }
        },
        {
          "day": 2,
          "week": 1,
          "dtPhase": "Empathize & Define",
          "dtPlaybookActivity": "SNS Playbook p.9 — \"Think about the products/ apps that you use. Identify each product's/ app's purpose and why you use it.\" Applied here: find 3 existing apps that try to solve your problem.",
          "learn": "How to analyse a competitor app — look at reviews, features, and what users complain about",
          "dsaOfTheDay": "None — still in empathy stage. Observation only.",
          "implement": "Download or visit 2 existing apps related to your problem. Write what they do well and what they miss.",
          "reflection": "DONE: competitor notes. LEARNED: one gap. STUCK: what is still unclear about the user?",
          "problemBreakdown": {
            "empathyNote": "Read real user reviews of competitor apps (1-star reviews tell you what is broken). Write 3 quotes from actual reviews.",
            "researchNote": "Search: '[competitor app name] problems site:reddit.com' — find what users complain about most.",
            "technicalNote": "Look at the competitor's tech stack if possible (use stackshare.io or their job listings). What can you do differently?",
            "guideNote": "Done when: you have analysed 2 existing apps and listed at least 2 specific gaps you will address.",
            "codingPractice": {
              "platform": "LeetCode",
              "problemName": "Best Time to Buy and Sell Stock",
              "alternativeChoices": ["Maximum Subarray", "Move Zeroes"],
              "difficulty": "Easy",
              "whyThisProblem": "Practice scanning arrays — same pattern as scanning competitor feature lists for gaps"
            }
          }
        }
      ],
      "systemDesignPhase": {
        "isRequired": true,
        "description": "Before writing any code: draw your system architecture, data models, and API flow",
        "estimatedHours": 4,
        "introducedOnDay": 11
      },
      "codingPlatforms": [
        {
          "platform": "HackerRank",
          "problemName": "Compare the Triplets",
          "alternativeChoices": ["Diagonal Difference", "Plus Minus"],
          "difficulty": "Easy",
          "topicsCovered": ["Arrays"],
          "relevance": "Practice storing and comparing values — same pattern used when scoring user needs",
          "introducedOnDay": 1
        }
      ],
      "learningPrerequisites": [
        {
          "topic": "Arrays and Lists",
          "when": "Week 2, Day 1",
          "why": "You will store user action items as a Python list before building the backend"
        }
      ],
      "courseModules": [
        {
          "moduleName": "Arrays and Strings",
          "concepts": ["list indexing", "iteration", "string split"],
          "readinessLevel": "Week 2"
        }
      ]
    }
  ]
}

IMPORTANT:
- dailySchedule must have EXACTLY ${totalDays} entries (${totalWeeks} weeks × 5 days)
- Follow the Day-by-Day table above EXACTLY — one DT step per day, no bundling, no skipping, no reordering
- Each day's "implement" task must be doable in 2 hours by a beginner
- Every day must feel different — different activity, different output
- Generate exactly 1 problem statement
`.trim();

    // One call per statement — see comment above the prompt for why (token cap).
    const missingSchedule = (s) => !s || !Array.isArray(s.dailySchedule) || s.dailySchedule.length !== totalDays;

    const generateOneStatement = async () => {
      const raw = await callLLM(prompt, 4096);
      let statement = Array.isArray(raw?.statements) ? raw.statements[0] : null;
      if (missingSchedule(statement)) {
        // one retry — occasionally the model still trims/loses a few days
        const retry = await callLLM(prompt, 4096).catch(() => null);
        const retryStatement = Array.isArray(retry?.statements) ? retry.statements[0] : null;
        if (!missingSchedule(retryStatement)) statement = retryStatement;
      }
      return statement;
    };

    const results = await Promise.all(
      Array.from({ length: numStatements }, () => generateOneStatement())
    );

    if (!results.some(s => s)) {
      return res.status(500).json({ success: false, error: "LLM returned no statements" });
    }

    const droppedTitles = results.filter(missingSchedule).map(s => s?.title).filter(Boolean);
    let statements = results.filter(s => !missingSchedule(s));

    if (!statements.length) {
      return res.status(500).json({
        success: false,
        error: "The AI didn't generate a valid day-by-day schedule for any statement. Please try again.",
      });
    }

    // Skip fingerprints already stored (any user) or excluded by the client
    let taken = Array.isArray(excludeFingerprints)
      ? excludeFingerprints.map(String).filter(Boolean)
      : [];
    if (uniqueOnly !== false) {
      try {
        const dbTaken = await loadAllFingerprintsFromDb(ProblemStatement);
        taken = Array.from(new Set([...taken, ...dbTaken]));
      } catch (e) {
        console.warn("fingerprint load failed:", e.message);
      }
    }

    const skipped = [];
    statements = statements.filter((s) => {
      const fp = fingerprintFromParts(s.title, s.description);
      if (uniqueOnly !== false && isFingerprintTaken(fp || s.description, taken)) {
        skipped.push(s.title || fp);
        return false;
      }
      if (fp) taken.push(fp);
      return true;
    });

    if (!statements.length) {
      return res.status(409).json({
        success: false,
        error: "Every generated statement fingerprint is already taken. Try a different seed or filters.",
        skipped,
      });
    }

    // Origin provenance from body + YC/Unicorn inspiration match
    let inspirationPool = [];
    try {
      const insp = await getYCUnicornProblems(false);
      inspirationPool = Array.isArray(insp?.data) ? insp.data : [];
    } catch (_) { /* optional */ }

    // Keep generate descriptions short unless detailed:true
    const clipShort = (text) => {
      try {
        const { clipToShortStatement } = require("../utils/problemFrameworkValidate");
        return clipToShortStatement(text, {
          maxSentences: 6,
          maxWords: Math.max(90, Math.min(160, wordFloor + 60)),
        });
      } catch (_) {
        const parts = String(text || "").match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [String(text || "")];
        return parts.slice(0, 6).join(" ").trim();
      }
    };

    const saved = [];
    for (const s of statements) {
      if (!wantDetailed && s.description) {
        s.description = clipShort(s.description);
      }
      const blob = `${s.title || ""} ${s.description || ""}`;
      const idea = matchInspiration(blob, inspirationPool) || matchInspiration(problemContext, inspirationPool);
      const prov = extractProvenance(
        {
          company: bodyCompany || s.company,
          year: bodyYear || s.year,
          sourceKind: bodySourceKind || s.sourceKind,
          sourceLabel: bodySourceLabel || s.sourceLabel,
        },
        idea
      );
      const fp = fingerprintFromParts(s.title, s.description);
      try {
        const doc = await ProblemStatement.create({
          userId,
          title:              s.title,
          clubs:              clubs,
          pillars:            s.pillars || activePillars.slice(0, 3),
          description:        s.description,
          fingerprint:        fp,
          company:            prov.company,
          year:               prov.year,
          sourceKind:         prov.sourceKind,
          sourceLabel:        prov.sourceLabel,
          batch:              prov.batch,
          workingOn:          prov.workingOn,
          sourceUrl:          prov.url,
          objectives:         s.objectives || [],
          deliverables:       s.deliverables || [],
          weeklyDeliverables: s.weeklyDeliverables || {},
          timeline:           s.timeline || timeline,
          teamSize:           s.teamSize || "3-5 students",
          difficulty:         s.difficulty || difficulty,
          dtPhases:           s.dtPhases || dtPhases,
          aiIntegration:      s.aiIntegration !== undefined ? s.aiIntegration : aiIntegration,
          aiDetails:          s.aiDetails || "",
          tags:               s.tags || [],
          problemBreakdown:   s.problemBreakdown || null,
          dailySchedule:         s.dailySchedule || [],
          learningPrerequisites: s.learningPrerequisites || [],
          systemDesignPhase:     s.systemDesignPhase || { isRequired: true, estimatedHours: 4 },
          codingPlatforms:       s.codingPlatforms || [],
          courseModules:         s.courseModules || [],
        });
        saved.push(doc);
      } catch (createErr) {
        if (createErr?.code === 11000) {
          skipped.push(s.title || fp);
          continue;
        }
        throw createErr;
      }
    }

    if (!saved.length) {
      return res.status(409).json({
        success: false,
        error: "All generated statements collided with existing fingerprints.",
        skipped,
      });
    }

    const warnings = [];
    if (droppedTitles.length) {
      warnings.push(
        `${droppedTitles.length} statement(s) were dropped because the AI didn't produce a valid schedule: ${droppedTitles.join(", ")}`
      );
    }
    if (skipped.length) {
      warnings.push(`${skipped.length} statement(s) skipped (fingerprint already taken)`);
    }

    return res.json({
      success: true,
      data: saved,
      ...(warnings.length ? { warning: warnings.join(" · ") } : {}),
    });
  } catch (err) {
    console.error("generateStatements error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

function escapeRegExp(text = "") {
  return String(text).replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

function buildAccuracyChecks(report = {}, filters = {}) {
  const checks = [];
  checks.push({
    id: "framework-yc-or-unicorn",
    label: "Framework fit (YC OR Unicorn)",
    pass: Boolean(report.fitsYC || report.fitsUnicorn),
    note: report.fitsYC || report.fitsUnicorn
      ? "YC " + (report.ycPassCount || 0) + "/" + (report.ycTotal || 0) + ", Unicorn " + (report.unicornPassCount || 0) + "/" + (report.unicornTotal || 0)
      : "Need stronger YC/Unicorn framing signals",
    evidence: [report.verdict || ""].filter(Boolean),
  });
  checks.push({
    id: "thrust-map",
    label: "SNS thrust mapping (tech OR industry)",
    pass: Boolean(report.fits77),
    note: report.fits77 ? "Mapped to SNS thrust area" : "Map to at least one SNS tech or industry",
    evidence: [
      report.primaryTech ? "Tech: " + report.primaryTech : "",
      report.primaryVertical ? "Industry: " + report.primaryVertical : "",
    ].filter(Boolean),
  });
  checks.push({
    id: "source-freshness",
    label: "Source freshness & traceability",
    pass: Boolean(report.sourceUrl || report.sourceFetchedAt),
    note: report.sourceFetchedAt ? "Source timestamp available" : "Using available source metadata",
    evidence: [
      report.sourceUrl ? "sourceUrl: " + report.sourceUrl : "",
      report.sourceFetchedAt ? "fetchedAt: " + report.sourceFetchedAt : "",
      Number.isFinite(Number(report.sourceConfidence)) ? "confidence: " + Number(report.sourceConfidence).toFixed(2) : "",
    ].filter(Boolean),
  });
  if (filters.kind && filters.kind !== "all") {
    checks.push({
      id: "requested-kind",
      label: "Requested source kind",
      pass: report.sourceKind === filters.kind || report.sourceKind === "both",
      note: "Requested kind: " + filters.kind,
      evidence: ["resolved: " + (report.sourceKind || "unknown")],
    });
  }
  if (filters.year) {
    checks.push({
      id: "requested-year",
      label: "Requested source year",
      pass: String(report.year || "") === String(filters.year),
      note: "Requested year: " + filters.year,
      evidence: ["resolved: " + (report.year || "unknown")],
    });
  }
  checks.push({
    id: "requested-window",
    label: "Requested source window",
    pass: true,
    note: "Applied window: " + (filters.window || "recent"),
    evidence: [
      "kind: " + (filters.kind || "all"),
      "mode: " + (filters.mode || "all"),
      filters.month ? "month: " + filters.month : "",
    ].filter(Boolean),
  });
  return checks;
}

exports.getYCInspiration = async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === "1" || req.query.refresh === "true";
    const yearRaw = req.query.year;
    const monthRaw = req.query.month;
    const window = String(req.query.window || "recent").toLowerCase();
    const kind = String(req.query.kind || "all").toLowerCase();
    const result = await getYCUnicornProblems(forceRefresh, {
      mode: req.query.mode || "all",
      kind,
      year: yearRaw != null && yearRaw !== "" ? Number(yearRaw) : null,
      month: monthRaw != null && monthRaw !== "" ? Number(monthRaw) : null,
      window,
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// POST /api/problem-statement/validate  { problemText, useLLM? }
exports.validateProblemFramework = async (req, res) => {
  try {
    const { validateProblemStatement } = require("../utils/problemFrameworkValidate");
    const {
      INNOVATION_TECHNOLOGIES,
      INDUSTRY_VERTICALS,
    } = require("../data/snsThrustAreas");
    const problemText = req.body.problemText || req.body.problem || "";
    const useLLM = req.body.useLLM !== false;
    const numDays = req.body.numDays || req.body.days || 5;
    const sourceFilters = {
      year: req.body.year != null && req.body.year !== "" ? Number(req.body.year) : null,
      month: req.body.month != null && req.body.month !== "" ? Number(req.body.month) : null,
      kind: req.body.kind || "all",
      window: req.body.window || "recent",
      mode: req.body.mode || "all",
    };

    const report = await validateProblemStatement(problemText, { useLLM, numDays, sourceFilters });
    const inspiration = await getYCUnicornProblems(false, sourceFilters);
    const inspirationRows = Array.isArray(inspiration?.data) ? inspiration.data : [];
    const matched = matchInspiration(problemText, inspirationRows);
    const prov = extractProvenance(report, matched);

    let dbMeta = null;
    const companyNeedle = prov.company || report.company || matched?.company || "";
    if (companyNeedle) {
      dbMeta = await ProblemStatement.findOne(
        { company: { $regex: new RegExp(escapeRegExp(companyNeedle), "i") } },
        { company: 1, year: 1, sourceKind: 1, sourceLabel: 1, sourceUrl: 1, batch: 1, updatedAt: 1, createdAt: 1 }
      ).sort({ updatedAt: -1 }).lean();
    }

    const mergedReport = {
      ...report,
      sourceKind: prov.sourceKind || report.sourceKind || dbMeta?.sourceKind || matched?.kind || "",
      sourceLabel: prov.sourceLabel || report.sourceLabel || dbMeta?.sourceLabel || matched?.source || "",
      company: prov.company || report.company || dbMeta?.company || "",
      year: prov.year || report.year || dbMeta?.year || (matched?.year != null ? String(matched.year) : ""),
      sourceUrl: prov.url || report.sourceUrl || dbMeta?.sourceUrl || matched?.sourceUrl || "",
      sourceFetchedAt: matched?.fetchedAt || dbMeta?.updatedAt || dbMeta?.createdAt || inspiration?.generatedDate || null,
      sourceConfidence: Number.isFinite(Number(matched?.confidence))
        ? Number(matched.confidence)
        : inspiration?.isLive
          ? 0.8
          : 0.6,
      sourceMeta: {
        isLive: !!inspiration?.isLive,
        cached: !!inspiration?.cached,
        staleCacheUsed: !!inspiration?.staleCacheUsed,
        ttlMs: inspiration?.ttlMs || null,
      },
    };

    mergedReport.checks = buildAccuracyChecks(mergedReport, sourceFilters);

    return res.json({
      success: true,
      report: mergedReport,
      catalogs: {
        innovationTechnologies: INNOVATION_TECHNOLOGIES.map((t) => ({ id: t.id, name: t.name })),
        industryVerticals: INDUSTRY_VERTICALS.map((v) => ({ id: v.id, name: v.name })),
      },
    });
  } catch (err) {
    console.error("validateProblemFramework:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// POST /api/problem-statement/rewrite  { problemText, framework, tech?, vertical?, mode?, seed? }
exports.rewriteProblemFramework = async (req, res) => {
  try {
    const { rewriteProblemStatement } = require("../utils/problemFrameworkValidate");
    const problemText = req.body.problemText || req.body.problem || "";
    const framework = req.body.framework || "all";
    const result = await rewriteProblemStatement(problemText, framework, {
      tech: req.body.tech || (Array.isArray(req.body.techs) ? req.body.techs[0] : "") || "",
      vertical: req.body.vertical || (Array.isArray(req.body.verticals) ? req.body.verticals[0] : "") || "",
      techs: req.body.techs || [],
      verticals: req.body.verticals || [],
      mode: req.body.mode || "",
      seed: req.body.seed || "",
      numDays: req.body.numDays || req.body.days || req.body.totalDays || 5,
      count: req.body.count || 1,
      variation: req.body.variation || 0,
      uniqueOnly: req.body.uniqueOnly !== false,
      excludeFingerprints: req.body.excludeFingerprints || [],
      excludeAssigned: req.body.excludeAssigned !== false,
      detailed: req.body.detailed === true,
      minWords: req.body.minWords || 0,
      year: req.body.year || "",
      kind: req.body.kind || "",
    });
    const options = Array.isArray(result?.options)
      ? result.options
      : Array.isArray(result?.candidates)
        ? result.candidates
        : result
          ? [result]
          : [];
    const rewritten = result?.rewritten || options[0] || result;
    return res.json({
      success: true,
      rewritten,
      options,
      candidates: options,
    });
  } catch (err) {
    console.error("rewriteProblemFramework:", err.message);
    const msg = String(err.message || "");
    if (/already taken|fingerprint/i.test(msg)) {
      return res.status(409).json({ success: false, error: msg });
    }
    return res.status(500).json({ success: false, error: err.message });
  }
};

// GET /api/problem-statement/thrust-areas
exports.getThrustAreas = async (req, res) => {
  try {
    const {
      INNOVATION_TECHNOLOGIES,
      INDUSTRY_VERTICALS,
      YC_CHECKS,
      UNICORN_CHECKS,
    } = require("../data/snsThrustAreas");
    return res.json({
      success: true,
      innovationTechnologies: INNOVATION_TECHNOLOGIES,
      industryVerticals: INDUSTRY_VERTICALS,
      ycChecks: YC_CHECKS,
      unicornChecks: UNICORN_CHECKS,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ── GET /api/problem-statement ────────────────────────────────────────────────
exports.getAllStatements = async (req, res) => {
  try {
    const docs = await ProblemStatement.find({ userId: req.user.id }).sort({ createdAt: -1 });
    return res.json({ success: true, data: docs });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ── DELETE /api/problem-statement/:id ────────────────────────────────────────
exports.deleteStatement = async (req, res) => {
  try {
    await ProblemStatement.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.quickCreate = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      title,
      description,
      fingerprint: bodyFp = "",
      uniqueOnly = true,
      claimExclusive = true,
      allowDuplicate = false,
      sourceKind = "",
      company = "",
      year = "",
      sourceLabel = "",
      batch = "",
      workingOn = "",
      sourceUrl = "",
    } = req.body;

    if (!title || !String(title).trim()) {
      return res.status(400).json({ success: false, error: "title is required" });
    }

    const desc = (description && String(description).trim()) || String(title).trim();
    const fp =
      fingerprintStatement(bodyFp) ||
      fingerprintFromParts(title, desc);

    // Duplicate = reminder, not a block. Without allowDuplicate we answer 409 with
    // code DUPLICATE_STATEMENT and the list of people who already hold it; the UI
    // then lets the user reuse the same problem for their own plan or pick another.
    if (!allowDuplicate && fp) {
      const matches = await lookupDuplicates(ProblemStatement, fp, userId);
      if (matches.length) {
        return res.status(409).json({
          success: false,
          code: "DUPLICATE_STATEMENT",
          error: "This problem statement already exists.",
          fingerprint: fp,
          existingId: matches[0].statementId,
          matches,
        });
      }
    }

    let inspiration = null;
    try {
      const insp = await getYCUnicornProblems(false);
      inspiration = matchInspiration(`${title} ${desc}`, Array.isArray(insp?.data) ? insp.data : []);
    } catch (_) { /* optional */ }
    const prov = extractProvenance(
      { sourceKind, company, year, sourceLabel, batch, workingOn, sourceUrl },
      inspiration
    );

    let doc;
    try {
      doc = await ProblemStatement.create({
        userId,
        title: String(title).trim().slice(0, 200),
        description: desc,
        fingerprint: fp,
        company: prov.company,
        year: prov.year,
        sourceKind: prov.sourceKind,
        sourceLabel: prov.sourceLabel,
        batch: prov.batch,
        workingOn: prov.workingOn,
        sourceUrl: prov.url,
        dailySchedule: [],
      });
    } catch (createErr) {
      throw createErr;
    }

    return res.json({ success: true, data: doc });
  } catch (err) {
    console.error("quickCreate error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ── POST /api/problem-statement/check  { title?, description }  ──────────────
// Tells the UI whether a statement already exists and who holds it.
exports.checkDuplicate = async (req, res) => {
  try {
    const { title = "", description = "", text = "" } = req.body || {};
    const fp = fingerprintFromParts(title, description || text) || fingerprintStatement(text);
    if (!fp) return res.json({ success: true, exists: false, matches: [] });
    const matches = await lookupDuplicates(ProblemStatement, fp, req.user.id);
    return res.json({ success: true, exists: matches.length > 0, fingerprint: fp, matches });
  } catch (err) {
    console.error("checkDuplicate:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};
