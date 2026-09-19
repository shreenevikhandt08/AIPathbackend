const express    = require("express");
const router     = express.Router();
// const auth       = require("../middleware/auth");
const ctrl       = require("../controllers/Problemstatementcontroller");
const { verifyToken } = require("../middleware/auth");

router.post   ("/generate",        verifyToken, ctrl.generateStatements);
router.post   ("/quick-create",    verifyToken, ctrl.quickCreate);
router.get    ("/yc-inspiration",  verifyToken, ctrl.getYCInspiration);
router.post   ("/validate",        verifyToken, ctrl.validateProblemFramework);
router.post   ("/rewrite",         verifyToken, ctrl.rewriteProblemFramework);
router.get    ("/thrust-areas",    verifyToken, ctrl.getThrustAreas);
router.get    ("/",                verifyToken, ctrl.getAllStatements);
router.delete ("/:id",             verifyToken, ctrl.deleteStatement);

module.exports = router;