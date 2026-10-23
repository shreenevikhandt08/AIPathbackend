const mongoose = require("mongoose");

const problemStatementSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true },
    clubs: [
      {
        name: String,
        type: { type: String, enum: ["technical", "non-technical"] },
      },
    ],
    pillars: [String],
    description: { type: String, required: true },
    /** Normalized fingerprint. NOT unique: several users may plan the same problem; the UI reminds them who already has it. */
    fingerprint: { type: String, trim: true, default: "", index: true },
    objectives: [String],
    deliverables: [String],
    weeklyDeliverables: { type: mongoose.Schema.Types.Mixed, default: {} },
    timeline: String,
    teamSize: String,
    difficulty: { type: String, enum: ["beginner", "intermediate", "advanced"] },
    dtPhases: [String],
    aiIntegration: { type: Boolean, default: true },
    aiDetails: String,
    tags: [String],

    // Origin card / provenance (YC, Unicorn, etc.)
    sourceKind: { type: String, trim: true, default: "" },
    sourceLabel: { type: String, trim: true, default: "" },
    company: { type: String, trim: true, default: "" },
    year: { type: String, trim: true, default: "" },
    batch: { type: String, trim: true, default: "" },
    workingOn: { type: String, trim: true, default: "" },
    sourceUrl: { type: String, trim: true, default: "" },

    problemBreakdown: { type: mongoose.Schema.Types.Mixed, default: null },
    dailySchedule: [{ type: mongoose.Schema.Types.Mixed }],
    teamAssignments: { type: mongoose.Schema.Types.Mixed, default: {} },

    learningPrerequisites: [
      {
        topic: String,
        lectureNotes: String,
        resources: [String],
      },
    ],

    systemDesignPhase: {
      isRequired: { type: Boolean, default: false },
      description: String,
      estimatedHours: Number,
    },

    codingPlatforms: [
      {
        platform: {
          type: String,
          enum: ["LeetCode", "HackerRank", "Exercism", "CodeChef", "GeeksForGeeks"],
        },
        problemNumber: String,
        difficulty: { type: String, enum: ["Easy", "Medium", "Hard"] },
        topicsCovered: [String],
        relevance: String,
      },
    ],

    courseModules: [
      {
        moduleName: String,
        concepts: [String],
        readinessLevel: {
          type: String,
          enum: ["Before Start", "By Week 2", "Throughout"],
        },
      },
    ],
  },
  { timestamps: true }
);

problemStatementSchema.index({ userId: 1, title: 1 });

// Non-unique lookup index (the old unique index "uniq_statement_fingerprint" is dropped in config/db.js)
problemStatementSchema.index({ fingerprint: 1 }, { name: "statement_fingerprint_lookup" });

module.exports = mongoose.model("ProblemStatement", problemStatementSchema);
