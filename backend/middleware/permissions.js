const pool = require('../db/connection');

const checkPermission = (requiredPermission) => {
  return async (req, res, next) => {
    try {
      // Admin has all permissions
      if (req.user.role === 'admin') {
        return next();
      }

      const result = await pool.query(
        `SELECT p.name FROM permissions p
         JOIN role_permissions rp ON p.id = rp.permission_id
         JOIN roles r ON rp.role_id = r.id
         WHERE r.name = $1 AND p.name = $2`,
        [req.user.role, requiredPermission]
      );

      if (result.rows.length === 0) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      next();
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };
};

const requireRoles = (...allowedRoles) => {
  const allowed = new Set(allowedRoles.map((r) => String(r).toLowerCase()));
  return (req, res, next) => {
    const currentRole = String(req.user?.role || '').toLowerCase();
    if (!currentRole) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!allowed.has(currentRole)) {
      return res.status(403).json({ error: 'Forbidden for current role' });
    }
    return next();
  };
};

module.exports = { checkPermission, requireRoles };
