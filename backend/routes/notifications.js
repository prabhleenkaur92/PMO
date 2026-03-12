const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { getUnreadCount, getNotifications, markAsRead, markAllAsRead } = require('../controllers/notificationController');

router.get('/unread-count', authMiddleware, getUnreadCount);
router.get('/', authMiddleware, getNotifications);
router.patch('/:id/read', authMiddleware, markAsRead);
router.patch('/read-all', authMiddleware, markAllAsRead);

module.exports = router;
