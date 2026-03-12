const pool = require('../db/connection');
const { logAudit } = require('../middleware/logger');
const { PROJECT_FORM_FIELDS, ROLE_VALUES } = require('../config/projectFormFields');
const {
  ensureFieldVisibilityTable,
  getVisibilityRowsForRole,
  upsertFieldVisibility
} = require('../utils/fieldVisibility');

const getAllRoles = async (req, res) => {
  try {
    // Only admin can view roles
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can view roles' });
    }

    const result = await pool.query(
      'SELECT id, name, description FROM roles ORDER BY name'
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching roles:', error);
    res.status(500).json({ error: error.message });
  }
};

const getRolePermissions = async (req, res) => {
  try {
    const { roleId } = req.params;

    // Only admin can view permissions
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can view permissions' });
    }

    const result = await pool.query(
      `SELECT p.* FROM permissions p
       JOIN role_permissions rp ON p.id = rp.permission_id
       WHERE rp.role_id = $1
       ORDER BY p.module, p.action`,
      [roleId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching role permissions:', error);
    res.status(500).json({ error: error.message });
  }
};

const grantPermission = async (req, res) => {
  try {
    const { roleId } = req.params;
    const { permissionId } = req.body;

    // Only admin can grant permissions
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can grant permissions' });
    }

    await pool.query(
      'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [roleId, permissionId]
    );

    // Log audit
    await logAudit(req.user.id, 'PERMISSION_GRANTED', 'roles', roleId, {}, { permissionId }, req);

    res.json({ message: 'Permission granted successfully' });
  } catch (error) {
    console.error('Error granting permission:', error);
    res.status(500).json({ error: error.message });
  }
};

const revokePermission = async (req, res) => {
  try {
    const { roleId, permissionId } = req.params;

    // Only admin can revoke permissions
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can revoke permissions' });
    }

    await pool.query(
      'DELETE FROM role_permissions WHERE role_id = $1 AND permission_id = $2',
      [roleId, permissionId]
    );

    // Log audit
    await logAudit(req.user.id, 'PERMISSION_REVOKED', 'roles', roleId, { permissionId }, {}, req);

    res.json({ message: 'Permission revoked successfully' });
  } catch (error) {
    console.error('Error revoking permission:', error);
    res.status(500).json({ error: error.message });
  }
};

const getMyFieldVisibility = async (req, res) => {
  try {
    const module = req.query.module || 'project_form';
    if (module !== 'project_form') {
      return res.status(400).json({ error: 'Unsupported module' });
    }

    const fields = await getVisibilityRowsForRole(req.user.role, module);
    res.json({ role: req.user.role, module, fields });
  } catch (error) {
    console.error('Error fetching my field visibility:', error);
    res.status(500).json({ error: error.message });
  }
};

const getFieldVisibilityMatrix = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can manage field visibility' });
    }

    const module = req.query.module || 'project_form';
    if (module !== 'project_form') {
      return res.status(400).json({ error: 'Unsupported module' });
    }

    await ensureFieldVisibilityTable();

    const matrix = {};
    for (const role of ROLE_VALUES) {
      matrix[role] = await getVisibilityRowsForRole(role, module);
    }

    res.json({ module, matrix, fields: PROJECT_FORM_FIELDS });
  } catch (error) {
    console.error('Error fetching field visibility matrix:', error);
    res.status(500).json({ error: error.message });
  }
};

const updateFieldVisibility = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can manage field visibility' });
    }

    const {
      role,
      fieldKey,
      isVisible,
      module = 'project_form'
    } = req.body;

    if (module !== 'project_form') {
      return res.status(400).json({ error: 'Unsupported module' });
    }

    if (typeof isVisible !== 'boolean') {
      return res.status(400).json({ error: 'isVisible must be boolean' });
    }

    await upsertFieldVisibility({
      role,
      module,
      fieldKey,
      isVisible,
      updatedBy: req.user.id
    });

    await logAudit(
      req.user.id,
      'FIELD_VISIBILITY_UPDATED',
      'form_field_visibility',
      null,
      {},
      { role, fieldKey, isVisible, module },
      req
    );

    res.json({ message: 'Field visibility updated successfully' });
  } catch (error) {
    console.error('Error updating field visibility:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getAllRoles,
  getRolePermissions,
  grantPermission,
  revokePermission,
  getMyFieldVisibility,
  getFieldVisibilityMatrix,
  updateFieldVisibility
};
