/**
 * Loads college syllabus for Subjects module.
 * Prefer R2023 campus PDF lookup (college + dept + year + sem).
 * Fallback: backend/data/collegeSyllabusInput.txt
 */
const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "data", "collegeSyllabusInput.txt");

function loadCollegeSyllabusInput() {
  try {
    const text = fs.readFileSync(FILE, "utf8");
    const cleaned = String(text || "")
      .split(/\r?\n/)
      .filter((line) => !/^\s*#/.test(line))
      .join("\n")
      .trim();
    return cleaned.length >= 40 ? cleaned : "";
  } catch {
    return "";
  }
}

function profileFromInputs(inputs = {}) {
  let college = inputs.college || "";
  let department = inputs.department || "";
  let collegeYear = inputs.collegeYear != null ? Number(inputs.collegeYear) : null;
  let semester = inputs.semester != null ? Number(inputs.semester) : null;

  try {
    const ap =
      typeof inputs._academicProfile === "string"
        ? JSON.parse(inputs._academicProfile)
        : inputs._academicProfile;
    if (ap && typeof ap === "object") {
      if (!college) college = ap.college || "";
      if (!department) department = ap.department || "";
      if (collegeYear == null && ap.collegeYear != null) collegeYear = Number(ap.collegeYear);
      if (semester == null && ap.semester != null) semester = Number(ap.semester);
    }
  } catch {
    /* ignore */
  }

  // Team primary member
  try {
    const raw = inputs._teamMembers;
    const members = typeof raw === "string" ? JSON.parse(raw) : raw;
    const primary = Array.isArray(members) ? members.find((m) => m?.name?.trim()) : null;
    if (primary) {
      if (!college) college = primary.college || "";
      if (!department) department = primary.department || "";
      if (collegeYear == null && primary.collegeYear != null) {
        collegeYear = Number(primary.collegeYear);
      }
      if (semester == null && primary.semester != null) {
        semester = Number(primary.semester);
      }
    }
  } catch {
    /* ignore */
  }

  return { college, department, collegeYear, semester };
}

/**
 * If inputs.syllabus is empty/short and Subjects are enabled,
 * fill from campus R2023 PDF (tech) or hands-on template.
 */
async function ensureSyllabusFromHandsOnFile(inputs = {}) {
  const next = inputs && typeof inputs === "object" ? inputs : {};
  const skip =
    next._skipSubjects === true ||
    next._skipSubjects === "true" ||
    next._skipSubjects === 1;
  if (skip) return next;

  const current = String(next.syllabus || "").trim();
  // Do not overwrite a real user upload / pasted syllabus
  if (current.length >= 40 && !next._syllabusFromCampus) return next;

  const profile = profileFromInputs(next);
  if (profile.college && profile.department && profile.semester) {
    try {
      const { lookupCampusSyllabus } = require("./campusSyllabusLookup");
      const result = await lookupCampusSyllabus(profile);
      if (result.ok && result.syllabusText) {
        next.syllabus = result.syllabusText;
        next._syllabusSource = result.meta?.fileName || "campus-r2023";
        next._syllabusFromCampus = true;
        next._campusSubjects = result.subjects;
        return next;
      }
      if (result.error) {
        console.warn("Campus syllabus lookup:", result.error);
      }
    } catch (e) {
      console.warn("Campus syllabus lookup failed:", e.message);
    }
  }

  if (current.length >= 40) return next;

  const fromFile = loadCollegeSyllabusInput();
  if (!fromFile) return next;

  next.syllabus = fromFile;
  next._syllabusSource = "collegeSyllabusInput.txt";
  next._syllabusFromCampus = false;
  return next;
}

module.exports = {
  loadCollegeSyllabusInput,
  ensureSyllabusFromHandsOnFile,
  profileFromInputs,
  SYLLABUS_INPUT_PATH: FILE,
};
