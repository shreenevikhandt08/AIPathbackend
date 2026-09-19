// controllers/subjectsController.js
const express = require("express");
const Subject = require("../models/Subject");
const { verifyToken } = require("../middleware/auth");

async function listSubjects(req, res) {
  try {
    const subjects = await Subject.find({ userId: req.user.id }).sort({ createdAt: 1 });
    res.json({ success: true, subjects });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// POST /
async function createSubject(req, res) {
  try {
    const { name, syllabusText } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, error: "name is required" });

    const subject = await Subject.findOneAndUpdate(
      { userId: req.user.id, name: name.trim() },
      { $set: { syllabusText: syllabusText || "", source: "manual" } },
      { upsert: true, new: true }
    );
    res.json({ success: true, subject });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// DELETE /:id
async function deleteSubject(req, res) {
  try {
    const deleted = await Subject.findOneAndDelete({ userId: req.user.id, _id: req.params.id });
    if (!deleted) return res.status(404).json({ success: false, error: "Subject not found" });
    res.json({ success: true, message: `Subject "${deleted.name}" removed` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}


module.exports = { listSubjects, createSubject, deleteSubject };
