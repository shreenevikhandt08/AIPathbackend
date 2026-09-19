const express = require("express");
const { generateActivity } = require("../controllers/facultyAssistantController");
const { verifyToken } = require("../middleware/auth");

const router = express.Router();

router.post("/", verifyToken, generateActivity);

module.exports = router;
