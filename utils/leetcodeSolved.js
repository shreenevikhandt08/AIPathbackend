/**
 * Public LeetCode GraphQL — skip problems the student already accepted.
 * Username is optional; if missing, the picker behaves as before.
 */
const axios = require("axios");

const cache = new Map(); // username -> { at, pack }
const TTL_MS = 30 * 60 * 1000;

function emptyPack() {
  return { slugs: [], titles: [], names: [], count: 0, source: "none" };
}

function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeUsername(raw) {
  return String(raw || "")
    .trim()
    .replace(/^https?:\/\/(www\.)?leetcode\.com\/(u\/)?/i, "")
    .replace(/\/.*$/, "")
    .replace(/^@/, "");
}

async function fetchLeetCodeSolved(username) {
  const u = normalizeUsername(username);
  if (!u) return emptyPack();
  const key = u.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.pack;

  const pack = emptyPack();
  try {
    const { data } = await axios.post(
      "https://leetcode.com/graphql",
      {
        query: `query recentAc($username: String!) {
          recentAcSubmissionList(username: $username, limit: 100) {
            title
            titleSlug
          }
        }`,
        variables: { username: u },
      },
      {
        timeout: 12000,
        headers: {
          "Content-Type": "application/json",
          Referer: "https://leetcode.com",
          Origin: "https://leetcode.com",
          "User-Agent": "Mozilla/5.0 AI-Path-Builder",
        },
      }
    );
    const list = data?.data?.recentAcSubmissionList;
    if (Array.isArray(list) && list.length) {
      for (const row of list) {
        const slug = String(row?.titleSlug || "").toLowerCase().trim();
        const title = String(row?.title || "").toLowerCase().trim();
        if (slug) pack.slugs.push(slug);
        if (title) {
          pack.titles.push(title);
          pack.names.push(title);
        }
      }
      pack.count = pack.slugs.length;
      pack.source = "leetcode-graphql";
    }
  } catch (e) {
    console.warn("LeetCode solved lookup failed:", e.message);
  }

  cache.set(key, { at: Date.now(), pack });
  return pack;
}

function collectUsernames(inputs = {}) {
  const out = [];
  const push = (v) => {
    const u = normalizeUsername(v);
    if (u && !out.includes(u)) out.push(u);
  };
  push(inputs.leetcodeUsername);
  try {
    const raw = inputs._teamMembers ?? inputs.teamMembers;
    const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(arr)) arr.forEach((m) => push(m?.leetcodeUsername));
  } catch (_) {}
  return out;
}

async function attachSolvedLeetCode(inputs = {}) {
  const users = collectUsernames(inputs);
  const byUser = {};
  const merged = emptyPack();
  for (const u of users) {
    const pack = await fetchLeetCodeSolved(u);
    byUser[u.toLowerCase()] = pack;
    merged.slugs.push(...pack.slugs);
    merged.titles.push(...pack.titles);
    merged.names.push(...pack.names);
    merged.count += pack.count;
  }
  merged.slugs = [...new Set(merged.slugs)];
  merged.titles = [...new Set(merged.titles)];
  merged.names = [...new Set(merged.names)];
  if (merged.count) merged.source = "leetcode-graphql";
  inputs._solvedLc = merged;
  inputs._solvedLcByUser = byUser;
  return merged;
}

function solvedPackForPicker(cfg, member) {
  const byUser = cfg?._solvedLcByUser || cfg?.inputs?._solvedLcByUser || {};
  const u = normalizeUsername(member?.leetcodeUsername || cfg?.leetcodeUsername);
  if (u && byUser[u.toLowerCase()]) return byUser[u.toLowerCase()];
  return cfg?._solvedLc || cfg?.inputs?._solvedLc || emptyPack();
}

function isSolvedProblem(p, pack) {
  if (!p || !pack) return false;
  const slug =
    String(p.slug || "").toLowerCase() ||
    String(p.url || "").match(/leetcode\.com\/problems\/([a-z0-9-]+)/i)?.[1] ||
    slugify(p.name);
  const name = String(p.name || "").toLowerCase().trim();
  if (slug && (pack.slugs || []).includes(slug)) return true;
  if (name && (pack.titles || []).includes(name)) return true;
  return false;
}

module.exports = {
  fetchLeetCodeSolved,
  attachSolvedLeetCode,
  solvedPackForPicker,
  isSolvedProblem,
  normalizeUsername,
  slugify,
};
