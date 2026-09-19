const express = require("express");
const { getBanks, previewPick } = require("../controllers/assessmentController");

const router = express.Router();

router.get("/banks", getBanks);
router.get("/pick", previewPick);

module.exports = router;
