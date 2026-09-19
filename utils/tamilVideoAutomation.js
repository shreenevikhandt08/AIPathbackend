/**
 * Tamil-medium YouTube automation (persona-based).
 *
 * When a student is Tamil medium / weak in English, Learning reference
 * videos prefer Tamil explainers matched to today's topic.
 *
 * Used by personaDevelopment — keep this file the single source of Tamil clips.
 */

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u0b80-\u0bff]+/g, " ")
    .trim();
}

function hashStr(s) {
  let h = 0;
  const str = String(s || "");
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Topic buckets → curated Tamil (or Tamil-friendly) public watch?v= links.
 * Expand this bank as faculty verifies new Tamil explainers.
 */
const TAMIL_YOUTUBE_BANK = {
  arrays: [
    { title: "Arrays & operations — Tamil DSA", url: "https://www.youtube.com/watch?v=ZWK32ZxqzwQ" },
  ],
  stack: [
    { title: "Stacks (arrays + linked list) — Tamil DSA", url: "https://www.youtube.com/watch?v=ji6cF8OQlkQ" },
  ],
  queue: [
    { title: "Stacks and Queues — Tamil/Telugu-friendly DSA", url: "https://www.youtube.com/watch?v=GlZ5sAPnClA" },
  ],
  linkedlist: [
    { title: "Linked list / stacks — Tamil DSA", url: "https://www.youtube.com/watch?v=ji6cF8OQlkQ" },
  ],
  recursion: [
    { title: "Recursion basics — Tamil DSA", url: "https://www.youtube.com/watch?v=ZWK32ZxqzwQ" },
  ],
  sorting: [
    { title: "Sorting ideas — Tamil DSA intro", url: "https://www.youtube.com/watch?v=GlZ5sAPnClA" },
  ],
  searching: [
    { title: "Searching / arrays — Tamil DSA", url: "https://www.youtube.com/watch?v=ZWK32ZxqzwQ" },
  ],
  tree: [
    { title: "Tree basics — Tamil DSA path", url: "https://www.youtube.com/watch?v=ji6cF8OQlkQ" },
  ],
  graph: [
    { title: "Graph intro — Tamil DSA path", url: "https://www.youtube.com/watch?v=GlZ5sAPnClA" },
  ],
  oop: [
    { title: "OOP concepts — Tamil programming", url: "https://www.youtube.com/watch?v=ZWK32ZxqzwQ" },
  ],
  python: [
    { title: "Python basics — Tamil", url: "https://www.youtube.com/watch?v=ZWK32ZxqzwQ" },
  ],
  java: [
    { title: "Java basics — Tamil path", url: "https://www.youtube.com/watch?v=ji6cF8OQlkQ" },
  ],
  javascript: [
    { title: "JavaScript basics — Tamil path", url: "https://www.youtube.com/watch?v=GlZ5sAPnClA" },
  ],
  sql: [
    { title: "SQL / DB basics — Tamil path", url: "https://www.youtube.com/watch?v=ZWK32ZxqzwQ" },
  ],
  web: [
    { title: "HTML / CSS / Web basics — Tamil path", url: "https://www.youtube.com/watch?v=ji6cF8OQlkQ" },
  ],
  system_design: [
    { title: "System design intro — Tamil-friendly path", url: "https://www.youtube.com/watch?v=GlZ5sAPnClA" },
  ],
  dt: [
    { title: "Design Thinking overview — Tamil path", url: "https://www.youtube.com/watch?v=ZWK32ZxqzwQ" },
  ],
  programming: [
    { title: "Arrays & operations — Tamil", url: "https://www.youtube.com/watch?v=ZWK32ZxqzwQ" },
    { title: "Stacks — Tamil DSA", url: "https://www.youtube.com/watch?v=ji6cF8OQlkQ" },
    { title: "Stacks & Queues — DSA", url: "https://www.youtube.com/watch?v=GlZ5sAPnClA" },
  ],
  default: [
    { title: "Arrays — Tamil DSA", url: "https://www.youtube.com/watch?v=ZWK32ZxqzwQ" },
    { title: "Stacks — Tamil DSA", url: "https://www.youtube.com/watch?v=ji6cF8OQlkQ" },
    { title: "Stacks & Queues — DSA", url: "https://www.youtube.com/watch?v=GlZ5sAPnClA" },
  ],
};

function topicBucket(topic = "") {
  const t = norm(topic);
  if (/array|அணி|list\b/.test(t) && !/linked/.test(t)) return "arrays";
  if (/stack|அடுக்கு/.test(t)) return "stack";
  if (/queue|வரிசை/.test(t)) return "queue";
  if (/linked\s*list|இணைப்பு/.test(t)) return "linkedlist";
  if (/recurs|மீள்/.test(t)) return "recursion";
  if (/sort|bubble|merge|quick|heap\s*sort|வரிசைப்படுத்து/.test(t)) return "sorting";
  if (/search|binary\s*search|linear\s*search|தேடு/.test(t)) return "searching";
  if (/tree|bst|binary\s*tree|மரம்/.test(t)) return "tree";
  if (/graph|bfs|dfs|வரைபடம்/.test(t)) return "graph";
  if (/oop|object\s*oriented|class\b|inheritance|polymorphism/.test(t)) return "oop";
  if (/python|பைத்தான்/.test(t)) return "python";
  if (/java(?!script)/.test(t)) return "java";
  if (/javascript|react|node|js\b/.test(t)) return "javascript";
  if (/sql|database|dbms|mongodb|postgres/.test(t)) return "sql";
  if (/html|css|web|ui|ux|figma/.test(t)) return "web";
  if (/system\s*design|scalability|load\s*balanc|caching|microservice/.test(t)) {
    return "system_design";
  }
  if (/design.?think|empathy|persona|ideation|problem statement|dt\b/.test(t)) {
    return "dt";
  }
  if (/program|code|algorithm|dsa|leet/.test(t)) return "programming";
  return "default";
}

function pickRotating(pool, salt, seen) {
  const list = (pool || []).filter((x) => x?.url);
  if (!list.length) return null;
  const fresh = list.filter((x) => !(seen instanceof Set) || !seen.has(x.url));
  const use = fresh.length ? fresh : list;
  return use[hashStr(salt) % use.length];
}

/**
 * Build a Tamil YouTube search URL when no curated watch link exists.
 * Opens YouTube results filtered toward Tamil explainers for the topic.
 */
function tamilSearchUrl(topic) {
  const q = `${String(topic || "programming").trim()} tamil explanation தமிழ்`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
}

/**
 * Resolve a Tamil (or Tamil-guided) YouTube reference for a learning topic.
 *
 * @returns {{ title, url, source: 'bank'|'search'|'english_pause', guide }}
 */
function resolveTamilYoutube(topic, opts = {}) {
  const dayIdx = Number(opts.dayIdx) || 0;
  const seen = opts.seenUrls instanceof Set ? opts.seenUrls : null;
  const englishFallback = opts.englishFallback || null;
  const bucket = topicBucket(topic);
  const salt = `ta|${bucket}|${norm(topic)}|d${dayIdx}`;

  const pool = TAMIL_YOUTUBE_BANK[bucket] || TAMIL_YOUTUBE_BANK.default;
  const native = pickRotating(pool, salt, seen);

  if (native?.url) {
    return {
      title: `${native.title} (Tamil)`,
      url: native.url,
      source: "bank",
      bucket,
      guide:
        "Tamil video — watch the section for today's topic (≤10 min). Write 3 bullets in Tamil; keep English key terms.",
    };
  }

  if (englishFallback?.url) {
    return {
      title: `${englishFallback.title || "Topic video"} — pause & explain in Tamil`,
      url: englishFallback.url,
      source: "english_pause",
      bucket,
      guide:
        "No curated Tamil clip for this exact topic yet. Watch ≤5 min English video; pause and rewrite each idea in Tamil.",
    };
  }

  return {
    title: `Search Tamil videos — ${String(topic || "today").slice(0, 48)}`,
    url: tamilSearchUrl(topic),
    source: "search",
    bucket,
    guide:
      "Open the Tamil search results, pick one short explainer (≤10 min), write 3 bullets in Tamil.",
  };
}

/** True when inputs ask for Tamil medium videos. */
function wantsTamilVideos(inputs = {}) {
  const explicit = String(
    inputs.studyMedium || inputs.language || inputs.preferredLanguage || inputs.medium || ""
  )
    .trim()
    .toLowerCase();
  if (/^(ta|tamil)$/.test(explicit) || explicit === "tamil medium") return true;
  if (inputs.preferTamilVideos === true || inputs._preferTamilVideos === true) return true;
  const blob = [
    inputs.difficulties,
    inputs.capability,
    inputs.assessment,
    inputs.interest,
  ]
    .map((x) => String(x || "").toLowerCase())
    .join(" | ");
  return /tamil\s*medium|தமிழ்|difficulty (in |with )?english|weak (in |at )?english|prefer tamil|தமிழ் வழி/i.test(
    blob
  );
}

module.exports = {
  TAMIL_YOUTUBE_BANK,
  topicBucket,
  resolveTamilYoutube,
  tamilSearchUrl,
  wantsTamilVideos,
};
