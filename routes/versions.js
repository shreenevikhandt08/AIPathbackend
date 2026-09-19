const express = require("express");
const {
  listVersions,
  compareVersions,
  compareVersionsPost,
  getVersion,
  restoreVersion,
  saveVersion,
  deleteVersion,
  setVersionProtected,
} = require("../controllers/versionsController");
const { verifyToken } = require("../middleware/auth");

const router = express.Router();

router.get("/", verifyToken, listVersions);
// Register compare BEFORE /:versionNum so "compare" is never treated as a version id
router.get("/compare/:vA/:vB", verifyToken, compareVersions);
router.post("/compare", verifyToken, compareVersionsPost);
router.post("/save", verifyToken, saveVersion);
router.post("/restore/:versionNum", verifyToken, restoreVersion);
router.post("/:versionNum/protect", verifyToken, setVersionProtected);
router.get("/:versionNum", verifyToken, getVersion);
router.delete("/:versionNum", verifyToken, deleteVersion);

module.exports = router;
