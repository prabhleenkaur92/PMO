const { body } = require('express-validator');
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { register, login, logout, getCurrentUser } = require('../controllers/authController');

// Validation middleware
const registerValidation = [
  body('username').isLength({ min: 3 }).withMessage('Username must be at least 3 characters'),
  body('email').isEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('firstName').notEmpty().withMessage('First name required'),
  body('lastName').notEmpty().withMessage('Last name required')
];

// Public routes
router.post('/register', registerValidation, register);
router.post('/login', login);

// Protected routes
router.post('/logout', authMiddleware, logout);
router.get('/me', authMiddleware, getCurrentUser);

module.exports = router;
