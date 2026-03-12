const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { requireRoles } = require('../middleware/permissions');
const {
  getOrders,
  createOrder,
  updateOrder,
  deleteOrder,
  markMilestoneCompleted,
  assignSubprojectManager
} = require('../controllers/orderController');

router.get('/', authMiddleware, requireRoles('finance', 'admin', 'pmo', 'manager'), getOrders);
router.post('/', authMiddleware, requireRoles('finance', 'admin'), createOrder);
router.patch('/:id', authMiddleware, requireRoles('finance', 'admin'), updateOrder);
router.delete('/:id', authMiddleware, requireRoles('admin'), deleteOrder);
router.patch('/:orderId/milestones/:scheduleId/complete', authMiddleware, requireRoles('finance', 'admin'), markMilestoneCompleted);
router.patch('/:orderId/subprojects/:subprojectId/assign-manager', authMiddleware, requireRoles('pmo', 'admin'), assignSubprojectManager);

module.exports = router;
