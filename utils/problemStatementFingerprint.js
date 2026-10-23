/**
 * Statement uniqueness — must match FE `fingerprintStatement` in
 * AIPathfrontend/src/utils/problemStatementMeta.js
 */

const crypto = require("crypto");

/** Normalize problem text so the same statement cannot be stored twice. */
function fingerprintStatement(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 480);
}

function fingerprintFromParts(...parts) {
  return fingerprintStatement(parts.filter(Boolean).join(" "));
}

function statementsOverlap(a, b) {
  const fa = fingerprintStatement(a);
  const fb = fingerprintStatement(b);
  if (!fa || !fb) return false;
  if (fa === fb) return true;
  const wa = new Set(fa.split(" ").filter((w) => w.length > 3));
  const wb = fb.split(" ").filter((w) => w.length > 3);
  if (!wa.size || !wb.length) return fa.slice(0, 80) === fb.slice(0, 80);
  let hit = 0;
  wb.forEach((w) => {
    if (wa.has(w)) hit += 1;
  });
  return hit / Math.min(wa.size, wb.length) >= 0.72;
}

function isFingerprintTaken(fp, usedList = []) {
  const needle = fingerprintStatement(fp);
  if (!needle) return false;
  const used = (usedList || []).map(String).filter(Boolean);
  if (used.includes(needle)) return true;
  return used.some((u) => statementsOverlap(needle, u));
}

/** Short hash for logging / secondary indexes (optional). */
function fingerprintHash(fp) {
  const s = fingerprintStatement(fp);
  if (!s) return "";
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 24);
}

function firstText(...vals) {
  for (const v of vals) {
    const s = String(v == null ? "" : v).trim();
    if (s) return s;
  }
  return "";
}

/** Parse "YC W09 — Airbnb" / "Unicorn — Uber (~2010)" → company name. */
function parseCompanyFromSource(source) {
  const s = String(source || "").trim();
  if (!s) return "";
  const em = s.split(/\s*[—–-]\s*/);
  if (em.length >= 2) {
    let right = em.slice(1).join(" — ").trim();
    right = right.replace(/\s*\([^)]*\)\s*$/, "").trim();
    right = right.replace(/\s*\/\s*.*$/, "").trim();
    if (right && !/^(yc|unicorn|offline|fallback)/i.test(right)) return right;
  }
  const m = s.match(/\b(?:YC|Unicorn)[^A-Za-z0-9]+([A-Z][\w.&'+-]{1,40})/);
  return m ? m[1] : "";
}

/**
 * Extract Origin-card provenance from a validation report / rewrite payload / YC idea.
 */
function extractProvenance(report = {}, idea = null) {
  const kindRaw = firstText(
    report.sourceKind,
    report.origin,
    report.frameworkSource,
    report.inspiredBy,
    idea?.kind,
    idea?.sourceKind
  ).toLowerCase();
  const sourceBlob = firstText(report.sourceLabel, idea?.source, report.source);
  const yc =
    report.fitsYC === true ||
    /yc|y combinator|ycombinator/.test(kindRaw) ||
    /y combinator|\byc\b/.test(sourceBlob.toLowerCase());
  const uni =
    report.fitsUnicorn === true ||
    /unicorn/.test(kindRaw) ||
    /unicorn/.test(sourceBlob.toLowerCase());

  let sourceLabel = firstText(report.sourceLabel, idea?.source);
  if (!sourceLabel) {
    if (yc && uni) sourceLabel = "Y Combinator + Unicorn";
    else if (yc) sourceLabel = "Y Combinator";
    else if (uni) sourceLabel = "Unicorn";
  }

  const company = firstText(
    report.company,
    report.companyName,
    report.inspiredCompany,
    report.referenceCompany,
    report.workingCompany,
    idea?.company,
    idea?.name,
    idea?.org,
    parseCompanyFromSource(sourceBlob),
    parseCompanyFromSource(idea?.source)
  );

  return {
    sourceKind: yc && !uni ? "yc" : uni && !yc ? "unicorn" : yc && uni ? "both" : kindRaw || "",
    sourceLabel,
    company,
    year: firstText(
      report.year,
      report.batchYear,
      report.sourceYear,
      idea?.year != null ? String(idea.year) : ""
    ),
    batch: firstText(report.batch, report.ycBatch, report.season, idea?.batch),
    workingOn: firstText(
      report.workingOn,
      report.companyOneLiner,
      report.oneLiner,
      report.whatTheyDo,
      idea?.oneLiner,
      idea?.description,
      idea?.blurb,
      idea?.title
    ),
    url: firstText(report.sourceUrl, report.url, report.website, idea?.url, idea?.website),
  };
}

const STOP = new Set([
  "that", "this", "with", "from", "your", "their", "have", "been", "will", "into",
  "using", "style", "without", "every", "about", "which", "where", "when", "what",
  "make", "made", "than", "also", "only", "more", "most", "such", "over", "under",
  "for", "the", "and", "are", "was", "were", "they", "them", "then", "than",
]);

function analogTokens(text) {
  return fingerprintStatement(text)
    .split(" ")
    .filter((w) => w.length > 3 && !STOP.has(w));
}

/** Closest YC / Unicorn analog — always picks a best match when ideas exist. */
function matchBestAnalog(text, ideas = []) {
  const pool = (ideas || []).filter((i) => i && (i.title || i.source || i.company));
  if (!pool.length) return null;
  const withOrigin = pool.filter(
    (i) => i.year || i.company || parseCompanyFromSource(i.source)
  );
  const list = withOrigin.length ? withOrigin : pool;
  const needle = analogTokens(text);
  const nset = new Set(needle);
  const lower = String(text || "").toLowerCase();
  let best = list[0];
  let score = -1;
  list.forEach((idea) => {
    const blob = `${idea.title || ""} ${idea.company || idea.name || ""} ${idea.source || ""} ${idea.oneLiner || idea.description || ""}`;
    const it = analogTokens(blob);
    let hit = 0;
    it.forEach((w) => {
      if (nset.has(w)) hit += 1;
    });
    const co = String(idea.company || parseCompanyFromSource(idea.source) || "").toLowerCase();
    const coKey = co.split(/[^a-z0-9]+/)[0];
    if (coKey && coKey.length > 2 && lower.includes(coKey)) hit += 10;
    const s = hit + (it.length ? hit / it.length : 0);
    if (s > score) {
      score = s;
      best = idea;
    }
  });
  return best;
}

function matchInspiration(text, ideas = []) {
  return matchBestAnalog(text, ideas);
}

async function loadAllFingerprintsFromDb(ProblemStatement) {
  const rows = await ProblemStatement.find({}, { fingerprint: 1, title: 1, description: 1 })
    .lean()
    .exec();
  const out = [];
  for (const r of rows || []) {
    if (r.fingerprint) out.push(String(r.fingerprint));
    else {
      const fp = fingerprintFromParts(r.title, r.description);
      if (fp) out.push(fp);
    }
  }
  return Array.from(new Set(out));
}

async function findByFingerprint(ProblemStatement, textOrFp) {
  const fp = fingerprintStatement(textOrFp);
  if (!fp) return null;
  let doc = await ProblemStatement.findOne({ fingerprint: fp }).lean();
  if (doc) return doc;
  // Legacy rows without fingerprint field
  const candidates = await ProblemStatement.find({}, { title: 1, description: 1, fingerprint: 1 })
    .lean()
    .limit(500);
  for (const r of candidates || []) {
    const existing = r.fingerprint || fingerprintFromParts(r.title, r.description);
    if (existing && (existing === fp || statementsOverlap(existing, fp))) return r;
  }
  return null;
}

module.exports = {
  fingerprintStatement,
  fingerprintFromParts,
  fingerprintHash,
  statementsOverlap,
  isFingerprintTaken,
  parseCompanyFromSource,
  extractProvenance,
  matchInspiration,
  matchBestAnalog,
  loadAllFingerprintsFromDb,
  findByFingerprint,
};
