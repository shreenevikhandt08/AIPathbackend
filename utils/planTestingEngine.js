/**
 * Pre-output Testing Engine
 * Re-evaluates generated schedule content BEFORE it reaches the student.
 *
 * What it does:
 *  1) Live-checks external URLs (dead links removed or replaced with curated practice links)
 *  2) Fixes bare LeetCode /problemset links → exact /problems/<slug>/ for the named problem
 *  3) NEVER swaps a LeetCode homework/practice URL to GFG/FCC/MDN/other platforms
 *  4) Same-day: avoid repeating the same non-LC practice URL
 *  5) Soft quality scores: coverage, objectives, persona, career, schedule alignment, etc.
 *  6) Completes incomplete wording fragments where safe
 *
 * Checks reported:
 *  Content Coverage · Objective Alignment · Link Validation · Document Validation
 *  Learning Validation · Difficulty Validation · Persona Validation
 *  Language Validation · Career Alignment · Schedule Alignment
 *  LeetCode Exact Problem · Day LeetCode↔Homework Link · Same-day Link Uniqueness
 *  Topic Link Relevance · Complete Content
 */
const { urlLooksAlive } = require("./enrichLearningResourcesRag");
const {
  isBlockedUrl,
  isAllowedHost,
  isPublicYoutube,
  pickDistinctPracticeLink,
} = require("../data/curatedLearningLinks");
const {
  isExactLeetCodeProblemUrl,
  isBareLeetCodeUrl,
  isLeetCodeHostUrl,
  repairLeetCodeUrlsInContent,
  extractLeetCodeProblemName,
  buildLeetCodeProblemUrl,
  extractLeetCodeNumber,
} = require("./leetcodeUrl");

const URL_RE = /https?:\/\/[^\s\)\]\>\"\'\,]+/gi;
const CONCURRENCY = 8;

function clip(s, n = 80) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function extractUrls(text) {
  const raw = String(text || "").match(URL_RE) || [];
  return [...new Set(raw.map((u) => u.replace(/[.,;:!?)]+$/g, "").trim()).filter(Boolean))];
}

function normalizeUrl(url) {
  return String(url || "")
    .trim()
    .replace(/[.,;:!?)]+$/g, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function extractTopicHint(content = "") {
  const lines = String(content || "").split(/\n+/);
  for (const line of lines) {
    const m =
      line.match(/▶\s*Heading:\s*(.+)/i) ||
      line.match(/Learn(?:ing)?(?:\s+topic)?[:\s]+(.+)/i) ||
      line.match(/What to Learn[:\s]+(.+)/i) ||
      line.match(/▶\s*(?:Topic|Concept)[:\s]+(.+)/i) ||
      line.match(/Class today:\s*(.+)/i) ||
      line.match(/Pattern[:\s]+(.+)/i) ||
      line.match(/today'?s topic[:\s]+(.+)/i) ||
      line.match(/Problem:\s*#?\d*\s*[—–-]?\s*(.+)/i) ||
      line.match(/Connects to:\s*Learning\s*[“"]([^”"]+)[”"]/i);
    if (m?.[1]) {
      const cleaned = clip(
        m[1]
          .replace(/https?:\/\/\S+/g, "")
          .replace(/^Deepen\s*[—–-]\s*/i, "")
          .trim(),
        60
      );
      if (cleaned && !/^(dsa|system design|learning|today)$/i.test(cleaned)) return cleaned;
      if (cleaned) return cleaned;
    }
  }
  for (const line of lines) {
    const clean = line.replace(/^▶\s*/, "").replace(/https?:\/\/\S+/g, "").trim();
    if (clean.length >= 12 && !/^helpful links/i.test(clean)) return clip(clean, 60);
  }
  return "today's topic";
}

function shapeOk(url) {
  const u = String(url || "").trim();
  if (!u || !/^https?:\/\//i.test(u) || isBlockedUrl(u)) return false;
  if (/youtu(\.be|be\.com)/i.test(u)) return isPublicYoutube(u) || /youtube\.com\/@|\/playlists|\/results\?/i.test(u);
  return isAllowedHost(u);
}

function linkKindFromUrl(url, line = "") {
  if (/youtu(\.be|be\.com)/i.test(url) || /YouTube|Video/i.test(line)) return "youtube";
  return "web";
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  const n = Math.min(limit, Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

/**
 * Find a different working practice URL not already used this day.
 * Live-checks candidates when possible.
 */
async function nextWorkingPracticeLink({
  topic,
  kind,
  dayIdx,
  daySeen,
  salt,
  urlVerdict,
}) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const cand = pickDistinctPracticeLink(topic, {
      kind,
      dayIdx,
      seenUrls: daySeen,
      salt: salt + attempt,
    });
    if (!cand?.url) continue;
    const key = normalizeUrl(cand.url);
    if (daySeen.has(key)) continue;

    let ok = urlVerdict.get(cand.url)?.ok;
    if (ok == null) {
      if (!shapeOk(cand.url)) {
        urlVerdict.set(cand.url, { ok: false, reason: "blocked_or_shape" });
        daySeen.add(key); // don't retry this bad candidate forever
        continue;
      }
      ok = await urlLooksAlive(cand.url);
      urlVerdict.set(cand.url, { ok, reason: ok ? "alive" : "dead" });
    }
    if (!ok) {
      daySeen.add(key);
      continue;
    }
    return cand;
  }
  // Last resort: any shaped curated link even if recheck failed
  return pickDistinctPracticeLink(topic, { kind, dayIdx, seenUrls: daySeen, salt });
}

/**
 * Rewrite a content cell:
 *  - drop / replace dead URLs with verified practice links
 *  - if URL already used earlier the same day, swap for a different working link
 *  - NEVER replace LeetCode problem URLs with other platforms (GFG/FCC/MDN/etc.)
 */
async function rewriteContentUrls(content, urlVerdict, topic, daySeen, dayIdx = 0) {
  const lines = String(content || "").split("\n");
  const next = [];
  let replaced = 0;
  let removed = 0;
  let kept = 0;
  let deduped = 0;
  let salt = 0;

  // Resolve the exact LC URL for this cell once (from Problem # / name)
  const cellLcExact = buildLeetCodeProblemUrl({
    lc: extractLeetCodeNumber(content),
    name: extractLeetCodeProblemName(content),
  });

  for (const line of lines) {
    const urls = extractUrls(line);
    if (!urls.length) {
      next.push(line);
      continue;
    }

    let rewritten = line;
    let lineDead = false;

    for (const u of urls) {
      const key = normalizeUrl(u);
      const isLc = isLeetCodeHostUrl(u);

      // LeetCode: keep / repair to exact problem only — never swap to another site
      if (isLc) {
        if (isExactLeetCodeProblemUrl(u) && !isBareLeetCodeUrl(u)) {
          // Prefer cell's named problem if slug mismatches
          if (cellLcExact && normalizeUrl(cellLcExact) !== key) {
            rewritten = rewritten.split(u).join(cellLcExact);
            daySeen.add(normalizeUrl(cellLcExact));
            replaced += 1;
            urlVerdict.set(cellLcExact, { ok: true, reason: "leetcode_slug_fix" });
          } else {
            kept += 1;
            daySeen.add(key);
            urlVerdict.set(u, { ok: true, reason: "leetcode_exact" });
          }
          continue;
        }
        // Bare problemset /problems/ — pin to this cell's problem
        const exact = cellLcExact || buildLeetCodeProblemUrl({ name: extractLeetCodeProblemName(line) });
        if (exact) {
          rewritten = rewritten.split(u).join(exact);
          daySeen.add(normalizeUrl(exact));
          replaced += 1;
          urlVerdict.set(exact, { ok: true, reason: "leetcode_repaired" });
        } else {
          kept += 1;
          daySeen.add(key);
        }
        continue;
      }

      const v = urlVerdict.get(u) || { ok: shapeOk(u), reason: "shape" };
      const alreadyToday = daySeen.has(key);
      const kind = linkKindFromUrl(u, line);

      const needsSwap = !v.ok || alreadyToday;
      if (!needsSwap) {
        kept += 1;
        daySeen.add(key);
        continue;
      }

      const isLinkLine =
        /·\s*(Website|YouTube|Article|Video|Link)\s*:/i.test(line) ||
        /helpful links/i.test(line) ||
        /exercism|freecodecamp|mdn|geeksforgeeks|hackerrank/i.test(u) ||
        /https?:\/\//i.test(line);

      // On a LeetCode homework row, a wrong non-LC Link must become the LC problem
      if (/^Link:\s*/i.test(line) && cellLcExact) {
        rewritten = rewritten.split(u).join(cellLcExact);
        daySeen.add(normalizeUrl(cellLcExact));
        replaced += 1;
        urlVerdict.set(cellLcExact, { ok: true, reason: "leetcode_wrong_host_fixed" });
        continue;
      }

      if (isLinkLine) {
        const rep = await nextWorkingPracticeLink({
          topic,
          kind,
          dayIdx,
          daySeen,
          salt: salt++,
          urlVerdict,
        });
        if (rep?.url && normalizeUrl(rep.url) !== key && !isLeetCodeHostUrl(u)) {
          // Never inject a non-LC replacement into a LeetCode-labeled line
          if (/leetcode/i.test(line) && !isLeetCodeHostUrl(rep.url)) {
            if (cellLcExact) {
              rewritten = rewritten.split(u).join(cellLcExact);
              daySeen.add(normalizeUrl(cellLcExact));
              replaced += 1;
            } else {
              kept += 1;
              daySeen.add(key);
            }
            continue;
          }
          rewritten = rewritten.split(u).join(rep.url);
          rewritten = rewritten.replace(
            /(Website|YouTube|Article|Video|Link)\s*:\s*[^—\-]+(?:—|-)/i,
            `$1: ${rep.title} —`
          );
          if (alreadyToday && v.ok) deduped += 1;
          else replaced += 1;
          daySeen.add(normalizeUrl(rep.url));
          urlVerdict.set(rep.url, { ok: true, reason: alreadyToday ? "day_dedupe" : "curated_replacement" });
        } else {
          lineDead = true;
          removed += 1;
        }
      } else {
        rewritten = rewritten.split(u).join("").replace(/\s{2,}/g, " ").trim();
        removed += 1;
        if (!rewritten || /^▶\s*$/.test(rewritten)) lineDead = true;
      }
    }

    if (lineDead && /·\s*(Website|YouTube|Article|Video|Link)\s*:/i.test(line)) {
      const kind = /youtube|video/i.test(line) ? "youtube" : "web";
      const rep = await nextWorkingPracticeLink({
        topic,
        kind,
        dayIdx,
        daySeen,
        salt: salt++,
        urlVerdict,
      });
      if (rep?.url) {
        next.push(`   · ${rep.kind}: ${rep.title} — ${rep.url}`);
        daySeen.add(normalizeUrl(rep.url));
        replaced += 1;
      }
      continue;
    }
    if (lineDead && !extractUrls(rewritten).length && /^▶\s*$/.test(rewritten.trim())) {
      continue;
    }
    next.push(rewritten);
  }

  return {
    content: next.join("\n"),
    stats: { replaced, removed, kept, deduped },
  };
}

function scoreContentCoverage(rows) {
  const learning = rows.filter((r) => /learn/i.test(String(r[2] || "")));
  if (!learning.length) return { pass: false, score: 0, note: "No Learning rows" };
  let withSubstance = 0;
  for (const r of learning) {
    const c = String(r[3] || "");
    if (c.length >= 80 && /▶/.test(c)) withSubstance += 1;
  }
  const ratio = withSubstance / learning.length;
  return {
    pass: ratio >= 0.7,
    score: Math.round(ratio * 100),
    note:
      ratio >= 0.7
        ? "Learning content matches schedule topics"
        : "Some Learning rows lack substantive content",
  };
}

function scoreObjectiveAlignment(rows, inputs = {}) {
  const objective = [
    inputs.assessment,
    inputs.domain,
    inputs.interest,
    inputs._dtInstruction ? "design thinking" : "",
  ]
    .map((x) => String(x || "").toLowerCase())
    .join(" ");
  if (!objective.trim()) {
    return { pass: true, score: 80, note: "No explicit objective — skipped soft check" };
  }
  const keywords = objective
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4)
    .slice(0, 12);
  if (!keywords.length) return { pass: true, score: 75, note: "Objective too short to score" };

  const blob = rows.map((r) => String(r[3] || "").toLowerCase()).join("\n");
  const hits = keywords.filter((k) => blob.includes(k)).length;
  const ratio = hits / keywords.length;
  return {
    pass: ratio >= 0.25 || hits >= 2,
    score: Math.round(Math.min(100, ratio * 100 + hits * 5)),
    note:
      hits >= 2
        ? "Content supports stated objective"
        : "Weak objective keyword overlap — review goals",
  };
}

function scoreDocumentValidation(rows, inputs = {}) {
  const blob = rows.map((r) => String(r[3] || "")).join("\n");
  const mentionsUpload = /uploaded|your pdf|ebook|from your upload|ctrl\+f/i.test(blob);
  const hasUpload = [
    inputs.instructions,
    inputs.dsaSyllabus,
    inputs.systemDesign,
    inputs.syllabus,
    inputs.questions,
  ].some((t) => String(t || "").length > 40);

  if (!mentionsUpload) {
    return { pass: true, score: 90, note: "No document refs — OK" };
  }
  if (hasUpload) {
    return { pass: true, score: 95, note: "Document refs tied to uploaded files" };
  }
  return {
    pass: false,
    score: 40,
    note: "Document referenced but no upload present — hints will be removed",
    stripUploadHints: true,
  };
}

function stripUploadHints(content) {
  return String(content || "")
    .split("\n")
    .filter((line) => !/from your upload|uploaded notes|uploaded syllabus|uploaded .*pdf|ebook\/page/i.test(line))
    .join("\n");
}

function scoreLearningValidation(rows) {
  const hasAssess = rows.some((r) =>
    /assess|check(?:\s+your)?\s+understanding|quiz|reflect|self[- ]?test|exit ticket/i.test(
      `${r[2]} ${r[3]}`
    )
  );
  const hasPractice = rows.some((r) =>
    /practice|apply|project build|build hook|try this|leetcode|exercism/i.test(`${r[2]} ${r[3]}`)
  );
  const pass = hasAssess || hasPractice;
  return {
    pass,
    score: pass ? (hasAssess && hasPractice ? 95 : 78) : 45,
    note: pass
      ? "Assessment / practice present to check understanding"
      : "Missing check-for-understanding activity",
  };
}

function scoreDifficulty(rows, inputs = {}) {
  const skill = Number(inputs.skillLevel || inputs._skillLevel || 3);
  const blob = rows.map((r) => String(r[3] || "").toLowerCase()).join("\n");
  const advanced = (blob.match(/\b(advanced|expert|optimiz|distributed|concurrency)\b/g) || [])
    .length;
  const beginner = (blob.match(/\b(intro|basics?|beginner|first[- ]year|start here)\b/g) || [])
    .length;

  if (skill <= 2 && advanced > beginner * 2 + 3) {
    return { pass: false, score: 45, note: "Content may be too hard for skill level" };
  }
  if (skill >= 4 && beginner > advanced * 2 + 5) {
    return { pass: false, score: 55, note: "Content may be too easy for skill level" };
  }
  return { pass: true, score: 85, note: "Difficulty broadly matches capability" };
}

function scorePersona(rows, inputs = {}) {
  const persona = [inputs.interest, inputs.dislikes, inputs.capability, inputs.domain]
    .map((x) => String(x || "").toLowerCase())
    .join(" ");
  const likes = String(inputs.interest || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4)
    .slice(0, 8);

  if (!persona.trim()) {
    return { pass: true, score: 75, note: "No persona profile — skipped" };
  }

  const blob = rows.map((r) => String(r[3] || "").toLowerCase()).join("\n");
  const likeHits = likes.filter((k) => blob.includes(k)).length;
  const hasGrowth = /growth (ladder|challenge)|tiny exposure|micro-version|overcome dislike/i.test(
    blob
  );
  const hasOutcomes = /attitude|logical|& business|technical skills|curiosity|accountability/i.test(
    blob
  );

  if (/don'?t like videos|avoidVideos/i.test(String(inputs.dislikes || "")) || /video/i.test(String(inputs.dislikes || ""))) {
    const heavyVideoPush = (blob.match(/·\s*youtube:/gi) || []).length > (rows.length / 2);
    if (heavyVideoPush && !hasGrowth) {
      return { pass: false, score: 40, note: "Too many videos vs video dislike — expect article-first + micro challenge" };
    }
  }

  return {
    pass: true,
    score: Math.min(100, 55 + likeHits * 6 + (hasGrowth ? 15 : 0) + (hasOutcomes ? 15 : 0)),
    note: hasGrowth
      ? "Persona respected + gentle growth challenge present"
      : likeHits
        ? "Resources align with interests"
        : "Persona soft-match OK",
  };
}

function scoreLanguage(rows, inputs = {}) {
  let pref = String(inputs.language || inputs.preferredLanguage || inputs.studyMedium || "en").toLowerCase();
  try {
    const { detectStudyMedium } = require("./personaDevelopment");
    const m = detectStudyMedium(inputs);
    if (m.preferNative) pref = m.code;
  } catch (_) {}

  const blob = rows.map((r) => String(r[3] || "")).join("\n");
  if (/^(ta|tamil)/.test(pref)) {
    const hasTa =
      /ta\.wikipedia\.org|தமிழ்|tamil medium|pause & explain in tamil|write.*in tamil/i.test(blob);
    return {
      pass: hasTa || /medium · persona-checked/i.test(blob),
      score: hasTa ? 95 : 70,
      note: hasTa
        ? "Tamil-medium references / pause-and-translate guidance present"
        : "Tamil medium set — prefer native article lines",
    };
  }
  if (/^(hi|hindi)/.test(pref)) {
    const hasHi = /hi\.wikipedia\.org|हिन्दी|hindi medium|explain in hindi/i.test(blob);
    return {
      pass: hasHi || /medium · persona-checked/i.test(blob),
      score: hasHi ? 95 : 70,
      note: hasHi ? "Hindi-medium references present" : "Hindi medium soft-check",
    };
  }
  const nonLatin = (blob.match(/[\u0900-\u097F\u0B80-\u0BFF\u4E00-\u9FFF]/g) || []).length;
  if (/^en|english|auto/.test(pref) && nonLatin > 80) {
    return { pass: false, score: 50, note: "Mixed language vs English preference" };
  }
  return { pass: true, score: 90, note: "Language preference respected" };
}

function scoreCareer(rows, inputs = {}) {
  const career = [inputs.targetRole, inputs.targetCompany, inputs.domain, inputs.assessment, inputs.goals]
    .map((x) => String(x || "").toLowerCase())
    .join(" ");
  const blob = rows.map((r) => `${r[2]} ${r[3]}`.toLowerCase()).join("\n");
  const hasCareerBlock =
    /career objective|goal \/ outcome|target role|apply rule: every homework/i.test(blob);
  if (!career.trim()) {
    return {
      pass: true,
      score: hasCareerBlock ? 85 : 70,
      note: hasCareerBlock
        ? "Homework includes career objective / outcome block"
        : "No career target set — skipped",
    };
  }
  const keys = career
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3)
    .slice(0, 10);
  const hits = keys.filter((k) => blob.includes(k)).length;
  const pass = hasCareerBlock || hits >= 1 || /career|interview|portfolio|role|company/i.test(blob);
  return {
    pass,
    score: pass ? Math.min(100, 55 + (hasCareerBlock ? 20 : 0) + hits * 8) : 45,
    note: hasCareerBlock
      ? "Homework driven by career objective + outcome"
      : pass
        ? "Activities show career relevance"
        : "Weak career alignment",
  };
}

function scoreScheduleAlignment(rows) {
  const byDay = new Map();
  for (const r of rows) {
    const day = String(r[0] || "");
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(r);
  }
  let goodDays = 0;
  let total = 0;
  for (const dayRows of byDay.values()) {
    total += 1;
    const acts = dayRows.map((r) => String(r[2] || "").toLowerCase());
    const hasLearn = acts.some((a) => /learn/.test(a));
    const hasApply = acts.some((a) => /project|apply|build|practice|homework/.test(a));
    if (hasLearn && hasApply) goodDays += 1;
    else if (hasLearn) goodDays += 0.6;
  }
  const ratio = total ? goodDays / total : 0;
  return {
    pass: ratio >= 0.55,
    score: Math.round(ratio * 100),
    note:
      ratio >= 0.55
        ? "Activities map to scheduled learn → apply flow"
        : "Some days lack learn/apply pairing",
  };
}

function scoreSameDayLinkUniqueness(rows) {
  const byDay = new Map();
  for (const r of rows) {
    if (!Array.isArray(r)) continue;
    const day = String(r[0] || "");
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(...extractUrls(r[3]).map(normalizeUrl));
  }
  let daysWithDup = 0;
  let daysChecked = 0;
  for (const urls of byDay.values()) {
    if (!urls.length) continue;
    daysChecked += 1;
    const set = new Set(urls);
    if (set.size < urls.length) daysWithDup += 1;
  }
  const pass = daysWithDup === 0;
  return {
    pass,
    score: pass ? 100 : Math.max(40, 100 - daysWithDup * 15),
    note: pass
      ? "No repeated practice links within the same day"
      : `${daysWithDup} day(s) still had duplicate links`,
    daysWithDup,
  };
}

/**
 * Every LeetCode mention with a problem name must use /problems/<slug>/ (not bare problemset).
 */
function scoreLeetCodeExactProblem(rows) {
  let lcCells = 0;
  let exact = 0;
  let bare = 0;
  let namedNoUrl = 0;
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 4) continue;
    const content = String(r[3] || "");
    if (!/leetcode/i.test(content) && !/leetcode\.com/i.test(content)) continue;
    lcCells += 1;
    const urls = extractUrls(content).filter((u) => /leetcode\.com/i.test(u));
    const name = extractLeetCodeProblemName(content);
    if (!urls.length) {
      if (name) namedNoUrl += 1;
      continue;
    }
    const hasExact = urls.some((u) => isExactLeetCodeProblemUrl(u));
    const hasBare = urls.some((u) => isBareLeetCodeUrl(u));
    if (hasExact) exact += 1;
    else if (hasBare) bare += 1;
  }
  const pass = bare === 0 && namedNoUrl === 0;
  const score =
    lcCells === 0
      ? 80
      : Math.round((100 * exact) / Math.max(1, exact + bare + namedNoUrl));
  return {
    pass: lcCells === 0 ? true : pass,
    score: lcCells === 0 ? 80 : Math.max(35, score),
    note:
      lcCells === 0
        ? "No LeetCode cells in plan"
        : pass
          ? `All ${exact} LeetCode link(s) point to exact /problems/<slug>/ URLs`
          : `${bare} bare LeetCode URL(s) and ${namedNoUrl} named problem(s) without exact link (repaired when possible)`,
    exact,
    bare,
    namedNoUrl,
    lcCells,
  };
}

/**
 * Homework LeetCode should reference same-day Learning / Coding Practice.
 */
function scoreDayLeetCodeHomeworkLink(rows) {
  const byDay = new Map();
  for (const r of rows) {
    if (!Array.isArray(r)) continue;
    const day = String(r[0] || "");
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(r);
  }
  let days = 0;
  let linked = 0;
  for (const dayRows of byDay.values()) {
    const hw = dayRows.find(
      (r) =>
        /homework/i.test(String(r[2] || "")) &&
        /leetcode/i.test(String(r[3] || ""))
    );
    if (!hw) continue;
    days += 1;
    const text = String(hw[3] || "");
    const hasConn =
      /How it connects to today's learning|How it connects to project implementation|Connects to:|Schedule connection|Class today|Day Coding Practice|linked to today's schedule/i.test(
        text
      ) &&
      (/1\)\s*Learning:|Learning: you studied|SAME part|same pattern|drills that|project implementation|Project hook/i.test(
        text
      ) ||
        /Class today:/i.test(text));
    if (hasConn) linked += 1;
  }
  if (days === 0) {
    return {
      pass: true,
      score: 75,
      note: "No LeetCode homework rows to check against daily schedule",
    };
  }
  const ratio = linked / days;
  return {
    pass: ratio >= 0.7,
    score: Math.round(ratio * 100),
    note:
      ratio >= 0.7
        ? `LeetCode homework explains how it connects to same-day Learning/Coding (${linked}/${days} days)`
        : `Only ${linked}/${days} LeetCode homework days show How it connects (1–2–3)`,
    linked,
    days,
  };
}

const BLANK_VALUE_RE =
  /^(?:\s*|[-–—_…]{1,}|n\/?a|na|null|undefined|tbd|todo|none|blank|empty|\?+|…+)$/i;

/**
 * Fill incomplete / blank fragments so students never see empty placeholders.
 */
function repairIncompleteContent(content = "", topicHint = "today's topic") {
  const topic = String(topicHint || "today's topic").replace(/\s+/g, " ").trim().slice(0, 60);
  let fixed = 0;
  const lines = String(content || "").split("\n");
  const out = [];

  for (let raw of lines) {
    let line = String(raw || "");
    if (!line.trim()) {
      continue;
    }

    // Mid-word / truncated quotes: "... pe…" or hanging ellipsis after a short stump
    if (/[A-Za-z]{1,4}(?:…|\.\.\.)(?:\s|[”"']|$)/.test(line) || /"[^"]{8,}[A-Za-z]{1,3}(?:…|\.\.\.)"/.test(line)) {
      line = line
        .replace(/"[^"]*[A-Za-z]{1,4}(?:…|\.\.\.)"/g, `"your project problem"`)
        .replace(/\b[A-Za-z]{1,4}(?:…|\.\.\.)(?=\s|[”"']|$)/g, topic);
      fixed += 1;
    }
    // Any remaining decorative ellipsis after an incomplete token — drop ellipsis, keep words
    if (/(?:…|\.\.\.)\s*$/.test(line) && !/\b(etc|and so on)\b/i.test(line)) {
      line = line.replace(/(?:…|\.\.\.)\s*$/, "").trim();
      if (/\b(the|a|an|to|for|with|and|or|of|in|on|at|by|pe|th|wh)\s*$/i.test(line)) {
        line = `${line.replace(/\s+\S+$/, "").trim()} — finish this step for “${topic}”.`;
      } else {
        line = `${line}.`;
      }
      fixed += 1;
    }

    // Replace vague CORE% time-box jargon with actionable wording
    if (/CORE\s*~\s*\d+%|enrichment\s*~\s*\d+%/i.test(line)) {
      line = `▶ Task 1 — Main work: Finish the checklist for “${topic}” until Done when is true (~first part of the slot).`;
      fixed += 1;
    }
    if (/Finish CORE quickly|spend remaining time on Challenge \+ like\/dislike/i.test(line)) {
      line = `▶ How to work: Finish the main checklist in about the first half of the slot, then do Extra A → B → C in order (written in Learning). Help one peer 5 min if asked.`;
      fixed += 1;
    }

    // "▶ Heading:" / "Link:" / "Why:" with empty value
    const labeled = line.match(/^(\s*(?:▶\s*)?[^:\n]{1,40}:\s*)(.*)$/);
    if (labeled) {
      const prefix = labeled[1];
      let value = String(labeled[2] || "").trim();
      value = value.replace(/[—–-]\s*$/, "").trim();
      if (BLANK_VALUE_RE.test(value) || value === "") {
        const key = prefix.replace(/^▶\s*/, "").replace(/:\s*$/, "").trim().toLowerCase();
        if (/heading|topic|learn|class today|pattern|problem|tonight|connects to|how it connects|why|do|apply|done when/i.test(key)) {
          value =
            /heading|topic|learn|class/i.test(key)
              ? topic
              : /pattern/i.test(key)
                ? `practice pattern for ${topic}`
                : /why/i.test(key)
                  ? `You need this step to move “${topic}” forward today.`
                  : /done when/i.test(key)
                    ? `Finished when notes show Why + Concept + Apply for “${topic}”.`
                    : /apply|do/i.test(key)
                      ? `Write 1–2 concrete lines linking this task to “${topic}”.`
                      : /connects|how it connects/i.test(key)
                        ? `Learning “${topic}” → Coding Practice — this drills that same part.`
                        : `Complete this step for “${topic}”.`;
          line = `${prefix.replace(/\s*$/, "")} ${value}`;
          fixed += 1;
        }
      } else if (/\b(tbd|todo|n\/a|null|undefined|___+)\b/i.test(value)) {
        line = `${prefix}${value
          .replace(/\b(tbd|todo|n\/a|null|undefined)\b/gi, topic)
          .replace(/_{3,}/g, topic)}`;
        fixed += 1;
      }
    }

    if (/^\s*(?:▶\s*)?(?:TBD|TODO|N\/A|___+|…)\s*$/i.test(line)) {
      line = `▶ Continue with “${topic}” — finish this step fully before moving on.`;
      fixed += 1;
    }

    if (/\b(the|a|an|to|for|with|and|or|of|in|on|at|by)\s*$/i.test(line.trim())) {
      line = `${line.trim()} “${topic}”.`;
      fixed += 1;
    }

    out.push(line);
  }

  if (!out.length) {
    out.push(`▶ Focus today: ${topic}.`);
    out.push(`▶ Done when: you can explain “${topic}” in one clear sentence.`);
    fixed += 1;
  }

  return { content: out.join("\n"), fixed };
}

function scoreCompleteContent(rows) {
  let cells = 0;
  let incomplete = 0;
  const samples = [];
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 4) continue;
    const content = String(r[3] || "");
    cells += 1;
    const issues = [];
    if (!content.trim()) issues.push("empty cell");
    for (const line of content.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      const labeled = t.match(/^((?:▶\s*)?[^:]{1,40}:\s*)(.*)$/);
      if (labeled && BLANK_VALUE_RE.test(String(labeled[2] || "").trim())) {
        issues.push(`blank after “${labeled[1].replace(/^▶\s*/, "").trim()}”`);
      }
      if (/\b(tbd|todo|___+|null|undefined)\b/i.test(t)) issues.push("placeholder");
      if (/\b(the|a|an|to|for|with|and|or|of)\s*$/i.test(t)) issues.push("truncated sentence");
      if (/[A-Za-z]{1,4}(?:…|\.\.\.)(?:\s|[”"']|$)/.test(t) || /"[^"]{6,}[A-Za-z]{1,3}(?:…|\.\.\.)"/.test(t)) {
        issues.push("cut word / ellipsis");
      }
      if (/CORE\s*~\s*\d+%|Finish CORE quickly/i.test(t)) issues.push("vague CORE jargon");
    }
    if (issues.length) {
      incomplete += 1;
      if (samples.length < 8) {
        samples.push({
          day: String(r[0] || ""),
          activity: String(r[2] || ""),
          issues: issues.slice(0, 3),
        });
      }
    }
  }
  const pass = incomplete === 0;
  const score = cells === 0 ? 70 : Math.round((100 * (cells - incomplete)) / cells);
  return {
    pass,
    score: Math.max(30, score),
    note: pass
      ? "All sentences and fields are complete — nothing left blank"
      : `${incomplete}/${cells} cell(s) had blanks or incomplete wording (repaired before show)`,
    incomplete,
    cells,
    samples,
  };
}

/**
 * Website/Video lines should match the day's Heading / topic (not a random DSA/SD hub).
 */
function scoreTopicLinkRelevance(rows) {
  let checked = 0;
  let aligned = 0;
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 4) continue;
    const act = String(r[2] || "");
    const content = String(r[3] || "");
    if (!/learn|system design|coding practice/i.test(act)) continue;
    if (!/Website|YouTube|Video|Helpful links/i.test(content)) continue;
    checked += 1;
    const topic = extractTopicHint(content);
    const topicTokens = String(topic || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4)
      .slice(0, 6);
    const linkBlob = content
      .split("\n")
      .filter((l) => /Website|YouTube|Video|article|search_query|\?s=/i.test(l))
      .join(" ")
      .toLowerCase();
    const hit =
      !topicTokens.length ||
      topicTokens.some((w) => linkBlob.includes(w)) ||
      /for\s+[“"]|search_query=|\?s=/i.test(linkBlob) ||
      /matched to today's topic|matched to/i.test(content);
    if (hit) aligned += 1;
  }
  if (checked === 0) {
    return { pass: true, score: 75, note: "No Learning/SD link rows to score" };
  }
  const ratio = aligned / checked;
  return {
    pass: ratio >= 0.7,
    score: Math.round(ratio * 100),
    note:
      ratio >= 0.7
        ? `Videos/links aligned to the day's topic (${aligned}/${checked})`
        : `Only ${aligned}/${checked} link rows clearly match the day's DSA/SD topic`,
    aligned,
    checked,
  };
}

/**
 * Run full testing engine on daily plan rows.
 * @returns {{ rows, report }}
 */
async function runPlanTestingEngine(rows = [], inputs = {}) {
  const started = Date.now();
  const list = Array.isArray(rows) ? rows.map((r) => (Array.isArray(r) ? [...r] : r)) : [];

  // ── Collect + live-check URLs ──────────────────────────────────────────────
  const allUrls = [];
  for (const r of list) {
    if (!Array.isArray(r) || r.length < 4) continue;
    for (const u of extractUrls(r[3])) allUrls.push(u);
  }
  const uniqueUrls = [...new Set(allUrls)];

  const urlVerdict = new Map();
  await mapPool(uniqueUrls, CONCURRENCY, async (url) => {
    // Exact LeetCode problem pages often block HEAD bots — always keep them
    if (isExactLeetCodeProblemUrl(url) && !isBareLeetCodeUrl(url)) {
      urlVerdict.set(url, { ok: true, reason: "leetcode_exact_trusted" });
      return;
    }
    if (!shapeOk(url)) {
      urlVerdict.set(url, { ok: false, reason: "blocked_or_shape" });
      return;
    }
    const alive = await urlLooksAlive(url);
    urlVerdict.set(url, { ok: alive, reason: alive ? "alive" : "dead" });
  });

  // ── Rewrite day-by-day (dedupe + repair) ───────────────────────────────────
  let linkReplaced = 0;
  let linkRemoved = 0;
  let linkKept = 0;
  let linkDeduped = 0;
  let leetcodeFixed = 0;
  let textFixed = 0;
  const docCheck = scoreDocumentValidation(list, inputs);

  const dayOrder = [];
  const dayBuckets = new Map();
  list.forEach((r, idx) => {
    if (!Array.isArray(r) || r.length < 4) return;
    const day = String(r[0] || `row-${idx}`);
    if (!dayBuckets.has(day)) {
      dayBuckets.set(day, []);
      dayOrder.push(day);
    }
    dayBuckets.get(day).push(idx);
  });

  // Prefer Learning heading as the day's topic for link replacements on that day
  const dayTopicHint = new Map();
  for (const day of dayOrder) {
    for (const idx of dayBuckets.get(day) || []) {
      const r = list[idx];
      if (/^learning$/i.test(String(r[2] || "")) || /learn/i.test(String(r[2] || ""))) {
        const h = extractTopicHint(r[3]);
        if (h && h !== "today's topic") {
          dayTopicHint.set(day, h);
          break;
        }
      }
    }
  }

  for (let d = 0; d < dayOrder.length; d++) {
    const day = dayOrder[d];
    const daySeen = new Set();
    for (const idx of dayBuckets.get(day) || []) {
      const r = list[idx];
      const topic = dayTopicHint.get(day) || extractTopicHint(r[3]);
      let content = String(r[3] || "");
      if (docCheck.stripUploadHints) content = stripUploadHints(content);

      // Fix bare LeetCode → exact /problems/<slug>/ before general link rewrite
      const lcRepair = repairLeetCodeUrlsInContent(content);
      content = lcRepair.content;
      leetcodeFixed += lcRepair.fixed || 0;

      const { content: next, stats } = await rewriteContentUrls(
        content,
        urlVerdict,
        topic,
        daySeen,
        d
      );
      // Re-apply LC repair in case rewrite swapped in a problemset fallback
      const lcAfter = repairLeetCodeUrlsInContent(next);
      leetcodeFixed += lcAfter.fixed || 0;

      // Complete every sentence / fill blanks before student sees the plan
      const textRepair = repairIncompleteContent(lcAfter.content, topic);
      textFixed += textRepair.fixed || 0;

      linkReplaced += stats.replaced;
      linkRemoved += stats.removed;
      linkKept += stats.kept;
      linkDeduped += stats.deduped || 0;
      r[3] = textRepair.content;
    }
  }

  const checks = {
    contentCoverage: scoreContentCoverage(list),
    objectiveAlignment: scoreObjectiveAlignment(list, inputs),
    linkValidation: {
      pass: linkKept + linkReplaced + linkDeduped > 0 || uniqueUrls.length === 0,
      score:
        uniqueUrls.length === 0
          ? 70
          : Math.round(
              (100 * (linkKept + linkReplaced + linkDeduped)) /
                Math.max(1, linkKept + linkReplaced + linkDeduped + linkRemoved)
            ),
      note:
        uniqueUrls.length === 0
          ? "No external links in plan"
          : `Checked ${uniqueUrls.length} URL(s): ${linkKept} kept, ${linkReplaced} replaced, ${linkDeduped} de-duplicated same-day, ${linkRemoved} removed` +
            (leetcodeFixed ? `; ${leetcodeFixed} LeetCode URL(s) pointed to exact problems` : "") +
            (textFixed ? `; ${textFixed} incomplete text fragment(s) completed` : ""),
      checked: uniqueUrls.length,
      kept: linkKept,
      replaced: linkReplaced,
      deduped: linkDeduped,
      removed: linkRemoved,
      leetcodeFixed,
      textFixed,
      dead: [...urlVerdict.entries()].filter(([, v]) => !v.ok).map(([u]) => u).slice(0, 20),
    },
    leetcodeExactProblem: scoreLeetCodeExactProblem(list),
    dayLeetCodeHomeworkLink: scoreDayLeetCodeHomeworkLink(list),
    topicLinkRelevance: scoreTopicLinkRelevance(list),
    completeContent: scoreCompleteContent(list),
    sameDayLinkUniqueness: scoreSameDayLinkUniqueness(list),
    documentValidation: docCheck,
    learningValidation: scoreLearningValidation(list),
    difficultyValidation: scoreDifficulty(list, inputs),
    personaValidation: scorePersona(list, inputs),
    languageValidation: scoreLanguage(list, inputs),
    careerAlignment: scoreCareer(list, inputs),
    scheduleAlignment: scoreScheduleAlignment(list),
  };

  const scores = Object.values(checks).map((c) => Number(c.score) || 0);
  const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const failed = Object.entries(checks)
    .filter(([, c]) => c.pass === false)
    .map(([k]) => k);

  const report = {
    engine: "planTestingEngine",
    version: 5,
    passed: failed.length === 0,
    score: avg,
    failedChecks: failed,
    checks,
    links: {
      checked: uniqueUrls.length,
      kept: linkKept,
      replaced: linkReplaced,
      deduped: linkDeduped,
      removed: linkRemoved,
      leetcodeFixed,
      textFixed,
    },
    elapsedMs: Date.now() - started,
    summary:
      failed.length === 0
        ? `Testing engine passed (${avg}/100). On-topic links; complete wording; exact LeetCode; no same-day repeats.`
        : `Testing engine score ${avg}/100. Soft fails: ${failed.join(", ")}. Links/text/LeetCode repaired where possible.`,
  };

  console.log(
    `[planTestingEngine] score=${avg} links=${uniqueUrls.length} kept=${linkKept} replaced=${linkReplaced} deduped=${linkDeduped} lcFixed=${leetcodeFixed} textFixed=${textFixed} removed=${linkRemoved} ${report.elapsedMs}ms`
  );

  return { rows: list, report };
}

module.exports = {
  runPlanTestingEngine,
  extractUrls,
  shapeOk,
  scoreLeetCodeExactProblem,
  scoreDayLeetCodeHomeworkLink,
  scoreCompleteContent,
  scoreTopicLinkRelevance,
  repairIncompleteContent,
};
