const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "academic_planner_secret_key";

function readBearerToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return "";
  let token = authHeader.slice(7).trim();
  if (/^Bearer\s+/i.test(token)) token = token.replace(/^Bearer\s+/i, "").trim();
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    token = token.slice(1, -1).trim();
  }
  return token;
}

function verifyToken(req, res, next) {
  const token = readBearerToken(req);
  if (!token) {
    return res.status(401).json({ success: false, error: "No token provided — please log in again" });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { id, email }
    next();
  } catch (err) {
    const expired = err?.name === "TokenExpiredError";
    return res.status(401).json({
      success: false,
      error: expired
        ? "Session expired — please log in again"
        : "Invalid or expired token — please log in again",
    });
  }
}

/** Attach req.user when a valid JWT is present; continue as guest otherwise. */
function optionalAuth(req, res, next) {
  const token = readBearerToken(req);
  if (!token) return next();
  try {
    req.user = jwt.verify(token, JWT_SECRET);
  } catch (_) {
    req.user = null;
  }
  return next();
}

module.exports = { verifyToken, optionalAuth };
