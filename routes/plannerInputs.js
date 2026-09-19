const express = require("express");
const { verifyToken } = require("../middleware/auth");
const { getPlannerInputs, savePlannerInputs } = require("../controllers/plannerInputController");

const router = express.Router();

router.get("/", verifyToken, getPlannerInputs);
router.post("/", verifyToken, savePlannerInputs);

module.exports = router;
