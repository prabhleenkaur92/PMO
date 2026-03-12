const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const labelController = require('../controllers/labelController');

// Label CRUD
router.post('/', auth, labelController.createLabel);
router.get('/', auth, labelController.getLabels);
router.get('/:id', auth, labelController.getLabel);
router.put('/:id', auth, labelController.updateLabel);
router.delete('/:id', auth, labelController.deleteLabel);

module.exports = router;
