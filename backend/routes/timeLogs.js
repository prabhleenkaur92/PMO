const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const timeTrackingController = require('../controllers/timeTrackingController');

// Time Tracking
router.post('/', auth, timeTrackingController.logTime);
router.get('/', auth, timeTrackingController.getTimeLogs);
router.put('/:id', auth, timeTrackingController.updateTimeLog);
router.delete('/:id', auth, timeTrackingController.deleteTimeLog);
router.get('/summary', auth, timeTrackingController.getTimeSummary);

module.exports = router;
