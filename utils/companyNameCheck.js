/** Shared duplicate / lookalike checks for dream companies */

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function similarity(a, b) {
  const s1 = normalize(a);
  const s2 = normalize(b);
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;
  if (s1.includes(s2) || s2.includes(s1)) return 0.88;
  const bigrams = (s) => {
    const g = new Set();
    for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2));
    return g;
  };
  const A = bigrams(s1);
  const B = bigrams(s2);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((x) => {
    if (B.has(x)) inter += 1;
  });
  return (2 * inter) / (A.size + B.size);
}

const SCAM_PATTERNS = [
  /work from home.*earn/i,
  /guaranteed (job|package|placement)/i,
  /pay.*(registration|training).*fee/i,
  /whatsapp.*(hiring|interview)/i,
  /no interview.*offer/i,
  /\b(earn|salary)\s*\d+\s*lakh.*week/i,
  /crypto\s*airdrop\s*job/i,
];

const KNOWN_ALIASES = {
  google: "Google",
  googlle: "Google",
  gooogle: "Google",
  alphabet: "Google",
  amazon: "Amazon",
  amazom: "Amazon",
  amzon: "Amazon",
  aws: "Amazon",
  meta: "Meta",
  facebook: "Meta",
  fb: "Meta",
  apple: "Apple",
  aapl: "Apple",
  netflix: "Netflix",
  microsoft: "Microsoft",
  msft: "Microsoft",
  microsof: "Microsoft",
  infosys: "Infosys",
  infy: "Infosys",
  tcs: "TCS",
  "tata consultancy": "TCS",
  wipro: "Wipro",
  accenture: "Accenture",
  cognizant: "Cognizant",
  cts: "Cognizant",
  hcl: "HCLTech",
  hcltech: "HCLTech",
  ibm: "IBM",
  deloitte: "Deloitte",
  mckinsey: "McKinsey",
  bcg: "BCG",
};

/**
 * @param {string} rawName
 * @param {string[]} knownNames - built-in + community
 */
function checkCompanyName(rawName, knownNames = []) {
  const name = String(rawName || "").trim().replace(/\s+/g, " ");
  const norm = normalize(name);
  const warnings = [];
  let suggestedOriginal = null;
  let severity = "ok"; // ok | warn | block

  if (!name || name.length < 2) {
    return { ok: false, severity: "block", warnings: ["Enter a company name."], suggestedOriginal: null, normalizedName: norm };
  }
  if (name.length > 80) {
    return { ok: false, severity: "block", warnings: ["Name is too long."], suggestedOriginal: null, normalizedName: norm };
  }

  for (const re of SCAM_PATTERNS) {
    if (re.test(name)) {
      severity = "block";
      warnings.push("This looks like a hiring scam / spam phrase — use a real company name.");
      break;
    }
  }

  const aliasHit = KNOWN_ALIASES[norm] || KNOWN_ALIASES[norm.replace(/\s+/g, "")];
  if (aliasHit) {
    const exactKnown = knownNames.find((k) => normalize(k) === normalize(aliasHit));
    if (exactKnown && normalize(exactKnown) !== norm) {
      suggestedOriginal = exactKnown;
      severity = severity === "block" ? "block" : "warn";
      warnings.push(`This looks like "${exactKnown}". Use the official name from the list instead of adding a duplicate.`);
    }
  }

  let best = null;
  let bestScore = 0;
  for (const k of knownNames) {
    const score = similarity(name, k);
    if (score > bestScore) {
      bestScore = score;
      best = k;
    }
  }

  if (best && bestScore >= 0.92) {
    suggestedOriginal = best;
    severity = "block";
    warnings.push(`"${best}" is already in the list — pick it instead of adding a duplicate.`);
  } else if (best && bestScore >= 0.72) {
    suggestedOriginal = best;
    if (severity !== "block") severity = "warn";
    warnings.push(`Did you mean "${best}"? Names this close are often typos or fake lookalikes.`);
  }

  return {
    ok: severity !== "block",
    severity,
    warnings,
    suggestedOriginal,
    normalizedName: norm,
    name,
  };
}

module.exports = { normalize, similarity, checkCompanyName };
