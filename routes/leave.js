const express = require("express");
const { setBase, getBase, getLeaveEvents, addLeave, removeLeave, applyDisruption } = require("../controllers/leaveController");
const { verifyToken } = require("../middleware/auth");

const router = express.Router();

router.post("/set-base", verifyToken, setBase);
router.get("/base", verifyToken, getBase);
router.get("/", verifyToken, getLeaveEvents);
router.post("/add", verifyToken, addLeave);
router.post("/remove", verifyToken, removeLeave);
router.post("/disruption", verifyToken, applyDisruption);

module.exports = router;
