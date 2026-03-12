const pool = require('../db/connection');

let notificationsTableCache = null;
let notificationsColumnsCache = null;

const tableExists = async () => {
  if (notificationsTableCache !== null) return notificationsTableCache;
  try {
    const res = await pool.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1
       ) as exists`,
      ['notifications']
    );
    notificationsTableCache = !!(res.rows[0] && res.rows[0].exists);
    return notificationsTableCache;
  } catch (e) {
    notificationsTableCache = false;
    return false;
  }
};

const getNotificationColumns = async () => {
  if (notificationsColumnsCache) return notificationsColumnsCache;
  try {
    const res = await pool.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'notifications'`
    );
    notificationsColumnsCache = new Set((res.rows || []).map((r) => r.column_name));
    return notificationsColumnsCache;
  } catch (_) {
    notificationsColumnsCache = new Set();
    return notificationsColumnsCache;
  }
};

const safeInsertNotification = async (userId, message, data = {}) => {
  try {
    if (!(await tableExists())) return false;
    const payload = data || {};
    const columns = await getNotificationColumns();

    if (columns.has('data')) {
      await pool.query(
        `INSERT INTO notifications (user_id, message, data) VALUES ($1, $2, $3)` ,
        [userId, message, JSON.stringify(payload)]
      );
      return true;
    }

    const projectId = payload.projectId || payload.project_id || payload.project || null;
    const actionUrl = payload.actionUrl || payload.action_url || (projectId ? `/project/${projectId}` : null);
    const entityType = payload.entityType || payload.entity_type || (projectId ? 'project' : null);

    await pool.query(
      `INSERT INTO notifications (user_id, title, message, type, entity_type, entity_id, action_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)` ,
      [
        userId,
        payload.title || 'Notification',
        message,
        payload.type || 'info',
        entityType,
        projectId,
        actionUrl
      ]
    );
    return true;
  } catch (e) {
    console.warn('safeInsertNotification failed:', e.message || e);
    return false;
  }
};

const safeNotifyRoles = async (roles, message, data = {}) => {
  try {
    if (!Array.isArray(roles) || roles.length === 0) return;
    if (!(await tableExists())) return;
    const users = await pool.query('SELECT id FROM users WHERE is_active = TRUE AND role = ANY($1::role_type[])', [roles]);
    for (const row of users.rows) {
      try {
        await safeInsertNotification(row.id, message, data);
      } catch (e) {
        console.warn('notifyRoles insert skipped for user', row.id, e.message || e);
      }
    }
  } catch (e) {
    console.warn('safeNotifyRoles failed:', e.message || e);
  }
};

const safeGetUnreadCount = async (userId) => {
  try {
    if (!(await tableExists())) return 0;
    const res = await pool.query('SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND is_read = FALSE', [userId]);
    return parseInt(res.rows[0].count || 0);
  } catch (e) {
    console.warn('safeGetUnreadCount failed:', e.message || e);
    return 0;
  }
};

const safeGetNotifications = async (userId, limit = 20, offset = 0) => {
  try {
    if (!(await tableExists())) return [];
    const res = await pool.query('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3', [userId, limit, offset]);
    return (res.rows || []).map((row) => ({
      ...row,
      data: row.data || {
        projectId: row.entity_id || null,
        actionUrl: row.action_url || null
      }
    }));
  } catch (e) {
    console.warn('safeGetNotifications failed:', e.message || e);
    return [];
  }
};

const safeMarkAsRead = async (id, userId) => {
  try {
    if (!(await tableExists())) return false;
    await pool.query('UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2', [id, userId]);
    return true;
  } catch (e) {
    console.warn('safeMarkAsRead failed:', e.message || e);
    return false;
  }
};

const safeMarkAllAsRead = async (userId) => {
  try {
    if (!(await tableExists())) return false;
    await pool.query('UPDATE notifications SET is_read = TRUE WHERE user_id = $1', [userId]);
    return true;
  } catch (e) {
    console.warn('safeMarkAllAsRead failed:', e.message || e);
    return false;
  }
};

module.exports = {
  tableExists,
  safeInsertNotification,
  safeNotifyRoles,
  safeGetUnreadCount,
  safeGetNotifications,
  safeMarkAsRead,
  safeMarkAllAsRead
};
