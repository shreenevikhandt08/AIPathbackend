const express = require("express");
const {
  signup,
  login,
  health,
  forgotPassword,
  resetPassword,
  signupInstitutions,
  signupDepartments,
} = require("../controllers/authController");

const router = express.Router();

router.post("/signup", signup);
router.post("/login",  login);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.get("/signup/institutions", signupInstitutions);
router.get("/signup/departments", signupDepartments);
router.get("/health",  health);

module.exports = router;
