const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { backupUpload } = require('../middleware/fileUpload');
const {
  getAuditLogs,
  getAccessLogs,
  clearAuditLogs,
  clearAccessLogs,
  exportAuditLogs,
  exportAccessLogs,
  exportSystemBackup,
  importSystemBackup
} = require('../controllers/auditController');

router.get('/logs/audit', authMiddleware, getAuditLogs);
router.get('/logs/access', authMiddleware, getAccessLogs);
router.get('/logs/audit/export', authMiddleware, exportAuditLogs);
router.get('/logs/access/export', authMiddleware, exportAccessLogs);
router.get('/backup/export', authMiddleware, exportSystemBackup);
router.post('/backup/import', authMiddleware, backupUpload.single('file'), importSystemBackup);
router.delete('/logs/audit', authMiddleware, clearAuditLogs);
router.delete('/logs/access', authMiddleware, clearAccessLogs);

module.exports = router;
