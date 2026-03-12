const pool = require('../db/connection');

// Advanced search across projects, issues, and users
exports.search = async (req, res) => {
  const {
    searchText,
    entityType = 'issue',
    project,
    status,
    priority,
    assignee,
    label,
    dateFrom,
    dateTo,
    issueType,
    sprint
  } = req.query;

  try {
    let query = '';
    let params = [];
    let paramCount = 1;

    if (entityType === 'issue') {
      query = `
        SELECT i.*, p.project_number, u.first_name as assignee_name
        FROM issues i
        JOIN projects p ON i.project_id = p.id
        LEFT JOIN users u ON i.assignee_id = u.id
        WHERE 1=1
      `;

      if (searchText) {
        query += ` AND (i.issue_key ILIKE $${paramCount} OR i.title ILIKE $${paramCount} OR i.description ILIKE $${paramCount})`;
        params.push(`%${searchText}%`);
        paramCount++;
      }
      if (project) {
        query += ` AND i.project_id = $${paramCount}`;
        params.push(project);
        paramCount++;
      }
      if (status) {
        query += ` AND i.status = $${paramCount}`;
        params.push(status);
        paramCount++;
      }
      if (priority) {
        query += ` AND i.priority = $${paramCount}`;
        params.push(priority);
        paramCount++;
      }
      if (assignee) {
        query += ` AND i.assignee_id = $${paramCount}`;
        params.push(assignee);
        paramCount++;
      }
      if (issueType) {
        query += ` AND i.issue_type = $${paramCount}`;
        params.push(issueType);
        paramCount++;
      }
      if (sprint) {
        query += ` AND i.sprint_id = $${paramCount}`;
        params.push(sprint);
        paramCount++;
      }
      if (dateFrom) {
        query += ` AND i.created_at >= $${paramCount}`;
        params.push(new Date(dateFrom));
        paramCount++;
      }
      if (dateTo) {
        query += ` AND i.created_at <= $${paramCount}`;
        params.push(new Date(dateTo));
        paramCount++;
      }

      query += ` ORDER BY i.created_at DESC LIMIT 100`;
    } else if (entityType === 'project') {
      query = `
        SELECT * FROM projects
        WHERE 1=1
      `;

      if (searchText) {
        query += ` AND (project_number ILIKE $${paramCount} OR company_name ILIKE $${paramCount})`;
        params.push(`%${searchText}%`);
        paramCount++;
      }
      if (status) {
        query += ` AND status = $${paramCount}`;
        params.push(status);
        paramCount++;
      }

      query += ` ORDER BY created_at DESC LIMIT 100`;
    } else if (entityType === 'user') {
      query = `
        SELECT id, username, first_name, last_name, email, role
        FROM users
        WHERE 1=1
      `;

      if (searchText) {
        query += ` AND (username ILIKE $${paramCount} OR first_name ILIKE $${paramCount} OR last_name ILIKE $${paramCount})`;
        params.push(`%${searchText}%`);
        paramCount++;
      }

      query += ` ORDER BY first_name ASC LIMIT 100`;
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
};

// Save a search filter
exports.saveFilter = async (req, res) => {
  const { name, filter_criteria, filter_type, is_favorite, is_shared } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO saved_filters (user_id, name, filter_criteria, filter_type, is_favorite, is_shared)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.user.id, name, JSON.stringify(filter_criteria), filter_type, is_favorite, is_shared]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error saving filter:', error);
    res.status(500).json({ error: 'Failed to save filter' });
  }
};

// Get saved filters for user
exports.getSavedFilters = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM saved_filters WHERE user_id = $1 ORDER BY is_favorite DESC, created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching filters:', error);
    res.status(500).json({ error: 'Failed to fetch filters' });
  }
};

// Delete saved filter
exports.deleteFilter = async (req, res) => {
  const { filterId } = req.params;

  try {
    await pool.query(
      `DELETE FROM saved_filters WHERE id = $1 AND user_id = $2`,
      [filterId, req.user.id]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting filter:', error);
    res.status(500).json({ error: 'Failed to delete filter' });
  }
};
