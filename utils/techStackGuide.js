
function softClip(text, n = 220) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  const slice = t.slice(0, n);
  const sp = slice.lastIndexOf(" ");
  return `${(sp > 60 ? slice.slice(0, sp) : slice).trim()}…`;
}

function suggestTechStack(problemText = "", theme = {}) {
  const p = String(problemText || theme.project || "").toLowerCase();
  const themeTech = String(theme.tech || "").trim();

  let recommended = {
    language: "Python",
    ui: "CLI (terminal menu)",
    storage: "In-memory lists/dicts first (arrays & hash maps); files later if needed",
    why: "Fast for beginners, great for data/state demos, matches array/hash-map learning.",
  };

  if (/cli|terminal|command.?line|scanf|console/.test(p)) {
    recommended = {
      language: "Python or C (team skill)",
      ui: "CLI (terminal)",
      storage: "Arrays / lists / hash maps in memory",
      why: "Your problem is already framed as a CLI — keep the first version terminal-based.",
    };
  } else if (/web|react|browser|dashboard|website|ui screen/.test(p)) {
    recommended = {
      language: "JavaScript",
      ui: "Simple web page (HTML + JS) or React if already taught",
      storage: "Browser memory / JSON file first; database only if taught",
      why: "Web UI problems ship faster with JS in the browser for student demos.",
    };
  } else if (/mobile|android|ios|flutter/.test(p)) {
    recommended = {
      language: "Java / Kotlin or Flutter (Dart) — only if the team already knows it",
      ui: "Simple mobile screens OR start with CLI prototype first",
      storage: "Local lists; then SQLite if needed",
      why: "Mobile is heavier — many teams prototype logic in CLI/Python first.",
    };
  } else if (/machine|sensor|iot|factory|manufactur|ops data|telemetry/.test(p)) {
    recommended = {
      language: "Python",
      ui: "CLI first (input machine state → print/store)",
      storage: "List/dict of machine states; CSV/JSON file optional",
      why: "Ops/data problems map cleanly to Python + simple structures students already learn.",
    };
  }

  if (themeTech && /python|javascript|java|c\+\+|react|node/i.test(themeTech)) {
    recommended.why += ` Week tech hint already mentions: ${softClip(themeTech, 80)}.`;
  }

  const alternatives = [
    {
      language: "Java",
      ui: "CLI",
      storage: "ArrayList / HashMap",
      why: "Good if your syllabus is Java-heavy.",
    },
    {
      language: "JavaScript (Node)",
      ui: "CLI or tiny web form",
      storage: "Objects / Map; JSON file",
      why: "Good if you want one language for logic + simple UI later.",
    },
    {
      language: "C",
      ui: "CLI",
      storage: "Arrays / structs",
      why: "Only if C is what your class already practices every day.",
    },
  ].filter((a) => a.language.split(" ")[0].toLowerCase() !== recommended.language.split(" ")[0].toLowerCase());

  return {
    recommended,
    alternatives: alternatives.slice(0, 2),
    problemSnippet: softClip(problemText || theme.project || "your uploaded problem", 280),
  };
}

function isTechStackSuggestStep(dtStep) {
  return /tech\s*stack/i.test(String(dtStep?.step || ""));
}

/** True when the day is real feature coding (not Empathy/Pitch research). */
function needsTechStackConfirm(dtStep) {
  if (!dtStep) return true; // applied build = coding
  const stage = String(dtStep.stage || "");
  if (/Empathize/i.test(stage)) return false;
  if (/Pitch\s*&\s*BMC/i.test(stage)) return false;
  return /Plan|Prototype|Evaluate|Implement/i.test(stage);
}

function formatTechStackSuggestions(problemText, theme) {
  const s = suggestTechStack(problemText, theme);
  const r = s.recommended;
  return [
    `▶ Tech stack SUGGESTIONS (not locked yet)`,
    `▶ For your problem: "${s.problemSnippet}"`,
    `▶ Suggested best fit for beginners on THIS project:`,
    `▶   Language: ${r.language}`,
    `▶   Screen/UI: ${r.ui}`,
    `▶   Storage: ${r.storage}`,
    `▶   Why: ${r.why}`,
    `▶ Other options you may choose instead:`,
    ...s.alternatives.map(
      (a, i) => `▶   Option ${i + 1}: ${a.language} · ${a.ui} · ${a.storage} — ${a.why}`
    ),
    `▶ Your job today: write notes/tech-stack-ideas.md with the suggestion + 1 alternative you like.`,
    `▶ Do NOT lock the final stack today — confirm it on the first coding day.`,
    `▶ Rule: pick what your team can finish in 2 weeks, not what sounds impressive.`,
  ].join("\n");
}

function formatTechStackConfirm(problemText, theme) {
  const s = suggestTechStack(problemText, theme);
  const r = s.recommended;
  return [
    `▶ BEFORE CODING — confirm your tech stack (required today)`,
    `▶ Problem: "${s.problemSnippet}"`,
    `▶ Recommended for this project: ${r.language} + ${r.ui} + ${r.storage}`,
    `▶ Why this is a strong default: ${r.why}`,
    `▶ You may choose differently — that is OK — but you must WRITE the final choice:`,
    `▶   1) Language: ___`,
    `▶   2) UI: CLI / web / other: ___`,
    `▶   3) Storage: ___`,
    `▶   4) Why it fits THIS problem: ___`,
    `▶ Save as notes/tech-stack.md — all later coding follows this file.`,
    `▶ Done when: tech-stack.md exists and the whole team agrees for 60 seconds.`,
  ].join("\n");
}

module.exports = {
  suggestTechStack,
  isTechStackSuggestStep,
  needsTechStackConfirm,
  formatTechStackSuggestions,
  formatTechStackConfirm,
};
