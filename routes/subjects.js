const express = require("express");
const { listSubjects, createSubject, deleteSubject } = require("../controllers/subjectsController");
const { verifyToken } = require("../middleware/auth");

const router = express.Router();

router.get("/", verifyToken, listSubjects);
router.post("/", verifyToken, createSubject);
router.delete("/:id", verifyToken, deleteSubject);

module.exports = router;
