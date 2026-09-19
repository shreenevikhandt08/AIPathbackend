/**
 * Validate / rewrite / generate problem statements against:
 * - Y Combinator OR Unicorn (either framework is enough)
 * - SNS revised thrust areas (must map: ≥1 tech OR ≥1 industry)
 * - Contains AI: Yes/No (informational)
 *
 * Pass rule: (fitsYC OR fitsUnicorn) AND fits77 (tech OR industry)
 */
const { callLLM } = require("./llm");
const {
  INNOVATION_TECHNOLOGIES,
  INDUSTRY_VERTICALS,
  YC_CHECKS,
  UNICORN_CHECKS,
  canonicalizeTechName,
  canonicalizeVerticalName,
  canonicalizeTechList,
  canonicalizeVerticalList,
} = require("../data/snsThrustAreas");

function clip(text, n = 6000) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function keywordWeight(key) {
  const n = String(key || "").length;
  if (n <= 2) return 0.35;
  if (n <= 3) return 0.7;
  if (n <= 5) return 1.4;
  if (n <= 8) return 2.4;
  return 3.6;
}

const WEAK_SOLO = new Set([
  "ads", "lead", "leads", "shop", "plant", "building", "content", "game", "bank",
  "agent", "policy", "pipeline", "monitoring", "deployment", "architecture",
  "hardware", "firmware", "sql", "bi", "sql", "ar", "vr", "ev", "oem",
]);

const TECH_DOMAIN_CUES = {
  cgc: ["sales crm", "lead scoring", "marketing automation", "hubspot", "salesforce"],
  hrtech: ["human resources", "recruitment", "payroll", "onboarding", "hrms"],
  systemdesign: ["system design", "load balancer", "microservices", "cap theorem", "data structures"],
  mern: ["react", "mongodb", "express", "next.js", "node.js", "mern"],
  ai: ["machine learning", "computer vision", "generative ai", "large language", "chatbot", "neural network"],
  datascience: ["data science", "data engineering", "data warehouse", "data lake", "etl pipeline"],
  cloud: ["kubernetes", "docker", "terraform", "aws", "devops"],
  testing: ["cybersecurity", "penetration", "owasp", "selenium", "quality assurance"],
  core_eng: ["embedded", "pcb", "esp32", "solidworks", "microcontroller", "hvac", "vlsi"],
};

const VERT_DOMAIN_CUES = {
  smart_mfg: ["factory", "manufacturing", "automotive", "shop floor", "industry 4.0", "aircraft"],
  healthcare: ["hospital", "patient", "clinic", "diagnosis", "pharmacy", "telemedicine"],
  retail: ["retail", "kirana", "fmcg", "supply chain", "last mile", "inventory"],
  finserv: ["upi", "fintech", "banking", "lending", "kyc", "nbfc"],
  media: ["streaming", "ott", "esports", "ott platform"],
  realestate: ["real estate", "proptech", "tenant", "apartment"],
  energy: ["solar", "renewable", "power plant", "smart meter", "ev charging"],
  agri: ["farmer", "farmers", "farming", "crop", "dairy", "irrigation", "agritech", "mandi", "cold storage"],
  govtech: ["e-governance", "municipality", "aadhaar", "grievance", "panchayat", "smart city"],
};

function applyCueBoost(lower, item, group) {
  const map = group === "tech" ? TECH_DOMAIN_CUES : VERT_DOMAIN_CUES;
  const cues = map[item.id] || [];
  let extra = 0;
  const hits = [];
  for (const c of cues) {
    if (c && lower.includes(String(c).toLowerCase())) {
      extra += 4.8;
      hits.push(c);
    }
  }
  const name = String(item.name || "").toLowerCase();
  if (name.length >= 8 && lower.includes(name)) extra += 10;
  return { extra, hits };
}

function scoreKeywordHits(text, items, group = "tech") {
  const lower = String(text || "").toLowerCase();
  return items.map((item) => {
    const hits = [];
    let score = 0;
    for (const k of item.keywords || []) {
      const key = String(k).toLowerCase().trim();
      if (!key) continue;
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      let ok = false;
      try {
        const plural = key.length <= 2 ? "" : "(?:s|es)?";
        ok = new RegExp(`(?:^|[^a-z0-9])${escaped}${plural}(?:$|[^a-z0-9])`, "i").test(lower);
      } catch {
        ok = lower.includes(key);
      }
      if (!ok) continue;
      hits.push(k);
      score += keywordWeight(key);
    }
    const cue = applyCueBoost(lower, item, group);
    score += cue.extra;
    hits.push(...cue.hits);
    const strongHits = hits.filter((h) => !WEAK_SOLO.has(String(h).toLowerCase()));
    const matched = score >= 3.2 && (strongHits.length > 0 || cue.extra >= 4.8 || score >= 8);
    return {
      id: item.id,
      name: item.name,
      matched,
      hits,
      score: Math.round(score * 10) / 10,
    };
  });
}

function choosePrimary(scored, llmName, canonicalizeFn) {
  const ranked = [...(scored || [])].sort((a, b) => b.score - a.score);
  const top = ranked[0];
  const llm = canonicalizeFn ? canonicalizeFn(llmName) : String(llmName || "").trim();
  const llmRow = scored.find((s) => s.name === llm);
  if (top && top.score >= 3.2) {
    if (llmRow && llmRow.score >= top.score - 1.5 && llmRow.score >= 2.8) return llmRow.name;
    return top.name;
  }
  if (llmRow && llmRow.score >= 2.8) return llmRow.name;
  if (top && top.matched) return top.name;
  return null;
}

function detectContainsAI(text) {
  const t = String(text || "");
  const patterns = [
    /\bai\b/i,
    /\bartificial intelligence\b/i,
    /\bmachine learning\b|\bml\b/i,
    /\bdeep learning\b/i,
    /\bllm\b|\blarge language model\b/i,
    /\bgenai\b|\bgenerative ai\b/i,
    /\bnlp\b|\bnatural language\b/i,
    /\bcomputer vision\b/i,
    /\bchatbot\b|\bai agent\b|\bai\-powered\b/i,
  ];
  const hits = patterns.filter((re) => re.test(t)).map((re) => re.source);
  return {
    containsAI: hits.length > 0,
    aiSignals: hits.length,
    note: hits.length
      ? "Problem mentions AI / ML / GenAI / related tech"
      : "No clear AI / ML wording — can still map to other thrust tech",
  };
}

function heuristicFrameworkScore(text, checks) {
  const signals = {
    clear_user: /(student|farmer|patient|driver|sme|clinic|user|customer|citizen|operator|worker|teacher|retailer|shop|hospital|doctor|nurse)/i.test(text),
    pain: /(pain|problem|fail|delay|manual|error|waste|cost|lost|struggle|inefficien|bottleneck|gap)/i.test(text),
    why_now: /(ai|iot|cloud|mobile|covid|genai|llm|sensor|now|recent|increasing|cheap|accessible)/i.test(text),
    solution_shape: /(app|platform|dashboard|system|tool|agent|workflow|portal|device|saas)/i.test(text),
    measurable: /(reduce|increase|%|minute|hour|cost|accuracy|detect|alert|save|improve)/i.test(text),
    large_market: /(india|global|million|industry|enterprises|cities|hospitals|factories|nationwide)/i.test(text),
    repeatable: /(subscription|daily|recurring|marketplace|saas|repeat|usage|frequency)/i.test(text),
    defensible: /(data|network|workflow|model|proprietary|feedback loop|moat)/i.test(text),
    tech_leverage: /(ai|ml|iot|automation|software|algorithm|digital twin|genai)/i.test(text),
    ambitious: /(scale|platform|ecosystem|nationwide|multi|enterprise|unicorn)/i.test(text),
  };
  return checks.map((c) => ({
    id: c.id,
    label: c.label,
    hint: c.hint,
    pass: Boolean(signals[c.id]),
    note: signals[c.id] ? "Signal found in text" : `Missing: ${c.hint}`,
  }));
}

function pickBestMatches(scored, limit = 2) {
  return scored
    .filter((x) => x.matched || x.score >= 3.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.name);
}

function guessActor(text) {
  const m = String(text || "").match(
    /\b(farmers?|patients?|students?|drivers?|shopkeepers?|kirana owners?|citizens?|nurses?|doctors?|teachers?|workers?|operators?)\b/i
  );
  return m ? m[1] : "the named user";
}

function isGenericOutcomeLine(s) {
  return /paper-prototype the first screen|next working module \(UI, API|Connect the week’s modules|Write the problem, users, and data/i.test(
    String(s || "")
  );
}

function parseWeeksFromStatement(text) {
  const raw = String(text || "");
  const blocks = [];
  const re = /week\s*(\d+)\s*[:.\-–)]\s*([\s\S]*?)(?=week\s*\d+\s*[:.\-–)]|$)/gi;
  let m;
  while ((m = re.exec(raw))) {
    const week = Number(m[1]);
    const body = String(m[2] || "").trim();
    const technical = (
      body.match(/technical\s*[—:\-]\s*(.+)/i) ||
      body.match(/build(?:ing)?\s*[—:\-]\s*(.+)/i) ||
      [null, body.split(/\n/)[0]]
    )[1];
    const outcome = (
      body.match(/outcome\s*[—:\-]\s*(.+)/i) ||
      body.match(/done when\s*[—:\-]\s*(.+)/i) ||
      [null, ""]
    )[1];
    blocks.push({
      week,
      technical: String(technical || "").replace(/\s+/g, " ").trim(),
      outcome: String(outcome || "").replace(/\s+/g, " ").trim(),
    });
  }
  return blocks;
}

function problemSpecificOutcomes(text, weeks, tech, vertical) {
  const who = guessActor(text);
  const stack = tech ? ` using ${tech}` : "";
  const domain = vertical ? ` (${vertical})` : "";
  const out = [];
  for (let w = 1; w <= weeks; w++) {
    if (w === 1) {
      out.push({
        week: 1,
        technical: `Map ${who}'s pain and data; ship one working first slice${stack}.`,
        outcome: `${who} (or faculty) can point to the user, the pain, and one clickable first slice.`,
      });
    } else if (w === weeks) {
      out.push({
        week: w,
        technical: `Connect the slices into one demo path for ${who}${domain}; list what is still missing.`,
        outcome: `${who} completes the core flow live; remaining gaps are written down.`,
      });
    } else {
      out.push({
        week: w,
        technical: `Add the next module ${who} needs (screen, API, or data)${stack}.`,
        outcome: `${who} can use that module without extra explanation.`,
      });
    }
  }
  return out;
}

function finalizeWeeklyOutcomes(problemText, llmRows, totalWeeks, totalDays, tech, vertical) {
  const weeks = Math.max(1, Number(totalWeeks) || 1);
  const days = Math.max(1, Number(totalDays) || weeks * 5);
  const extracted = parseWeeksFromStatement(problemText);
  const inferred = problemSpecificOutcomes(problemText, weeks, tech, vertical);
  const byWeek = new Map();
  const take = (row) => {
    const w = Number(row?.week);
    if (!w) return;
    const prev = byWeek.get(w) || { week: w, technical: "", outcome: "" };
    const technical = !isGenericOutcomeLine(row.technical) && String(row.technical || "").trim()
      ? String(row.technical).trim()
      : prev.technical;
    const outcome = !isGenericOutcomeLine(row.outcome) && String(row.outcome || "").trim()
      ? String(row.outcome).trim()
      : prev.outcome;
    byWeek.set(w, { week: w, technical, outcome });
  };
  inferred.forEach(take);
  extracted.forEach(take);
  (Array.isArray(llmRows) ? llmRows : []).forEach(take);
  return normalizeWeeklyOutcomes([...byWeek.values()], weeks, days, inferred[0]?.technical || "", inferred);
}

function attachPassFlags(report) {
  const fitsYC = report.fitsYC ?? report.ycPassCount >= 3;
  const fitsUnicorn = report.fitsUnicorn ?? report.unicornPassCount >= 3;
  // Thrust: ANY one thrust match is enough (tech OR industry)
  const fits77 = report.fits77 ?? Boolean(report.has77Tech || report.has77Industry);
  const fitsYcOrUnicorn = Boolean(fitsYC || fitsUnicorn);
  const verified = Boolean(fitsYcOrUnicorn && fits77);
  return {
    ...report,
    fitsYC,
    fitsUnicorn,
    fits77,
    fitsYcOrUnicorn,
    verified,
    passRule: "(YC OR Unicorn) AND (any SNS thrust tech OR industry)",
  };
}

function buildValidationReport(problemText) {
  const text = clip(problemText, 8000);
  const tech = scoreKeywordHits(text, INNOVATION_TECHNOLOGIES, "tech");
  const verticals = scoreKeywordHits(text, INDUSTRY_VERTICALS, "vertical");
  const yc = heuristicFrameworkScore(text, YC_CHECKS);
  const unicorn = heuristicFrameworkScore(text, UNICORN_CHECKS);
  const aiCheck = detectContainsAI(text);

  const techMatched = tech.filter((t) => t.matched);
  const vertMatched = verticals.filter((v) => v.matched);
  const ycPass = yc.filter((x) => x.pass).length;
  const uniPass = unicorn.filter((x) => x.pass).length;
  const matchedTech = pickBestMatches(tech, 2);
  const matchedVerticals = pickBestMatches(verticals, 2);

  const strengths = [];
  const gaps = [];

  if (matchedTech.length) strengths.push(`Thrust tech: ${matchedTech.join("; ")}`);
  if (matchedVerticals.length) strengths.push(`Thrust industry: ${matchedVerticals.join("; ")}`);
  if (!matchedTech.length && !matchedVerticals.length) {
    gaps.push("Map to any SNS thrust area — at least one Technology OR one Industry");
  }

  if (ycPass >= 3) strengths.push(`YC-style: ${ycPass}/${yc.length}`);
  if (uniPass >= 3) strengths.push(`Unicorn-scale: ${uniPass}/${unicorn.length}`);
  if (ycPass < 3 && uniPass < 3) {
    gaps.push(`Need YC OR Unicorn (YC ${ycPass}/${yc.length}, Unicorn ${uniPass}/${unicorn.length})`);
  }

  strengths.push(aiCheck.containsAI ? "Contains AI: Yes" : "Contains AI: No");

  const thrustScore = matchedTech.length || matchedVerticals.length ? 50 : 0;
  const frameworkScore = Math.max(
    (ycPass / Math.max(1, yc.length)) * 50,
    (uniPass / Math.max(1, unicorn.length)) * 50
  );
  const score = Math.round(thrustScore + frameworkScore);

  const fits77 = matchedTech.length > 0 || matchedVerticals.length > 0;
  const fitsYC = ycPass >= 3;
  const fitsUnicorn = uniPass >= 3;

  return attachPassFlags({
    score,
    verdict: (fitsYC || fitsUnicorn) && fits77
      ? `Verified — ${fitsYC ? "YC" : "Unicorn"}${fitsYC && fitsUnicorn ? "+Unicorn" : ""} + thrust${aiCheck.containsAI ? " · AI" : ""}`
      : "Partial — need (YC or Unicorn) and any thrust map",
    strengths,
    gaps,
    yc,
    unicorn,
    innovationTechnologies: tech,
    industryVerticals: verticals,
    matchedTech,
    matchedVerticals,
    suggestedTech: matchedTech,
    suggestedVerticals: matchedVerticals,
    primaryTech: matchedTech[0] || null,
    primaryVertical: matchedVerticals[0] || null,
    ycPassCount: ycPass,
    unicornPassCount: uniPass,
    ycTotal: yc.length,
    unicornTotal: unicorn.length,
    has77Tech: matchedTech.length > 0,
    has77Industry: matchedVerticals.length > 0,
    fitsYC,
    fitsUnicorn,
    fits77,
    containsAI: aiCheck.containsAI,
    aiCheck,
  });
}

async function enrichValidationWithLLM(problemText, base, { numDays = 5 } = {}) {
  try {
    const totalDays = Math.max(1, Number(numDays) || 5);
    const totalWeeks = workingWeeksFromDays(totalDays);
    const prompt = `
You validate a student PROBLEM STATEMENT for SNS.

PASS RULE (mandatory):
- Must map to SNS thrust areas: at least ONE Innovation Technology OR ONE Industry Vertical (exact names). Either is enough.
- Must fit Y Combinator style OR Unicorn ambition (either is enough — NOT both required).
- Also report whether the problem contains AI (yes/no).

TECHNOLOGIES (pick names ONLY from this list): ${INNOVATION_TECHNOLOGIES.map((t) => t.name).join(" | ")}
INDUSTRIES (pick names ONLY from this list): ${INDUSTRY_VERTICALS.map((v) => v.name).join(" | ")}

HOW TO MAP (critical — do not keyword-scatter):
- Industry = who the user is / where the pain happens (farmer→Agri / Food, hospital→Healthcare, factory→Smart Manufacturing, kirana/shop/logistics→Retail/FMCG/SCL, bank/UPI→Financial Services, city/gov→GovTech).
- Technology = the main method to solve it (vision/predict/LLM→AI, dashboards/ETL→Data Science, website/MERN→Coding & MERN, sensors/PCB→Mechanical/Electronics/Civil, cloud/k8s→Cloud & DevOps).
- Do NOT pick CGC just because of "lead", "pipeline", "ads", or "campaign" unless the product IS sales/marketing software.
- Do NOT pick Realestate just because of "building". Do NOT pick Media just because of "content".
- Do NOT pick Coding & MERN only because they said "app" or "website". Pick MERN only if the core is web software (React/Node/Mongo) rather than AI/vision/IoT.
- Do NOT pick Healthcare because of "health" of crops/machines. Hospital/patient/clinic → Healthcare. Farmer/crop/dairy → Agri / Food.
- If two names fit, pick the more specific domain of THIS problem, not a generic web/app stack.
- weeklyOutcomes MUST name THIS problem's user, data, and product — never generic "paper prototype" or "next module" unless you also name what the module is.

PROBLEM:
"""
${clip(problemText, 3500)}
"""

Heuristic (may be wrong — correct it):
${JSON.stringify({
  score: base.score,
  matchedTech: base.matchedTech,
  matchedVerticals: base.matchedVerticals,
  ycPassCount: base.ycPassCount,
  unicornPassCount: base.unicornPassCount,
  gaps: base.gaps,
})}

Also infer expected outcomes for a ${totalDays}-working-day / ${totalWeeks}-week student build (5 days = 1 week). If the statement already lists weeks, use those. Each week needs BOTH:
- technical: what they build (one sentence)
- outcome: who can do what; done when (one sentence)

Return ONLY JSON:
{
  "score": 0-100,
  "verdict": "short",
  "strengths": ["..."],
  "gaps": ["..."],
  "suggestedTech": ["exact names from TECHNOLOGIES — best 1-2"],
  "suggestedVerticals": ["exact names from INDUSTRIES — best 1-2"],
  "primaryTech": "exact TECHNOLOGY name or null",
  "primaryVertical": "exact INDUSTRY name or null",
  "techReason": "why this tech fits THIS problem",
  "verticalReason": "why this industry fits THIS problem",
  "ycNotes": ["..."],
  "unicornNotes": ["..."],
  "improveBullets": ["3 concrete fixes"],
  "fitsYC": true/false,
  "fitsUnicorn": true/false,
  "fits77": true/false,
  "containsAI": true/false,
  "weeklyOutcomes": [
    { "week": 1, "days": "Days 1–5", "technical": "...", "outcome": "..." }
  ]
}
`.trim();
    const parsed = await callLLM(prompt, 2800);
    if (!parsed || typeof parsed !== "object") return attachPassFlags({ ...base, mode: "heuristic" });

    const catalogTech = new Set(INNOVATION_TECHNOLOGIES.map((t) => t.name));
    const catalogVert = new Set(INDUSTRY_VERTICALS.map((v) => v.name));
    const suggestedTech = canonicalizeTechList(
      Array.isArray(parsed.suggestedTech) ? parsed.suggestedTech : base.matchedTech
    );
    const suggestedVerticals = canonicalizeVerticalList(
      Array.isArray(parsed.suggestedVerticals) ? parsed.suggestedVerticals : base.matchedVerticals
    );
    const primaryTech = choosePrimary(
      base.innovationTechnologies || [],
      parsed.primaryTech,
      canonicalizeTechName
    ) || suggestedTech[0] || canonicalizeTechName(base.primaryTech) || null;
    const primaryVertical = choosePrimary(
      base.industryVerticals || [],
      parsed.primaryVertical,
      canonicalizeVerticalName
    ) || suggestedVerticals[0] || canonicalizeVerticalName(base.primaryVertical) || null;

    const fitsYC = typeof parsed.fitsYC === "boolean" ? parsed.fitsYC : base.ycPassCount >= 3;
    const fitsUnicorn = typeof parsed.fitsUnicorn === "boolean" ? parsed.fitsUnicorn : base.unicornPassCount >= 3;
    const has77Tech = Boolean(primaryTech || suggestedTech.length);
    const has77Industry = Boolean(primaryVertical || suggestedVerticals.length);
    const fits77 = Boolean(has77Tech || has77Industry);
    const containsAI =
      typeof parsed.containsAI === "boolean" ? parsed.containsAI : Boolean(base.containsAI);

    const weeklyOutcomes = finalizeWeeklyOutcomes(
      problemText,
      parsed.weeklyOutcomes,
      totalWeeks,
      totalDays,
      primaryTech,
      primaryVertical
    );

    return attachPassFlags({
      ...base,
      score: Number(parsed.score) || base.score,
      verdict: String(parsed.verdict || base.verdict),
      strengths: Array.isArray(parsed.strengths) && parsed.strengths.length ? parsed.strengths : base.strengths,
      gaps: Array.isArray(parsed.gaps) && parsed.gaps.length ? parsed.gaps : base.gaps,
      suggestedTech: suggestedTech.length ? suggestedTech : base.matchedTech,
      suggestedVerticals: suggestedVerticals.length ? suggestedVerticals : base.matchedVerticals,
      matchedTech: primaryTech ? [primaryTech, ...suggestedTech.filter((t) => t !== primaryTech)].slice(0, 2) : (suggestedTech.length ? suggestedTech : base.matchedTech),
      matchedVerticals: primaryVertical ? [primaryVertical, ...suggestedVerticals.filter((v) => v !== primaryVertical)].slice(0, 2) : (suggestedVerticals.length ? suggestedVerticals : base.matchedVerticals),
      primaryTech,
      primaryVertical,
      techReason: String(parsed.techReason || "").trim(),
      verticalReason: String(parsed.verticalReason || "").trim(),
      improveBullets: Array.isArray(parsed.improveBullets) ? parsed.improveBullets.slice(0, 5) : [],
      ycNotes: Array.isArray(parsed.ycNotes) ? parsed.ycNotes : [],
      unicornNotes: Array.isArray(parsed.unicornNotes) ? parsed.unicornNotes : [],
      fitsYC,
      fitsUnicorn,
      fits77,
      has77Tech,
      has77Industry,
      containsAI,
      weeklyOutcomes,
      totalWeeks,
      totalDays,
      mode: "heuristic+llm",
    });
  } catch (e) {
    return attachPassFlags({
      ...base,
      mode: "heuristic",
      llmError: e.message,
      fitsYC: base.ycPassCount >= 3,
      fitsUnicorn: base.unicornPassCount >= 3,
      fits77: Boolean(base.has77Tech || base.has77Industry),
      weeklyOutcomes: base.weeklyOutcomes || finalizeWeeklyOutcomes(
        problemText, [], workingWeeksFromDays(numDays), Math.max(1, Number(numDays) || 5),
        base.primaryTech, base.primaryVertical
      ),
    });
  }
}

async function validateProblemStatement(problemText, { useLLM = true, numDays = 5 } = {}) {
  const totalDays = Math.max(1, Number(numDays) || 5);
  const totalWeeks = workingWeeksFromDays(totalDays);
  const built = buildValidationReport(problemText);
  const base = attachPassFlags({
    ...built,
    weeklyOutcomes: finalizeWeeklyOutcomes(
      problemText,
      [],
      totalWeeks,
      totalDays,
      built.primaryTech,
      built.primaryVertical
    ),
    totalWeeks,
    totalDays,
    techReason: built.primaryTech
      ? `Best fit from the statement: ${built.primaryTech}`
      : "No clear technology named — map to one SNS tech.",
    verticalReason: built.primaryVertical
      ? `Best fit from the statement: ${built.primaryVertical}`
      : "No clear industry named — map to one SNS industry.",
    mode: "heuristic",
  });
  if (!String(problemText || "").trim()) {
    return attachPassFlags({
      ...base,
      score: 0,
      verdict: "Empty problem statement",
      gaps: ["Paste or upload a problem statement first"],
      fitsYC: false,
      fitsUnicorn: false,
      fits77: false,
      weeklyOutcomes: [],
    });
  }
  if (!useLLM) return base;
  return enrichValidationWithLLM(problemText, base, { numDays: totalDays });
}

async function loadYcUnicornRag() {
  try {
    const { getYCUnicornProblems } = require("./ycSearch");
    const result = await getYCUnicornProblems(false);
    return {
      problems: Array.isArray(result?.data) ? result.data : [],
      isLive: !!result?.isLive,
      generatedDate: result?.generatedDate || null,
    };
  } catch (e) {
    return { problems: [], isLive: false, generatedDate: null, error: e.message };
  }
}

/**
 * Rewrite existing statement OR generate a new one (mode=generate).
 * Pulls YC / Unicorn inspiration as RAG context for the LLM.
 */
function workingWeeksFromDays(numDays) {
  const d = Math.max(1, Number(numDays) || 5);
  return Math.max(1, Math.ceil(d / 5));
}

async function rewriteProblemStatement(problemText, framework = "all", opts = {}) {
  const techPick = opts.tech || "";
  const verticalPick = opts.vertical || "";
  const mode = opts.mode === "generate" || !String(problemText || "").trim() ? "generate" : "rewrite";
  const seed = String(opts.seed || "").trim();
  const totalDays = Math.max(1, Number(opts.numDays || opts.totalDays || opts.days) || 5);
  const totalWeeks = workingWeeksFromDays(totalDays);

  const fw =
    framework === "yc"
      ? "Y Combinator startup problem style + map to SNS thrust areas"
      : framework === "unicorn"
        ? "Unicorn-scale ambitious but buildable problem + map to SNS thrust areas"
        : framework === "77"
          ? "SNS revised thrust areas (innovation tech + industry vertical)"
          : "YC OR Unicorn (either) + mandatory SNS thrust mapping";

  const rag = await loadYcUnicornRag();
  const ragBlock = (rag.problems || [])
    .slice(0, 8)
    .map((p, i) => `${i + 1}. ${p.title}${p.source ? ` [inspired by: ${p.source}]` : ""}`)
    .join("\n");

  const prompt = `
You are writing problem statements for SNS college innovators.

TARGET FRAMEWORK: ${fw}
MODE: ${mode === "generate" ? "GENERATE a brand-new problem statement" : "REWRITE / strengthen the given statement"}

SNS Innovation Technologies (pick EXACTLY one name from this list):
${INNOVATION_TECHNOLOGIES.map((t) => `- ${t.name}`).join("\n")}

SNS Industry Verticals (pick EXACTLY one name from this list):
${INDUSTRY_VERTICALS.map((v) => `- ${v.name}`).join("\n")}

Preferred tech (if any): ${techPick || "choose the best fit"}
Preferred industry (if any): ${verticalPick || "choose the best fit"}

PLAN WINDOW: ${totalDays} working days = ${totalWeeks} week(s) (5 college days per week). Expected outcomes must cover EVERY week, not only week 1.

YC / Unicorn RAG inspiration (use as inspiration only — do NOT copy titles verbatim; adapt to Indian college / industrial context):
${ragBlock || "(no live inspiration — invent a strong industrial problem)"}

${seed ? `User seed / idea:\n"""\n${clip(seed, 1200)}\n"""\n` : ""}

${mode === "rewrite" ? `Original statement to improve:\n"""\n${clip(problemText, 3500)}\n"""\n` : "No original statement — invent a strong, concrete problem."}

Rules:
- Fit Y Combinator shape OR Unicorn ambition (either is enough — do not require both).
- MUST map to SNS thrust areas: Explicitly name 1 tech + 1 industry from the lists (exact spelling).
- Keep it concrete for a ${totalDays}-working-day / ${totalWeeks}-week student build (5 college days = 1 week).
- 8–16 lines max for statement.
- weeklyOutcomes MUST have exactly ${totalWeeks} items (Week 1 through Week ${totalWeeks}).
- Each week has TWO fields, both specific to THIS problem (no generic “build a slice”):
  - technical: what they build (modules, data, APIs, screens, stack). One sentence, max 22 words.
  - outcome: who can do what, and how they know it is done. One sentence, max 22 words.
- Week 1 = research + first working piece. Last week = demoable product + what is still missing.

Return ONLY JSON:
{
  "title": "short title",
  "statement": "full problem statement",
  "tech": "exact tech name from list",
  "vertical": "exact industry name from list",
  "ycHooks": ["user", "pain", "why now", "product", "metric"],
  "unicornHooks": ["market", "repeatable", "leverage", "first slice"],
  "firstSlice": "what students build in week 1 (short)",
  "weeklyOutcomes": [
    {
      "week": 1,
      "days": "Days 1–5",
      "technical": "Build X using named stack/files",
      "outcome": "Named user can do Y; done when Z is visible"
    }
  ],
  "ragUsed": ["short note which inspiration themes were adapted"]
}
`.trim();

  const parsed = await callLLM(prompt, 4096);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Rewrite failed — empty LLM response");
  }
  const weeklyOutcomes = normalizeWeeklyOutcomes(parsed.weeklyOutcomes, totalWeeks, totalDays, parsed.firstSlice);
  return {
    title: String(parsed.title || (mode === "generate" ? "Generated problem" : "Rewritten problem")).trim(),
    statement: String(parsed.statement || "").trim(),
    tech: canonicalizeTechName(parsed.tech || techPick || "") || String(parsed.tech || techPick || "").trim(),
    vertical:
      canonicalizeVerticalName(parsed.vertical || verticalPick || "") ||
      String(parsed.vertical || verticalPick || "").trim(),
    ycHooks: Array.isArray(parsed.ycHooks) ? parsed.ycHooks.map(String) : [],
    unicornHooks: Array.isArray(parsed.unicornHooks) ? parsed.unicornHooks.map(String) : [],
    firstSlice: String(parsed.firstSlice || weeklyOutcomes[0]?.technical || weeklyOutcomes[0]?.outcome || "").trim(),
    weeklyOutcomes,
    totalDays,
    totalWeeks,
    ragUsed: Array.isArray(parsed.ragUsed) ? parsed.ragUsed.map(String) : [],
    framework,
    mode,
    ragMeta: {
      isLive: rag.isLive,
      count: (rag.problems || []).length,
      generatedDate: rag.generatedDate,
    },
  };
}

function clipWeeklyOutcome(text, maxWords = 22) {
  let t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const first = t.match(/^(.+?[.!?])(\s|$)/);
  if (first) t = first[1].replace(/[.!?]+$/, "").trim();
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > maxWords) t = words.slice(0, maxWords).join(" ");
  if (t.length > 160) t = t.slice(0, 160).replace(/\s+\S*$/, "").trim();
  if (!t) return "";
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

function weekOutcomeFallback(w, weeks, firstSlice) {
  if (w === 1) {
    return {
      technical: clipWeeklyOutcome(firstSlice) ||
        "Write the problem, users, and data; paper-prototype the first screen or flow.",
      outcome: "Faculty can point to a named user, pain, and one sketched first slice.",
    };
  }
  if (w === weeks) {
    return {
      technical: "Connect the week’s modules into one demo path; log gaps in PRD/SAD.",
      outcome: "A user (or faculty) completes the core flow live; missing pieces are listed.",
    };
  }
  return {
    technical: `Add the next working module (UI, API, or data) that last week’s slice needs.`,
    outcome: `Someone besides the builder can use that module without extra explanation.`,
  };
}

function normalizeWeeklyOutcomes(raw, totalWeeks, totalDays, firstSlice, fallbackRows) {
  const weeks = Math.max(1, Number(totalWeeks) || 1);
  const days = Math.max(1, Number(totalDays) || weeks * 5);
  const byWeek = new Map();
  if (Array.isArray(raw)) {
    raw.forEach((row) => {
      const w = Math.max(1, Number(row?.week) || 0);
      if (!w) return;
      const technical = String(row.technical || row.tech || row.build || "").trim();
      const outcome = String(row.outcome || row.text || row.result || "").trim();
      byWeek.set(w, { technical, outcome });
    });
  }
  const out = [];
  for (let w = 1; w <= weeks; w++) {
    const from = (w - 1) * 5 + 1;
    const to = Math.min(days, w * 5);
    const hit = byWeek.get(w) || {};
    const specific = Array.isArray(fallbackRows) ? fallbackRows.find((r) => Number(r.week) === w) : null;
    const fb = specific || weekOutcomeFallback(w, weeks, firstSlice);
    const technical = clipWeeklyOutcome(hit.technical) || fb.technical;
    const outcome = clipWeeklyOutcome(hit.outcome) || (w === 1 && !hit.technical ? clipWeeklyOutcome(firstSlice) : "") || fb.outcome;
    out.push({
      week: w,
      days: `Days ${from}–${to}`,
      technical,
      outcome,
    });
  }
  return out;
}

module.exports = {
  validateProblemStatement,
  rewriteProblemStatement,
  buildValidationReport,
  loadYcUnicornRag,
  INNOVATION_TECHNOLOGIES,
  INDUSTRY_VERTICALS,
};
