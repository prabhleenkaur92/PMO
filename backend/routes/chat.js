const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { chatUpload } = require('../middleware/fileUpload');
const {
  getContacts,
  getOnlineUsers,
  getMessages,
  sendMessage,
  sendTyping,
  getUnreadCounts,
  stream
} = require('../controllers/chatController');

router.get('/stream', stream);
router.get('/contacts', authMiddleware, getContacts);
router.get('/online-users', authMiddleware, getOnlineUsers);
router.get('/unread-counts', authMiddleware, getUnreadCounts);
router.get('/messages/:userId', authMiddleware, getMessages);
router.post('/messages', authMiddleware, chatUpload.single('attachment'), sendMessage);
router.post('/typing', authMiddleware, sendTyping);

module.exports = router;
