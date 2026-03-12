const express = require('express');
const searchController = require('../controllers/searchController');

const router = express.Router();

// Search across projects, issues, and users
router.get('/', searchController.search);

// Save filter
router.post('/filters', searchController.saveFilter);

// Get saved filters for user
router.get('/filters', searchController.getSavedFilters);

// Delete saved filter
router.delete('/filters/:filterId', searchController.deleteFilter);

module.exports = router;
