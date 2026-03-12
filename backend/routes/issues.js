const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const issueController = require('../controllers/issueController');

// Issue CRUD
router.post('/', auth, issueController.createIssue);
router.get('/', auth, issueController.getIssues);
router.get('/:id', auth, issueController.getIssue);
router.put('/:id', auth, issueController.updateIssue);
router.delete('/:id', auth, issueController.deleteIssue);

// Comments
router.post('/:id/comments', auth, issueController.addComment);
router.get('/:id/comments', auth, issueController.getComments);

// Watchers
router.post('/:id/watchers', auth, issueController.toggleWatcher);

module.exports = router;
