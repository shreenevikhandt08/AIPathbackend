const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middleware/auth");
const ctrl = require("../controllers/dreamCompanyController");

router.get("/", verifyToken, ctrl.listDreamCompanies);
router.post("/check", verifyToken, ctrl.checkDreamCompany);
router.post("/", verifyToken, ctrl.addDreamCompany);

module.exports = router;
