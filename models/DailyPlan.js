const mongoose = require("mongoose");

const subTaskDoneSchema = new mongoose.Schema(
  {
    rowIndex: { type: Number, required: true },
    subIndex: { type: Number, required: true },  // 0-based index within the ▶ bullets of that row
  },
  { _id: false }
);

const dailyPlanSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  dayId:     { type: String, required: true },  // e.g. "Week 3 - Wednesday"
  week:      { type: Number, required: true },
  dayName:   { type: String, required: true },  // "Monday" .. "Friday"
  date:      { type: String },                  // YYYY-MM-DD
  locked:    { type: Boolean, default: false },
  completed: { type: Boolean, default: false },
  rows:      { type: Array, default: [] },    
  doneRows:  { type: [Number], default: [] },   // row indices marked done via checkbox  // schedule rows for this day
     subTaskDoneRows: { type: [subTaskDoneSchema], default: [] },
  notes:     { type: String, default: "" },
}, { timestamps: true });

dailyPlanSchema.index({ userId: 1, dayId: 1 }, { unique: true });
dailyPlanSchema.index({ userId: 1, week: 1 });

module.exports = mongoose.model("DailyPlan", dailyPlanSchema);
