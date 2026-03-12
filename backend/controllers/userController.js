const pool = require('../db/connection');
const bcrypt = require('bcryptjs');
const { logAudit } = require('../middleware/logger');
const { ensureFinanceAndPmoRoles } = require('../utils/ensureRoles');

const getAllUsers = async (req, res) => {
  try {
    // Only admin can view all users
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can view all users' });
    }

    const result = await pool.query(
      'SELECT id, username, email, first_name, last_name, role, phone, is_active, last_login FROM users ORDER BY created_at DESC'
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: error.message });
  }
};

const getUsersByRole = async (req, res) => {
  try {
    const { role } = req.params;

    // Allow admins/managers/PMO to fetch users by role.
    if (!['admin', 'manager', 'pmo'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const result = await pool.query(
      'SELECT id, username, email, first_name, last_name, role FROM users WHERE role = $1 AND is_active = TRUE ORDER BY username',
      [role]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching users by role:', error);
    res.status(500).json({ error: error.message });
  }
};

const getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    // Users can only view themselves unless admin
    if (req.user.role !== 'admin' && req.user.id !== id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const result = await pool.query(
      'SELECT id, username, email, first_name, last_name, role, phone, is_active, created_at, last_login FROM users WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: error.message });
  }
};

const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { firstName, lastName, phone } = req.body;

    // Users can only update themselves unless admin
    if (req.user.role !== 'admin' && req.user.id !== id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const result = await pool.query(
      `UPDATE users SET first_name = COALESCE($1, first_name), 
       last_name = COALESCE($2, last_name), 
       phone = COALESCE($3, phone),
       updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 RETURNING *`,
      [firstName, lastName, phone, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Log audit
    await logAudit(req.user.id, 'USER_UPDATED', 'users', id, {}, result.rows[0], req);

    res.json({ message: 'User updated successfully', user: result.rows[0] });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: error.message });
  }
};

const changeUserRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    // Only admin can change roles
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can change user roles' });
    }

    await ensureFinanceAndPmoRoles();

    const currentResult = await pool.query(
      'SELECT role FROM users WHERE id = $1',
      [id]
    );

    if (currentResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const oldRole = currentResult.rows[0].role;

    const result = await pool.query(
      'UPDATE users SET role = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [role, id]
    );

    // Log audit
    await logAudit(req.user.id, 'USER_ROLE_CHANGED', 'users', id, { role: oldRole }, { role }, req);

    res.json({ message: 'User role updated successfully', user: result.rows[0] });
  } catch (error) {
    console.error('Error changing user role:', error);
    res.status(500).json({ error: error.message });
  }
};

const deactivateUser = async (req, res) => {
  try {
    const { id } = req.params;

    // Only admin can deactivate users
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can deactivate users' });
    }

    const result = await pool.query(
      'UPDATE users SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Log audit
    await logAudit(req.user.id, 'USER_DEACTIVATED', 'users', id, { is_active: true }, { is_active: false }, req);

    res.json({ message: 'User deactivated successfully' });
  } catch (error) {
    console.error('Error deactivating user:', error);
    res.status(500).json({ error: error.message });
  }
};

const activateUser = async (req, res) => {
  try {
    const { id } = req.params;

    // Only admin can activate users
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can activate users' });
    }

    const result = await pool.query(
      'UPDATE users SET is_active = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Log audit
    await logAudit(req.user.id, 'USER_ACTIVATED', 'users', id, { is_active: false }, { is_active: true }, req);

    res.json({ message: 'User activated successfully' });
  } catch (error) {
    console.error('Error activating user:', error);
    res.status(500).json({ error: error.message });
  }
};

// Admin creates new user
const createUser = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can create users' });
    }

    const { username, email, password, role, firstName, lastName, phone } = req.body;

    if (!username || !email || !password || !role) {
      return res.status(400).json({ error: 'Missing required fields: username, email, password, role' });
    }

    await ensureFinanceAndPmoRoles();

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, role, first_name, last_name, phone, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
       RETURNING id, username, email, role, first_name, last_name, phone, is_active`,
      [username, email, hashedPassword, role, firstName || null, lastName || null, phone || null]
    );

    // Log audit
    await logAudit(req.user.id, 'USER_CREATED', 'users', result.rows[0].id, {}, result.rows[0], req);

    res.status(201).json({ message: 'User created successfully', user: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Username or email already exists' });
    }
    console.error('Error creating user:', error);
    res.status(500).json({ error: error.message });
  }
};

// Admin changes user password
const changePassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;

    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can change passwords' });
    }

    if (!newPassword) {
      return res.status(400).json({ error: 'New password is required' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const result = await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, username, email, role',
      [hashedPassword, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Log audit
    await logAudit(req.user.id, 'PASSWORD_CHANGED', 'users', id, {}, { message: 'Password changed' }, req);

    res.json({ message: 'Password changed successfully', user: result.rows[0] });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ error: error.message });
  }
};

// Admin deletes user
const deleteUser = async (req, res) => {
  let client;
  try {
    const { id } = req.params;

    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can delete users' });
    }

    // Prevent deleting the admin making the request
    if (req.user.id === id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    client = await pool.connect();
    await client.query('BEGIN');

    await client.query(
      'UPDATE access_logs SET user_id = NULL WHERE user_id = $1',
      [id]
    );

    const result = await client.query(
      'DELETE FROM users WHERE id = $1 AND id != $2 RETURNING id, username, email',
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found or cannot be deleted' });
    }

    await client.query('COMMIT');

    // Log audit
    await logAudit(req.user.id, 'USER_DELETED', 'users', id, result.rows[0], {}, req);

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error rolling back delete user transaction:', rollbackError);
      }
    }
    console.error('Error deleting user:', error);
    res.status(500).json({ error: error.message });
  } finally {
    if (client) client.release();
  }
};

module.exports = {
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
};
