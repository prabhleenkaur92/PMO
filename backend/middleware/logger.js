const pool = require('../db/connection');

const logAudit = async (userId, action, entityType, entityId, oldValues, newValues, req) => {
  try {
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';

    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, action, entityType, entityId, JSON.stringify(oldValues), JSON.stringify(newValues), ip, userAgent]
    );
  } catch (error) {
    console.error('Error logging audit:', error);
  }
};

const logAccess = async (userId, endpoint, method, statusCode, req) => {
  try {
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';

    await pool.query(
      `INSERT INTO access_logs (user_id, endpoint, method, status_code, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, endpoint, method, statusCode, ip, userAgent]
    );
  } catch (error) {
    console.error('Error logging access:', error);
  }
};

module.exports = { logAudit, logAccess };
