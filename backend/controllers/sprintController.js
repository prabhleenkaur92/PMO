const pool = require('../db/connection');
const { logAudit } = require('../middleware/logger');
const { logActivity } = require('../utils/activityLogger');

// Create Sprint
exports.createSprint = async (req, res) => {
  const { project_id, name, goal, start_date, end_date } = req.body;

  if (!project_id || !name || !start_date || !end_date) {
    return res.status(400).json({ error: 'Project ID, name, start date, and end date are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO sprints (project_id, name, goal, start_date, end_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [project_id, name, goal, start_date, end_date, req.user.id]
    );

    const sprint = result.rows[0];

    await logActivity(client, {
      user_id: req.user.id,
      action_type: 'sprint_created',
      entity_type: 'sprint',
      entity_id: sprint.id,
      project_id,
      description: `Created sprint: ${name}`,
      metadata: { start_date, end_date }
    });

    await client.query('COMMIT');
    res.status(201).json(sprint);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating sprint:', error);
    res.status(500).json({ error: 'Failed to create sprint' });
  } finally {
    client.release();
  }
};

// Get Sprints
exports.getSprints = async (req, res) => {
  const { project_id, status } = req.query;

  try {
    let query = `
      SELECT 
        s.*,
        u.username as created_by_name,
        COUNT(DISTINCT i.id) as issue_count,
        SUM(CASE WHEN i.status = 'Done' THEN 1 ELSE 0 END) as completed_issues,
        SUM(i.story_points) as total_story_points,
        SUM(CASE WHEN i.status = 'Done' THEN i.story_points ELSE 0 END) as completed_story_points
      FROM sprints s
      LEFT JOIN users u ON s.created_by = u.id
      LEFT JOIN issues i ON s.id = i.sprint_id
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 1;

    if (project_id) {
      query += ` AND s.project_id = $${paramCount}`;
      params.push(project_id);
      paramCount++;
    }

    if (status) {
      query += ` AND s.status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }

    query += ` GROUP BY s.id, u.username ORDER BY s.start_date DESC`;

    const result = await pool.query(query, params);
    res.json({ sprints: result.rows });
  } catch (error) {
    console.error('Error fetching sprints:', error);
    res.status(500).json({ error: 'Failed to fetch sprints' });
  }
};

// Get Sprint by ID
exports.getSprint = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT 
        s.*,
        u.username as created_by_name,
        p.project_number,
        p.company_name,
        COUNT(DISTINCT i.id) as issue_count,
        SUM(CASE WHEN i.status = 'Done' THEN 1 ELSE 0 END) as completed_issues,
        SUM(i.story_points) as total_story_points,
        SUM(CASE WHEN i.status = 'Done' THEN i.story_points ELSE 0 END) as completed_story_points,
        COALESCE(json_agg(
          DISTINCT jsonb_build_object(
            'id', i.id,
            'issue_key', i.issue_key,
            'title', i.title,
            'status', i.status,
            'priority', i.priority,
            'story_points', i.story_points,
            'assignee_name', u_assignee.username
          )
        ) FILTER (WHERE i.id IS NOT NULL), '[]') as issues
      FROM sprints s
      LEFT JOIN users u ON s.created_by = u.id
      LEFT JOIN projects p ON s.project_id = p.id
      LEFT JOIN issues i ON s.id = i.sprint_id
      LEFT JOIN users u_assignee ON i.assignee_id = u_assignee.id
      WHERE s.id = $1
      GROUP BY s.id, u.username, p.project_number, p.company_name`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Sprint not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching sprint:', error);
    res.status(500).json({ error: 'Failed to fetch sprint' });
  }
};

// Update Sprint
exports.updateSprint = async (req, res) => {
  const { id } = req.params;
  const { name, goal, start_date, end_date, status } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const updateFields = [];
    const updateValues = [];
    let paramCount = 1;

    if (name) {
      updateFields.push(`name = $${paramCount}`);
      updateValues.push(name);
      paramCount++;
    }

    if (goal !== undefined) {
      updateFields.push(`goal = $${paramCount}`);
      updateValues.push(goal);
      paramCount++;
    }

    if (start_date) {
      updateFields.push(`start_date = $${paramCount}`);
      updateValues.push(start_date);
      paramCount++;
    }

    if (end_date) {
      updateFields.push(`end_date = $${paramCount}`);
      updateValues.push(end_date);
      paramCount++;
    }

    if (status) {
      updateFields.push(`status = $${paramCount}`);
      updateValues.push(status);
      paramCount++;
    }

    if (updateFields.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No fields to update' });
    }

    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    updateValues.push(id);

    const result = await client.query(
      `UPDATE sprints SET ${updateFields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      updateValues
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Sprint not found' });
    }

    const sprint = result.rows[0];

    await logActivity(client, {
      user_id: req.user.id,
      action_type: 'sprint_updated',
      entity_type: 'sprint',
      entity_id: id,
      project_id: sprint.project_id,
      description: `Updated sprint: ${sprint.name}`,
      metadata: { updates: req.body }
    });

    await client.query('COMMIT');
    res.json(sprint);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating sprint:', error);
    res.status(500).json({ error: 'Failed to update sprint' });
  } finally {
    client.release();
  }
};

// Start Sprint
exports.startSprint = async (req, res) => {
  const { id } = req.params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if there's already an active sprint in the same project
    const sprintCheck = await client.query(
      `SELECT project_id FROM sprints WHERE id = $1`,
      [id]
    );

    if (sprintCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Sprint not found' });
    }

    const projectId = sprintCheck.rows[0].project_id;

    const activeSprints = await client.query(
      `SELECT id FROM sprints WHERE project_id = $1 AND status = 'active' AND id != $2`,
      [projectId, id]
    );

    if (activeSprints.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Another sprint is already active in this project' });
    }

    const result = await client.query(
      `UPDATE sprints SET status = 'active', updated_at = CURRENT_TIMESTAMP 
       WHERE id = $1 RETURNING *`,
      [id]
    );

    await logActivity(client, {
      user_id: req.user.id,
      action_type: 'sprint_started',
      entity_type: 'sprint',
      entity_id: id,
      project_id: projectId,
      description: `Started sprint: ${result.rows[0].name}`,
      metadata: {}
    });

    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error starting sprint:', error);
    res.status(500).json({ error: 'Failed to start sprint' });
  } finally {
    client.release();
  }
};

// Complete Sprint
exports.completeSprint = async (req, res) => {
  const { id } = req.params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE sprints SET status = 'completed', updated_at = CURRENT_TIMESTAMP 
       WHERE id = $1 RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Sprint not found' });
    }

    await logActivity(client, {
      user_id: req.user.id,
      action_type: 'sprint_completed',
      entity_type: 'sprint',
      entity_id: id,
      project_id: result.rows[0].project_id,
      description: `Completed sprint: ${result.rows[0].name}`,
      metadata: {}
    });

    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error completing sprint:', error);
    res.status(500).json({ error: 'Failed to complete sprint' });
  } finally {
    client.release();
  }
};

// Delete Sprint
exports.deleteSprint = async (req, res) => {
  const { id } = req.params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const sprint = await client.query('SELECT * FROM sprints WHERE id = $1', [id]);
    if (sprint.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Sprint not found' });
    }

    // Unassign all issues from this sprint
    await client.query('UPDATE issues SET sprint_id = NULL WHERE sprint_id = $1', [id]);

    await client.query('DELETE FROM sprints WHERE id = $1', [id]);

    await logActivity(client, {
      user_id: req.user.id,
      action_type: 'sprint_deleted',
      entity_type: 'sprint',
      entity_id: id,
      project_id: sprint.rows[0].project_id,
      description: `Deleted sprint: ${sprint.rows[0].name}`,
      metadata: { sprint: sprint.rows[0] }
    });

    await client.query('COMMIT');
    res.json({ message: 'Sprint deleted successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting sprint:', error);
    res.status(500).json({ error: 'Failed to delete sprint' });
  } finally {
    client.release();
  }
};

// Get Sprint Report
exports.getSprintReport = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT 
        s.*,
        COUNT(DISTINCT i.id) as total_issues,
        SUM(CASE WHEN i.status = 'Done' THEN 1 ELSE 0 END) as completed_issues,
        SUM(CASE WHEN i.status = 'In Progress' THEN 1 ELSE 0 END) as in_progress_issues,
        SUM(CASE WHEN i.status = 'Backlog' OR i.status = 'Todo' THEN 1 ELSE 0 END) as not_started_issues,
        SUM(i.story_points) as total_story_points,
        SUM(CASE WHEN i.status = 'Done' THEN i.story_points ELSE 0 END) as completed_story_points,
        SUM(i.estimated_hours) as total_estimated_hours,
        SUM(i.actual_hours) as total_actual_hours,
        COALESCE(json_agg(
          DISTINCT jsonb_build_object(
            'date', tl.work_date,
            'hours', SUM(tl.hours_spent)
          )
        ) FILTER (WHERE tl.id IS NOT NULL), '[]') as daily_time_logs
      FROM sprints s
      LEFT JOIN issues i ON s.id = i.sprint_id
      LEFT JOIN time_logs tl ON i.id = tl.issue_id
      WHERE s.id = $1
      GROUP BY s.id, tl.work_date`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Sprint not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching sprint report:', error);
    res.status(500).json({ error: 'Failed to fetch sprint report' });
  }
};

module.exports = exports;
