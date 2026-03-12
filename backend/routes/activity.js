const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const activityController = require('../controllers/activityController');

// Activity Feed
router.get('/', auth, activityController.getActivityFeed);
router.get('/recent', auth, activityController.getRecentActivities);
router.get('/user/:user_id', auth, activityController.getUserActivityTimeline);

module.exports = router;
