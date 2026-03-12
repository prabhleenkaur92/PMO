const express = require('express');
const reportsController = require('../controllers/reportsController');

const router = express.Router();

// Get dashboard stats by role
router.get('/dashboard/:role', reportsController.getDashboardStats);

// Generate report
router.get('/generate', reportsController.generateReport);

// Export report
router.get('/export', reportsController.exportReport);

module.exports = router;
