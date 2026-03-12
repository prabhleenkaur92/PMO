const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const sprintController = require('../controllers/sprintController');

// Sprint CRUD
router.post('/', auth, sprintController.createSprint);
router.get('/', auth, sprintController.getSprints);
router.get('/:id', auth, sprintController.getSprint);
router.put('/:id', auth, sprintController.updateSprint);
router.delete('/:id', auth, sprintController.deleteSprint);

// Sprint actions
router.post('/:id/start', auth, sprintController.startSprint);
router.post('/:id/complete', auth, sprintController.completeSprint);
router.get('/:id/report', auth, sprintController.getSprintReport);

module.exports = router;
