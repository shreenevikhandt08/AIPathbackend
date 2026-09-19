const bcrypt = require("bcryptjs");
const jwt    = require("jsonwebtoken");
const crypto = require("crypto");
const mongoose = require("mongoose");
const User   = require("../models/User");
const {
  loginWithOkrion,
  checkOkrionUserExists,
  createOkrionUser,
  listOkrionInstitutions,
  listOkrionDepartments,
} = require("../services/okrionSsoService");

const JWT_SECRET = process.env.JWT_SECRET || "academic_planner_secret_key";

function passwordMeetsRules(password) {
  const p = String(password || "");
  return p.length >= 9 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /[0-9]/.test(p);
}

function hashResetCode(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function getAllowedAiPathRole(okrionUser = {}) {
  const appRole = okrionUser.appRole || {};
  const role = String(appRole.aipathbuilder || "").trim().toLowerCase();
  return ["admin", "faculty", "student"].includes(role) ? role : "";
}

function getBranchId(branchId) {
  if (!branchId) return null;
  if (typeof branchId === "object") return branchId._id ?? branchId.id ?? null;
  return branchId;
}

function buildDisplayName(okrionUser = {}) {
  return (
    okrionUser.name ||
    [okrionUser.firstName, okrionUser.lastName].filter(Boolean).join(" ").trim() ||
    okrionUser.email ||
    "OKRion User"
  );
}

function toClientUser(user) {
  return {
    id: user._id,
    okrionUserId: user.okrionUserId,
    name: user.name,
    email: user.email,
    role: user.role,
    branchId: user.branchId,
    department: user.department,
    registerNumber: user.registerNumber,
    institutionName: user.institutionName,
    phone: user.phone,
    source: user.source,
  };
}

async function upsertOkrionUser(okrionUser, role) {
  const email = normalizeEmail(okrionUser.email);
  const okrionUserId = Number(okrionUser.okrUserId || okrionUser.userId || okrionUser._id);
  if (!email || !Number.isFinite(okrionUserId)) {
    const err = new Error("OKRion SSO returned an incomplete user profile");
    err.status = 502;
    throw err;
  }

  const update = {
    okrionUserId,
    name: buildDisplayName(okrionUser),
    email,
    role,
    branchId: getBranchId(okrionUser.branchId ?? okrionUser.branch),
    department: okrionUser.department || okrionUser.course || "",
    registerNumber: okrionUser.registerNumber || "",
    institutionName: okrionUser.institutionName || "",
    phone: okrionUser.phone || "",
    source: "okrion_sso",
    lastLoginAt: new Date(),
  };

  let user = await User.findOne({ okrionUserId });
  if (!user) user = await User.findOne({ email });
  if (!user) user = new User(update);
  else Object.assign(user, update);

  await user.save();
  return user;
}

async function signup(req, res) {
  try {
    const {
      fullName,
      initials,
      firstName,
      lastName,
      name,
      email,
      password,
      phone,
      role,
      department,
      course,
      year,
      designation,
      institutionId,
      institutionName,
      registerNumber,
    } = req.body || {};
    const normalizedEmail = normalizeEmail(email);
    const normalizedRole = String(role || "student").trim().toLowerCase();
    const resolvedFirstName = String(fullName || firstName || name || "").trim();
    const resolvedInitials = String(initials || lastName || "").trim();

    if (!resolvedFirstName || !resolvedInitials || !normalizedEmail || !password || !normalizedRole) {
      return res.status(400).json({ success: false, error: "Full name, initials, email, password, and role are required" });
    }
    if (!["student", "faculty"].includes(normalizedRole)) {
      return res.status(400).json({ success: false, error: "Role must be student or faculty" });
    }
    if (!institutionName) {
      return res.status(400).json({ success: false, error: "Institution name is required" });
    }
    if (!department) {
      return res.status(400).json({ success: false, error: "Department/Wings is required" });
    }
    if (!phone) {
      return res.status(400).json({ success: false, error: "Phone number is required" });
    }
    if (normalizedRole === "student" && !registerNumber) {
      return res.status(400).json({ success: false, error: "Register number is required" });
    }
    if (!passwordMeetsRules(password))
      return res.status(400).json({
        success: false,
        error: "Password must be 9+ characters with uppercase, lowercase, and a number",
      });

    const existing = await checkOkrionUserExists(normalizedEmail);
    if (existing?.exists) {
      return res.status(409).json({
        success: false,
        code: "OKRION_USER_EXISTS",
        error: "This account already exists in OKRion. Please sign in directly.",
      });
    }

    const created = await createOkrionUser({
      email: normalizedEmail,
      password,
      firstName: resolvedFirstName,
      lastName: resolvedInitials,
      phone,
      role: normalizedRole,
      institutionId,
      department,
      course: course || department,
      year,
      designation,
      institutionName,
      registerNumber,
      appName: "aipathbuilder",
    });
    const createdUser = created?.user;
    const aiPathRole = getAllowedAiPathRole(createdUser) || normalizedRole;
    let localUser = null;
    if (createdUser) {
      localUser = await upsertOkrionUser(createdUser, aiPathRole);
    }

    res.json({
      success: true,
      message: "Account created in OKRion. Please sign in with your OKRion credentials.",
      user: localUser ? toClientUser(localUser) : undefined,
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
}

async function signupInstitutions(_req, res) {
  try {
    const data = await listOkrionInstitutions();
    res.json({
      success: true,
      institutions: data?.institutions || [],
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
}

async function signupDepartments(req, res) {
  try {
    const institutionId = req.query.institutionId;
    if (!institutionId) {
      return res.status(400).json({ success: false, error: "institutionId is required" });
    }
    const data = await listOkrionDepartments(institutionId);
    res.json({
      success: true,
      institution: data?.institution || null,
      departments: data?.departments || [],
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body;
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !password) {
      return res.status(400).json({ success: false, error: "Email and password are required" });
    }

    const ssoResult = await loginWithOkrion(normalizedEmail, password);
    const okrionUser = ssoResult?.user;
    const aiPathRole = getAllowedAiPathRole(okrionUser);
    if (!aiPathRole) {
      return res.status(403).json({
        success: false,
        error: "Your OKRion account does not have AI Path Builder access. Please contact the administrator.",
      });
    }

    const user = await upsertOkrionUser(okrionUser, aiPathRole);
    const token = jwt.sign(
      { id: user._id, email: user.email, role: user.role, okrionUserId: user.okrionUserId },
      JWT_SECRET,
      { expiresIn: "7d" }
    );
    res.json({
      success: true,
      token,
      user: toClientUser(user),
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
}

async function forgotPassword(req, res) {
  try {
    const email = String(req.body.email || "").toLowerCase().trim();
    if (!email) return res.status(400).json({ success: false, error: "Email is required" });
    const user = await User.findOne({ email });
    const generic = "If that email is registered, use the reset code to set a new password.";
    if (!user) return res.json({ success: true, message: generic });

    const code = String(crypto.randomInt(100000, 1000000));
    user.resetCodeHash = hashResetCode(code);
    user.resetCodeExpires = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();
    const payload = { success: true, message: generic };
    // No SMTP on this app — return the code so campus users can reset.
    payload.code = code;
    return res.json(payload);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function resetPassword(req, res) {
  try {
    const email = String(req.body.email || "").toLowerCase().trim();
    const code = String(req.body.code || "").trim();
    const password = req.body.password;
    if (!email || !code || !password)
      return res.status(400).json({ success: false, error: "Email, code, and new password are required" });
    if (!passwordMeetsRules(password))
      return res.status(400).json({
        success: false,
        error: "Password must be 9+ characters with uppercase, lowercase, and a number",
      });

    const user = await User.findOne({ email });
    if (!user || !user.resetCodeHash || !user.resetCodeExpires)
      return res.status(400).json({ success: false, error: "Invalid or expired code" });
    if (user.resetCodeExpires.getTime() < Date.now())
      return res.status(400).json({ success: false, error: "Code expired — request a new one" });
    if (hashResetCode(code) !== user.resetCodeHash)
      return res.status(400).json({ success: false, error: "Invalid code" });

    user.password = await bcrypt.hash(password, 10);
    user.resetCodeHash = "";
    user.resetCodeExpires = null;
    await user.save();
    res.json({ success: true, message: "Password updated" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

function sendHealth(_req, res) {
  const dbUp = mongoose.connection.readyState === 1;
  res.status(200).json({
    status: "ok",
    service: "ai-path-builder",
    db: dbUp ? "connected" : "disconnected",
  });
}

function health(req, res) {
  sendHealth(req, res);
}

module.exports = { signup, login, health, forgotPassword, resetPassword, signupInstitutions, signupDepartments };
