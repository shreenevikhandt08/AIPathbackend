/**
 * Persona Development Engine
 * - If Tamil/Hindi medium (from Difficulties / Assessment text): Tamil/Hindi YouTube only
 *   + English websites (varied) — no native-language Wikipedia sites
 * - Links rotate by day + topic so the same video/site is not repeated
 * - Respect dislikes; gentle growth challenges
 * - Outcomes: Attitude · Logical/Business · Technical
 */
const {
  curatedOrDefault,
  curatedForTopic,
  pickVariedCuratedPair,
  isBlockedUrl,
} = require("../data/curatedLearningLinks");

/** Detect study medium from assessment form text (no separate UI field). */
function detectStudyMedium(inputs = {}) {
  const explicit = String(
    inputs.language ||
      inputs.preferredLanguage ||
      inputs.medium ||
      inputs.studyMedium ||
      ""
  )
    .trim()
    .toLowerCase();

  const blob = [
    explicit,
    inputs.difficulties,
    inputs.capability,
    inputs.assessment,
    inputs.interest,
    inputs.dislikes,
  ]
    .map((x) => String(x || "").toLowerCase())
    .join(" | ");

  if (
    /tamil\s*medium|தமிழ்|tamil\b|difficulty (in |with )?english|weak (in |at )?english|english (is )?(hard|difficult)|prefer tamil|தமிழ் வழி/i.test(
      blob
    ) ||
    /^(ta|tamil)$/i.test(explicit) ||
    inputs.preferTamilVideos === true ||
    inputs._preferTamilVideos === true
  ) {
    return { code: "ta", label: "Tamil", preferNative: true };
  }
  if (
    /hindi\s*medium|हिन्दी|hindi\b|prefer hindi|हिंदी/i.test(blob) ||
    /^(hi|hindi)$/i.test(explicit)
  ) {
    return { code: "hi", label: "Hindi", preferNative: true };
  }
  if (
    /telugu\s*medium|తెలుగు|telugu\b|prefer telugu/i.test(blob) ||
    /^(te|telugu)$/i.test(explicit)
  ) {
    return { code: "te", label: "Telugu", preferNative: true };
  }
  if (
    /kannada\s*medium|ಕನ್ನಡ|kannada\b|prefer kannada/i.test(blob) ||
    /^(kn|kannada)$/i.test(explicit)
  ) {
    return { code: "kn", label: "Kannada", preferNative: true };
  }
  if (
    /malayalam\s*medium|മലയാളം|malayalam\b|prefer malayalam/i.test(blob) ||
    /^(ml|malayalam)$/i.test(explicit)
  ) {
    return { code: "ml", label: "Malayalam", preferNative: true };
  }
  if (/english\s*medium|prefer english|^(en|english)$/i.test(explicit + " " + blob)) {
    return { code: "en", label: "English", preferNative: false };
  }
  return { code: "en", label: "English", preferNative: false };
}

/** Parse dislikes into actionable flags. */
function parseDislikeFlags(inputs = {}) {
  const raw = String(inputs.dislikes || inputs.interest || "").toLowerCase();
  const dislikePart = /dislikes?\s*\/?\s*avoid[:\s]+(.+)/i.exec(
    String(inputs.interest || "")
  );
  const text = `${raw} ${dislikePart?.[1] || ""}`.toLowerCase();

  return {
    raw: String(inputs.dislikes || dislikePart?.[1] || "").trim(),
    avoidVideos: /video|youtube|watch\b|lecture video|screen.?time/i.test(text),
    avoidLongLectures: /long\s*(lecture|theory|class)|boring lecture/i.test(text),
    avoidPublicSpeaking: /public\s*speak|presentat|stage\s*fear|shy|speak(ing)? (in )?front/i.test(
      text
    ),
    avoidReading: /long\s*read|heavy\s*text|reading\s*long/i.test(text),
    avoidGroup: /group\s*work|team\s*work|peer/i.test(text),
    avoidCoding: /\bcoding\b|programming|debug/i.test(text) && !/like.*cod/i.test(text),
  };
}

function hashStr(s) {
  let h = 0;
  const str = String(s || "");
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function ensureSeen(inputs = {}) {
  if (!inputs._seenResourceUrls) {
    inputs._seenResourceUrls = new Set();
  } else if (!(inputs._seenResourceUrls instanceof Set)) {
    inputs._seenResourceUrls = new Set(
      Array.isArray(inputs._seenResourceUrls) ? inputs._seenResourceUrls : []
    );
  }
  return inputs._seenResourceUrls;
}

function pickRotating(list, salt, seen) {
  if (!Array.isArray(list) || !list.length) return null;
  const start = hashStr(salt) % list.length;
  for (let i = 0; i < list.length; i++) {
    const item = list[(start + i) % list.length];
    const url = item?.url;
    if (url && seen && seen.has(url)) continue;
    return item;
  }
  // All seen — still rotate so consecutive days differ
  return list[start];
}

function topicBucket(topic = "") {
  const t = String(topic || "").toLowerCase();
  if (/array|list\b|operation/i.test(t)) return "arrays";
  if (/stack/i.test(t)) return "stack";
  if (/queue|deque/i.test(t)) return "queue";
  if (/link|linked/i.test(t)) return "linkedlist";
  if (/tree|bst|binary/i.test(t)) return "tree";
  if (/graph|bfs|dfs/i.test(t)) return "graph";
  if (/sort|search|binary search/i.test(t)) return "sort";
  if (/hash|map|dict/i.test(t)) return "hash";
  if (/python/i.test(t)) return "python";
  if (/java(?!script)/i.test(t)) return "java";
  if (/javascript|js\b|react|node/i.test(t)) return "javascript";
  if (/sql|database|dbms/i.test(t)) return "sql";
  if (/git|github/i.test(t)) return "git";
  if (/html|css|web|ui|ux|figma/i.test(t)) return "web";
  if (/design.?think|empathy|persona|ideation|problem statement/i.test(t)) return "dt";
  if (/program|code|algorithm|dsa|oop/i.test(t)) return "programming";
  return "default";
}

/**
 * Native-medium = YouTube ONLY (no Tamil/Hindi websites).
 * Tamil clips live in tamilVideoAutomation.js (single source).
 */
const MEDIUM_YOUTUBE_BANK = {
  hi: {
    default: [],
    programming: [],
    arrays: [],
    stack: [],
    queue: [],
  },
};

const OUTCOMES = [
  {
    id: "attitude",
    title: "Attitude — Curiosity & Accountability",
    short: "Attitude",
    focus: "Ask one honest question, own one promise, finish one small proof.",
  },
  {
    id: "logical_business",
    title: "Logical & Business skill",
    short: "Logic / Business",
    focus: "If-then thinking + who pays / who benefits for today's piece.",
  },
  {
    id: "technical",
    title: "Technical Skills",
    short: "Technical",
    focus: "One concrete technical artifact you can show (code, diagram, config, test).",
  },
];

function outcomeForDay(dayIdx = 0) {
  return OUTCOMES[Math.max(0, Number(dayIdx) || 0) % OUTCOMES.length];
}

function softClip(s, n = 100) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (t.length <= n) return t;
  // Prefer one short complete sentence when it fits
  const sentence = (t.match(/^[^.!?]+[.!?]/) || [])[0];
  if (sentence && sentence.length >= 24 && sentence.length <= Math.max(n, Math.floor(n * 1.15))) {
    return sentence.trim();
  }
  const slice = t.slice(0, n);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = (lastSpace > Math.min(24, Math.floor(n * 0.45)) ? slice.slice(0, lastSpace) : slice)
    .trim()
    .replace(/[.,;:]+$/g, "");
  // Never emit mid-word stumps like "pe…" — complete words only, no ellipsis
  return cut || t.slice(0, Math.min(n, t.length));
}

/**
 * Pick varied English website + medium YouTube (when needed).
 */
function pickPersonaResources(topic, inputs = {}, opts = {}) {
  const medium = detectStudyMedium(inputs);
  const flags = parseDislikeFlags(inputs);
  const dayIdx = Number(opts.dayIdx) || 0;
  const seen = ensureSeen(inputs);
  const salt = `${topic}|d${dayIdx}|${medium.code}`;

  const varied = pickVariedCuratedPair(topic, { dayIdx, seenUrls: seen }) ||
    curatedForTopic(topic) ||
    curatedOrDefault(topic);

  // English website always (varied) — never native Wikipedia
  const web = varied?.web ? { ...varied.web } : null;

  let youtube = null;
  let videoGuide = null;

  if (!flags.avoidVideos) {
    if (medium.code === "ta") {
      const { resolveTamilYoutube } = require("./tamilVideoAutomation");
      const ta = resolveTamilYoutube(topic, {
        dayIdx,
        seenUrls: seen,
        englishFallback: varied?.youtube || null,
      });
      youtube = { title: ta.title, url: ta.url };
      videoGuide = ta.guide;
    } else if (medium.preferNative) {
      const bank = MEDIUM_YOUTUBE_BANK[medium.code] || {};
      const bucket = topicBucket(topic);
      const pool = (bank[bucket] || bank.default || []).filter((x) => x?.url);
      let nativeYt = pickRotating(pool, salt, seen);

      if (nativeYt) {
        youtube = {
          title: `${nativeYt.title} (${medium.label})`,
          url: nativeYt.url,
        };
        videoGuide = `${medium.label} video — watch the section for today's topic (≤10 min). Write 3 bullets in ${medium.label}; keep English key terms.`;
      } else if (varied?.youtube?.url) {
        youtube = {
          title: `${varied.youtube.title} — pause & explain in ${medium.label}`,
          url: varied.youtube.url,
        };
        videoGuide = `No ${medium.label} clip for this exact topic yet. Watch ≤5 min English video; pause and rewrite each idea in ${medium.label}.`;
      }
    } else if (varied?.youtube?.url) {
      youtube = { ...varied.youtube };
    }
  }

  if (web?.url) seen.add(web.url);
  if (youtube?.url) seen.add(youtube.url);

  return {
    medium,
    flags,
    web,
    youtube,
    bridge: null,
    preferArticle: flags.avoidVideos,
    source: medium.preferNative ? `${medium.code}-yt+en-web` : "varied-curated",
    videoGuide,
  };
}

/**
 * Format link lines for Learning block (persona-aware + de-duplicated).
 */
function buildPersonaLinkLines(topic, inputs = {}, opts = {}) {
  const pick = pickPersonaResources(topic, inputs, opts);
  const lines = [];

  if (pick.web?.url && !isBlockedUrl(pick.web.url)) {
    lines.push(`   · Website: ${pick.web.title} — ${pick.web.url}`);
  }

  if (pick.youtube?.url && !pick.flags.avoidVideos) {
    const ytLabel = pick.medium.preferNative
      ? `Video (${pick.medium.label})`
      : "Video";
    lines.push(`   · ${ytLabel}: ${pick.youtube.title} — ${pick.youtube.url}`);
  } else if (pick.flags.avoidVideos) {
    lines.push(`   · Video skipped (you prefer articles).`);
  }

  return { lines, pick };
}

function buildOutcomeLearningBullets({
  dayIdx = 0,
  learnLabel = "today's topic",
  problem = "your project",
  subjectName = "",
  inputs = {},
} = {}) {
  const outcome = outcomeForDay(dayIdx);
  const medium = detectStudyMedium(inputs);
  const subject = softClip(subjectName || learnLabel, 40);
  const learn = softClip(learnLabel, 50);
  const prob = softClip(problem, 60);
  const langNote = medium.preferNative
    ? `You may write answers in ${medium.label}; keep key terms in English too.`
    : "Write in clear English.";

  const attitude = [
    `▶ Outcome today: ${outcome.title}`,
    `▶ Curiosity (2 min): write ONE question about "${learn}" you cannot answer yet.`,
    `▶ Accountability (3 min): promise one deliverable for "${prob}" before the day ends — write it at the top of your notes.`,
    `▶ Subject link: connect "${subject}" → that question in 1 sentence.`,
  ];

  const logical = [
    `▶ Outcome today: ${outcome.title}`,
    `▶ Logic: write 1 if-then rule using "${learn}" for "${prob}".`,
    `▶ Business: who benefits if this rule works? who pays the cost if it fails? (2 lines)`,
    `▶ Subject link: use one idea from "${subject}" inside that if-then rule.`,
  ];

  const technical = [
    `▶ Outcome today: ${outcome.title}`,
    `▶ Technical: produce ONE artifact for "${learn}" (snippet, diagram, table, or test case).`,
    `▶ Subject integration: name which "${subject}" concept you reused in the artifact.`,
    `▶ Done check: artifact filename + 1-line "what it proves".`,
  ];

  const pack =
    outcome.id === "attitude" ? attitude : outcome.id === "logical_business" ? logical : technical;

  return {
    outcome,
    medium,
    lines: [...pack, `▶ Language: ${langNote}`],
  };
}

function buildGentleChallengeTask(dayIdx = 0, inputs = {}, learnLabel = "", subjectName = "") {
  const flags = parseDislikeFlags(inputs);
  const medium = detectStudyMedium(inputs);
  const learn = softClip(learnLabel || "today's topic", 40);
  const subject = softClip(subjectName || learn, 40);
  const d = Math.max(0, Number(dayIdx) || 0);

  if (!flags.raw && !flags.avoidVideos && !flags.avoidPublicSpeaking && !flags.avoidLongLectures) {
    return null;
  }

  const challenges = [];

  if (flags.avoidVideos) {
    challenges.push({
      kind: "video_micro",
      line: `Growth challenge (videos): watch ONLY 3 minutes of a ${medium.preferNative ? medium.label : "short"} explainer on "${learn}", pause, write 3 bullets — then stop.`,
    });
  }
  if (flags.avoidPublicSpeaking) {
    challenges.push({
      kind: "speak_micro",
      line: `Growth challenge (speaking): explain "${learn}" aloud for 45 seconds to your phone (or empty room). No audience. Log: what felt hard.`,
    });
  }
  if (flags.avoidLongLectures) {
    challenges.push({
      kind: "lecture_micro",
      line: `Growth challenge (long theory): read ONE short section on "${subject}" (≤1 page / 5 min), then do one practice step.`,
    });
  }
  if (flags.avoidReading) {
    challenges.push({
      kind: "read_micro",
      line: `Growth challenge (reading): read 8–10 lines only about "${learn}", highlight 2 words, rewrite in your words.`,
    });
  }
  if (flags.avoidCoding) {
    challenges.push({
      kind: "code_micro",
      line: `Growth challenge (coding): change ONE line or fill ONE blank in a tiny snippet for "${learn}" — not a full program.`,
    });
  }
  if (flags.avoidGroup) {
    challenges.push({
      kind: "peer_micro",
      line: `Growth challenge (group work): send ONE question about "${learn}" to a classmate OR write the question you'd ask — no long meeting.`,
    });
  }
  if (!challenges.length && flags.raw) {
    challenges.push({
      kind: "generic_micro",
      line: `Growth challenge (your dislike: "${softClip(flags.raw, 40)}"): do a 5-minute micro-version linked to "${learn}" + subject "${subject}" — stop when the timer ends.`,
    });
  }

  if (!challenges.length) return null;
  const pick = challenges[d % challenges.length];
  return {
    ...pick,
    header: `▶ Growth ladder (small task — overcome dislike without overwhelm):`,
    why: `▶ Why: future roles need this skill; today we practise a tiny slice only.`,
  };
}

function buildPersonaMiniBuild({
  dayIdx = 0,
  inputs = {},
  learnLabel = "",
  subjectName = "",
  problemQuote = "",
  dtStep = null,
} = {}) {
  const outcomePack = buildOutcomeLearningBullets({
    dayIdx,
    learnLabel,
    problem: problemQuote,
    subjectName,
    inputs,
  });
  const challenge = buildGentleChallengeTask(dayIdx, inputs, learnLabel, subjectName);
  const medium = outcomePack.medium;
  const outcome = outcomePack.outcome;
  const problem = softClip(problemQuote || "your project", 80);
  const learn = softClip(learnLabel || "today's topic", 50);
  const subject = softClip(subjectName || learn, 40);
  const likeBit = softClip(
    String(inputs.interest || "")
      .replace(/dislikes?\s*\/?\s*avoid[:\s].*/i, "")
      .split(/[,|;]/)[0] ||
      String(inputs.interest || "").trim() ||
      "",
    40
  );

  const lines = [
    `▶ Mini Build — interest + strength + overcome weakness`,
    `▶ Purpose: practise today's spotlight outcome on YOUR problem (not busywork).`,
    `▶ Spotlight outcome: ${outcome.title} — ${softClip(outcome.focus, 100)}`,
    `▶ Why this matters: builds Attitude, Logic/Business, and Technical skill for "${problem}".`,
    likeBit
      ? `▶ Interest bridge: use "${likeBit}" as the metaphor or demo style for "${learn}".`
      : `▶ Interest bridge: pick one thing you enjoy and use it as the demo style for "${learn}".`,
    `▶ Subject to reuse: "${subject}" (same as Learning — do not invent a new topic).`,
    ...outcomePack.lines.slice(1, 4),
    challenge ? `▶ Overcome weakness (tiny step): ${challenge.line}` : null,
    challenge ? challenge.why : null,
    medium.preferNative
      ? `▶ Medium: ${medium.label} OK for thinking aloud; keep key terms in English.`
      : null,
    dtStep?.step ? `▶ Related DT Step: ${dtStep.step}` : null,
    `▶ Done when: mini-build-day${Number(dayIdx) + 1}.md has (1) outcome (2) interest link (3) one weakness step result.`,
  ];

  return {
    activity: "Mini Build",
    content: lines
      .filter(Boolean)
      .map((l) => (String(l).startsWith("▶") ? l : `▶ ${l}`))
      .join("\n"),
    outcome,
    medium,
    challenge,
  };
}

/**
 * Optional early-finish micro-task for Learning / Project ONLY — never for Break slots.
 * Interest × subject + gentle weakness growth.
 */
function buildBetweenClassMicroTask({
  dayIdx = 0,
  inputs = {},
  learnLabel = "",
  subjectName = "",
  problemQuote = "",
  paceKey = "average",
} = {}) {
  const likes = String(inputs.interest || "")
    .replace(/dislikes?\s*\/?\s*avoid[:\s].*/i, "")
    .replace(/likes?\/?\s*activities?[:\s]*/i, "")
    .trim();
  const flags = parseDislikeFlags(inputs);
  const subject = softClip(subjectName || learnLabel || "today's topic", 40);
  const learn = softClip(learnLabel || subject, 40);
  let problem = softClip(problemQuote || "your project", 70);
  if (!problem || problem.length < 8) problem = "your project problem";
  const likeBit = softClip(
    likes.split(/[,|;]/)[0] || likes || "something you enjoy",
    36
  );
  const d = Math.max(0, Number(dayIdx) || 0);
  const mins =
    paceKey === "fast" ? 6 : paceKey === "slow" ? 3 : paceKey === "steady" ? 4 : 5;

  const likeTasks = [
    `Interest (${mins} min): 1 sentence "${likeBit}" → "${learn}", then one tiny demo idea for: ${problem}.`,
    `Interest (${mins} min): invent a "${likeBit}" metaphor that explains "${subject}" (2 bullets).`,
    `Interest (${mins} min): list 2 ways "${likeBit}" helps today's Apply on: ${problem}.`,
  ];
  const growth = buildGentleChallengeTask(dayIdx, inputs, learnLabel, subjectName);
  const lines = [
    `▶ Early-finish only (${mins} min) — skip if you need rest`,
    `▶ ${likeTasks[d % likeTasks.length]}`,
  ];
  if (growth && (paceKey === "fast" || paceKey === "average" || d % 2 === 1)) {
    lines.push(`▶ Overcome weakness: ${growth.line}`);
  } else if (flags.raw) {
    lines.push(
      `▶ Keep light: if "${softClip(flags.raw, 30)}" drains you, stop at the timer.`
    );
  }
  lines.push(`▶ Done when: 1 notes line exists (interest × ${subject}).`);
  return lines.join("\n");
}

/**
 * Career objective + outcome lines for homework (goals / role / company / domain).
 */
function buildCareerHomeworkBlock(inputs = {}, member = null) {
  const m = member && typeof member === "object" ? member : {};
  const goals = softClip(
    m.assessment || inputs.assessment || inputs.goals || inputs.outcome || "",
    140
  );
  const role = softClip(m.targetRole || inputs.targetRole || "", 60);
  const company = softClip(m.targetCompany || inputs.targetCompany || "", 60);
  const domain = softClip(m.domain || inputs.domain || "", 60);
  if (!goals && !role && !company && !domain) {
    return [`Career objective: write target role + 1 goal in one line before you start.`];
  }
  const lines = [];
  const bits = [];
  if (role) bits.push(`role ${role}`);
  if (company) bits.push(`company ${company}`);
  if (domain) bits.push(`domain ${domain}`);
  if (goals) bits.push(goals);
  lines.push(`Career objective: ${bits.join(" · ")}`);
  lines.push(`End each task with 1 line linking the work → this goal/role.`);
  return lines;
}

module.exports = {
  detectStudyMedium,
  parseDislikeFlags,
  pickPersonaResources,
  buildPersonaLinkLines,
  buildOutcomeLearningBullets,
  buildGentleChallengeTask,
  buildPersonaMiniBuild,
  buildBetweenClassMicroTask,
  buildCareerHomeworkBlock,
  outcomeForDay,
  OUTCOMES,
  MEDIUM_YOUTUBE_BANK,
};
