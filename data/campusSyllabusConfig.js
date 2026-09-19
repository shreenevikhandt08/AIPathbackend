/**
 * Campus R2023 syllabus roots + dept folder mapping (SNS College of Technology).
 * PDFs live under SYLLABUS_ROOT (env) or the default Downloads path.
 */
const path = require("path");
const fs = require("fs");

const DEFAULT_ROOT = path.join(
  "C:",
  "Users",
  "HP",
  "Downloads",
  "syllabus",
  "R2023 curriculum & syllabus( After 20th ACM)"
);

/** UI department label → folder name under the R2023 root */
const DEPT_FOLDER_MAP = {
  cse: "CSE",
  "computer science": "CSE",
  "computer science and engineering": "CSE",
  it: "IT",
  "information technology": "IT",
  "ai & ds": "AIML",
  aids: "AIML",
  "ai&ds": "AIML",
  "ai and ds": "AIML",
  "artificial intelligence": "AIML",
  aiml: "AIML",
  "ai & ml": "AIML",
  "ai/ml": "AIML",
  ece: "ECE",
  "electronics and communication": "ECE",
  eee: "EEE",
  "electrical and electronics": "EEE",
  mechanical: "MECH",
  mech: "MECH",
  mechatronics: "MCT",
  mct: "MCT",
  civil: "Civil",
  automobile: "AUTOMOBILE",
  auto: "AUTOMOBILE",
  aerospace: "AEROSPACE",
  agri: "Agri",
  agriculture: "Agri",
  bme: "BME",
  "biomedical": "BME",
  ft: "FT",
  "food technology": "FT",
};

const SEM_ROMAN = {
  1: "I",
  2: "II",
  3: "III",
  4: "IV",
  5: "V",
  6: "VI",
  7: "VII",
  8: "VIII",
};

/** Used on ECS when R2023 PDFs are not baked into the image. */
const FALLBACK_SUBJECTS = {
  CSE: {
    3: [
      { code: "23MAT201", name: "Discrete Mathematics" },
      { code: "23CST201", name: "Data Structures" },
      { code: "23CST202", name: "Digital Principles and Computer Organization" },
      { code: "23CST203", name: "Object Oriented Programming" },
      { code: "23CST211", name: "Data Structures Laboratory" },
      { code: "23CST212", name: "Object Oriented Programming Laboratory" },
    ],
    4: [
      { code: "23CST241", name: "Design and Analysis of Algorithms" },
      { code: "23CST242", name: "Database Management Systems" },
      { code: "23CST243", name: "Operating Systems" },
      { code: "23CST244", name: "Computer Networks" },
    ],
  },
  IT: {
    3: [
      { code: "23ITT201", name: "Data Structures" },
      { code: "23ITT202", name: "Digital Principles" },
      { code: "23ITT203", name: "Object Oriented Programming" },
      { code: "23MAT201", name: "Discrete Mathematics" },
    ],
  },
  AIML: {
    3: [
      { code: "23ADT201", name: "Data Structures" },
      { code: "23ADT202", name: "Python for Data Science" },
      { code: "23MAT201", name: "Discrete Mathematics" },
      { code: "23ADT203", name: "Digital Principles" },
    ],
  },
};

function fallbackSubjects(folder, semester) {
  const map = FALLBACK_SUBJECTS[String(folder || "").toUpperCase()] || FALLBACK_SUBJECTS.CSE;
  return map[Number(semester)] || map[3] || FALLBACK_SUBJECTS.CSE[3];
}

function resolveSyllabusRoot() {
  const fromEnv = String(process.env.SYLLABUS_ROOT || "").trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const localCopy = path.join(__dirname, "syllabi", "r2023");
  if (fs.existsSync(localCopy)) return localCopy;
  if (fs.existsSync(DEFAULT_ROOT)) return DEFAULT_ROOT;
  return fromEnv || DEFAULT_ROOT;
}

function mapDepartmentFolder(department = "") {
  const key = String(department || "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!key || key === "other") return null;
  if (DEPT_FOLDER_MAP[key]) return DEPT_FOLDER_MAP[key];
  // fuzzy: folder name equals dept
  const compact = key.replace(/[^a-z0-9&]/g, "");
  for (const [k, folder] of Object.entries(DEPT_FOLDER_MAP)) {
    if (compact.includes(k.replace(/[^a-z0-9&]/g, "")) || k.includes(key)) return folder;
  }
  return null;
}

function semesterRoman(sem) {
  const n = Number(sem);
  return SEM_ROMAN[n] || null;
}

module.exports = {
  DEFAULT_ROOT,
  DEPT_FOLDER_MAP,
  SEM_ROMAN,
  resolveSyllabusRoot,
  mapDepartmentFolder,
  semesterRoman,
  fallbackSubjects,
};
