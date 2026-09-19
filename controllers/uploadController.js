const UploadedFile = require("../models/UploadedFile");
const PlannerInput = require("../models/PlannerInput");
const { signedUrlForKey } = require("../utils/s3Storage");

async function listMyUploads(req, res) {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Log in to see your files" });
    }
    const rows = await UploadedFile.find({ userId }).sort({ uploadedAt: -1 }).limit(200).lean();
    const files = await Promise.all(
      rows.map(async (row) => {
        let url = row.url || row.publicUrl || "";
        try {
          if (row.key) url = (await signedUrlForKey(row.key)) || url;
        } catch (_) {}
        return { ...row, url };
      })
    );
    return res.json({ success: true, files });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function mergePlannerFileMeta(userId, storedByField) {
  if (!userId || !storedByField || !Object.keys(storedByField).length) return;
  const doc = await PlannerInput.findOne({ userId }).lean();
  const prev = (doc && doc.uploadedFiles) || {};
  const next = { ...prev };
  for (const [field, items] of Object.entries(storedByField)) {
    const existing = Array.isArray(next[field]) ? next[field] : [];
    next[field] = [...existing, ...items];
  }
  await PlannerInput.findOneAndUpdate(
    { userId },
    { $set: { userId, uploadedFiles: next } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

module.exports = { listMyUploads, mergePlannerFileMeta };
