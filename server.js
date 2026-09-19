const express = require("express");
const cors    = require("cors");
const dotenv  = require("dotenv");
dotenv.config();

// Must run before any HTTPS (OpenRouter / Atlas) — Windows often needs system CAs
require("./utils/tlsSetup").applySystemCa();

const connectDB      = require("./config/db");
const requestLogger  = require("./middleware/requestLogger");

const authRoutes            = require("./routes/auth");
const leaveRoutes           = require("./routes/leave");
const subjectRoutes         = require("./routes/subjects");
const versionRoutes         = require("./routes/versions");
const blueprintRoutes       = require("./routes/blueprint");
const schedulerRoutes       = require("./routes/scheduler");
const dailyRoutes           = require("./routes/daily");
const lectureNotesRoutes    = require("./routes/lectureNotes");
const facultyAssistantRoutes = require("./routes/facultyAssistant");
const plannerRoutes         = require("./routes/planner");
const disruptionRoutes      = require("./routes/disruption");
const questionBankRoutes    = require("./routes/Questionbank");
const problemStatementRoutes = require("./routes/Problemstatement");
const placementRoutes       = require("./routes/placement");
const teamRoutes            = require("./routes/team");
const assessmentRoutes      = require("./routes/assessment");
const dreamCompanyRoutes    = require("./routes/dreamCompanies");
const profileSuggestionRoutes = require("./routes/profileSuggestions");
const plannerInputRoutes    = require("./routes/plannerInputs");
const weeklyRoutes          = require("./routes/weekly");
const homeworkRoutes        = require("./routes/homework");
const campusSyllabusRoutes  = require("./routes/campusSyllabus");
const scheduleRepoRoutes    = require("./routes/scheduleRepo");

const app  = express();
const PORT = process.env.PORT || 5001;

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    req.headers["access-control-request-headers"] || "Content-Type, Authorization, X-Requested-With, Accept"
  );
  res.setHeader("Access-Control-Max-Age", "86400");
}

app.use((req, res, next) => {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

app.use(cors({
  origin: true,
  credentials: true,
}));

// ── Connect DB ────────────────────────────────────────────────────────────────
connectDB();

function sendHealth(_req, res) {
  const mongoose = require("mongoose");
  res.status(200).json({
    status: "ok",
    service: "ai-path-builder",
    db: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
  });
}

// Health first so ALB probes never wait on JSON parsing or route work
app.get("/", sendHealth);
app.get("/health", sendHealth);
app.get("/ready", sendHealth);
app.get("/api/health", sendHealth);

app.use(express.json({ limit: "20mb" }));
app.use(requestLogger);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api",                    authRoutes);           // /api/signup, /api/login, /api/health
app.use("/api/leave",              leaveRoutes);
app.use("/api/subjects",           subjectRoutes);
app.use("/api/versions",           versionRoutes);
app.use("/api/audit-logs",         require("./routes/auditLogs"));
app.use("/api/blueprint",          blueprintRoutes);
app.use("/api/scheduler",          schedulerRoutes);
app.use("/api/daily",              dailyRoutes);
app.use("/api/weekly",             weeklyRoutes);
app.use("/api/homework",           homeworkRoutes);
app.use("/api/campus-syllabus",    campusSyllabusRoutes);
app.use("/api/schedule-repo",      scheduleRepoRoutes);
app.use("/api/planner-inputs",     plannerInputRoutes);
app.use("/api/lecture-notes",      lectureNotesRoutes);
app.use("/api/faculty-assistant",  facultyAssistantRoutes);
app.use("/api",                    plannerRoutes);        // /api/generate, /api/generate-all, /api/refine, /api/calendar, /api/upload
app.use("/api/disruption",         disruptionRoutes);
app.use("/api/question-bank",      questionBankRoutes);
app.use("/api/problem-statement",  problemStatementRoutes);
app.use("/api/placement",          placementRoutes);
app.use("/api/team",               teamRoutes);
app.use("/api/assessment",         assessmentRoutes);
app.use("/api/dream-companies",    dreamCompanyRoutes);
app.use("/api/profile-suggestions", profileSuggestionRoutes);

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  applyCors(req, res);
  console.error("Unhandled error:", err.message);
  res.status(500).json({ success: false, error: err.message });
});

// ── Start ─────────────────────────────────────────────────────────────────────
process.on("uncaughtException",  (err) => console.error("UNCAUGHT:", err.message));
process.on("unhandledRejection", (err) => console.error("UNHANDLED:", err.message));

const server = app.listen(Number(PORT) || 5001, "0.0.0.0", () => {
  console.log(`Backend listening on 0.0.0.0:${PORT || 5001}`);
});
// ALB idle timeout is 60s; Node's default keep-alive (5s) makes the TG flap unhealthy
server.keepAliveTimeout = 65000;
server.headersTimeout = 70000;
server.requestTimeout = 0;

console.log("OpenRouter Key:", process.env.OPENROUTER_API_KEY ? "YES" : "MISSING");
const s3 = require("./utils/s3Storage");
console.log("S3 bucket:", s3.bucketName(), "/", s3.folderPrefix(), s3.isConfigured() ? "(keys set)" : "(keys missing)");
s3.verifyBucket().then((info) => {
  if (info.ok) console.log(`S3 reachable → ${info.bucket}`);
  else console.warn(`S3 not reachable → ${info.bucket}: ${info.reason}`);
});