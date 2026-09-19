/**
 * Curated FREE, public learning links — preferred over fragile RAG URLs.
 * Only stable, well-known free pages + public YouTube watch?v= links.
 * RAG may suggest extras; sanitize prefers these when the topic matches.
 */

/** Domains we trust (free / public educational). */
const ALLOWED_HOSTS = [
  "developer.mozilla.org",
  "www.freecodecamp.org",
  "freecodecamp.org",
  "www.geeksforgeeks.org",
  "geeksforgeeks.org",
  "www.programiz.com",
  "programiz.com",
  "github.com",
  "www.github.com",
  "git-scm.com",
  "help.figma.com",
  "www.figma.com",
  "figma.com",
  "www.youtube.com",
  "youtube.com",
  "youtu.be",
  "www.khanacademy.org",
  "khanacademy.org",
  "javascript.info",
  "www.javascript.info",
  "css-tricks.com",
  "web.dev",
  "www.w3schools.com",
  "w3schools.com",
  "refactoring.guru",
  "www.refactoring.guru",
  "roadmap.sh",
  "www.roadmap.sh",
  "neetcode.io",
  "leetcode.com",
  "www.leetcode.com",
  "docs.python.org",
  "react.dev",
  "nextjs.org",
  "nodejs.org",
  "expressjs.com",
  "www.postgresql.org",
  "learn.microsoft.com",
  "aws.amazon.com",
  "cloud.google.com",
  "nngroup.com",
  "www.nngroup.com",
  "www.interaction-design.org",
  "interaction-design.org",
  "www.strategyzer.com",
  "strategyzer.com",
  "en.wikipedia.org",
  "wikipedia.org",
  "www.wikipedia.org",
  "ta.wikipedia.org",
  "hi.wikipedia.org",
  "te.wikipedia.org",
  "kn.wikipedia.org",
  "ml.wikipedia.org",
];

/** Hosts / URL patterns to reject (paid, private, fragile). */
const BLOCKED_PATTERNS = [
  /udemy\.com/i,
  /coursera\.org/i,
  /pluralsight\.com/i,
  /linkedin\.com\/learning/i,
  /skillshare\.com/i,
  /oreilly\.com/i,
  /educative\.io/i,
  /frontendmasters\.com/i,
  /codecademy\.com\/(learn|courses)/i,
  /medium\.com\/.*\?source=/i,
  /youtube\.com\/playlist\?list=PLPrivate/i,
  /youtube\.com\/(@|channel\/).*\/videos$/i,
  /\/p\/|\/paywall|\/subscribe/i,
  /chatgpt\.com/i,
  /chat\.openai\.com/i,
  /example\.com/i,
  /camerasystemdesign\.com/i,
  /youtube\.com\/watch\?v=example/i,
  /youtu\.be\/example/i,
  /strategyzer\.com\/library\//i,
  /figma\.com\/resource-library/i,
  /interaction-design\.org\/literature\/article\//i,
];

/** freeCodeCamp paths that are stable (avoid invented /news/slug → 404). */
const FCC_SAFE_RE = [
  /^https?:\/\/(www\.)?freecodecamp\.org\/?(\?.*)?$/i,
  /^https?:\/\/(www\.)?freecodecamp\.org\/learn(\/[\w\-/]*)?(\?.*)?$/i,
  /^https?:\/\/(www\.)?freecodecamp\.org\/news\/?(\?.*)?$/i,
];

function isSafeFreeCodeCampUrl(url) {
  const u = String(url || "").trim();
  if (!/freecodecamp\.org/i.test(u)) return true;
  return FCC_SAFE_RE.some((re) => re.test(u));
}

/**
 * Stable GFG hubs + search only — LLM-invented article slugs often 404
 * even though geeksforgeeks.org itself is public.
 */
const GFG_HUB_RE = [
  /^https?:\/\/(www\.)?geeksforgeeks\.org\/?(\?.*)?$/i,
  /^https?:\/\/(www\.)?geeksforgeeks\.org\/data-structures\/?(\?.*)?$/i,
  /^https?:\/\/(www\.)?geeksforgeeks\.org\/fundamentals-of-algorithms\/?(\?.*)?$/i,
  /^https?:\/\/(www\.)?geeksforgeeks\.org\/\?s=/i,
  /^https?:\/\/(www\.)?geeksforgeeks\.org\/\?q=/i,
];

/** Known-good article paths we ship in CURATED (extend as we verify). */
const GFG_KNOWN_PATHS = new Set([
  "/array-data-structure/",
  "/hashing-data-structure/",
  "/stack-data-structure/",
  "/queue-data-structure/",
  "/binary-tree-data-structure/",
  "/graph-data-structure-and-algorithms/",
  "/sorting-algorithms/",
  "/binary-search/",
  "/window-sliding-technique/",
  "/dynamic-programming/",
  "/heap-data-structure/",
  "/trie-insert-and-search/",
  "/sql-tutorial/",
  "/data-structures/",
  "/linked-list-data-structure/",
  "/two-pointer-technique/",
  "/recursion/",
  "/backtracking-algorithms/",
  "/greedy-algorithms/",
  "/dsa/hashing-data-structure/",
  "/dsa/introduction-to-arrays-data-structure-and-algorithm-tutorials/",
  "/dsa/introduction-to-stack-data-structure-and-algorithm-tutorials/",
  "/dsa/introduction-to-queue-data-structure-and-algorithm-tutorials/",
]);

function gfgPathname(url) {
  try {
    const p = new URL(String(url)).pathname.replace(/\/+$/, "/") || "/";
    return p.endsWith("/") ? p : `${p}/`;
  } catch {
    return "";
  }
}

function isSafeGfgUrl(url) {
  const u = String(url || "").trim();
  if (!/geeksforgeeks\.org/i.test(u)) return true;
  if (GFG_HUB_RE.some((re) => re.test(u))) return true;
  const path = gfgPathname(u);
  if (path && GFG_KNOWN_PATHS.has(path)) return true;
  // Allow verified /dsa/ hub-style pages that match known set only
  return false;
}

/** Pattern / topic → real GFG article (or site search that always works). */
function gfgGuideForPattern(pattern = "") {
  const t = String(pattern || "").toLowerCase();
  const hit = (keys, title, url) => ({ title, url });

  if (/lru|lfu|cache|doubly|evict|hash.?map.*list/.test(t)) {
    return hit(null, "GFG — Hashing / map basics", "https://www.geeksforgeeks.org/hashing-data-structure/");
  }
  if (/sliding|window|rate.?limit/.test(t)) {
    return hit(null, "GFG — Sliding Window", "https://www.geeksforgeeks.org/window-sliding-technique/");
  }
  if (/queue|deque/.test(t)) {
    return hit(null, "GFG — Queue", "https://www.geeksforgeeks.org/queue-data-structure/");
  }
  if (/stack|monotonic|parenthes/.test(t)) {
    return hit(null, "GFG — Stack", "https://www.geeksforgeeks.org/stack-data-structure/");
  }
  if (/graph|bfs|dfs|island|topo|union/.test(t)) {
    return hit(null, "GFG — Graph", "https://www.geeksforgeeks.org/graph-data-structure-and-algorithms/");
  }
  if (/trie/.test(t)) {
    return hit(null, "GFG — Trie", "https://www.geeksforgeeks.org/trie-insert-and-search/");
  }
  if (/tree|bst|binary tree/.test(t)) {
    return hit(null, "GFG — Binary Tree", "https://www.geeksforgeeks.org/binary-tree-data-structure/");
  }
  if (/binary.?search/.test(t)) {
    return hit(null, "GFG — Binary Search", "https://www.geeksforgeeks.org/binary-search/");
  }
  if (/two.?pointer/.test(t)) {
    return hit(null, "GFG — Two Pointer technique", "https://www.geeksforgeeks.org/two-pointer-technique/");
  }
  if (/heap|priority|top.?k/.test(t)) {
    return hit(null, "GFG — Heap", "https://www.geeksforgeeks.org/heap-data-structure/");
  }
  if (/dp|dynamic|knapsack|kadane|memo/.test(t)) {
    return hit(null, "GFG — Dynamic Programming", "https://www.geeksforgeeks.org/dynamic-programming/");
  }
  if (/linked.?list/.test(t)) {
    return hit(null, "GFG — Linked List", "https://www.geeksforgeeks.org/linked-list-data-structure/");
  }
  if (/sort|merge.?interval|interval/.test(t)) {
    return hit(null, "GFG — Sorting", "https://www.geeksforgeeks.org/sorting-algorithms/");
  }
  if (/array|hash|map|anagram|two sum/.test(t)) {
    return hit(null, "GFG — Arrays", "https://www.geeksforgeeks.org/array-data-structure/");
  }

  const q = encodeURIComponent(String(pattern || "data structures").trim().slice(0, 80) || "data structures");
  return {
    title: `GFG search — ${String(pattern || "DSA").trim().slice(0, 40)}`,
    url: `https://www.geeksforgeeks.org/?s=${q}`,
  };
}

/**
 * Topic keyword → free website + free YouTube (public watch?v= only).
 * Keys matched as substrings against the topic string.
 */
const CURATED = [
  // ── Design Thinking / Problem playbook (match before generic DSA keys) ──
  {
    keys: ["problem identification", "problem statement", "identify the problem", "define the problem"],
    web: {
      title: "Wikipedia — Design thinking",
      url: "https://en.wikipedia.org/wiki/Design_thinking",
    },
    youtube: {
      title: "What is Design Thinking? (public explainer)",
      url: "https://www.youtube.com/watch?v=a7sEoEvT8l8",
    },
  },
  {
    keys: ["similar products", "competitor", "competitive analysis", "existing products"],
    web: {
      title: "NN/g — Competitive usability evaluations",
      url: "https://www.nngroup.com/articles/competitive-usability-evaluations/",
    },
    youtube: {
      title: "Competitive analysis basics (public)",
      url: "https://www.youtube.com/watch?v=yAi5YHEnOwA",
    },
  },
  {
    keys: ["my ideas", "ideation", "brainstorm", "idea generation"],
    web: {
      title: "NN/g — Design Thinking 101",
      url: "https://www.nngroup.com/articles/design-thinking/",
    },
    youtube: {
      title: "Ideation / brainstorming for products (public)",
      url: "https://www.youtube.com/watch?v=bMzqAqnMIF0",
    },
  },
  {
    keys: ["audience", "persona", "target user", "user persona"],
    web: {
      title: "NN/g — Personas",
      url: "https://www.nngroup.com/articles/persona/",
    },
    youtube: {
      title: "How to create user personas (public)",
      url: "https://www.youtube.com/watch?v=u44pBnAn7cM",
    },
  },
  {
    keys: ["empathy map", "empathy"],
    web: {
      title: "NN/g — Empathy Mapping",
      url: "https://www.nngroup.com/articles/empathy-mapping/",
    },
    youtube: {
      title: "Empathy map explained (public)",
      url: "https://www.youtube.com/watch?v=QwF9a56WFWA",
    },
  },
  {
    keys: ["user interview", "customer interview"],
    web: {
      title: "NN/g — User Interviews",
      url: "https://www.nngroup.com/articles/user-interviews/",
    },
    youtube: {
      title: "User interview tips (public)",
      url: "https://www.youtube.com/watch?v=QJ0a9E9u6bE",
    },
  },
  {
    keys: ["journey map", "user journey", "process flow", "user actions"],
    web: {
      title: "NN/g — Journey Mapping 101",
      url: "https://www.nngroup.com/articles/journey-mapping-101/",
    },
    youtube: {
      title: "Customer journey map explained (public)",
      url: "https://www.youtube.com/watch?v=mSxpXUbTjYM",
    },
  },
  {
    keys: ["ui/ux", "ui ux", "sketch screens", "wireframe", "figma", "design style", "storyboard", "build in figma"],
    web: {
      title: "Figma Help Center (public)",
      url: "https://help.figma.com/hc/en-us",
    },
    youtube: {
      title: "Figma UI design tutorial (public)",
      url: "https://www.youtube.com/watch?v=FTFaQWZBqQ8",
    },
  },
  {
    keys: ["tech stack", "mvc", "app state"],
    web: {
      title: "System Design Primer (GitHub)",
      url: "https://github.com/donnemartin/system-design-primer",
    },
    youtube: {
      title: "System Design for beginners (public)",
      url: "https://www.youtube.com/watch?v=UzLMhqg3_Wc",
    },
  },
  {
    keys: ["bmc canvas", "business model canvas", "customer sales pitch", "final pitch", "app pitch", "pitch among peers"],
    web: {
      title: "Wikipedia — Business Model Canvas",
      url: "https://en.wikipedia.org/wiki/Business_Model_Canvas",
    },
    youtube: {
      title: "What is Design Thinking? (public explainer)",
      url: "https://www.youtube.com/watch?v=a7sEoEvT8l8",
    },
  },
  {
    // DT step named exactly "Focus" (POV / focus statement)
    keys: ["^focus$", "focus statement", "point of view", "pov statement"],
    web: {
      title: "Wikipedia — Design thinking",
      url: "https://en.wikipedia.org/wiki/Design_thinking",
    },
    youtube: {
      title: "What is Design Thinking? (public explainer)",
      url: "https://www.youtube.com/watch?v=a7sEoEvT8l8",
    },
  },
  {
    keys: ["array", "arrays", "array data structure"],
    web: {
      title: "GFG — Array data structure",
      url: "https://www.geeksforgeeks.org/array-data-structure/",
    },
    youtube: {
      title: "Data Structures Easy to Advanced (freeCodeCamp)",
      url: "https://www.youtube.com/watch?v=RBSGKlAvoiM",
    },
  },
  {
    keys: ["hash", "hashing", "hashmap", "hash map", "dictionary", "object map", "two sum"],
    web: {
      title: "GFG — Hashing intro",
      url: "https://www.geeksforgeeks.org/hashing-data-structure/",
    },
    youtube: {
      title: "Data Structures for Beginners",
      url: "https://www.youtube.com/watch?v=BBpAmxU_NQo",
    },
  },
  {
    keys: ["stack", "stacks"],
    web: {
      title: "GFG — Stack",
      url: "https://www.geeksforgeeks.org/stack-data-structure/",
    },
    youtube: {
      title: "Stacks explained",
      url: "https://www.youtube.com/watch?v=wjI1WNcIntg",
    },
  },
  {
    keys: ["queue", "queues", "deque"],
    web: {
      title: "GFG — Queue",
      url: "https://www.geeksforgeeks.org/queue-data-structure/",
    },
    youtube: {
      title: "Queues explained",
      url: "https://www.youtube.com/watch?v=D6gu-_tmEpQ",
    },
  },
  {
    keys: ["linked list", "linkedlist", "ll"],
    web: {
      title: "Programiz — Linked List",
      url: "https://www.programiz.com/dsa/linked-list",
    },
    youtube: {
      title: "Data Structures course (freeCodeCamp)",
      url: "https://www.youtube.com/watch?v=zg9ih6SVACc",
    },
  },
  {
    keys: ["tree", "binary tree", "bst", "binary search tree"],
    web: {
      title: "GFG — Binary Tree",
      url: "https://www.geeksforgeeks.org/binary-tree-data-structure/",
    },
    youtube: {
      title: "Binary trees intro",
      url: "https://www.youtube.com/watch?v=H5JubkIy_p8",
    },
  },
  {
    keys: ["graph", "bfs", "dfs", "shortest path"],
    web: {
      title: "GFG — Graph",
      url: "https://www.geeksforgeeks.org/graph-data-structure-and-algorithms/",
    },
    youtube: {
      title: "Graph theory intro",
      url: "https://www.youtube.com/watch?v=tWVWeAqZ0WU",
    },
  },
  {
    keys: ["recursion", "recursive", "backtrack"],
    web: {
      title: "Programiz — Recursion",
      url: "https://www.programiz.com/java-programming/recursion",
    },
    youtube: {
      title: "Recursion for beginners",
      url: "https://www.youtube.com/watch?v=KEEKn7Me-ms",
    },
  },
  {
    keys: ["sorting", "sort", "merge sort", "quick sort", "bubble"],
    web: {
      title: "GFG — Sorting algorithms",
      url: "https://www.geeksforgeeks.org/sorting-algorithms/",
    },
    youtube: {
      title: "Sorting algorithms visualized",
      url: "https://www.youtube.com/watch?v=kPRA0W1kECg",
    },
  },
  {
    keys: ["binary search", "searching"],
    web: {
      title: "GFG — Binary Search",
      url: "https://www.geeksforgeeks.org/binary-search/",
    },
    youtube: {
      title: "Binary search explained",
      url: "https://www.youtube.com/watch?v=P3YID7liBug",
    },
  },
  {
    keys: ["sliding window", "two pointer", "two pointers"],
    web: {
      title: "GFG — Sliding Window",
      url: "https://www.geeksforgeeks.org/window-sliding-technique/",
    },
    youtube: {
      title: "Sliding window technique",
      url: "https://www.youtube.com/watch?v=MK-NZ4hN7rs",
    },
  },
  {
    keys: ["dynamic programming", "dp", "memoization"],
    web: {
      title: "GFG — Dynamic Programming",
      url: "https://www.geeksforgeeks.org/dynamic-programming/",
    },
    youtube: {
      title: "DP for beginners",
      url: "https://www.youtube.com/watch?v=oBt53YbR9Kk",
    },
  },
  {
    keys: ["heap", "priority queue", "heaps"],
    web: {
      title: "GFG — Heap",
      url: "https://www.geeksforgeeks.org/heap-data-structure/",
    },
    youtube: {
      title: "Heaps explained",
      url: "https://www.youtube.com/watch?v=t0Cq6tVNRBA",
    },
  },
  {
    keys: ["trie", "prefix tree"],
    web: {
      title: "GFG — Trie",
      url: "https://www.geeksforgeeks.org/trie-insert-and-search/",
    },
    youtube: {
      title: "Trie data structure",
      url: "https://www.youtube.com/watch?v=AXjmTQ8LEoI",
    },
  },
  {
    keys: ["javascript", "js basics", "es6", "dom"],
    web: {
      title: "javascript.info — The Modern JavaScript Tutorial",
      url: "https://javascript.info/",
    },
    youtube: {
      title: "JavaScript full course (freeCodeCamp)",
      url: "https://www.youtube.com/watch?v=PkZNo7MFNFg",
    },
  },
  {
    keys: ["html", "css", "frontend basics", "web page"],
    web: {
      title: "MDN — Learn web development",
      url: "https://developer.mozilla.org/en-US/docs/Learn_web_development",
    },
    youtube: {
      title: "HTML & CSS — freeCodeCamp playlist",
      url: "https://www.youtube.com/playlist?list=PLWKjhJtqVAbnZtkAU59JjYLJ0L_TT9LkA",
    },
  },
  {
    keys: ["react", "jsx", "hooks", "useState", "useEffect"],
    web: {
      title: "React docs — Learn React",
      url: "https://react.dev/learn",
    },
    youtube: {
      title: "React course for beginners (freeCodeCamp)",
      url: "https://www.youtube.com/watch?v=bMknfKXIFA8",
    },
  },
  {
    keys: ["node", "nodejs", "express", "backend api"],
    web: {
      title: "Node.js docs — Learn",
      url: "https://nodejs.org/en/learn",
    },
    youtube: {
      title: "Node.js & Express course (freeCodeCamp)",
      url: "https://www.youtube.com/watch?v=Oe421EPjeBE",
    },
  },
  {
    keys: ["python", "django", "flask"],
    web: {
      title: "Python docs — Tutorial",
      url: "https://docs.python.org/3/tutorial/",
    },
    youtube: {
      title: "Python for beginners (freeCodeCamp)",
      url: "https://www.youtube.com/watch?v=rfscVS0vtbw",
    },
  },
  {
    keys: ["sql", "database", "postgres", "mysql", "mongodb"],
    web: {
      title: "Programiz — SQL",
      url: "https://www.programiz.com/sql",
    },
    youtube: {
      title: "SQL full course (freeCodeCamp)",
      url: "https://www.youtube.com/watch?v=HXV3zeQKqGY",
    },
  },
  {
    keys: ["system design", "architecture", "scalability", "load balancer", "caching", "cdn"],
    web: {
      title: "System Design Primer (GitHub)",
      url: "https://github.com/donnemartin/system-design-primer",
    },
    youtube: {
      title: "System Design for beginners (public)",
      url: "https://www.youtube.com/watch?v=UzLMhqg3_Wc",
    },
  },
  {
    keys: ["api", "rest", "http", "json"],
    web: {
      title: "MDN — HTTP overview",
      url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Overview",
    },
    youtube: {
      title: "REST APIs explained (public)",
      url: "https://www.youtube.com/watch?v=-MTSQjw5DrM",
    },
  },
  {
    keys: ["git", "github", "version control"],
    web: {
      title: "Git docs — Getting started",
      url: "https://git-scm.com/book/en/v2/Getting-Started-About-Version-Control",
    },
    youtube: {
      title: "Git & GitHub for beginners (freeCodeCamp)",
      url: "https://www.youtube.com/watch?v=RGOj5yH7evk",
    },
  },
  {
    keys: ["figma", "wireframe", "prototype", "ui ux", "ui design", "ux design", "ui/ux"],
    web: {
      title: "Figma Help Center (public)",
      url: "https://help.figma.com/hc/en-us",
    },
    youtube: {
      title: "Figma UI design tutorial (public)",
      url: "https://www.youtube.com/watch?v=FTFaQWZBqQ8",
    },
  },
  {
    keys: ["empathy", "persona", "user research", "design thinking", "bmc", "business model"],
    web: {
      title: "Wikipedia — Design thinking",
      url: "https://en.wikipedia.org/wiki/Design_thinking",
    },
    youtube: {
      title: "What is Design Thinking? (public explainer)",
      url: "https://www.youtube.com/watch?v=a7sEoEvT8l8",
    },
  },
  {
    keys: ["leetcode", "coding practice", "dsa", "algorithms", "data structure"],
    web: {
      title: "GeeksforGeeks — Data Structures hub",
      url: "https://www.geeksforgeeks.org/data-structures/",
    },
    youtube: {
      title: "Data Structures Easy to Advanced (freeCodeCamp)",
      url: "https://www.youtube.com/watch?v=RBSGKlAvoiM",
    },
  },
];

/** Safe default when topic doesn't match — still free & public. */
const DEFAULT_PAIR = {
  web: {
    title: "freeCodeCamp — Learn to code (free curriculum)",
    url: "https://www.freecodecamp.org/learn/",
  },
  youtube: {
    title: "freeCodeCamp — public playlists",
    url: "https://www.youtube.com/@freecodecamp/playlists",
  },
  source: "curated-default",
};

function escapeRegExp(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Does topic contain this curated key? Short keys need word boundaries
 * so "api" ≠ "application" and bare "design" ≠ "system design".
 */
function keyHitsTopic(topic = "", key = "") {
  const t = String(topic || "").toLowerCase().trim();
  let k = String(key || "").toLowerCase().trim();
  if (!t || !k) return false;
  if (k.startsWith("^") && k.endsWith("$")) {
    return t === k.slice(1, -1);
  }
  // Ambiguous single words that collide across domains
  if (k === "design") return /\bui\s*\/?\s*ux\b|\bui design\b|\bux design\b|\bfigma\b/.test(t);
  if (k.length <= 4) {
    return new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(k)}(?:[^a-z0-9]|$)`, "i").test(t);
  }
  return t.includes(k);
}

function scoreCuratedRow(topic, row) {
  let best = 0;
  for (const k of row.keys || []) {
    if (keyHitsTopic(topic, k)) {
      best = Math.max(best, String(k).replace(/^\^|\$$/g, "").length);
    }
  }
  return best;
}

/** Ranked on-topic curated rows (highest key-length score first). */
function rankedCuratedMatches(topic = "") {
  const scored = CURATED.map((row) => ({ row, score: scoreCuratedRow(topic, row) }))
    .filter((x) => x.score >= 4)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return [];
  const top = scored[0].score;
  // Keep only near-best matches so "System Design" never shares a pool with Figma
  return scored.filter((x) => x.score >= top - 2).map((x) => x.row);
}

/**
 * Exact-topic search pair when no curated row matches — links still teach THIS topic.
 */
function topicSearchPair(topic = "") {
  const label = String(topic || "today's topic").replace(/\s+/g, " ").trim().slice(0, 60) || "today's topic";
  const q = encodeURIComponent(label);
  return {
    web: {
      title: `Articles for “${label}” (GFG search)`,
      url: `https://www.geeksforgeeks.org/?s=${q}`,
    },
    youtube: {
      title: `Videos for “${label}” (YouTube search)`,
      url: `https://www.youtube.com/results?search_query=${q}`,
    },
    source: "topic-search",
    topic: label,
  };
}

function withTopicTitles(pair, topic = "") {
  const label = String(topic || pair?.topic || "today's topic").replace(/\s+/g, " ").trim().slice(0, 50);
  if (!pair?.web?.url) return pair;
  const tag = (title) => {
    const t = String(title || "").trim();
    if (/for\s+[“"]/i.test(t) || t.toLowerCase().includes(label.toLowerCase().slice(0, 20))) return t;
    return `${t} — for “${label}”`;
  };
  return {
    ...pair,
    web: { ...pair.web, title: tag(pair.web.title) },
    youtube: pair.youtube?.url
      ? { ...pair.youtube, title: tag(pair.youtube.title) }
      : pair.youtube,
    topic: label,
  };
}

function curatedForTopic(topic = "") {
  const matches = rankedCuratedMatches(topic);
  if (!matches.length) return null;
  const row = matches[0];
  return withTopicTitles(
    {
      web: { ...row.web },
      youtube: { ...row.youtube },
      source: "curated-free",
      topic: String(topic).slice(0, 80),
    },
    topic
  );
}

function hashTopicDay(topic, dayIdx) {
  const s = `${String(topic || "").toLowerCase()}|${Number(dayIdx) || 0}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Pick a curated pair that changes with day/topic and skips already-used URLs.
 * Stays strictly on-topic — never swaps a DSA/SD day for an unrelated family video.
 */
function pickVariedCuratedPair(topic = "", { dayIdx = 0, seenUrls = null } = {}) {
  const seen = seenUrls instanceof Set ? seenUrls : null;
  const matches = rankedCuratedMatches(topic);

  const tryRow = (row) => {
    if (!row?.web?.url || !row?.youtube?.url) return null;
    if (seen && (seen.has(row.web.url) || seen.has(row.youtube.url))) return null;
    return withTopicTitles(
      {
        web: { ...row.web },
        youtube: { ...row.youtube },
        source: "curated-varied",
        topic: String(topic).slice(0, 80),
      },
      topic
    );
  };

  if (matches.length) {
    const mStart = hashTopicDay(topic, dayIdx) % matches.length;
    for (let i = 0; i < matches.length; i++) {
      const hit = tryRow(matches[(mStart + i) % matches.length]);
      if (hit) return hit;
    }
    // All on-topic URLs already used today — reuse best match (better than off-topic)
    const row = matches[mStart % matches.length];
    return withTopicTitles(
      {
        web: { ...row.web },
        youtube: { ...row.youtube },
        source: "curated-reuse-ontopic",
        topic: String(topic).slice(0, 80),
      },
      topic
    );
  }

  // No curated keyword hit — topic search (still about THIS label), not random bank
  return withTopicTitles(topicSearchPair(topic), topic);
}

/**
 * Pick one practice link (website OR youtube) that is not already used today.
 * Prefer on-topic curated rows; never fall back to unrelated bank entries.
 */
function pickDistinctPracticeLink(
  topic = "",
  { kind = "web", dayIdx = 0, seenUrls = null, salt = 0 } = {}
) {
  const seen = seenUrls instanceof Set ? seenUrls : new Set();
  const wantYt = /youtube|video/i.test(String(kind || ""));
  const label = wantYt ? "YouTube" : "Website";

  const take = (item) => {
    if (!item?.url || seen.has(item.url)) return null;
    if (wantYt && !isPublicYoutube(item.url) && !/youtube\.com\/results\?/i.test(item.url)) {
      return null;
    }
    if (!wantYt && (isBlockedUrl(item.url) || !isAllowedHost(item.url))) return null;
    return { url: item.url, title: item.title || label, kind: label };
  };

  const matches = rankedCuratedMatches(topic);
  const start =
    (hashTopicDay(topic, dayIdx) + Number(salt) * 13) % Math.max(1, matches.length || 1);

  for (let i = 0; i < matches.length; i++) {
    const row = matches[(start + i) % matches.length];
    const hit = take(wantYt ? row.youtube : row.web);
    if (hit) {
      hit.title = `${hit.title} — for “${String(topic || "").slice(0, 40)}”`;
      return hit;
    }
  }

  const search = topicSearchPair(topic);
  const fromSearch = take(wantYt ? search.youtube : search.web);
  if (fromSearch) return fromSearch;

  // Last resort: on-topic curated even if URL was seen
  if (matches.length) {
    const row = matches[start % matches.length];
    const item = wantYt ? row.youtube : row.web;
    if (item?.url) {
      return {
        url: item.url,
        title: `${item.title || label} — for “${String(topic || "").slice(0, 40)}”`,
        kind: label,
      };
    }
  }

  const fb = wantYt ? search.youtube : search.web;
  return { url: fb.url, title: fb.title, kind: label };
}

function curatedOrDefault(topic = "") {
  return (
    curatedForTopic(topic) ||
    withTopicTitles(topicSearchPair(topic), topic)
  );
}

function hostOf(url) {
  try {
    return new URL(String(url)).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isBlockedUrl(url) {
  const u = String(url || "");
  if (!/^https?:\/\//i.test(u)) return true;
  if (BLOCKED_PATTERNS.some((re) => re.test(u))) return true;
  if (/youtu\.be\/\s*$|youtube\.com\/watch\?v=\s*$/i.test(u)) return true;
  // Reject invent-y / truncated watch IDs
  if (/youtube\.com\/watch\?v=[\w-]{1,5}$/i.test(u)) return true;
  // freeCodeCamp deep /news/slug URLs are often invented → 404
  if (/freecodecamp\.org/i.test(u) && !isSafeFreeCodeCampUrl(u)) return true;
  // GeeksforGeeks article slugs are often invented by LLM → real 404s
  if (/geeksforgeeks\.org/i.test(u) && !isSafeGfgUrl(u)) return true;
  return false;
}

function isAllowedHost(url) {
  const h = hostOf(url);
  if (!h) return false;
  return ALLOWED_HOSTS.some((a) => h === a || h.endsWith(`.${a}`));
}

function isWatchYoutube(url) {
  const u = String(url || "");
  return /youtube\.com\/watch\?v=[\w-]{11}/i.test(u) || /youtu\.be\/[\w-]{11}/i.test(u);
}

/** Public YouTube: watch video OR public playlist OR topic search OR freeCodeCamp playlists hub. */
function isPublicYoutube(url) {
  const u = String(url || "");
  if (isWatchYoutube(u)) return true;
  if (/youtube\.com\/playlist\?list=[\w-]+/i.test(u)) return true;
  if (/youtube\.com\/@freecodecamp\/playlists\/?(\?.*)?$/i.test(u)) return true;
  // Topic-aligned fallback — student searches the exact learning label
  if (/youtube\.com\/results\?search_query=/i.test(u)) return true;
  return false;
}

/**
 * Prefer curated free links; keep RAG only if URL looks public + allowed;
 * else curated/default.
 */
function sanitizeResourcePair(pair, topic, emergencyFallbackFn) {
  const curated = curatedForTopic(topic);
  // Always prefer known-good curated pair when topic matches
  if (curated) return curated;

  const fb =
    typeof emergencyFallbackFn === "function"
      ? emergencyFallbackFn(topic)
      : curatedOrDefault(topic);
  if (!pair) return fb;

  let web = pair.web || {};
  let youtube = pair.youtube || {};

  const webOk =
    web.url &&
    !isBlockedUrl(web.url) &&
    isAllowedHost(web.url);
  const ytOk =
    youtube.url &&
    !isBlockedUrl(youtube.url) &&
    isPublicYoutube(youtube.url);

  if (!webOk) {
    // Prefer a real GFG guide when the bad URL was an invented GFG slug
    if (/geeksforgeeks\.org/i.test(String(web.url || ""))) {
      const g = gfgGuideForPattern(topic);
      web = { title: g.title, url: g.url };
    } else {
      web = fb.web;
    }
  }
  if (!ytOk) youtube = fb.youtube;

  return {
    web: { title: web.title || fb.web.title, url: web.url || fb.web.url },
    youtube: {
      title: youtube.title || fb.youtube.title,
      url: youtube.url || fb.youtube.url,
    },
    source: pair.source || "sanitized",
    topic: String(topic || "").slice(0, 80),
    why: pair.why || null,
  };
}

module.exports = {
  ALLOWED_HOSTS,
  BLOCKED_PATTERNS,
  CURATED,
  DEFAULT_PAIR,
  curatedForTopic,
  curatedOrDefault,
  pickVariedCuratedPair,
  pickDistinctPracticeLink,
  rankedCuratedMatches,
  topicSearchPair,
  scoreCuratedRow,
  keyHitsTopic,
  isBlockedUrl,
  isAllowedHost,
  isWatchYoutube,
  isPublicYoutube,
  isSafeFreeCodeCampUrl,
  isSafeGfgUrl,
  gfgGuideForPattern,
  sanitizeResourcePair,
};
