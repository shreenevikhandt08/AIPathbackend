const mongoose = require('mongoose');

const teamMemberSchema = new mongoose.Schema({
  problemStatementId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ProblemStatement',
    required: true,
  },
  teamName: {
    type: String,
    required: true,
    trim: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  rollNumber: { type: String, trim: true },
  email:      { type: String, trim: true },
  targetRole: { type: String, trim: true },
  // The company/companies this member wants to work at eventually — used to
  // weave placement-prep tasks (mock interviews, company research, networking,
  // assessments) into their daily schedule alongside the project work.
  targetCompany: { type: String, trim: true },
  college:    { type: String, trim: true },
  // Academic level — campus dropdown; college year/sem OR school grade (SNS Academy)
  collegeYear: {
    type: Number,
    min: 1,
    max: 4,
    default: 2,
  },
  semester: {
    type: Number,
    min: 1,
    max: 8,
    default: 3,
  },
  schoolGrade: {
    type: Number,
    min: 1,
    max: 12,
    default: null,
  },
  department: { type: String, trim: true },
  skillLevel: {
    type: Number,
    min: 1,
    max: 5,
    default: 3,
  },
  // Denormalized label ("Beginner".."Expert") so the frontend never has to
  // re-derive it — kept in sync with skillLevel on every save.
  skillTag: {
    type: String,
    default: 'Intermediate',
  },
  leetcodeUsername: { type: String, trim: true, default: '' },
}, { timestamps: true });

teamMemberSchema.index({ problemStatementId: 1, teamName: 1 });

module.exports = mongoose.model('TeamMember', teamMemberSchema);
