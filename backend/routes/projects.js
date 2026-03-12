const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { requireRoles } = require('../middleware/permissions');
const { remarkUpload } = require('../middleware/fileUpload');
const { 
  createProject, 
  getNextWorkorderNumber,
  getProjects, 
  getProjectById, 
  updateProjectStatus,
  assignProject,
  updateManagerStatus,
  updateProject,
  addRemark,
  updateRemark,
  deleteRemark,
  deleteProject
} = require('../controllers/projectController');

router.post('/', authMiddleware, requireRoles('finance', 'admin'), createProject);
router.get('/', authMiddleware, requireRoles('finance', 'admin', 'pmo', 'manager', 'auditor'), getProjects);
router.get('/next-workorder-number', authMiddleware, requireRoles('finance', 'admin'), getNextWorkorderNumber);
router.get('/:id', authMiddleware, requireRoles('finance', 'admin', 'pmo', 'manager', 'auditor'), getProjectById);
router.post('/:id/remarks', authMiddleware, requireRoles('finance', 'admin', 'pmo', 'manager', 'auditor'), remarkUpload.array('files', 5), addRemark);
router.patch('/:id', authMiddleware, requireRoles('finance', 'admin'), updateProject);
router.patch('/:id/status', authMiddleware, requireRoles('pmo', 'manager', 'admin'), updateProjectStatus);
router.patch('/:id/assign', authMiddleware, requireRoles('manager', 'admin'), assignProject);
router.patch('/:id/manager-status', authMiddleware, requireRoles('manager', 'admin'), updateManagerStatus);
router.patch('/:id/remarks/:remarkId', authMiddleware, requireRoles('finance', 'admin', 'pmo', 'manager', 'auditor'), updateRemark);
router.delete('/:id/remarks/:remarkId', authMiddleware, requireRoles('finance', 'admin', 'pmo', 'manager', 'auditor'), deleteRemark);
router.delete('/:id', authMiddleware, requireRoles('admin'), deleteProject);

module.exports = router;
