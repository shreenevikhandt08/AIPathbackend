const { lookupCampusSyllabus } = require("../utils/campusSyllabusLookup");

/**
 * GET /api/campus-syllabus?college=&department=&collegeYear=&semester=
 * Returns R2023 subjects for the selected tech-campus profile.
 */
async function getCampusSyllabus(req, res) {
  try {
    const college = String(req.query.college || req.body?.college || "").trim();
    const department = String(req.query.department || req.body?.department || "").trim();
    const collegeYear = Number(req.query.collegeYear || req.body?.collegeYear || 0) || null;
    const semester = Number(req.query.semester || req.body?.semester || 0) || null;

    const result = await lookupCampusSyllabus({
      college,
      department,
      collegeYear,
      semester,
    });

    if (!result.ok) {
      return res.status(404).json({
        success: false,
        error: result.error || "Syllabus not found",
        meta: result.meta || {},
      });
    }

    return res.json({
      success: true,
      syllabusText: result.syllabusText,
      subjects: result.subjects,
      meta: result.meta,
    });
  } catch (err) {
    console.error("getCampusSyllabus:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { getCampusSyllabus };
