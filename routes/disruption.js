const express = require("express");
const { applyDisruption, getByDate, getAllDisruptions, deleteDisruption, undoDisruption, clearDate } = require("../controllers/disruptionController");
const { verifyToken } = require("../middleware/auth");
const router = express.Router();
const { applySwap, undoSwap, getSwapsByDay } = require("../controllers/disruptionController");

router.post("/swap", verifyToken, applySwap);
router.post("/undo-swap", verifyToken, undoSwap);
router.get("/swaps/:dayKey", verifyToken, getSwapsByDay)
router.post("/apply", verifyToken, applyDisruption);
router.get("/date/:date", verifyToken, getByDate);
router.get("/all", verifyToken, getAllDisruptions);
router.delete("/:id", verifyToken, deleteDisruption);
router.post("/undo", verifyToken, undoDisruption);
router.delete("/clear-date/:date", verifyToken, clearDate);

module.exports = router;
