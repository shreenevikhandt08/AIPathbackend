/**
 * Keep in sync with frontend src/constants/youtubePool.js.
 * Verified public YouTube videos (checked via YouTube oEmbed) from channels
 * students commonly learn from. Order inside `families` = match priority.
 */
const v = (id, title, channel) => ({ id, title, channel, url: `https://www.youtube.com/watch?v=${id}` });

const YT_FAMILIES = [
  {
    key: "trie",
    re: /\btrie|prefix tree/i,
    article: "https://www.geeksforgeeks.org/trie-insert-and-search/",
    videos: [
      v("zIjfhVPRZCg", "Data Structures: Tries", "HackerRank"),
      v("oobqoCJlHA0", "Implement Trie (Prefix Tree) — LeetCode 208", "NeetCode"),
      v("AXjmTQ8LEoI", "Trie Data Structure", "Tushar Roy"),
    ],
  },
  {
    key: "heap",
    re: /\bheap|priority queue|top.?k|kth largest/i,
    article: "https://www.geeksforgeeks.org/heap-data-structure/",
    videos: [
      v("t0Cq6tVNRBA", "Data Structures: Heaps", "HackerRank"),
      v("HqPJF2L5h9U", "Heap — Heap Sort — Heapify — Priority Queues", "Abdul Bari"),
      v("hOjcdrqMoQ8", "Kth Largest Element in a Stream — LeetCode 703", "NeetCode"),
      v("YPTqKIgVk-k", "Top K Frequent Elements — LeetCode 347", "NeetCode"),
    ],
  },
  {
    key: "dp",
    re: /dynamic programming|\bdp\b|memoi|knapsack|kadane|climbing stairs|coin change|house robber/i,
    article: "https://www.geeksforgeeks.org/dynamic-programming/",
    videos: [
      v("oBt53YbR9Kk", "Dynamic Programming — Full Course", "freeCodeCamp"),
      v("P8Xa2BitN3I", "Algorithms: Memoization and Dynamic Programming", "HackerRank"),
      v("Y0lT9Fck7qI", "Climbing Stairs — LeetCode 70", "NeetCode"),
      v("H9bfqozjoqs", "Coin Change — LeetCode 322", "NeetCode"),
      v("73r3KWiEvyk", "House Robber — LeetCode 198", "NeetCode"),
      v("5WZl3MMT0Eg", "Maximum Subarray — LeetCode 53", "NeetCode"),
    ],
  },
  {
    key: "graph",
    re: /graph|\bbfs\b|\bdfs\b|shortest path|dijkstra|island|topolog|union.?find|course schedule/i,
    article: "https://www.geeksforgeeks.org/graph-data-structure-and-algorithms/",
    videos: [
      v("zaBhtODEL0w", "Algorithms: Graph Search, DFS and BFS", "HackerRank"),
      v("pcKY4hjDrxk", "Graph Traversals — BFS & DFS", "Abdul Bari"),
      v("tWVWeAqZ0WU", "Graph Algorithms for Technical Interviews", "freeCodeCamp"),
      v("09_LlHjoEiY", "Graph Theory — Algorithms Course", "freeCodeCamp"),
      v("XB4MIexjvY0", "Dijkstra Algorithm — Shortest Path", "Abdul Bari"),
      v("pV2kpPD66nE", "Number of Islands — LeetCode 200", "NeetCode"),
      v("EgI5nU9etnU", "Course Schedule — LeetCode 207", "NeetCode"),
      v("ibjEGG7ylHk", "Union Find Introduction", "WilliamFiset"),
    ],
  },
  {
    key: "tree",
    re: /\btree|\bbst\b|binary search tree|invert binary|depth of binary/i,
    article: "https://www.geeksforgeeks.org/binary-tree-data-structure/",
    videos: [
      v("oSWTXtMglKE", "Data Structures: Trees", "HackerRank"),
      v("OnSn2XEQ4MY", "Invert Binary Tree — LeetCode 226", "NeetCode"),
      v("hTM3phVI6YQ", "Maximum Depth of Binary Tree — LeetCode 104", "NeetCode"),
    ],
  },
  {
    key: "linkedlist",
    re: /linked.?list|reverse list|list cycle|merge two sorted/i,
    article: "https://www.geeksforgeeks.org/linked-list-data-structure/",
    videos: [
      v("njTh_OwMljA", "Data Structures: Linked Lists", "HackerRank"),
      v("G0_I-ZF0S38", "Reverse Linked List — LeetCode 206", "NeetCode"),
      v("XIdigk956u0", "Merge Two Sorted Lists — LeetCode 21", "NeetCode"),
      v("gBTe7lFR3vc", "Linked List Cycle — LeetCode 141", "NeetCode"),
    ],
  },
  {
    key: "binarysearch",
    re: /binary search|searching/i,
    article: "https://www.geeksforgeeks.org/binary-search/",
    videos: [
      v("P3YID7liBug", "Algorithms: Binary Search", "HackerRank"),
      v("C2apEw9pgtw", "Binary Search Iterative Method", "Abdul Bari"),
      v("MFhxShGxHWc", "Binary Search Algorithm in 100 Seconds", "Fireship"),
      v("s4DPM8ct1pI", "Binary Search — LeetCode 704", "NeetCode"),
    ],
  },
  {
    key: "window",
    re: /sliding window|two.?pointer|palindrome|longest substring|3sum|container with most water|buy and sell stock/i,
    article: "https://www.geeksforgeeks.org/window-sliding-technique/",
    videos: [
      v("MK-NZ4hN7rs", "Sliding Window Technique", "Ryan Schachte"),
      v("1pkOgXD63yU", "Best Time to Buy and Sell Stock — LeetCode 121", "NeetCode"),
      v("wiGpQwVHdE0", "Longest Substring Without Repeating Characters — LeetCode 3", "NeetCode"),
      v("jzZsG8n2R9A", "3Sum — LeetCode 15", "NeetCode"),
      v("UuiTKBwPgAo", "Container With Most Water — LeetCode 11", "NeetCode"),
      v("jJXJ16kPFWg", "Valid Palindrome — LeetCode 125", "NeetCode"),
    ],
  },
  {
    key: "sort",
    re: /\bsort|merge interval|interval/i,
    article: "https://www.geeksforgeeks.org/sorting-algorithms/",
    videos: [
      v("kPRA0W1kECg", "15 Sorting Algorithms in 6 Minutes", "Timo Bingmann"),
      v("KF2j-9iSf4Q", "Algorithms: Merge Sort", "HackerRank"),
      v("SLauY6PpjW4", "Algorithms: Quicksort", "HackerRank"),
      v("6Gv8vg0kcHc", "Algorithms: Bubble Sort", "HackerRank"),
      v("mB5HXBb_HY8", "Merge Sort Algorithm", "Abdul Bari"),
      v("7h1s2SojIRw", "QuickSort Algorithm", "Abdul Bari"),
      v("44H3cEC2fFM", "Merge Intervals — LeetCode 56", "NeetCode"),
    ],
  },
  {
    key: "stackqueue",
    re: /\bstack|\bqueue|deque|parenthes|min stack/i,
    article: "https://www.geeksforgeeks.org/stack-data-structure/",
    videos: [
      v("wjI1WNcIntg", "Data Structures: Stacks and Queues", "HackerRank"),
      v("D6gu-_tmEpQ", "Queues in 3 minutes", "Michael Sambol"),
      v("WTzjTskDFMg", "Valid Parentheses — LeetCode 20", "NeetCode"),
      v("qkLl7nAwDPo", "Design Min Stack — LeetCode 155", "NeetCode"),
    ],
  },
  {
    key: "hash",
    re: /\bhash|hashmap|dictionary|two sum|anagram|contains duplicate|frequency/i,
    article: "https://www.geeksforgeeks.org/hashing-data-structure/",
    videos: [
      v("shs0KM3wKv8", "Data Structures: Hash Tables", "HackerRank"),
      v("mFY0J5W8Udk", "Hashing Technique — Simplified", "Abdul Bari"),
      v("KLlXCFG5TnA", "Two Sum — LeetCode 1", "NeetCode"),
      v("3OamzN90kPg", "Contains Duplicate — LeetCode 217", "NeetCode"),
      v("9UtInBqnCgA", "Valid Anagram — LeetCode 242", "NeetCode"),
      v("vzdNOK2oB2E", "Group Anagrams — LeetCode 49", "NeetCode"),
    ],
  },
  {
    key: "recursion",
    re: /recurs|backtrack|recurrence/i,
    article: "https://www.programiz.com/dsa/recursion",
    videos: [
      v("KEEKn7Me-ms", "Algorithms: Recursion", "HackerRank"),
      v("IJDJ0kBx2LM", "Recursion in Programming — Full Course", "freeCodeCamp"),
      v("rf60MejMz3E", "Recursion in 100 Seconds", "Fireship"),
      v("4V30R3I1vLI", "Recurrence Relation", "Abdul Bari"),
    ],
  },
  {
    key: "complexity",
    re: /big.?o|complexity|asymptotic|time and space/i,
    article: "https://www.geeksforgeeks.org/analysis-of-algorithms-set-1-asymptotic-analysis/",
    videos: [
      v("v4cd1O4zkGw", "Big O Notation", "HackerRank"),
      v("g2o22C3CRfU", "Big-O Notation in 100 Seconds", "Fireship"),
      v("A03oI0znAoc", "Asymptotic Notations — Big Oh, Omega, Theta", "Abdul Bari"),
      v("0IAPZzGSbME", "Introduction to Algorithms", "Abdul Bari"),
    ],
  },
  {
    key: "array",
    re: /\barray|product of array|subarray/i,
    article: "https://www.geeksforgeeks.org/array-data-structure/",
    videos: [
      v("bNvIQI2wAjk", "Product of Array Except Self — LeetCode 238", "NeetCode"),
      v("RBSGKlAvoiM", "Data Structures Easy to Advanced", "freeCodeCamp"),
      v("zg9ih6SVACc", "Data Structures — CS Course for Beginners", "freeCodeCamp"),
    ],
  },
  {
    key: "dsa",
    re: /\bdsa\b|data structure|algorithm|leetcode|coding practice|exercism/i,
    article: "https://www.geeksforgeeks.org/data-structures/",
    videos: [
      v("8hly31xKli0", "Algorithms and Data Structures — Full Course", "freeCodeCamp"),
      v("BBpAmxU_NQo", "Data Structures and Algorithms for Beginners", "Programming with Mosh"),
      v("pkYVOmU3MgA", "Data Structures and Algorithms in Python", "freeCodeCamp"),
      v("B31LgI4Y4DQ", "Data Structures — Full Course Using C and C++", "freeCodeCamp"),
      v("8mAITcNt710", "Harvard CS50 — Full Computer Science Course", "freeCodeCamp / Harvard"),
    ],
  },
  {
    key: "sysdesign",
    re: /system design|architecture|scalab|load balanc|caching|\bcdn\b|\bhld\b|\blld\b|microservice/i,
    article: "https://github.com/donnemartin/system-design-primer",
    videos: [
      v("m8Icp_Cid5o", "System Design for Beginners Course", "freeCodeCamp"),
      v("i7twT3x5yv8", "System Design Interview: A Step-By-Step Guide", "ByteByteGo"),
      v("xpDnVSmNFX0", "System Design Basics: Horizontal vs Vertical Scaling", "Gaurav Sen"),
      v("K0Ta65OqQkY", "What is Load Balancing?", "Gaurav Sen"),
      v("UzLMhqg3_Wc", "System Design Introduction for Interview", "Tushar Roy"),
      v("bUHFg8CZFws", "System Design Interview — Step By Step Guide", "System Design Interview"),
    ],
  },
  {
    key: "mvc",
    re: /\bmvc\b|app state|tech stack|model.?view/i,
    article: "https://developer.mozilla.org/en-US/docs/Glossary/MVC",
    videos: [
      v("pCvZtjoRq1I", "What Is MVC? Simple Explanation", "Traversy Media"),
      v("DUg2SWWK18I", "MVC Explained in 4 Minutes", "Web Dev Simplified"),
    ],
  },
  {
    key: "api",
    re: /\brest\b|\bapi\b|http|endpoint/i,
    article: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Overview",
    videos: [
      v("lsMQRaeKNDk", "What is a REST API?", "IBM Technology"),
      v("-MTSQjw5DrM", "RESTful APIs in 100 Seconds", "Fireship"),
    ],
  },
  {
    key: "agent",
    re: /n8n|agent|workbench|workflow|automation|\bllm\b|\brag\b|generative ai|prompt/i,
    article: "https://docs.n8n.io/",
    videos: [
      v("4BVTkqbn_tY", "n8n Beginner Course — Introduction to Automation", "n8n"),
      v("1MwSoB0gnM4", "n8n Quickstart", "n8n"),
      v("F8NKVhkZZWI", "What are AI Agents?", "IBM Technology"),
      v("sal78ACtGTc", "What's next for AI agentic workflows — Andrew Ng", "Sequoia Capital"),
      v("T-D1OfcDW1M", "What is Retrieval-Augmented Generation (RAG)?", "IBM Technology"),
      v("zjkBMFhNj_g", "Intro to Large Language Models", "Andrej Karpathy"),
    ],
  },
  {
    key: "ml",
    re: /machine learning|neural|deep learning|\bml\b|fine.?tun/i,
    article: "https://developers.google.com/machine-learning/crash-course",
    videos: [
      v("i_LwzRVP7bg", "Machine Learning for Everybody", "freeCodeCamp"),
      v("aircAruvnKk", "But what is a neural network?", "3Blue1Brown"),
      v("iOdFUJiB0Zc", "Fine Tuning LLM Models — Generative AI Course", "freeCodeCamp"),
    ],
  },
  {
    key: "react",
    re: /react|jsx|useState|useEffect|component/i,
    article: "https://react.dev/learn",
    videos: [
      v("bMknfKXIFA8", "React Course — Beginner's Tutorial", "freeCodeCamp"),
      v("Tn6-PIqc4UM", "React in 100 Seconds", "Fireship"),
      v("SqcY0GlETPk", "React Tutorial for Beginners", "Programming with Mosh"),
      v("w7ejDZ8SWv8", "React JS Crash Course", "Traversy Media"),
      v("Ke90Tje7VS0", "React JS — React Tutorial for Beginners", "Programming with Mosh"),
    ],
  },
  {
    key: "node",
    re: /node|express|backend/i,
    article: "https://nodejs.org/en/learn",
    videos: [
      v("Oe421EPjeBE", "Node.js and Express.js — Full Course", "freeCodeCamp"),
      v("ENrzD9HAZK4", "Node.js Ultimate Beginner's Guide", "Fireship"),
      v("TlB_eWDSMt4", "Node.js Tutorial for Beginners", "Programming with Mosh"),
      v("fBNz5xF-Kx4", "Node.js Crash Course", "Traversy Media"),
      v("L72fhGm1tfE", "Express JS Crash Course", "Traversy Media"),
    ],
  },
  {
    key: "typescript",
    re: /typescript/i,
    article: "https://www.typescriptlang.org/docs/",
    videos: [
      v("30LWjhZzg50", "Learn TypeScript — Full Tutorial", "freeCodeCamp"),
      v("zQnBQ4tB3ZA", "TypeScript in 100 Seconds", "Fireship"),
    ],
  },
  {
    key: "javascript",
    re: /javascript|\bjs\b|es6|\bdom\b/i,
    article: "https://javascript.info/",
    videos: [
      v("PkZNo7MFNFg", "Learn JavaScript — Full Course", "freeCodeCamp"),
      v("W6NZfCO5SIk", "JavaScript Course for Beginners", "Programming with Mosh"),
      v("hdI2bqOjy3c", "JavaScript Crash Course", "Traversy Media"),
      v("DHjqpvDnNGE", "JavaScript in 100 Seconds", "Fireship"),
    ],
  },
  {
    key: "web",
    re: /html|css|frontend|web page|responsive/i,
    article: "https://developer.mozilla.org/en-US/docs/Learn_web_development",
    videos: [
      v("mU6anWqZJcc", "Learn HTML5 and CSS3 From Scratch", "freeCodeCamp"),
      v("UB1O30fR-EE", "HTML Crash Course", "Traversy Media"),
      v("yfoY53QXEnI", "CSS Crash Course", "Traversy Media"),
      v("zJSY8tbf_ys", "Frontend Web Development Bootcamp", "freeCodeCamp"),
    ],
  },
  {
    key: "sql",
    re: /\bsql\b|database|postgres|mysql|mongo|\bdbms\b/i,
    article: "https://www.programiz.com/sql",
    videos: [
      v("HXV3zeQKqGY", "SQL Tutorial — Full Database Course", "freeCodeCamp"),
      v("7S_tz1z_5bA", "SQL Course for Beginners", "Programming with Mosh"),
      v("zsjvFFKOm3c", "SQL Explained in 100 Seconds", "Fireship"),
      v("qw--VYLpxG4", "Learn PostgreSQL — Full Course", "freeCodeCamp"),
      v("-56x56UppqQ", "MongoDB Crash Course", "Traversy Media"),
    ],
  },
  {
    key: "python",
    re: /python|django|flask/i,
    article: "https://docs.python.org/3/tutorial/",
    videos: [
      v("rfscVS0vtbw", "Learn Python — Full Course", "freeCodeCamp"),
      v("_uQrJ0TkZlc", "Python Full Course for Beginners", "Programming with Mosh"),
      v("x7X9w_GIm1s", "Python in 100 Seconds", "Fireship"),
      v("Ej_02ICOIgs", "Object Oriented Programming with Python", "freeCodeCamp"),
    ],
  },
  {
    key: "git",
    re: /\bgit\b|github|version control/i,
    article: "https://git-scm.com/book/en/v2/Getting-Started-About-Version-Control",
    videos: [
      v("RGOj5yH7evk", "Git and GitHub for Beginners", "freeCodeCamp"),
      v("8JJ101D3knE", "Git Tutorial for Beginners", "Programming with Mosh"),
      v("hwP7WQkmECE", "Git Explained in 100 Seconds", "Fireship"),
    ],
  },
  {
    key: "devops",
    re: /docker|container|devops|deploy|cloud|\baws\b/i,
    article: "https://docs.docker.com/get-started/",
    videos: [
      v("fqMOX6JJhGo", "Docker Tutorial for Beginners — Full DevOps Course", "freeCodeCamp"),
      v("pTFZFxd4hOI", "Docker Tutorial for Beginners", "Programming with Mosh"),
      v("Gjnup-PuquQ", "Docker in 100 Seconds", "Fireship"),
      v("SOTamWNgDKc", "AWS Certified Cloud Practitioner Course", "freeCodeCamp"),
    ],
  },
  {
    key: "java",
    re: /\bjava\b|c\+\+|\bcpp\b|\boops?\b/i,
    article: "https://www.programiz.com/java-programming",
    videos: [
      v("eIrMbAQSU34", "Java Full Course for Beginners", "Programming with Mosh"),
      v("vLnPwxZdW4Y", "C++ Tutorial for Beginners", "freeCodeCamp"),
    ],
  },
  {
    key: "uiux",
    re: /ui\s*\/?\s*ux|figma|wireframe|sketch screens|storyboard|design style|mockup|prototype/i,
    article: "https://help.figma.com/hc/en-us",
    videos: [
      v("FTFaQWZBqQ8", "Figma UI Design Tutorial", "AJ&Smart"),
      v("jwCmIBJ8Jtc", "Figma Tutorial for UI Design", "freeCodeCamp"),
      v("c9Wg6Cb_YlU", "UI / UX Design — Wireframe, Mockup & Design in Figma", "freeCodeCamp"),
    ],
  },
  {
    key: "pitch",
    re: /pitch|\bbmc\b|business model|value proposition|sales|investor/i,
    article: "https://www.strategyzer.com/business-model-canvas",
    videos: [
      v("QoAOzMTLP5s", "Business Model Canvas Explained", "Strategyzer"),
      v("ReM1uqmVfP0", "Value Proposition Canvas Explained", "Strategyzer"),
      v("17XZGUX_9iM", "How to Pitch Your Startup — Kevin Hale", "Y Combinator"),
      v("SHAh6WKBgiE", "Sales and Marketing; How to Talk to Investors", "Y Combinator"),
    ],
  },
  {
    key: "research",
    re: /persona|audience|empathy|interview|observation|user research|prepare test|usability/i,
    article: "https://www.nngroup.com/articles/persona/",
    videos: [
      v("u44pBnAn7cM", "Creating Personas for UX Research", "PlaybookUX"),
      v("QwF9a56WFWA", "What is an Empathy Map?", "PlaybookUX"),
      v("K2vSQPh6MCE", "GV's Sprint Process in 90 Seconds", "Google Ventures"),
    ],
  },
  {
    key: "dt",
    re: /design thinking|dt playbook|empathi|ideat|problem identification|similar products|my ideas|focus|define|reiterate|lean startup|user actions|features|inclusion|process flow/i,
    article: "https://www.interaction-design.org/literature/topics/design-thinking",
    videos: [
      v("_r0VX-aU_T8", "The Design Thinking Process", "Sprouts"),
      v("gHGN6hs2gZY", "What Is Design Thinking? An Overview", "AJ&Smart"),
      v("a7sEoEvT8l8", "What Is Design Thinking?", "Sean VanGenderen"),
      v("M66ZU2PCIcM", "IDEO Shopping Cart (ABC Nightline)", "IDEO / ABC"),
      v("fEvKo90qBns", "The Lean Startup — Eric Ries", "Talks at Google"),
      v("K2vSQPh6MCE", "GV's Sprint Process in 90 Seconds", "Google Ventures"),
    ],
  },
];

const GENERAL_VIDEOS = [
  v("zOjov-2OZ0E", "Introduction to Programming and Computer Science", "freeCodeCamp"),
  v("8mAITcNt710", "Harvard CS50 — Full Computer Science Course", "freeCodeCamp / Harvard"),
  v("8hly31xKli0", "Algorithms and Data Structures — Full Course", "freeCodeCamp"),
];

const KNOWN_VIDEO_IDS = new Set(
  [...YT_FAMILIES.flatMap((f) => f.videos), ...GENERAL_VIDEOS].map((x) => x.id)
);

function videoById(id) {
  for (const f of YT_FAMILIES) {
    const hit = f.videos.find((x) => x.id === id);
    if (hit) return hit;
  }
  return GENERAL_VIDEOS.find((x) => x.id === id) || null;
}

/**
 * On-topic verified video not already in `seen` (plan-wide Set of URLs).
 * Rotates by dayIdx so different days start at different videos.
 */
function pickPoolVideo(topic = "", { seen = null, dayIdx = 0 } = {}) {
  const used = seen instanceof Set ? seen : new Set();
  const t = String(topic || "");
  const fams = YT_FAMILIES.filter((f) => f.re.test(t));
  for (const f of fams) {
    const start = Math.abs(Number(dayIdx) || 0) % f.videos.length;
    for (let i = 0; i < f.videos.length; i++) {
      const cand = f.videos[(start + i) % f.videos.length];
      if (!used.has(cand.url)) return { ...cand, article: f.article };
    }
  }
  const pool = [...GENERAL_VIDEOS, ...YT_FAMILIES.flatMap((f) => f.videos)];
  const free = pool.find((x) => !used.has(x.url));
  const pick = free || pool[Math.abs(Number(dayIdx) || 0) % pool.length];
  return { ...pick, article: fams[0]?.article || "" };
}

module.exports = { YT_FAMILIES, GENERAL_VIDEOS, KNOWN_VIDEO_IDS, videoById, pickPoolVideo };
