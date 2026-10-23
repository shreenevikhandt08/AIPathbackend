const mongoose = require("mongoose");

mongoose.connection.on("disconnected", () => {
  console.warn("MongoDB disconnected — mongoose will retry; health stays 200");
});

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 15001,
    });
    console.log("✅ MongoDB connected");
    // Duplicate problem statements are allowed now (UI shows who already has one).
    // Drop the legacy unique index if it still exists.
    try {
      await mongoose.connection.collection("problemstatements").dropIndex("uniq_statement_fingerprint");
      console.log("🗂  Dropped legacy unique index uniq_statement_fingerprint");
    } catch (e) {
      if (!/index not found|ns not found/i.test(String(e.message))) {
        console.warn("Index cleanup skipped:", e.message);
      }
    }
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err.message);
    console.error(
      "   → Fix: MongoDB Atlas → Network Access → Add your current IP (or 0.0.0.0/0 for dev).\n" +
        "   → Also check MONGO_URI in backend/.env and that the cluster is not paused."
    );
    if (process.env.NODE_ENV === "production") {
      console.error("Retrying MongoDB in 5s (process stays up for ALB health)");
      setTimeout(() => connectDB(), 5000);
      return;
    }
    process.exit(1);
  }
}

module.exports = connectDB;
