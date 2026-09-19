const express = require("express");
const { verifyToken } = require("../middleware/auth");
const { listAuditLogs } = require("../controllers/auditController");

const router = express.Router();

router.get("/", verifyToken, listAuditLogs);

module.exports = router;
