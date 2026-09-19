const mongoose = require("mongoose");

const uploadedFileSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true, default: null },
    email: { type: String, default: "", trim: true, lowercase: true },
    field: { type: String, default: "general", index: true },
    originalName: { type: String, required: true },
    storedName: { type: String, default: "" },
    bucket: { type: String, default: "" },
    key: { type: String, required: true, unique: true },
    url: { type: String, default: "" },
    publicUrl: { type: String, default: "" },
    contentType: { type: String, default: "" },
    size: { type: Number, default: 0 },
    uploadedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

uploadedFileSchema.index({ userId: 1, uploadedAt: -1 });

module.exports = mongoose.model("UploadedFile", uploadedFileSchema);
