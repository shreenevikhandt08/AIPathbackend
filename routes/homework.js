const express = require("express");
const { verifyToken } = require("../middleware/auth");
const {
  getHomework,
  getHomeworkDay,
  syncHomework,
  upsertHomeworkDay,
  toggleHomeworkTask,
  toggleHomeworkNight,
  resetHomeworkProgress,
} = require("../controllers/homeworkController");

const router = express.Router();

router.get("/", verifyToken, getHomework);
router.get("/day/:dayId", verifyToken, getHomeworkDay);
router.post("/sync", verifyToken, syncHomework);
router.put("/day", verifyToken, upsertHomeworkDay);
router.post("/toggle-task", verifyToken, toggleHomeworkTask);
router.post("/toggle-night", verifyToken, toggleHomeworkNight);
router.post("/reset-progress", verifyToken, resetHomeworkProgress);

module.exports = router;
