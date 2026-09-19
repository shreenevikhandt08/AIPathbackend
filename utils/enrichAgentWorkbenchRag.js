/**
 * Agent Workbench RAG — independent of the student's project problem statement.
 * Pulls easy automation / free-API practice ideas from the web for SNS Agent Workbench.
 */
const axios = require("axios");
const { callLLM } = require("./llm");
const { FREE_APIS, WORKBENCH_TASKS, stripLinks } = require("../data/agentWorkbenchBanks");

const ONLINE_MODEL = "openai/gpt-4o-mini:online";

function clip(text, n = 2800) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

async function callOnlineJson(prompt, maxTokens = 2800) {
  const clampedTokens = Math.min(maxTokens, 4096);
  const response = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      model: "openai/gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: clampedTokens,
    },
    // {
    //   model: ONLINE_MODEL,
    //   messages: [{ role: "user", content: prompt }],
    //   temperature: 0.4,
    //   max_tokens: maxTokens,
    // },
    {
      headers: {
        Authorization: "Bearer " + process.env.OPENROUTER_API_KEY,
        "Content-Type": "application/json",
      },
      timeout: 55001,
    }
  );

  const raw = response.data.choices?.[0]?.message?.content || "";
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const match = cleaned.match(/(\{[\s\S]*\})/);
  return JSON.parse(match ? match[1] : cleaned);
}

function buildRagPrompt(count) {
  const freeList = FREE_APIS.map((a) => `- ${a.name}: ${a.task}`).join("\n");
  return `
You design CLEAR beginner Agent Workbench / n8n-style tasks for college students who are new to automation.

IMPORTANT:
- Do NOT mention any student project problem statement.
- No URLs / API links anywhere.
- Every task must be fully defined so a beginner knows exactly what to build.

Known practice themes:
${freeList}

Return ONLY valid JSON:
{
  "webInsights": ["short tip"],
  "sources": ["site name"],
  "tasks": [
    {
      "dayIndex": 0,
      "title": "Short task name (what the agent is called)",
      "theme": "HTTP|Transform|IF|Schedule|Webhook",
      "what": "1-2 sentences: what the finished agent does",
      "steps": [
        "Step 1 with concrete node action",
        "Step 2",
        "Step 3",
        "Step 4",
        "Step 5"
      ],
      "doneWhen": "Exact success check (file name + fields that must appear)"
    }
  ]
}

Rules:
- Exactly ${count} tasks, dayIndex 0..${count - 1}.
- Each task needs title + what + 4–6 concrete steps + doneWhen.
- Steps must name nodes (Manual Trigger, HTTP Request, Set, IF, Write file).
- No URLs. No vague lines like "explore the tool".
`.trim();
}

function fallbackTasks(count) {
  const tasks = [];
  for (let i = 0; i < count; i++) {
    const bank = WORKBENCH_TASKS[i % WORKBENCH_TASKS.length];
    tasks.push({
      dayIndex: i,
      title: bank.title,
      theme: "HTTP",
      apiName: bank.title,
      what: bank.what,
      steps: bank.steps,
      buildSteps: bank.steps.map((s, n) => `${n + 1}) ${s}`).join("\n"),
      skillFocus: bank.what,
      doneWhen: bank.success,
      success: bank.success,
    });
  }
  return {
    webInsights: [
      "Start with Manual Trigger → one HTTP/Set → write a file before adding branches.",
      "A task is done only when the output file shows the required fields.",
    ],
    sources: ["bank-fallback"],
    tasks,
    mode: "fallback",
  };
}

function normalizePack(parsed, count, mode) {
  const base = fallbackTasks(count);
  if (!parsed || typeof parsed !== "object") return { ...base, mode };

  const tasksIn = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  const tasks = [];
  for (let i = 0; i < count; i++) {
    const t = tasksIn[i] || tasksIn[i % Math.max(1, tasksIn.length)] || {};
    const fb = base.tasks[i];
    const stepsIn = Array.isArray(t.steps)
      ? t.steps.map((s) => stripLinks(String(s))).filter(Boolean)
      : [];
    const steps = stepsIn.length >= 3 ? stepsIn : fb.steps;
    const what = stripLinks(String(t.what || t.skillFocus || fb.what).trim());
    const doneWhen = stripLinks(String(t.doneWhen || t.success || fb.doneWhen).trim());
    tasks.push({
      dayIndex: i,
      title: stripLinks(String(t.title || fb.title).trim()),
      theme: String(t.theme || fb.theme).trim(),
      apiName: stripLinks(String(t.apiName || fb.apiName || "").trim()),
      what,
      steps,
      buildSteps: steps.map((s, n) => `${n + 1}) ${s}`).join("\n"),
      skillFocus: what,
      doneWhen,
      success: doneWhen,
    });
  }

  return {
    webInsights: Array.isArray(parsed.webInsights) && parsed.webInsights.length
      ? parsed.webInsights.map((x) => String(x).trim()).filter(Boolean).slice(0, 5)
      : base.webInsights,
    sources: Array.isArray(parsed.sources) ? parsed.sources.map(String).slice(0, 8) : [],
    tasks,
    mode,
  };
}

/** @param {string} [_ignoredProblem] kept for call-site compatibility — NOT used */
async function enrichAgentWorkbenchRag(_ignoredProblem, numDays = 10) {
  console.log(`🌐 RAG Agent Workbench (separate skill track, days=${numDays})…`);
  let parsed = null;
  let mode = "online";
  try {
    parsed = await callOnlineJson(buildRagPrompt(numDays), 3200);
  } catch (err) {
    console.warn("Online Agent RAG failed, trying offline LLM:", err.message);
    mode = "offline";
    try {
      parsed = await callLLM(
        buildRagPrompt(numDays) +
          `\n\n(Web search unavailable — invent ${numDays} free-API beginner automation tasks. Do not mention any student project.)`,
        2500
      );
    } catch (err2) {
      console.warn("Offline Agent RAG failed:", err2.message);
      const pack = fallbackTasks(numDays);
      console.log(`⚠️ Agent Workbench RAG emergency fallback (${pack.tasks.length} tasks)`);
      return pack;
    }
  }

  const pack = normalizePack(parsed, numDays, mode);
  console.log(
    `✅ Agent Workbench RAG done (mode=${pack.mode}, tasks=${pack.tasks.length}, sources=${(pack.sources || []).length})`
  );
  return pack;
}

function getAgentRagTask(pack, dayIdx) {
  if (!pack || !Array.isArray(pack.tasks) || !pack.tasks.length) return null;
  const i = Math.max(0, Number(dayIdx) || 0) % pack.tasks.length;
  return {
    ...pack.tasks[i],
    webInsights: pack.webInsights,
    sources: pack.sources,
    mode: pack.mode,
  };
}

module.exports = {
  enrichAgentWorkbenchRag,
  getAgentRagTask,
  fallbackTasks,
};
