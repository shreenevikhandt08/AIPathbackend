const express  = require("express");
const { generate, generateAll, refine, polish, calendar, uploadFiles, upload } = require("../controllers/plannerController");
const { optionalAuth, verifyToken } = require("../middleware/auth");
const { listMyUploads } = require("../controllers/uploadController");

const router = express.Router();

router.post("/generate",     generate);
router.post("/generate-all", generateAll);
router.post("/refine",       refine);
router.post("/polish",       polish);
router.post("/calendar",     calendar);
router.post("/upload",       optionalAuth, upload.any(), uploadFiles);
router.get("/uploads",       verifyToken, listMyUploads);

module.exports = router;