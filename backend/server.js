require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const db = require('./db/connection');
const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const userRoutes = require('./routes/users');
const rolesRoutes = require('./routes/roles');
const auditRoutes = require('./routes/audit');
const notificationRoutes = require('./routes/notifications');
const chatRoutes = require('./routes/chat');
const orderRoutes = require('./routes/orders');
const authMiddleware = require('./middleware/auth');
const accessLogger = require('./middleware/accessLogger');
const path = require('path');

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true
}));

// Rate limiting (relaxed for development)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000
});
app.use(limiter);

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(accessLogger);
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Public routes
app.use('/api/auth', authRoutes);
app.use('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Protected routes
app.use('/api/projects', authMiddleware, projectRoutes);
app.use('/api/users', authMiddleware, userRoutes);
app.use('/api/roles', authMiddleware, rolesRoutes);
app.use('/api/audit', authMiddleware, auditRoutes);
app.use('/api/notifications', authMiddleware, notificationRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/orders', authMiddleware, orderRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 5000;

// Initialize database and start server
db.query('SELECT NOW()', (err, result) => {
  if (err) {
    console.error('Database connection failed:', err);
    process.exit(1);
  }
  
  console.log('Database connected:', result.rows[0]);
  
  app.listen(PORT, () => {
    console.log(`PMO Portal API listening on port ${PORT}`);
  });
});

module.exports = app;
