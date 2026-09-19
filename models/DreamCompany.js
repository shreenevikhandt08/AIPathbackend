const mongoose = require("mongoose");

const dreamCompanySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    normalizedName: { type: String, required: true, unique: true, index: true },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    addedByName: { type: String, default: "" },
    useCount: { type: Number, default: 1 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("DreamCompany", dreamCompanySchema);
