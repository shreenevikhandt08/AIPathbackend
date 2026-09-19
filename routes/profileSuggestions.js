const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middleware/auth");
const { retrieveProfileSuggestions } = require("../utils/profileSuggestionRag");

/** GET /api/profile-suggestions?kind=interest|capability|domain&q=&refresh=1 */
router.get("/", verifyToken, async (req, res) => {
  try {
    const kind = String(req.query.kind || "interest").toLowerCase();
    const query = req.query.q || req.query.query || "";
    const limit = req.query.limit;
    const refresh = req.query.refresh === "1" || req.query.refresh === "true";
    const result = await retrieveProfileSuggestions(kind, { query, limit, refresh });
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
