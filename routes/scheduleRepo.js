const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middleware/auth");
const ctrl = require("../controllers/scheduleRepoController");

router.post("/lookup", verifyToken, ctrl.lookup);
router.post("/save", verifyToken, ctrl.save);
router.get("/", verifyToken, ctrl.list);
router.get("/:id", verifyToken, ctrl.getOne);

module.exports = router;
