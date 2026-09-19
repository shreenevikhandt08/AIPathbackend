const express = require("express");
const { detectDifficulty, buildIASchedule } = require("../controllers/schedulerController");
const { verifyToken } = require("../middleware/auth");

const router = express.Router();

router.post("/detect-difficulty", verifyToken, detectDifficulty);
router.post("/ia", verifyToken, buildIASchedule);

module.exports = router;
