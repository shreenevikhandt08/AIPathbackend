const crypto = require("crypto");

function norm(s, max = 400) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * Human-readable cohort id for campus scoping (no problem text).
 * Example: sns-college-of-technology|cse|2|3|subject_syllabus|30
 */
function buildCohortKey(key = {}) {
  return [
    key.campus || "",
    key.department || "",
    key.year || "",
    key.semester || "",
    key.mode || "",
    String(key.days || ""),
  ].join("|");
}

/**
 * Stable fingerprint for common-schedule lookup.
 * Same campus/dept/year/mode/days/problem → same hash.
 */
function buildScheduleFingerprint(inputs = {}) {
  const days = Number(inputs._numDays) || Number(inputs.numDays) || 30;
  const key = {
    campus: norm(inputs.college || inputs.campus || "", 120),
    department: norm(inputs.department || "", 80),
    year: String(
      inputs.collegeYear != null
        ? inputs.collegeYear
        : inputs.year != null
          ? inputs.year
          : inputs.schoolGrade != null
            ? inputs.schoolGrade
            : ""
    ),
    semester: String(inputs.semester != null ? inputs.semester : ""),
    mode: String(inputs._plannerMode || "subject_syllabus"),
    days: days,
    skipDsa: Boolean(inputs._skipDsa),
    skipSd: Boolean(inputs._skipSystemDesign),
    skipSubjects: Boolean(inputs._skipSubjects),
    problem: norm(inputs.problem || "", 500),
  };

  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify(key))
    .digest("hex")
    .slice(0, 28);

  // Soft key ignores exact problem text — cohort-level match
  const softPayload = {
    campus: key.campus,
    department: key.department,
    year: key.year,
    semester: key.semester,
    mode: key.mode,
    days: key.days,
    skipDsa: key.skipDsa,
    skipSd: key.skipSd,
    skipSubjects: key.skipSubjects,
  };
  const softHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(softPayload))
    .digest("hex")
    .slice(0, 28);

  const cohortKey = buildCohortKey(key);

  return { key, hash, softHash, cohortKey };
}

module.exports = { buildScheduleFingerprint, buildCohortKey, norm };
