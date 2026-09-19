/**
 * Canonical LeetCode problem URLs — always point at /problems/<slug>/ when a name exists.
 * Never leave bare /problems/ or /problemset/ when we know the problem title.
 */

const EXACT_LC_RE = /leetcode\.com\/problems\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?(?:[?#].*)?$/i;
const BARE_LC_RE =
  /leetcode\.com\/(?:problems\/?|problemset\/?)(?:[?#].*)?$/i;

function slugifyProblemName(name = "") {
  return String(name || "")
    .replace(/^#?\d+\s*[—–.:\-]*\s*/i, "")
    .replace(/\([^)]*\)\s*$/g, "")
    .replace(/\b(easy|medium|hard)\b/gi, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function lookupVerifiedByLc(lc) {
  const n = String(lc || "").trim();
  if (!n) return null;
  try {
    const { VERIFIED_LEETCODE, VERIFIED_SD_LEETCODE } = require("../data/verifiedLeetCodePool");
    const hit =
      (VERIFIED_LEETCODE || []).find((p) => String(p.lc) === n) ||
      (VERIFIED_SD_LEETCODE || []).find((p) => String(p.lc) === n);
    return hit || null;
  } catch (_) {
    return null;
  }
}

function isExactLeetCodeProblemUrl(url = "") {
  return EXACT_LC_RE.test(String(url || "").trim().replace(/[.,;:!?)]+$/g, ""));
}

function isBareLeetCodeUrl(url = "") {
  const u = String(url || "").trim().replace(/[.,;:!?)]+$/g, "");
  if (!/leetcode\.com/i.test(u)) return false;
  if (isExactLeetCodeProblemUrl(u)) return false;
  return (
    BARE_LC_RE.test(u) ||
    /leetcode\.com\/problems\/?\s*$/i.test(u) ||
    /leetcode\.com\/problemset/i.test(u)
  );
}

function isLeetCodeHostUrl(url = "") {
  return /leetcode\.com/i.test(String(url || ""));
}

/**
 * Build https://leetcode.com/problems/<slug>/ from url / slug / name / lc#.
 * @returns {string} exact problem URL, or "" if nothing usable
 */
function buildLeetCodeProblemUrl(p = {}) {
  const rawUrl = String(p?.url || "").trim().replace(/[.,;:!?)]+$/g, "");
  if (isExactLeetCodeProblemUrl(rawUrl)) {
    const m = rawUrl.match(EXACT_LC_RE);
    return `https://leetcode.com/problems/${m[1]}/`;
  }

  // Prefer verified pool by problem number (correct official slug)
  const verified = lookupVerifiedByLc(p?.lc);
  if (verified?.name) {
    const slug = slugifyProblemName(verified.name);
    if (slug) return `https://leetcode.com/problems/${slug}/`;
  }

  const slug =
    slugifyProblemName(p?.slug) ||
    slugifyProblemName(p?.name) ||
    slugifyProblemName(p?.title) ||
    slugifyProblemName(p?.problem);
  if (slug && slug.length >= 2) {
    return `https://leetcode.com/problems/${slug}/`;
  }
  return "";
}

/** Prefer exact problem URL; only fall back to problemset when no name/slug/lc. */
function leetcodeUrl(p = {}) {
  return buildLeetCodeProblemUrl(p) || "https://leetcode.com/problemset/";
}

/**
 * Pull a problem title from schedule / homework cell text.
 */
function extractLeetCodeProblemName(content = "") {
  const text = String(content || "");
  const patterns = [
    /^Problem:\s*(?:#\s*\d+\s*[—–.-]+\s*)?(.+?)(?:\s*\((?:Easy|Medium|Hard)\))?\s*$/im,
    /^Tonight:\s*(?:#\s*\d+\s*[—–.-]+\s*)?(.+?)(?:\s*\((?:Easy|Medium|Hard)\))?\s*$/im,
    /LeetCode\s*#\s*\d+\s*[—–.-]+\s*([^\n(]+?)(?:\s*\((?:Easy|Medium|Hard)\))?/i,
    /▶\s*Solve:\s*(?:LeetCode\s*)?(?:#\s*\d+\s*[—–.-]+\s*)?([^—\n]+?)(?:\s*\((?:Easy|Medium|Hard)\))?(?:\s*[—–-]\s*https?:\/\/)?/im,
    /Solve:\s*(?:LeetCode\s*)?(?:#\s*\d+\s*[—–.-]+\s*)?([A-Za-z][^—\n(]+)/im,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) {
      let name = String(m[1])
        .replace(/https?:\/\/\S+/g, "")
        .replace(/\bLeetCode\b/gi, "")
        .replace(/^#?\s*\d+\s*[—–.-]*\s*/i, "")
        .replace(/\([^)]*\)\s*$/g, "")
        .trim();
      if (name.length >= 2 && !/^one easy problem/i.test(name)) return name;
    }
  }
  return "";
}

/** Extract "#146" style problem number from homework / schedule cell. */
function extractLeetCodeNumber(content = "") {
  const text = String(content || "");
  const m =
    text.match(/Problem:\s*#\s*(\d+)/i) ||
    text.match(/LeetCode\s*#\s*(\d+)/i) ||
    text.match(/#\s*(\d+)\s*[—–.-]+\s*[A-Za-z]/);
  return m?.[1] || "";
}

/**
 * Rewrite bare / incomplete / wrong LeetCode URLs in a content cell to the exact problem.
 * @returns {{ content, fixed, bareRemaining }}
 */
function repairLeetCodeUrlsInContent(content = "") {
  let text = String(content || "");
  if (!/leetcode\.com/i.test(text) && !/leetcode\s*#/i.test(text) && !/^Problem:\s*#/im.test(text)) {
    return { content: text, fixed: 0, bareRemaining: 0 };
  }

  const lcNum = extractLeetCodeNumber(text);
  const name = extractLeetCodeProblemName(text);
  const exact = buildLeetCodeProblemUrl({ lc: lcNum, name });
  let fixed = 0;

  if (exact) {
    text = text.replace(/(Link:\s*)(https?:\/\/[^\s]+)/gi, (full, pfx, url) => {
      if (/leetcode\.com/i.test(url)) {
        if (isExactLeetCodeProblemUrl(url) && !isBareLeetCodeUrl(url)) {
          const wantSlug = exact.match(EXACT_LC_RE)?.[1];
          const haveSlug = url.match(EXACT_LC_RE)?.[1];
          if (wantSlug && haveSlug && wantSlug !== haveSlug) {
            fixed += 1;
            return `${pfx}${exact}`;
          }
          return full;
        }
        fixed += 1;
        return `${pfx}${exact}`;
      }
      // Wrong platform on a LeetCode homework Link line — force correct LC
      if (/LeetCode|Problem:\s*#/i.test(text)) {
        fixed += 1;
        return `${pfx}${exact}`;
      }
      return full;
    });

    text = text.replace(
      /(https?:\/\/(?:www\.)?leetcode\.com\/(?:problems\/?|problemset\/?)[^\s]*)/gi,
      (url) => {
        if (isExactLeetCodeProblemUrl(url)) {
          const wantSlug = exact.match(EXACT_LC_RE)?.[1];
          const haveSlug = url.match(EXACT_LC_RE)?.[1];
          if (wantSlug && haveSlug && wantSlug !== haveSlug) {
            fixed += 1;
            return exact;
          }
          return url.replace(/[.,;:!?)]+$/g, "");
        }
        fixed += 1;
        return exact;
      }
    );

    if (/▶\s*Solve:/i.test(text) && !/leetcode\.com\/problems\/[a-z0-9-]+/i.test(text)) {
      text = text.replace(
        /(▶\s*Solve:\s*)([^\n—]+)(—\s*)?(https?:\/\/\S+)?/i,
        (full, pfx, title) => {
          fixed += 1;
          return `${pfx}${String(title).trim()} — ${exact}`;
        }
      );
    }

    if (/^LeetCode\b/im.test(text) && /^Problem:\s*#/im.test(text) && !/^Link:\s*/im.test(text)) {
      text = text.replace(/^(Problem:\s*.+)$/im, `$1\nLink: ${exact}`);
      fixed += 1;
    }
  }

  const urls = text.match(/https?:\/\/(?:www\.)?leetcode\.com\/[^\s]+/gi) || [];
  const bareRemaining = urls.filter((u) => isBareLeetCodeUrl(u)).length;

  return { content: text, fixed, bareRemaining };
}

module.exports = {
  slugifyProblemName,
  isExactLeetCodeProblemUrl,
  isBareLeetCodeUrl,
  isLeetCodeHostUrl,
  buildLeetCodeProblemUrl,
  leetcodeUrl,
  extractLeetCodeProblemName,
  extractLeetCodeNumber,
  repairLeetCodeUrlsInContent,
  lookupVerifiedByLc,
};
