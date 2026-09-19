const express = require("express");
const { verifyToken } = require("../middleware/auth");
const { getWeekly, saveWeekly } = require("../controllers/weeklyController");

const router = express.Router();

router.get("/", verifyToken, getWeekly);
router.post("/sync", verifyToken, saveWeekly);

module.exports = router;
