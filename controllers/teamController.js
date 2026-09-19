const ProblemStatement = require('../models/Problemstatement');
const TeamMember = require('../models/TeamMember');
const { generateTeamSchedule, generateTeamScheduleFromRows, skillTagFor } = require('../services/teamScheduleEngine');
const { generateDailyScheduleForStatement } = require('../utils/ensureDailySchedule');

async function loadOwnedStatement(problemStatementId, userId) {
  if (!problemStatementId) return null;
  return ProblemStatement.findOne({ _id: problemStatementId, userId });
}

// POST /api/team/members/bulk  { problemStatementId, teamName, members: [{name, skillLevel, rollNumber, email, targetRole, college}] }
exports.bulkSaveMembers = async (req, res) => {
  try {
    const { problemStatementId, teamName, members } = req.body;

    if (!problemStatementId || !teamName || !String(teamName).trim()) {
      return res.status(400).json({ success: false, error: 'problemStatementId and teamName are required' });
    }
    if (!Array.isArray(members) || members.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one team member is required' });
    }

    const statement = await loadOwnedStatement(problemStatementId, req.user.id);
    if (!statement) {
      return res.status(404).json({ success: false, error: 'Problem statement not found' });
    }

    const cleanMembers = members.filter(m => m && m.name && m.name.trim());
    if (!cleanMembers.length) {
      return res.status(400).json({ success: false, error: 'At least one member with a name is required' });
    }

    await TeamMember.deleteMany({ problemStatementId, teamName });

    const docs = await TeamMember.insertMany(
      cleanMembers.map(m => ({
        problemStatementId,
        teamName: teamName.trim(),
        name: m.name.trim(),
        rollNumber: m.rollNumber || '',
        email: m.email || '',
        targetRole: m.targetRole || '',
        targetCompany: m.targetCompany || '',
        college: m.college || '',
        skillLevel: m.skillLevel || 3,
        skillTag: skillTagFor(m.skillLevel),
        leetcodeUsername: m.leetcodeUsername || '',
      }))
    );

    return res.json({ success: true, data: docs });
  } catch (error) {
    console.error('bulkSaveMembers error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to save team members' });
  }
};

// GET /api/team/members?problemStatementId=&teamName=
exports.getMembers = async (req, res) => {
  try {
    const { problemStatementId, teamName } = req.query;
    if (!problemStatementId || !teamName) {
      return res.status(400).json({ success: false, error: 'problemStatementId and teamName are required' });
    }

    const members = await TeamMember.find({ problemStatementId, teamName }).sort({ createdAt: 1 });
    return res.json({ success: true, data: members });
  } catch (error) {
    console.error('getMembers error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to fetch team members' });
  }
};

// DELETE /api/team/members/:id
exports.deleteMember = async (req, res) => {
  try {
    const result = await TeamMember.findByIdAndDelete(req.params.id);
    if (!result) {
      return res.status(404).json({ success: false, error: 'Team member not found' });
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('deleteMember error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to delete team member' });
  }
};

// POST /api/team/generate-schedule
// Accepts optional `dailyRows` payload (the main plan's rich rows) to use
// the rows-based path that clones real rich schedule content per member.
// Falls back to the schedule-based path when no dailyRows are provided.
exports.generateTeamSchedule = async (req, res) => {
  try {
    const { problemStatementId, teamName, days, dailyRows, activeDTStage, _activeDTStage } = req.body;

    if (!problemStatementId || !teamName || !String(teamName).trim()) {
      return res.status(400).json({ success: false, error: 'problemStatementId and teamName are required' });
    }

    const statement = await loadOwnedStatement(problemStatementId, req.user.id);
    if (!statement) {
      return res.status(404).json({ success: false, error: 'Problem statement not found' });
    }

    const members = await TeamMember.find({ problemStatementId, teamName: teamName.trim() }).sort({ createdAt: 1 });
    if (!members.length) {
      return res.status(400).json({
        success: false,
        error: 'No team members saved for this team yet. Add members first.',
      });
    }

    let teamResult;

    // ── PATH 1: rows-based (preferred) ─────────────────────────────────────
    if (Array.isArray(dailyRows) && dailyRows.length > 0) {
      const requestedDays = Number(days);
      const rowsToUse = (Number.isFinite(requestedDays) && requestedDays > 0)
        ? (() => {
            // Count unique dayIds in order and slice to requestedDays
            const seen = new Set();
            const sliced = [];
            for (const row of dailyRows) {
              const dayId = Array.isArray(row) ? row[0] : null;
              if (dayId && !seen.has(dayId)) {
                seen.add(dayId);
                if (seen.size > requestedDays) break;
              }
              if (!seen.size) continue;
              sliced.push(row);
            }
            return sliced;
          })()
        : dailyRows;

      const { attachSolvedLeetCode } = require("../utils/leetcodeSolved");
      const teamInputs = {
        _teamMembers: JSON.stringify(members.map((m) => ({
          name: m.name,
          skillLevel: m.skillLevel,
          leetcodeUsername: m.leetcodeUsername,
          collegeYear: m.collegeYear,
          semester: m.semester,
          schoolGrade: m.schoolGrade,
          college: m.college,
          department: m.department,
        }))),
      };
      await attachSolvedLeetCode(teamInputs).catch(() => null);

      teamResult = generateTeamScheduleFromRows(rowsToUse, members, {
        activeDTStage: activeDTStage || _activeDTStage || "empathize",
        inputs: teamInputs,
      });
    } else {
      // ── PATH 2: schedule-based (fallback) ────────────────────────────────
      if (!Array.isArray(statement.dailySchedule) || statement.dailySchedule.length === 0) {
        try {
          statement.dailySchedule = await generateDailyScheduleForStatement(statement);
        } catch (genErr) {
          console.error('auto dailySchedule generation failed:', genErr.message);
          return res.status(400).json({
            success: false,
            error: 'This problem statement has no dailySchedule yet, and auto-generating one failed: ' + genErr.message,
          });
        }
      }

      const requestedDays  = Number(days);
      const sourceSchedule = statement.dailySchedule;
      const scheduleSlice  = (Number.isFinite(requestedDays) && requestedDays > 0)
        ? sourceSchedule.slice(0, requestedDays)
        : sourceSchedule;

      if (Number.isFinite(requestedDays) && requestedDays > 0 && requestedDays > sourceSchedule.length) {
        return res.status(400).json({
          success: false,
          error: `You asked for ${requestedDays} days, but the linked problem statement only has ${sourceSchedule.length} day(s) of plan generated.`,
        });
      }

      // Attach statement-level tech / breakdown hints so PATH 2 rows stay clear for beginners
      const statementStack = statement.problemBreakdown?.technical?.recommendedStack || null;
      const enrichedSlice = scheduleSlice.map((d) => ({
        ...d,
        techStack: d.techStack || d.techStackToday || statementStack || statement.aiDetails || null,
        problemBreakdown: d.problemBreakdown || statement.problemBreakdown || null,
      }));

      teamResult = generateTeamSchedule(enrichedSlice, members);
    }

    // Persist to statement
    const teamAssignments = statement.teamAssignments || {};
    teamAssignments[teamName.trim()] = {
      generatedAt:         new Date(),
      requestedDays:       Number(days) || teamResult.schedule.length,
      sourceScheduleLength: Array.isArray(statement.dailySchedule) ? statement.dailySchedule.length : 0,
      usedRowsPath:        Array.isArray(dailyRows) && dailyRows.length > 0,
      members:             teamResult.members,
      schedule:            teamResult.schedule,
    };
    statement.teamAssignments = teamAssignments;
    statement.markModified('teamAssignments');
    statement.markModified('dailySchedule');
    await statement.save();

    return res.json({ success: true, data: teamAssignments[teamName.trim()] });
  } catch (error) {
    console.error('generateTeamSchedule error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to generate team schedules' });
  }
};

exports.saveTeamSchedule = async (req, res) => {
  try {
    const { problemStatementId, teamName, schedule, members } = req.body || {};
    if (!problemStatementId || !teamName) {
      return res.status(400).json({ success: false, error: "problemStatementId and teamName are required" });
    }
    const statement = await loadOwnedStatement(problemStatementId, req.user.id);
    if (!statement) {
      return res.status(404).json({ success: false, error: "Problem statement not found" });
    }
    const teamAssignments = statement.teamAssignments || {};
    const prev = teamAssignments[String(teamName).trim()] || {};
    teamAssignments[String(teamName).trim()] = {
      ...prev,
      generatedAt: prev.generatedAt || new Date(),
      editedAt: new Date(),
      members: Array.isArray(members) ? members : prev.members,
      schedule: Array.isArray(schedule) ? schedule : prev.schedule,
    };
    statement.teamAssignments = teamAssignments;
    statement.markModified("teamAssignments");
    await statement.save();
    return res.json({ success: true, data: teamAssignments[String(teamName).trim()] });
  } catch (error) {
    console.error("saveTeamSchedule error:", error);
    return res.status(500).json({ success: false, error: error.message || "Failed to save team schedule" });
  }
};

// GET /api/team/schedule?problemStatementId=&teamName=
exports.getTeamSchedule = async (req, res) => {
  try {
    const { problemStatementId, teamName } = req.query;
    if (!problemStatementId || !teamName) {
      return res.status(400).json({ success: false, error: 'problemStatementId and teamName are required' });
    }

    const statement = await loadOwnedStatement(problemStatementId, req.user.id);
    if (!statement) {
      return res.status(404).json({ success: false, error: 'Problem statement not found' });
    }

    const data = (statement.teamAssignments || {})[teamName.trim()] || null;
    return res.json({ success: true, data });
  } catch (error) {
    console.error('getTeamSchedule error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to fetch team schedule' });
  }
};