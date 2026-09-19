const express = require("express");
const { getCampusSyllabus } = require("../controllers/campusSyllabusController");

const router = express.Router();

router.get("/", getCampusSyllabus);
router.post("/", getCampusSyllabus);

module.exports = router;
