const express = require("express");
const { verifyToken } = require("../middleware/auth");
const {
  syncPlan,
  getPlan,
  getStatus,
  lockDay,
  unlockDay,
  regenerateDay,
  toggleRow,
  getDoneRows,
  toggleSubTask,
  getWeekReadiness,
  buildAssessment,
  getAssessment,
} = require("../controllers/dailyController");

const router = express.Router();

router.post("/sync", verifyToken, syncPlan);
router.get("/plan", verifyToken, getPlan);
router.get("/status", verifyToken, getStatus);
router.post("/lock", verifyToken, lockDay);
router.post("/unlock", verifyToken, unlockDay);
router.post("/regenerate", verifyToken, regenerateDay);
router.post("/toggle-row", verifyToken, toggleRow);
router.get("/done-rows/:dayId", verifyToken, getDoneRows);


//  checkbox
router.post("/toggle-subtask", verifyToken, toggleSubTask);

// Live readiness percentage for a week
router.get("/readiness/:weekNum", verifyToken, getWeekReadiness);

// Build / rebuild the Friday Assessment Day for a week
router.post("/assessment", verifyToken, buildAssessment);

// Fetch current assessment state for a week
router.get("/assessment/:weekNum", verifyToken, getAssessment);

module.exports = router;
