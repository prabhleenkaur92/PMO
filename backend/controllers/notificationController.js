const pool = require('../db/connection');
const notifications = require('../utils/notifications');

const getUnreadCount = async (req, res) => {
  try {
    const count = await notifications.safeGetUnreadCount(req.user.id);
    res.json({ unreadCount: parseInt(count || 0) });
  } catch (error) {
    console.error('Error fetching unread count:', error);
    res.status(500).json({ error: error.message });
  }
};

const getNotifications = async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    const rows = await notifications.safeGetNotifications(req.user.id, Number(limit), Number(offset));
    res.json(rows || []);
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: error.message });
  }
};

const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const ok = await notifications.safeMarkAsRead(id, req.user.id);
    if (!ok) return res.status(500).json({ error: 'Failed to mark notification as read' });
    res.json({ message: 'Notification marked as read' });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ error: error.message });
  }
};

const markAllAsRead = async (req, res) => {
  try {
    const ok = await notifications.safeMarkAllAsRead(req.user.id);
    if (!ok) return res.status(500).json({ error: 'Failed to mark notifications as read' });
    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    console.error('Error marking notifications as read:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getUnreadCount,
  getNotifications,
  markAsRead,
  markAllAsRead
};
