const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  okrionUserId: { type: Number, unique: true, sparse: true, index: true },
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: {
    type: String,
    required() {
      return this.source !== "okrion_sso";
    },
  },
  role: {
    type: String,
    enum: ["admin", "faculty", "student", "local"],
    default: "local",
    index: true,
  },
  branchId: { type: Number, default: null },
  department: { type: String, default: "", trim: true },
  registerNumber: { type: String, default: "", trim: true },
  institutionName: { type: String, default: "", trim: true },
  phone: { type: String, default: "", trim: true },
  source: {
    type: String,
    enum: ["local", "okrion_sso"],
    default: "local",
    index: true,
  },
  lastLoginAt: { type: Date, default: null },
  resetCodeHash: { type: String, default: "" },
  resetCodeExpires: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);
