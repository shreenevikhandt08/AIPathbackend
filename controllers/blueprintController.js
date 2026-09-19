const express        = require("express");
const ExamBlueprint  = require("../models/ExamBlueprint");
const PlanVersion    = require("../models/PlanVersion");
const LectureContent = require("../models/LectureContent");
const { verifyToken } = require("../middleware/auth");
const { generateLectureContent } = require("../services/aiGenerator");

// GET /
async function listBlueprints(req, res) {
  try {
    const blueprints = await ExamBlueprint.find({ userId: req.user.id }).sort({ version: -1 });
    res.json({ success: true, blueprints });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// GET /active
async function getActiveBlueprint(req, res) {
  try {
    const active = await ExamBlueprint.findOne({ userId: req.user.id, isActive: true });
    res.json({ success: true, blueprint: active || null });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// POST /
async function createBlueprint(req, res) {
  try {
    const { name, partA, partB, partC, notes } = req.body;

    const previousActive = await ExamBlueprint.findOne({ userId: req.user.id, isActive: true });

    // deactivate current active
    await ExamBlueprint.updateMany({ userId: req.user.id }, { isActive: false });

    const latest     = await ExamBlueprint.findOne({ userId: req.user.id }).sort({ version: -1 });
    const newVersion = (latest?.version || 0) + 1;

    const blueprint = await ExamBlueprint.create({
      userId:  req.user.id,
      version: newVersion,
      name:    name || `Blueprint v${newVersion}`,
      pattern: {
        partA: partA || { count: 20, type: "MCQ",           marks: 1 },
        partB: partB || { count: 5,  type: "Short Answer",  marks: 5 },
        partC: partC || { count: 2,  type: "Essay",         marks: 10 },
      },
      notes:    notes || "",
      isActive: true,
    });

    // ── Regenerate dependent content (spec: regenerateQuestionBank /
    // regenerateAssessments / regenerateWorksheets / regenerateMockTests) ───────
    // Find every piece of lecture content that was generated against the
    // PREVIOUS active blueprint — only those are "affected files" per the
    // spec ("Only affected files regenerate"). Content with no blueprint tie
    // (blueprintVersion: null) is left alone since it isn't pattern-dependent.
    let regeneratedCount = 0;
    let regenerationErrors = [];
    if (previousActive) {
      const affected = await LectureContent.find({
        userId: req.user.id,
        blueprintVersion: previousActive.version,
      });

      for (const item of affected) {
        try {
          // Regenerate ONLY the assessment + worksheet (the parts tied to exam
          // pattern) — lecture notes and activities are pattern-independent
          // and are left untouched, matching "only affected files regenerate".
          const regenerated = await generateLectureContent({
            subject: item.subject,
            topic: item.topic,
            syllabusText: item.syllabusText,
            blueprint,
            type: "assessment", // regenerateQuestionBank + regenerateAssessments
          });

          item.assessment = regenerated.assessment || item.assessment;
          item.blueprintVersion = newVersion;

          // worksheet regeneration (regenerateWorksheets) — only if one existed before
          if (item.worksheet) {
            const wsRegen = await generateLectureContent({
              subject: item.subject,
              topic: item.topic,
              syllabusText: item.syllabusText,
              blueprint,
              type: "worksheet",
            });
            item.worksheet = wsRegen.worksheet || item.worksheet;
          }

          await item.save();
          regeneratedCount++;
        } catch (err) {
          regenerationErrors.push({ subject: item.subject, topic: item.topic, error: err.message });
        }
      }
    }

    // Save a plan version snapshot noting the blueprint change (existing behavior)
    const latestPlan = await PlanVersion.findOne({ userId: req.user.id }).sort({ version: -1 });
    if (latestPlan) {
      const planVersion = (latestPlan.version || 0) + 1;
      await PlanVersion.create({
        userId:     req.user.id,
        version:    planVersion,
        changeType: "Blueprint Changed",
        reason:     `Exam pattern updated to v${newVersion}: ${name || "new blueprint"}. ${regeneratedCount} assessment(s)/worksheet(s) regenerated.`,
        plan:       latestPlan.plan,
        leaveEvents: latestPlan.leaveEvents || [],
      });
      try {
        const { audit } = require("../utils/auditLog");
        audit(req, {
          entity: "blueprint",
          action: "blueprint.change",
          summary: `Version ${planVersion} · Blueprint updated to v${newVersion}`,
          meta: {
            version: planVersion,
            blueprintVersion: newVersion,
            changeType: "Blueprint Changed",
            regeneratedCount,
          },
        });
      } catch (_) {}
    }

    res.json({
      success: true,
      blueprint,
      regeneratedCount,
      regenerationErrors,
      message: `Blueprint v${newVersion} saved and set as active. ${regeneratedCount} dependent assessment(s)/worksheet(s) regenerated.`,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// POST /activate/:versionNum
async function activateBlueprint(req, res) {
  try {
    await ExamBlueprint.updateMany({ userId: req.user.id }, { isActive: false });
    const bp = await ExamBlueprint.findOneAndUpdate(
      { userId: req.user.id, version: parseInt(req.params.versionNum) },
      { isActive: true },
      { new: true }
    );
    if (!bp) return res.status(404).json({ success: false, error: "Blueprint version not found" });
    res.json({ success: true, blueprint: bp });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// POST /deactivate/:versionNum
async function deactivateBlueprint(req, res) {
  try {
    const bp = await ExamBlueprint.findOneAndUpdate(
      { userId: req.user.id, version: parseInt(req.params.versionNum), isActive: true },
      { isActive: false },
      { new: true }
    );
    if (!bp) return res.status(404).json({ success: false, error: "That version isn't currently active" });
    res.json({ success: true, blueprint: bp, message: `Blueprint v${bp.version} deactivated — no blueprint is active now` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// DELETE /:versionNum
async function deleteBlueprint(req, res) {
  try {
    const version = parseInt(req.params.versionNum);
    const bp = await ExamBlueprint.findOne({ userId: req.user.id, version });
    if (!bp) return res.status(404).json({ success: false, error: "Blueprint version not found" });

    await ExamBlueprint.deleteOne({ userId: req.user.id, version });

    // If we just deleted the active one, no blueprint remains active until
    // the user picks another — we don't auto-activate to avoid surprises.
    res.json({
      success: true,
      message: `Blueprint v${version} deleted${bp.isActive ? " (it was active — no blueprint is active now)" : ""}`,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}


module.exports = { listBlueprints, getActiveBlueprint, createBlueprint, activateBlueprint, deactivateBlueprint, deleteBlueprint };
