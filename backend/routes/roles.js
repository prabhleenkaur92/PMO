const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const {
  getAllRoles,
  getRolePermissions,
  grantPermission,
  revokePermission,
  getMyFieldVisibility,
  getFieldVisibilityMatrix,
  updateFieldVisibility
} = require('../controllers/roleController');

router.get('/', authMiddleware, getAllRoles);
router.get('/field-visibility/me', authMiddleware, getMyFieldVisibility);
router.get('/field-visibility', authMiddleware, getFieldVisibilityMatrix);
router.patch('/field-visibility', authMiddleware, updateFieldVisibility);
router.get('/:roleId/permissions', authMiddleware, getRolePermissions);
router.post('/:roleId/permissions', authMiddleware, grantPermission);
router.delete('/:roleId/permissions/:permissionId', authMiddleware, revokePermission);

module.exports = router;
