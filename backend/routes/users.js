const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const {
  getAllUsers,
  getUsersByRole,
  getUserById,
  updateUser,
  changeUserRole,
  deactivateUser,
  activateUser,
  createUser,
  changePassword,
  deleteUser
} = require('../controllers/userController');

router.get('/', authMiddleware, getAllUsers);
router.post('/', authMiddleware, createUser);
router.get('/role/:role', authMiddleware, getUsersByRole);
router.get('/:id', authMiddleware, getUserById);
router.patch('/:id', authMiddleware, updateUser);
router.patch('/:id/role', authMiddleware, changeUserRole);
router.patch('/:id/password', authMiddleware, changePassword);
router.patch('/:id/deactivate', authMiddleware, deactivateUser);
router.patch('/:id/activate', authMiddleware, activateUser);
router.delete('/:id', authMiddleware, deleteUser);

module.exports = router;
