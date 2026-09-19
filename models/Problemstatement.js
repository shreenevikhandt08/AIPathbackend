const mongoose = require("mongoose");

const problemStatementSchema = new mongoose.Schema({
  userId:             { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  title:              { type: String, required: true },
  clubs:              [{ name: String, type: { type: String, enum: ["technical","non-technical"] } }],
  pillars:            [String],       // selected pillars from multi-select
  description:        { type: String, required: true },
  objectives:         [String],
  deliverables:       [String],       // flat list (fallback)
  weeklyDeliverables: { type: mongoose.Schema.Types.Mixed, default: {} }, // { "Week 1": [...], ... }
  timeline:           String,         // e.g. "4 weeks" or "4w + 8w"
  teamSize:           String,
  difficulty:         { type: String, enum: ["beginner","intermediate","advanced"] },
  dtPhases:           [String],       // selected DT playbook phase ids
  aiIntegration:      { type: Boolean, default: true },  // GenAI integration flag
  aiDetails:          String,         // how AI is used
  tags:               [String],

  // Full problem breakdown (empathy / research / technical / guide) — statement level
  problemBreakdown:   { type: mongoose.Schema.Types.Mixed, default: null },
  
  // DAY-BY-DAY SCHEDULE
  dailySchedule: [{ type: mongoose.Schema.Types.Mixed }],

  // PER-TEAM TASK DIVISION
  // Keyed by teamName → { generatedAt, members, schedule }.
  // Lets multiple real teams share the same problem statement's master
  // dailySchedule while each gets its own member-wise task breakdown,
  // so every team member stays in sync on the same day-by-day tasks.
  teamAssignments: { type: mongoose.Schema.Types.Mixed, default: {} },

  // LEARNING CONNECTIVITY - Links problem to actual course learning
  learningPrerequisites: [
    {
      topic:          String,  // e.g. "Data Structures", "API Design"
      lectureNotes:   String,  // link or reference to lecture notes
      resources:      [String], // external resource links
    }
  ],
  
  // SYSTEM DESIGN - Checkpoint before implementation
  systemDesignPhase: {
    isRequired:     { type: Boolean, default: false },
    description:    String,  // design approach description
    estimatedHours: Number,  // hours needed for design phase
  },
  
  // CODING PRACTICE PLATFORM MAPPING
  codingPlatforms: [
    {
      platform:       { type: String, enum: ["LeetCode", "HackerRank", "Exercism", "CodeChef", "GeeksForGeeks"] },
      problemNumber:  String,  // e.g. "LC-1234" or "HR-arrays-easy"
      difficulty:     { type: String, enum: ["Easy", "Medium", "Hard"] },
      topicsCovered:  [String], // ["Arrays", "Dynamic Programming"]
      relevance:      String,  // How it connects to the project
    }
  ],
  
  // MODULE PREREQUISITES - Explicitly connect to course modules
  courseModules: [
    {
      moduleName:     String,  // e.g. "Week 2 - Advanced OOP"
      concepts:       [String], // concepts from that module needed
      readinessLevel: { type: String, enum: ["Before Start", "By Week 2", "Throughout"] },
    }
  ],
}, { timestamps: true });

problemStatementSchema.index({ userId: 1, title: 1 });

module.exports = mongoose.model("ProblemStatement", problemStatementSchema);