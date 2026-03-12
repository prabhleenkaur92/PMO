const express = require('express');
const documentController = require('../controllers/documentController');

const router = express.Router();

// Upload document
router.post('/upload', documentController.upload.single('file'), documentController.uploadDocument);

// Get attachments for entity
router.get('/:entityId/attachments', documentController.getAttachments);

// Get specific attachment
router.get('/:id', documentController.getAttachment);

// Download attachment
router.get('/:id/download', documentController.downloadAttachment);

// Get document versions
router.get('/:documentId/versions', documentController.getVersions);

// Restore version
router.post('/:versionId/restore', documentController.restoreVersion);

// Delete version
router.delete('/:versionId', documentController.deleteVersion);

module.exports = router;
