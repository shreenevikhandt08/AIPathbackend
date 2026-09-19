// routes/blueprint.js
const express = require("express");
const { listBlueprints, getActiveBlueprint, createBlueprint, activateBlueprint, deactivateBlueprint, deleteBlueprint } = require("../controllers/blueprintController");
const { verifyToken } = require("../middleware/auth");

const router = express.Router();

router.get("/", verifyToken, listBlueprints);
router.get("/active", verifyToken, getActiveBlueprint);
router.post("/", verifyToken, createBlueprint);
router.post("/activate/:versionNum", verifyToken, activateBlueprint);
router.post("/deactivate/:versionNum", verifyToken, deactivateBlueprint);
router.delete("/:versionNum", verifyToken, deleteBlueprint);

module.exports = router;
