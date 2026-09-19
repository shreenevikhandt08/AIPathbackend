const express    = require("express");
const router     = express.Router();
// const auth       = require("../middleware/auth");
const ctrl       = require("../controllers/Questionbankcontroller");
const { verifyToken } = require("../middleware/auth");

router.post   ("/generate", verifyToken, ctrl.generateQuestions);
router.get    ("/",        verifyToken, ctrl.getAllBanks);
router.get    ("/:id",     verifyToken, ctrl.getBank);
router.delete ("/:id",      verifyToken, ctrl.deleteBank);

module.exports = router;