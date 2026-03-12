const pool = require('../db/connection');

// Get Activity Feed
exports.getActivityFeed = async (req, res) => {
  const { 
    project_id, 
    issue_id, 
    user_id,
    action_type,
    entity_type,
    limit = 50,
    offset = 0 
  } = req.query;

  try {
    let query = `
      SELECT 
        af.*,
        u.username,
        u.first_name,
        u.last_name,
        p.project_number,
        i.issue_key
      FROM activity_feed af
      LEFT JOIN users u ON af.user_id = u.id
      LEFT JOIN projects p ON af.project_id = p.id
      LEFT JOIN issues i ON af.issue_id = i.id
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 1;

    if (project_id) {
      query += ` AND af.project_id = $${paramCount}`;
      params.push(project_id);
      paramCount++;
    }

    if (issue_id) {
      query += ` AND af.issue_id = $${paramCount}`;
      params.push(issue_id);
      paramCount++;
    }

    if (user_id) {
      query += ` AND af.user_id = $${paramCount}`;
      params.push(user_id);
      paramCount++;
    }

    if (action_type) {
      query += ` AND af.action_type = $${paramCount}`;
      params.push(action_type);
      paramCount++;
    }

    if (entity_type) {
      query += ` AND af.entity_type = $${paramCount}`;
      params.push(entity_type);
      paramCount++;
    }

    query += ` ORDER BY af.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM activity_feed WHERE 1=1';
    const countParams = [];
    let countIndex = 1;

    if (project_id) {
      countQuery += ` AND project_id = $${countIndex}`;
      countParams.push(project_id);
      countIndex++;
    }

    if (issue_id) {
      countQuery += ` AND issue_id = $${countIndex}`;
      countParams.push(issue_id);
      countIndex++;
    }

    if (user_id) {
      countQuery += ` AND user_id = $${countIndex}`;
      countParams.push(user_id);
      countIndex++;
    }

    if (action_type) {
      countQuery += ` AND action_type = $${countIndex}`;
      countParams.push(action_type);
      countIndex++;
    }

    if (entity_type) {
      countQuery += ` AND entity_type = $${countIndex}`;
      countParams.push(entity_type);
      countIndex++;
    }

    const countResult = await pool.query(countQuery, countParams);

    res.json({
      activities: result.rows,
      total: parseInt(countResult.rows[0].total),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Error fetching activity feed:', error);
    res.status(500).json({ error: 'Failed to fetch activity feed' });
  }
};

// Get Recent Activities (for dashboard)
exports.getRecentActivities = async (req, res) => {
  const { limit = 20 } = req.query;

  try {
    const result = await pool.query(
      `SELECT 
        af.*,
        u.username,
        u.first_name,
        u.last_name,
        p.project_number,
        i.issue_key
      FROM activity_feed af
      LEFT JOIN users u ON af.user_id = u.id
      LEFT JOIN projects p ON af.project_id = p.id
      LEFT JOIN issues i ON af.issue_id = i.id
      ORDER BY af.created_at DESC
      LIMIT $1`,
      [limit]
    );

    res.json({ activities: result.rows });
  } catch (error) {
    console.error('Error fetching recent activities:', error);
    res.status(500).json({ error: 'Failed to fetch recent activities' });
  }
};

// Get User Activity Timeline
exports.getUserActivityTimeline = async (req, res) => {
  const { user_id } = req.params;
  const { limit = 100, offset = 0 } = req.query;

  try {
    const result = await pool.query(
      `SELECT 
        af.*,
        p.project_number,
        p.company_name,
        i.issue_key,
        i.title as issue_title
      FROM activity_feed af
      LEFT JOIN projects p ON af.project_id = p.id
      LEFT JOIN issues i ON af.issue_id = i.id
      WHERE af.user_id = $1
      ORDER BY af.created_at DESC
      LIMIT $2 OFFSET $3`,
      [user_id, limit, offset]
    );

    const countResult = await pool.query(
      'SELECT COUNT(*) as total FROM activity_feed WHERE user_id = $1',
      [user_id]
    );

    res.json({
      activities: result.rows,
      total: parseInt(countResult.rows[0].total),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Error fetching user activity timeline:', error);
    res.status(500).json({ error: 'Failed to fetch user activity timeline' });
  }
};

module.exports = exports;
