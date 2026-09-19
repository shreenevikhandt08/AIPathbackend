/**
 * Verified real LeetCode problems — fallback when RAG returns empty / truncated.
 * Numbers + titles match leetcode.com (Blind 75 / NeetCode / common interview).
 * Used only when RAG pack has no usable items — never invents fake problems.
 */

function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function withUrl(p) {
  return {
    ...p,
    url: p.url || `https://leetcode.com/problems/${slugify(p.name)}/`,
    source: p.source || "verified-pool",
  };
}

/** Classic DSA pool — large enough for multi-week plans without repeats. */
const VERIFIED_LEETCODE = [
  { lc: 1, name: "Two Sum", difficulty: "Easy", pattern: "Hash Map" },
  { lc: 217, name: "Contains Duplicate", difficulty: "Easy", pattern: "Hash Map" },
  { lc: 242, name: "Valid Anagram", difficulty: "Easy", pattern: "Hash Map" },
  { lc: 49, name: "Group Anagrams", difficulty: "Medium", pattern: "Hash Map" },
  { lc: 347, name: "Top K Frequent Elements", difficulty: "Medium", pattern: "Heap" },
  { lc: 238, name: "Product of Array Except Self", difficulty: "Medium", pattern: "Arrays" },
  { lc: 53, name: "Maximum Subarray", difficulty: "Medium", pattern: "Kadane" },
  { lc: 152, name: "Maximum Product Subarray", difficulty: "Medium", pattern: "Arrays" },
  { lc: 153, name: "Find Minimum in Rotated Sorted Array", difficulty: "Medium", pattern: "Binary Search" },
  { lc: 33, name: "Search in Rotated Sorted Array", difficulty: "Medium", pattern: "Binary Search" },
  { lc: 15, name: "3Sum", difficulty: "Medium", pattern: "Two Pointers" },
  { lc: 11, name: "Container With Most Water", difficulty: "Medium", pattern: "Two Pointers" },
  { lc: 121, name: "Best Time to Buy and Sell Stock", difficulty: "Easy", pattern: "Arrays" },
  { lc: 20, name: "Valid Parentheses", difficulty: "Easy", pattern: "Stack" },
  { lc: 155, name: "Min Stack", difficulty: "Medium", pattern: "Stack" },
  { lc: 150, name: "Evaluate Reverse Polish Notation", difficulty: "Medium", pattern: "Stack" },
  { lc: 22, name: "Generate Parentheses", difficulty: "Medium", pattern: "Backtracking" },
  { lc: 739, name: "Daily Temperatures", difficulty: "Medium", pattern: "Stack" },
  { lc: 141, name: "Linked List Cycle", difficulty: "Easy", pattern: "Linked List" },
  { lc: 21, name: "Merge Two Sorted Lists", difficulty: "Easy", pattern: "Linked List" },
  { lc: 19, name: "Remove Nth Node From End of List", difficulty: "Medium", pattern: "Linked List" },
  { lc: 143, name: "Reorder List", difficulty: "Medium", pattern: "Linked List" },
  { lc: 206, name: "Reverse Linked List", difficulty: "Easy", pattern: "Linked List" },
  { lc: 23, name: "Merge k Sorted Lists", difficulty: "Hard", pattern: "Heap" },
  { lc: 104, name: "Maximum Depth of Binary Tree", difficulty: "Easy", pattern: "Trees" },
  { lc: 226, name: "Invert Binary Tree", difficulty: "Easy", pattern: "Trees" },
  { lc: 102, name: "Binary Tree Level Order Traversal", difficulty: "Medium", pattern: "Trees" },
  { lc: 98, name: "Validate Binary Search Tree", difficulty: "Medium", pattern: "Trees" },
  { lc: 230, name: "Kth Smallest Element in a BST", difficulty: "Medium", pattern: "Trees" },
  { lc: 105, name: "Construct Binary Tree from Preorder and Inorder Traversal", difficulty: "Medium", pattern: "Trees" },
  { lc: 124, name: "Binary Tree Maximum Path Sum", difficulty: "Hard", pattern: "Trees" },
  { lc: 200, name: "Number of Islands", difficulty: "Medium", pattern: "Graphs" },
  { lc: 133, name: "Clone Graph", difficulty: "Medium", pattern: "Graphs" },
  { lc: 207, name: "Course Schedule", difficulty: "Medium", pattern: "Graphs" },
  { lc: 210, name: "Course Schedule II", difficulty: "Medium", pattern: "Graphs" },
  { lc: 417, name: "Pacific Atlantic Water Flow", difficulty: "Medium", pattern: "Graphs" },
  { lc: 70, name: "Climbing Stairs", difficulty: "Easy", pattern: "Dynamic Programming" },
  { lc: 198, name: "House Robber", difficulty: "Medium", pattern: "Dynamic Programming" },
  { lc: 213, name: "House Robber II", difficulty: "Medium", pattern: "Dynamic Programming" },
  { lc: 322, name: "Coin Change", difficulty: "Medium", pattern: "Dynamic Programming" },
  { lc: 300, name: "Longest Increasing Subsequence", difficulty: "Medium", pattern: "Dynamic Programming" },
  { lc: 1143, name: "Longest Common Subsequence", difficulty: "Medium", pattern: "Dynamic Programming" },
  { lc: 62, name: "Unique Paths", difficulty: "Medium", pattern: "Dynamic Programming" },
  { lc: 55, name: "Jump Game", difficulty: "Medium", pattern: "Greedy" },
  { lc: 45, name: "Jump Game II", difficulty: "Medium", pattern: "Greedy" },
  { lc: 56, name: "Merge Intervals", difficulty: "Medium", pattern: "Intervals" },
  { lc: 57, name: "Insert Interval", difficulty: "Medium", pattern: "Intervals" },
  { lc: 435, name: "Non-overlapping Intervals", difficulty: "Medium", pattern: "Intervals" },
  { lc: 208, name: "Implement Trie (Prefix Tree)", difficulty: "Medium", pattern: "Trie" },
  { lc: 211, name: "Design Add and Search Words Data Structure", difficulty: "Medium", pattern: "Trie" },
].map(withUrl);

/** SD-linked design problems for homework when DSA is off / SD nights. */
const VERIFIED_SD_LEETCODE = [
  {
    lc: 146,
    name: "LRU Cache",
    difficulty: "Medium",
    pattern: "Hash Map + Doubly Linked List",
    sd: "Caching / eviction",
    whySd: "Same idea as API response caches with capacity limits.",
  },
  {
    lc: 380,
    name: "Insert Delete GetRandom O(1)",
    difficulty: "Medium",
    pattern: "Hash Map + Array",
    sd: "Key-value store",
    whySd: "O(1) insert/delete/random mirrors in-memory store ops.",
  },
  {
    lc: 460,
    name: "LFU Cache",
    difficulty: "Hard",
    pattern: "Hash Map + Frequency lists",
    sd: "Caching / eviction",
    whySd: "Frequency-based eviction used in hot-key caches.",
  },
  {
    lc: 355,
    name: "Design Twitter",
    difficulty: "Medium",
    pattern: "Hash Map + Heap",
    sd: "Feed / fan-out",
    whySd: "Models timeline merge — core feed design.",
  },
  {
    lc: 295,
    name: "Find Median from Data Stream",
    difficulty: "Hard",
    pattern: "Two Heaps",
    sd: "Streaming metrics",
    whySd: "Streaming aggregates for monitoring dashboards.",
  },
  {
    lc: 232,
    name: "Implement Queue using Stacks",
    difficulty: "Easy",
    pattern: "Stack / Queue",
    sd: "Message queues",
    whySd: "Queue semantics show up in async job pipelines.",
  },
  {
    lc: 225,
    name: "Implement Stack using Queues",
    difficulty: "Easy",
    pattern: "Stack / Queue",
    sd: "Message queues",
    whySd: "Stack vs queue trade-offs in buffering.",
  },
  {
    lc: 155,
    name: "Min Stack",
    difficulty: "Medium",
    pattern: "Stack",
    sd: "Auxiliary indexes",
    whySd: "Auxiliary structure for O(1) min — like secondary indexes.",
  },
  {
    lc: 208,
    name: "Implement Trie (Prefix Tree)",
    difficulty: "Medium",
    pattern: "Trie",
    sd: "Autocomplete / prefix search",
    whySd: "Prefix trees power search-as-you-type.",
  },
  {
    lc: 211,
    name: "Design Add and Search Words Data Structure",
    difficulty: "Medium",
    pattern: "Trie",
    sd: "Search / wildcard",
    whySd: "Pattern search over indexed words.",
  },
  {
    lc: 703,
    name: "Kth Largest Element in a Stream",
    difficulty: "Easy",
    pattern: "Heap",
    sd: "Streaming top-K",
    whySd: "Top-K streams for leaderboards / alerts.",
  },
  {
    lc: 641,
    name: "Design Circular Deque",
    difficulty: "Medium",
    pattern: "Deque",
    sd: "Ring buffers",
    whySd: "Fixed-capacity buffers in streaming systems.",
  },
  {
    lc: 707,
    name: "Design Linked List",
    difficulty: "Medium",
    pattern: "Linked List",
    sd: "Custom data structures",
    whySd: "Build the structure before using library lists.",
  },
  {
    lc: 138,
    name: "Copy List with Random Pointer",
    difficulty: "Medium",
    pattern: "Hash Map + Linked List",
    sd: "Object graphs / cloning",
    whySd: "Deep-copy graphs with cross links (cache entries, sessions).",
  },
  {
    lc: 432,
    name: "All O`one Data Structure",
    difficulty: "Hard",
    pattern: "Hash Map + Doubly Linked List",
    sd: "Frequency maps",
    whySd: "O(1) min/max frequency — rate maps and hot keys.",
  },
  {
    lc: 716,
    name: "Max Stack",
    difficulty: "Hard",
    pattern: "Stack + TreeMap",
    sd: "Ordered indexes",
    whySd: "Max-aware stacks appear in priority buffers.",
  },
  {
    lc: 981,
    name: "Time Based Key-Value Store",
    difficulty: "Medium",
    pattern: "Hash Map + Binary Search",
    sd: "Versioned KV / timestamps",
    whySd: "Point-in-time lookups for configs and sensor history.",
  },
  {
    lc: 1396,
    name: "Design Underground System",
    difficulty: "Medium",
    pattern: "Hash Map",
    sd: "Event aggregation",
    whySd: "Check-in/out events → average latency metrics.",
  },
  {
    lc: 1656,
    name: "Design an Ordered Stream",
    difficulty: "Easy",
    pattern: "Array",
    sd: "Ordered delivery",
    whySd: "In-order chunk delivery like sequenced packets.",
  },
  {
    lc: 1797,
    name: "Design Authentication Manager",
    difficulty: "Medium",
    pattern: "Hash Map",
    sd: "Sessions / tokens",
    whySd: "Token expiry mirrors auth session stores.",
  },
].map(withUrl);

function pickFromVerifiedPool(pool, dayIdx = 0, usedLc = null, difficultyPrefs = null) {
  const bank = Array.isArray(pool) ? pool : [];
  if (!bank.length) return null;
  const used = new Set((usedLc || []).map(String));
  let unused = bank.filter((p) => !used.has(String(p.lc)));
  // Prefer unused; only recycle if the whole pool is exhausted
  let poolUse = unused.length ? unused : bank.slice();
  const prefs = Array.isArray(difficultyPrefs)
    ? difficultyPrefs.map((d) => String(d).toLowerCase())
    : null;
  if (prefs && prefs.length) {
    const preferred = poolUse.filter((p) =>
      prefs.includes(String(p.difficulty || "").toLowerCase())
    );
    if (preferred.length) poolUse = preferred;
  }
  const i = Math.max(0, Number(dayIdx) || 0) % poolUse.length;
  const pick = poolUse[i];
  if (Array.isArray(usedLc) && pick?.lc != null && !used.has(String(pick.lc))) {
    usedLc.push(String(pick.lc));
  }
  return pick || null;
}

function mergeVerifiedFallback(pack) {
  const out = pack && typeof pack === "object" ? { ...pack } : { leetcode: [], sdLeetcode: [] };
  const lc = Array.isArray(out.leetcode) ? out.leetcode.slice() : [];
  const sd = Array.isArray(out.sdLeetcode) ? out.sdLeetcode.slice() : [];
  const have = new Set([...lc, ...sd].map((p) => String(p.lc)));

  if (lc.length < 8) {
    for (const p of VERIFIED_LEETCODE) {
      if (have.has(String(p.lc))) continue;
      lc.push(p);
      have.add(String(p.lc));
    }
    out.leetcode = lc;
    out._lcFallback = true;
  }
  if (sd.length < 5) {
    for (const p of VERIFIED_SD_LEETCODE) {
      if (have.has(String(p.lc)) && sd.some((x) => String(x.lc) === String(p.lc))) continue;
      if (!sd.some((x) => String(x.lc) === String(p.lc))) sd.push(p);
    }
    out.sdLeetcode = sd;
    out._sdLcFallback = true;
  }
  if (out._lcFallback || out._sdLcFallback) {
    const modes = [out.mode, "verified-fallback"].filter(Boolean);
    out.mode = modes.join("+");
  }
  return out;
}

module.exports = {
  VERIFIED_LEETCODE,
  VERIFIED_SD_LEETCODE,
  pickFromVerifiedPool,
  mergeVerifiedFallback,
};
