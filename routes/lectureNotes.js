const express = require("express");
const { generateContent, listContent, getContent, debugContent, deleteContent } = require("../controllers/lectureNotesController");
const { verifyToken } = require("../middleware/auth");

const router = express.Router();

router.post("/", verifyToken, generateContent);
router.get("/", verifyToken, listContent);
router.get("/content", verifyToken, getContent);
router.get("/debug", verifyToken, debugContent);
router.delete("/content", verifyToken, deleteContent);

module.exports = router;
