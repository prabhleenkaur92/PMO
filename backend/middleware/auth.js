const jwt = require('jsonwebtoken');
const pool = require('../db/connection');

const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'No authorization token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Fetch fresh user data from database
    const result = await pool.query(
      'SELECT id, username, email, role, is_active FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0 || !result.rows[0].is_active) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    const dbUser = result.rows[0];
    req.user = {
      ...dbUser,
      role: String(dbUser.role || '').toLowerCase()
    };
    req.token = token;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
};

module.exports = authMiddleware;
