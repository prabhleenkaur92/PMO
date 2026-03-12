const pool = require('../db/connection');
const fs = require('fs');
const path = require('path');

const ensureAdmin = (req, res) => {
  if (req.user.role !== 'admin') {
    res.status(403).json({ error: 'Only admins can perform this action' });
    return false;
  }
  return true;
};

const buildAuditFilters = ({ userId, action, entityType }) => {
  let whereClause = 'WHERE 1=1';
  const params = [];

  if (userId) {
    whereClause += ` AND al.user_id = $${params.length + 1}`;
    params.push(userId);
  }

  if (action) {
    whereClause += ` AND al.action ILIKE $${params.length + 1}`;
    params.push(`%${action}%`);
  }

  if (entityType) {
    whereClause += ` AND al.entity_type = $${params.length + 1}`;
    params.push(entityType);
  }

  return { whereClause, params };
};

const buildAccessFilters = ({ userId, endpoint }) => {
  let whereClause = 'WHERE 1=1';
  const params = [];

  if (userId) {
    whereClause += ` AND ac.user_id = $${params.length + 1}`;
    params.push(userId);
  }

  if (endpoint) {
    whereClause += ` AND ac.endpoint ILIKE $${params.length + 1}`;
    params.push(`%${endpoint}%`);
  }

  return { whereClause, params };
};

const toCsv = (rows) => {
  if (!rows.length) return '';

  const headers = Object.keys(rows[0]);
  const escapeCsv = (value) => {
    if (value === null || value === undefined) return '';
    const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  };

  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsv(row[h])).join(','));
  }

  return lines.join('\n');
};

const getAuditLogs = async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;

    const { page = 1, limit = 50 } = req.query;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const parsedPage = Number.isFinite(pageNum) ? Math.max(1, pageNum) : 1;
    const parsedLimit = Number.isFinite(limitNum) ? Math.max(1, Math.min(500, limitNum)) : 50;
    const offset = (parsedPage - 1) * parsedLimit;

    const { whereClause, params } = buildAuditFilters(req.query);

    const countResult = await pool.query(
      `SELECT COUNT(*) as total
       FROM audit_logs al
       ${whereClause}`,
      params
    );

    const result = await pool.query(
      `SELECT al.*, u.username, u.email
       FROM audit_logs al
       LEFT JOIN users u ON al.user_id = u.id
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, parsedLimit, offset]
    );

    const total = parseInt(countResult.rows[0].total, 10);

    res.json({
      logs: result.rows,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
        pages: Math.ceil(total / parsedLimit)
      }
    });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({ error: error.message });
  }
};

const getAccessLogs = async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;

    const { page = 1, limit = 50 } = req.query;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const parsedPage = Number.isFinite(pageNum) ? Math.max(1, pageNum) : 1;
    const parsedLimit = Number.isFinite(limitNum) ? Math.max(1, Math.min(500, limitNum)) : 50;
    const offset = (parsedPage - 1) * parsedLimit;

    const { whereClause, params } = buildAccessFilters(req.query);

    const countResult = await pool.query(
      `SELECT COUNT(*) as total
       FROM access_logs ac
       ${whereClause}`,
      params
    );

    const result = await pool.query(
      `SELECT ac.*, u.username, u.email
       FROM access_logs ac
       LEFT JOIN users u ON ac.user_id = u.id
       ${whereClause}
       ORDER BY ac.accessed_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, parsedLimit, offset]
    );

    const total = parseInt(countResult.rows[0].total, 10);

    res.json({
      logs: result.rows,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
        pages: Math.ceil(total / parsedLimit)
      }
    });
  } catch (error) {
    console.error('Error fetching access logs:', error);
    res.status(500).json({ error: error.message });
  }
};

const clearAuditLogs = async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;

    await pool.query('DELETE FROM audit_logs');
    res.json({ message: 'Audit logs cleared successfully' });
  } catch (error) {
    console.error('Error clearing audit logs:', error);
    res.status(500).json({ error: error.message });
  }
};

const clearAccessLogs = async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;

    await pool.query('DELETE FROM access_logs');
    res.json({ message: 'Access logs cleared successfully' });
  } catch (error) {
    console.error('Error clearing access logs:', error);
    res.status(500).json({ error: error.message });
  }
};

const exportAuditLogs = async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;

    const format = (req.query.format || 'csv').toString().toLowerCase();
    const { whereClause, params } = buildAuditFilters(req.query);

    const result = await pool.query(
      `SELECT al.id, al.user_id, u.username, u.email, al.action, al.entity_type, al.entity_id,
              al.old_values, al.new_values, al.ip_address, al.user_agent, al.created_at
       FROM audit_logs al
       LEFT JOIN users u ON al.user_id = u.id
       ${whereClause}
       ORDER BY al.created_at DESC`,
      params
    );

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${timestamp}.json"`);
      return res.status(200).send(JSON.stringify(result.rows, null, 2));
    }

    const csv = toCsv(result.rows);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${timestamp}.csv"`);
    return res.status(200).send(csv);
  } catch (error) {
    console.error('Error exporting audit logs:', error);
    res.status(500).json({ error: error.message });
  }
};

const exportAccessLogs = async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;

    const format = (req.query.format || 'csv').toString().toLowerCase();
    const { whereClause, params } = buildAccessFilters(req.query);

    const result = await pool.query(
      `SELECT ac.id, ac.user_id, u.username, u.email, ac.endpoint, ac.method, ac.status_code,
              ac.ip_address, ac.user_agent, ac.accessed_at
       FROM access_logs ac
       LEFT JOIN users u ON ac.user_id = u.id
       ${whereClause}
       ORDER BY ac.accessed_at DESC`,
      params
    );

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="access-logs-${timestamp}.json"`);
      return res.status(200).send(JSON.stringify(result.rows, null, 2));
    }

    const csv = toCsv(result.rows);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="access-logs-${timestamp}.csv"`);
    return res.status(200).send(csv);
  } catch (error) {
    console.error('Error exporting access logs:', error);
    res.status(500).json({ error: error.message });
  }
};

const BACKUP_TABLES_ORDER = [
  'roles',
  'permissions',
  'users',
  'role_permissions',
  'clients',
  'points_of_contact',
  'projects',
  'orders',
  'order_subprojects',
  'order_payment_schedules',
  'project_status_history',
  'project_remarks',
  'file_attachments',
  'notifications',
  'chat_messages',
  'audit_logs',
  'access_logs',
  'form_field_visibility'
];

const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;

const tableExists = async (client, tableName) => {
  const result = await client.query(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [tableName]
  );
  return !!result.rows[0]?.exists;
};

const normalizeRelativeUploadPath = (rawPath, uploadsRoot) => {
  if (!rawPath) return null;
  const raw = String(rawPath);
  const normalized = raw.replace(/\\/g, '/');

  const marker = '/uploads/';
  const markerIdx = normalized.lastIndexOf(marker);
  let relative = markerIdx >= 0 ? normalized.slice(markerIdx + marker.length) : normalized;

  if (path.isAbsolute(raw) && raw.startsWith(uploadsRoot)) {
    relative = path.relative(uploadsRoot, raw);
  }

  relative = relative.replace(/^\/+/, '');
  const safe = path.normalize(relative).replace(/^(\.\.(\/|\\|$))+/, '');
  return safe || null;
};

const getRows = async (client, table) => {
  const result = await client.query(`SELECT * FROM ${quoteIdent(table)}`);
  return result.rows;
};

const exportSystemBackup = async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;

    const includeFiles = String(req.query.includeFiles || 'true').toLowerCase() !== 'false';
    const client = await pool.connect();
    const uploadsRoot = path.join(__dirname, '..', 'uploads');

    try {
      const existing = [];
      for (const t of BACKUP_TABLES_ORDER) {
        if (await tableExists(client, t)) existing.push(t);
      }

      const tables = {};
      for (const t of existing) {
        tables[t] = await getRows(client, t);
      }

      const files = [];
      if (includeFiles) {
        const seen = new Set();
        const addFileFromPath = (p) => {
          const relativePath = normalizeRelativeUploadPath(p, uploadsRoot);
          if (!relativePath || seen.has(relativePath)) return;
          const absPath = path.join(uploadsRoot, relativePath);
          if (!fs.existsSync(absPath)) return;
          const content = fs.readFileSync(absPath);
          files.push({
            relative_path: relativePath.replace(/\\/g, '/'),
            size: content.length,
            content_base64: content.toString('base64')
          });
          seen.add(relativePath);
        };

        for (const row of (tables.file_attachments || [])) {
          addFileFromPath(row.file_path);
        }
        for (const row of (tables.chat_messages || [])) {
          if (row.attachment_path) addFileFromPath(row.attachment_path);
        }
      }

      const backup = {
        type: 'pmo_portal_full_backup',
        version: 1,
        exported_at: new Date().toISOString(),
        exported_by: {
          id: req.user.id,
          username: req.user.username
        },
        includes_files: includeFiles,
        tables,
        files
      };

      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="pmo-full-backup-${ts}.json"`);
      return res.status(200).send(JSON.stringify(backup));
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error exporting full backup:', error);
    res.status(500).json({ error: error.message });
  }
};

const insertRows = async (client, tableName, rows) => {
  let inserted = 0;
  for (const sourceRow of rows) {
    const row = { ...sourceRow };
    const columns = Object.keys(row);
    if (columns.length === 0) continue;
    const placeholders = columns.map((_, idx) => `$${idx + 1}`).join(', ');
    const values = columns.map((c) => row[c]);
    await client.query(
      `INSERT INTO ${quoteIdent(tableName)} (${columns.map(quoteIdent).join(', ')})
       VALUES (${placeholders})`,
      values
    );
    inserted += 1;
  }
  return inserted;
};

const importSystemBackup = async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;

    const raw = req.file?.buffer
      ? req.file.buffer.toString('utf8')
      : (typeof req.body?.backup === 'string' ? req.body.backup : null);

    if (!raw) {
      return res.status(400).json({ error: 'Backup file is required. Upload JSON file as "file".' });
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid JSON backup file' });
    }

    if (!payload || payload.type !== 'pmo_portal_full_backup' || !payload.tables || typeof payload.tables !== 'object') {
      return res.status(400).json({ error: 'Unsupported backup format' });
    }

    const replaceExisting = String(req.query.replaceExisting || 'true').toLowerCase() !== 'false';
    if (!replaceExisting) {
      return res.status(400).json({ error: 'Only replaceExisting=true is supported for import' });
    }

    const uploadsRoot = path.join(__dirname, '..', 'uploads');
    let restoredFiles = 0;
    for (const file of (payload.files || [])) {
      if (!file || !file.relative_path || !file.content_base64) continue;
      const rel = normalizeRelativeUploadPath(file.relative_path, uploadsRoot);
      if (!rel) continue;
      const abs = path.join(uploadsRoot, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, Buffer.from(file.content_base64, 'base64'));
      restoredFiles += 1;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const availableTables = [];
      for (const t of BACKUP_TABLES_ORDER) {
        if (await tableExists(client, t) && Array.isArray(payload.tables[t])) {
          availableTables.push(t);
        }
      }

      if (availableTables.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'No compatible tables found in backup file' });
      }

      await client.query(`TRUNCATE TABLE ${availableTables.map(quoteIdent).join(', ')} RESTART IDENTITY CASCADE`);

      const insertCounts = {};
      for (const tableName of availableTables) {
        const tableRows = payload.tables[tableName].map((r) => ({ ...r }));

        if (tableName === 'file_attachments') {
          for (const row of tableRows) {
            if (row.file_path) {
              const rel = normalizeRelativeUploadPath(row.file_path, uploadsRoot);
              row.file_path = rel ? path.join(uploadsRoot, rel) : row.file_path;
            }
          }
        }

        if (tableName === 'chat_messages') {
          for (const row of tableRows) {
            if (row.attachment_path) {
              const rel = normalizeRelativeUploadPath(row.attachment_path, uploadsRoot);
              row.attachment_path = rel ? path.join(uploadsRoot, rel) : row.attachment_path;
            }
          }
        }

        insertCounts[tableName] = await insertRows(client, tableName, tableRows);
      }

      if (availableTables.includes('users')) {
        const adminCheck = await client.query(
          `SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin' AND is_active = TRUE`
        );
        if ((adminCheck.rows[0]?.count || 0) < 1) {
          throw new Error('Import rejected: backup has no active admin user');
        }
      }

      await client.query('COMMIT');

      return res.json({
        message: 'Full backup imported successfully',
        restoredFiles,
        tables: insertCounts
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error importing full backup:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getAuditLogs,
  getAccessLogs,
  clearAuditLogs,
  clearAccessLogs,
  exportAuditLogs,
  exportAccessLogs,
  exportSystemBackup,
  importSystemBackup
};
