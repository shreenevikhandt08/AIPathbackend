/**
 * Apply per-student subject include / like / dislike preferences
 * onto extracted college subjects and theme prompts.
 */

function prefKey(s) {
  return String(s?.code || s?.id || s?.name || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function parsePrefs(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

function collectPrefsFromInputs(inputs = {}) {
  const primary = parsePrefs(inputs._subjectPreferences || inputs.subjectPreferences);
  let team = [];
  try {
    const raw = inputs._teamSubjectPreferences ?? inputs._teamMembers;
    const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(arr)) {
      if (arr[0] && Array.isArray(arr[0])) {
        team = arr;
      } else {
        team = arr.map((m) => parsePrefs(m?.subjectPreferences));
      }
    }
  } catch {
    team = [];
  }
  // If primary empty, use first team member prefs
  const effectivePrimary = primary.length ? primary : team[0] || [];
  return { primary: effectivePrimary, team };
}

/**
 * Filter + annotate subjects using preference list.
 * Excluded (included:false) are dropped. Sentiment attached.
 */
function applyPreferencesToSubjects(subjects = [], prefs = []) {
  const list = Array.isArray(subjects) ? subjects : [];
  const prefList = parsePrefs(prefs);
  if (!prefList.length) return list;

  const byKey = new Map();
  for (const p of prefList) {
    byKey.set(prefKey(p), p);
    if (p.name) byKey.set(String(p.name).toLowerCase().trim(), p);
    if (p.code) byKey.set(String(p.code).toLowerCase().trim(), p);
  }

  const out = [];
  for (const s of list) {
    const name = String(s?.name || "");
    // Protect dedicated DSA/SD module tracks only (not college "Data Structures" course)
    const isModuleTrack =
      s?.isDsaTrack === true ||
      s?.isSdTrack === true ||
      /^dsa$/i.test(name) ||
      /^system design$/i.test(name) ||
      /^data structures and algorithms$/i.test(name);
    const p =
      byKey.get(prefKey(s)) ||
      byKey.get(name.toLowerCase().trim()) ||
      (s.code ? byKey.get(String(s.code).toLowerCase()) : null);

    if (isModuleTrack) {
      // Module tracks are never excluded, but we still keep concept hints.
      out.push({
        ...s,
        sentiment: p?.sentiment || "neutral",
        subjectCode: p?.code || s.code || "",
        mustLearnConcepts: Array.isArray(p?.mustLearnConcepts) ? p.mustLearnConcepts : [],
        omitConcepts: Array.isArray(p?.omitConcepts) ? p.omitConcepts : [],
      });
      continue;
    }

    if (p && p.included === false) continue;
    out.push({
      ...s,
      sentiment: p?.sentiment || "neutral",
      subjectCode: p?.code || s.code || "",
      mustLearnConcepts: Array.isArray(p?.mustLearnConcepts) ? p.mustLearnConcepts : [],
      omitConcepts: Array.isArray(p?.omitConcepts) ? p.omitConcepts : [],
    });
  }

  for (const p of prefList) {
    if (p.included === false) continue;
    const name = String(p?.name || "").trim();
    if (!name) continue;
    const already = out.some(
      (s) =>
        prefKey(s) === prefKey(p) ||
        String(s?.name || "").toLowerCase().trim() === name.toLowerCase()
    );
    if (already) continue;
    out.push({
      name,
      code: p.code || "",
      sentiment: p.sentiment || "neutral",
      subjectCode: p.code || "",
      mustLearnConcepts: Array.isArray(p.mustLearnConcepts) ? p.mustLearnConcepts : [],
      omitConcepts: Array.isArray(p.omitConcepts) ? p.omitConcepts : [],
      syllabusText: p.syllabusText || "",
    });
  }
  return out;
}

function buildPreferencePromptBlock(prefs = [], memberLabel = "") {
  const list = parsePrefs(prefs).filter((p) => p.included !== false);
  if (!list.length) return "";
  const liked = list.filter((p) => p.sentiment === "like").map((p) => p.name);
  const disliked = list.filter((p) => p.sentiment === "dislike").map((p) => p.name);
  const included = list.map((p) => p.name);
  const who = memberLabel ? ` (${memberLabel})` : "";
  const lines = [
    `SUBJECT PREFERENCES${who}:`,
    `Include only: ${included.join("; ") || "(none)"}`,
  ];
  if (liked.length) {
    lines.push(`Liked (emphasize inside multi-skill Learning, not as a separate silo): ${liked.join("; ")}`);
  }
  if (disliked.length) {
    lines.push(`Disliked (lighter coverage inside the same integrated Learning block): ${disliked.join("; ")}`);
  }

  const conceptLines = [];
  for (const p of list) {
    const name = p?.name || "";
    const needs = Array.isArray(p?.mustLearnConcepts) ? p.mustLearnConcepts : [];
    const omit = Array.isArray(p?.omitConcepts) ? p.omitConcepts : [];
    if (needs.length) {
      conceptLines.push(
        `Must learn concepts for ${name}: ${needs.slice(0, 8).join("; ")}${needs.length > 8 ? "…" : ""}`
      );
    }
    if (omit.length) {
      conceptLines.push(
        `Omit concepts in ${name}: ${omit.slice(0, 8).join("; ")}${omit.length > 8 ? "…" : ""}`
      );
    }
    const hasFile = String(p?.syllabusText || p?.fileName || "").trim().length > 40;
    if (hasFile) {
      conceptLines.push(
        `Uploaded syllabus for ${name}: use that file for Learning topics (must-learn / omit above).`
      );
    } else {
      conceptLines.push(
        `No uploaded syllabus for ${name}: use campus catalog / week theme topics; still honor must-learn and omit lists if filled.`
      );
    }
  }
  if (conceptLines.length) {
    lines.push(`Concept hints (apply per subject):`);
    lines.push(...conceptLines.slice(0, 18));
    lines.push(`In Learning, weave MUST concepts from included subjects into ONE multi-skill task (concept + logic + speak + math/quant + project apply). Do not schedule separate back-to-back single-subject lessons.`);
  }
  return lines.join("\n");
}

/**
 * Mutates inputs with preference prompt helpers; returns filtered subjects.
 */
function applySubjectPreferencesToPlan(subjects, inputs = {}) {
  const { primary, team } = collectPrefsFromInputs(inputs);
  let filtered = applyPreferencesToSubjects(subjects, primary);

  // If primary empty but team[0] has prefs (solo stored on member)
  if ((!primary || !primary.length) && team[0]?.length) {
    filtered = applyPreferencesToSubjects(subjects, team[0]);
  }

  const blocks = [];
  if (primary.length) blocks.push(buildPreferencePromptBlock(primary, "primary"));
  team.forEach((prefs, i) => {
    if (prefs?.length) blocks.push(buildPreferencePromptBlock(prefs, `member ${i + 1}`));
  });
  if (blocks.length) {
    inputs._subjectPreferencesBlock = blocks.join("\n\n");
  }

  // Sort: liked first, disliked last (among included)
  filtered = [...filtered].sort((a, b) => {
    const rank = (s) => (s.sentiment === "like" ? 0 : s.sentiment === "dislike" ? 2 : 1);
    return rank(a) - rank(b);
  });

  return filtered;
}

module.exports = {
  parsePrefs,
  collectPrefsFromInputs,
  applyPreferencesToSubjects,
  applySubjectPreferencesToPlan,
  buildPreferencePromptBlock,
  prefKey,
};
