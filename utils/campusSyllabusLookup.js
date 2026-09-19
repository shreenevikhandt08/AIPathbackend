/**
 * Load subjects for SNS tech campus from R2023 curriculum PDF/DOCX
 * by college + department + year + semester.
 */
const fs = require("fs");
const path = require("path");
const {
  resolveSyllabusRoot,
  mapDepartmentFolder,
  semesterRoman,
  fallbackSubjects,
} = require("../data/campusSyllabusConfig");

const textCache = new Map(); // filePath -> extracted text
const semCache = new Map(); // cacheKey -> { subjects, syllabusText, meta }

function isTechCampus(college = "") {
  const n = String(college || "").toLowerCase();
  return (
    /sns college of technology/i.test(n) ||
    /sns college of engineering/i.test(n) ||
    /college of technology/i.test(n)
  );
}

function findDeptFile(root, folderName) {
  const dir = path.join(root, folderName);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => /\.(pdf|docx)$/i.test(f));
  if (!files.length) return null;
  // Prefer PDF
  const pdf = files.find((f) => /\.pdf$/i.test(f));
  return path.join(dir, pdf || files[0]);
}

async function extractFileText(filePath) {
  if (textCache.has(filePath)) return textCache.get(filePath);
  const buf = fs.readFileSync(filePath);
  let text = "";
  if (/\.pdf$/i.test(filePath)) {
    const pdf = require("pdf-parse");
    const data = await pdf(buf);
    text = String(data.text || "");
  } else if (/\.docx$/i.test(filePath)) {
    const mammoth = require("mammoth");
    const result = await mammoth.extractRawText({ buffer: buf });
    text = String(result.value || "");
  }
  text = text.replace(/\r/g, "\n").replace(/[ \t]+\n/g, "\n");
  textCache.set(filePath, text);
  return text;
}

/**
 * Pull curriculum-table block for one semester (first table occurrence).
 */
function sliceSemesterBlock(fullText, roman) {
  const text = String(fullText || "");
  const reStart = new RegExp(`SEMESTER\\s+${roman}\\b`, "i");
  const start = text.search(reStart);
  if (start < 0) return "";

  // Prefer the early curriculum summary table (before detailed syllabi)
  const after = text.slice(start);
  const nextSem = after.slice(20).search(/SEMESTER\s+(I{1,3}|IV|V|VI{0,3}|IX|X|\d+)\b/i);
  let block = nextSem >= 0 ? after.slice(0, nextSem + 20) : after.slice(0, 3500);

  // If this block looks like detailed unit syllabus (very long course prose),
  // try to stay on the compact table — tables are usually < 2500 chars.
  if (block.length > 4000) block = block.slice(0, 3500);
  return block;
}

/**
 * Extract course code + title pairs from a semester curriculum table.
 */
function parseSubjectsFromBlock(block) {
  const text = String(block || "").replace(/\n+/g, "\n");
  const subjects = [];
  const seen = new Set();

  // Pattern A: code on its own line / nearby, then title
  // 23ITT201 Data Structures 3 0 0 …
  // 23MAT202 \n Discrete Mathematics \n 3 0 0
  const codeRe = /\b(23[A-Z]{2,4}\d{3}[A-Z]?)\b/gi;
  const codes = [];
  let m;
  while ((m = codeRe.exec(text))) {
    codes.push({ code: m[1].toUpperCase(), index: m.index });
  }

  for (let i = 0; i < codes.length; i++) {
    const { code, index } = codes[i];
    if (seen.has(code)) continue;
    const end = i + 1 < codes.length ? codes[i + 1].index : Math.min(text.length, index + 220);
    let chunk = text.slice(index + code.length, end).replace(/\s+/g, " ").trim();

    // Drop L T P credit noise
    chunk = chunk
      .replace(/\b\d\s+\d\s+\d\b.*$/i, "")
      .replace(/\b\d{1,2}\/\d{1,2}\b.*$/i, "")
      .replace(/\b(PCC|BSC|ESC|EEC|OEC|HSMC|MC|PEC)\b.*$/i, "")
      .replace(/\b(Theory|Practical|Mandatory|Integrated).*$/i, "")
      .replace(/^\s*[-–—:|]+\s*/, "")
      .trim();

    // Title is usually the leading words before numbers
    let title = chunk.match(/^([A-Za-z][A-Za-z0-9 &/(),.+'-]{2,80})/)?.[1]?.trim() || "";
    title = title
      .replace(/\s+/g, " ")
      .replace(/\b(Contact|hrs|week|Credit|Int|Ext|Category|SNo)\b.*$/i, "")
      .trim();

    // Skip lab-only noise titles that are empty / too short
    if (!title || title.length < 4) continue;
    if (/^(total|mandatory|theory|practical)$/i.test(title)) continue;

    seen.add(code);
    subjects.push({ code, name: title });
  }

  return subjects;
}

function formatSyllabusText({ college, department, year, semester, subjects, sourceFile }) {
  const lines = [
    `COLLEGE: ${college}`,
    `DEPARTMENT: ${department}`,
    `YEAR: ${year}`,
    `SEMESTER: ${semester}`,
    `SOURCE: R2023 curriculum (${path.basename(sourceFile || "syllabus")})`,
    "",
    "SUBJECTS:",
    ...subjects.map((s) => `- ${s.code} — ${s.name}`),
    "",
    "LEARNING_POOL:",
    ...subjects.slice(0, 8).map((s) => `- ${s.name}`),
  ];
  return lines.join("\n");
}

/**
 * @returns {Promise<{ ok, syllabusText, subjects, meta, error? }>}
 */
async function lookupCampusSyllabus({
  college = "",
  department = "",
  collegeYear = null,
  semester = null,
} = {}) {
  const sem = Number(semester);
  const year = Number(collegeYear) || Math.ceil(sem / 2) || null;
  const roman = semesterRoman(sem);

  if (!isTechCampus(college) && !/engineering|technology/i.test(String(college))) {
    return {
      ok: false,
      error: "Campus syllabus auto-fill is available for SNS tech colleges (Technology / Engineering).",
      subjects: [],
      syllabusText: "",
      meta: {},
    };
  }
  if (!roman) {
    return {
      ok: false,
      error: "Select a valid semester (1–8).",
      subjects: [],
      syllabusText: "",
      meta: {},
    };
  }

  const folder = mapDepartmentFolder(department);
  if (!folder) {
    return {
      ok: false,
      error: `No R2023 syllabus folder mapped for department "${department}".`,
      subjects: [],
      syllabusText: "",
      meta: {},
    };
  }

  const root = resolveSyllabusRoot();
  const cacheKey = `${root}|${folder}|${sem}`;
  if (semCache.has(cacheKey)) {
    return { ok: true, ...semCache.get(cacheKey) };
  }

  if (!fs.existsSync(root)) {
    const subjects = fallbackSubjects(folder, sem);
    const syllabusText = formatSyllabusText({
      college,
      department,
      year,
      semester: sem,
      subjects,
      sourceFile: "bundled-r2023.json",
    });
    return {
      ok: true,
      syllabusText,
      subjects,
      meta: { root, folder, source: "bundled", roman, semester: sem, year, college, department, count: subjects.length },
    };
  }

  const filePath = findDeptFile(root, folder);
  if (!filePath) {
    const subjects = fallbackSubjects(folder, sem);
    const syllabusText = formatSyllabusText({
      college,
      department,
      year,
      semester: sem,
      subjects,
      sourceFile: "bundled-r2023.json",
    });
    return {
      ok: true,
      syllabusText,
      subjects,
      meta: { root, folder, source: "bundled", roman, semester: sem, year, college, department, count: subjects.length },
    };
  }

  try {
    const fullText = await extractFileText(filePath);
    const block = sliceSemesterBlock(fullText, roman);
    let subjects = parseSubjectsFromBlock(block);

    // Fallback: search whole text for "SEMESTER X" detailed section headers with codes
    if (subjects.length < 3) {
      subjects = parseSubjectsFromBlock(fullText.slice(
        fullText.search(new RegExp(`SEMESTER\\s+${roman}\\b`, "i")),
        fullText.search(new RegExp(`SEMESTER\\s+${roman}\\b`, "i")) + 8000
      ));
    }

    if (!subjects.length) {
      return {
        ok: false,
        error: `Could not parse subjects for Semester ${sem} (${roman}) from ${path.basename(filePath)}`,
        subjects: [],
        syllabusText: "",
        meta: { root, folder, file: filePath, roman },
      };
    }

    const syllabusText = formatSyllabusText({
      college,
      department,
      year,
      semester: sem,
      subjects,
      sourceFile: filePath,
    });

    const payload = {
      syllabusText,
      subjects,
      meta: {
        root,
        folder,
        file: filePath,
        fileName: path.basename(filePath),
        roman,
        semester: sem,
        year,
        college,
        department,
        count: subjects.length,
      },
    };
    semCache.set(cacheKey, payload);
    return { ok: true, ...payload };
  } catch (err) {
    return {
      ok: false,
      error: err.message || "Failed to read syllabus file",
      subjects: [],
      syllabusText: "",
      meta: { file: filePath },
    };
  }
}

module.exports = {
  lookupCampusSyllabus,
  isTechCampus,
  parseSubjectsFromBlock,
  sliceSemesterBlock,
};
