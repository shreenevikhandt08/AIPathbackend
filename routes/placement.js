const express = require("express");
const router  = express.Router();
const ctrl    = require("../controllers/placementController");
const { verifyToken } = require("../middleware/auth");

router.get    ("/companies", verifyToken, ctrl.getCompanies);
router.post   ("/generate",  verifyToken, ctrl.generateQuestions);
router.get    ("/",          verifyToken, ctrl.getAllBanks);
router.get    ("/:id",       verifyToken, ctrl.getBank);
router.delete ("/:id",       verifyToken, ctrl.deleteBank);

module.exports = router;
