const express = require('express');
const router = express.Router();
const teamController = require('../controllers/teamController');
const { verifyToken } = require('../middleware/auth');

router.post('/members/bulk', verifyToken, teamController.bulkSaveMembers);
router.get('/members', verifyToken, teamController.getMembers);
router.delete('/members/:id', verifyToken, teamController.deleteMember);

router.post('/generate-schedule', verifyToken, teamController.generateTeamSchedule);
router.post('/schedule/save', verifyToken, teamController.saveTeamSchedule);
router.get('/schedule', verifyToken, teamController.getTeamSchedule);

module.exports = router;
