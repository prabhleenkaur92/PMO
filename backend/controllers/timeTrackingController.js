const pool = require('../db/connection');
const { logActivity } = require('../utils/activityLogger');

// Log Time
exports.logTime = async (req, res) => {
  const { issue_id, hours_spent, work_date, description } = req.body;

  if (!issue_id || !hours_spent || !work_date) {
    return res.status(400).json({ error: 'Issue ID, hours spent, and work date are required' });
  }

  if (hours_spent <= 0) {
    return res.status(400).json({ error: 'Hours spent must be greater than 0' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify issue exists
    const issueResult = await client.query(
      'SELECT id, issue_key, project_id FROM issues WHERE id = $1',
      [issue_id]
    );

    if (issueResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Issue not found' });
    }

    const issue = issueResult.rows[0];

    // Insert time log
    const result = await client.query(
      `INSERT INTO time_logs (issue_id, user_id, hours_spent, work_date, description)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [issue_id, req.user.id, hours_spent, work_date, description]
    );

    const timeLog = result.rows[0];

    // Update actual hours on issue
    await client.query(
      `UPDATE issues SET actual_hours = actual_hours + $1 WHERE id = $2`,
      [hours_spent, issue_id]
    );

    // Log activity
    await logActivity(client, {
      user_id: req.user.id,
      action_type: 'time_logged',
      entity_type: 'issue',
      entity_id: issue_id,
      project_id: issue.project_id,
      issue_id,
      description: `Logged ${hours_spent}h on ${issue.issue_key}`,
      metadata: { hours: hours_spent, work_date }
    });

    await client.query('COMMIT');
    res.status(201).json(timeLog);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error logging time:', error);
    res.status(500).json({ error: 'Failed to log time' });
  } finally {
    client.release();
  }
};

// Get Time Logs
exports.getTimeLogs = async (req, res) => {
  const { issue_id, user_id, start_date, end_date, limit = 100, offset = 0 } = req.query;

  try {
    let query = `
      SELECT 
        tl.*,
        u.username,
        u.first_name,
        u.last_name,
        i.issue_key,
        i.title as issue_title
      FROM time_logs tl
      JOIN users u ON tl.user_id = u.id
      JOIN issues i ON tl.issue_id = i.id
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 1;

    if (issue_id) {
      query += ` AND tl.issue_id = $${paramCount}`;
      params.push(issue_id);
      paramCount++;
    }

    if (user_id) {
      query += ` AND tl.user_id = $${paramCount}`;
      params.push(user_id);
      paramCount++;
    }

    if (start_date) {
      query += ` AND tl.work_date >= $${paramCount}`;
      params.push(start_date);
      paramCount++;
    }

    if (end_date) {
      query += ` AND tl.work_date <= $${paramCount}`;
      params.push(end_date);
      paramCount++;
    }

    query += ` ORDER BY tl.work_date DESC, tl.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Get total count
    let countQuery = `SELECT COUNT(*) as total FROM time_logs tl WHERE 1=1`;
    const countParams = [];
    let countParamIndex = 1;

    if (issue_id) {
      countQuery += ` AND tl.issue_id = $${countParamIndex}`;
      countParams.push(issue_id);
      countParamIndex++;
    }

    if (user_id) {
      countQuery += ` AND tl.user_id = $${countParamIndex}`;
      countParams.push(user_id);
      countParamIndex++;
    }

    if (start_date) {
      countQuery += ` AND tl.work_date >= $${countParamIndex}`;
      countParams.push(start_date);
      countParamIndex++;
    }

    if (end_date) {
      countQuery += ` AND tl.work_date <= $${countParamIndex}`;
      countParams.push(end_date);
      countParamIndex++;
    }

    const countResult = await pool.query(countQuery, countParams);

    res.json({
      time_logs: result.rows,
      total: parseInt(countResult.rows[0].total),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Error fetching time logs:', error);
    res.status(500).json({ error: 'Failed to fetch time logs' });
  }
};

// Update Time Log
exports.updateTimeLog = async (req, res) => {
  const { id } = req.params;
  const { hours_spent, work_date, description } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get current time log
    const currentLog = await client.query(
      'SELECT * FROM time_logs WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (currentLog.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Time log not found or unauthorized' });
    }

    const oldLog = currentLog.rows[0];
    const hoursDiff = (hours_spent || oldLog.hours_spent) - oldLog.hours_spent;

    const updateFields = [];
    const updateValues = [];
    let paramCount = 1;

    if (hours_spent !== undefined) {
      updateFields.push(`hours_spent = $${paramCount}`);
      updateValues.push(hours_spent);
      paramCount++;
    }

    if (work_date) {
      updateFields.push(`work_date = $${paramCount}`);
      updateValues.push(work_date);
      paramCount++;
    }

    if (description !== undefined) {
      updateFields.push(`description = $${paramCount}`);
      updateValues.push(description);
      paramCount++;
    }

    if (updateFields.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No fields to update' });
    }

    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    updateValues.push(id);

    const result = await client.query(
      `UPDATE time_logs SET ${updateFields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      updateValues
    );

    // Update issue actual hours
    if (hoursDiff !== 0) {
      await client.query(
        `UPDATE issues SET actual_hours = actual_hours + $1 WHERE id = $2`,
        [hoursDiff, oldLog.issue_id]
      );
    }

    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating time log:', error);
    res.status(500).json({ error: 'Failed to update time log' });
  } finally {
    client.release();
  }
};

// Delete Time Log
exports.deleteTimeLog = async (req, res) => {
  const { id } = req.params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const timeLog = await client.query(
      'SELECT * FROM time_logs WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (timeLog.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Time log not found or unauthorized' });
    }

    const log = timeLog.rows[0];

    // Update issue actual hours
    await client.query(
      `UPDATE issues SET actual_hours = GREATEST(actual_hours - $1, 0) WHERE id = $2`,
      [log.hours_spent, log.issue_id]
    );

    await client.query('DELETE FROM time_logs WHERE id = $1', [id]);

    await client.query('COMMIT');
    res.json({ message: 'Time log deleted successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting time log:', error);
    res.status(500).json({ error: 'Failed to delete time log' });
  } finally {
    client.release();
  }
};

// Get Time Summary
exports.getTimeSummary = async (req, res) => {
  const { project_id, sprint_id, user_id, start_date, end_date } = req.query;

  try {
    let query = `
      SELECT 
        DATE(tl.work_date) as work_date,
        SUM(tl.hours_spent) as total_hours,
        COUNT(DISTINCT tl.user_id) as user_count,
        COUNT(DISTINCT tl.issue_id) as issue_count,
        COALESCE(json_agg(
          DISTINCT jsonb_build_object(
            'user_id', u.id,
            'username', u.username,
            'hours', SUM(tl.hours_spent) OVER (PARTITION BY u.id, DATE(tl.work_date))
          )
        ), '[]') as user_breakdown
      FROM time_logs tl
      JOIN issues i ON tl.issue_id = i.id
      JOIN users u ON tl.user_id = u.id
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 1;

    if (project_id) {
      query += ` AND i.project_id = $${paramCount}`;
      params.push(project_id);
      paramCount++;
    }

    if (sprint_id) {
      query += ` AND i.sprint_id = $${paramCount}`;
      params.push(sprint_id);
      paramCount++;
    }

    if (user_id) {
      query += ` AND tl.user_id = $${paramCount}`;
      params.push(user_id);
      paramCount++;
    }

    if (start_date) {
      query += ` AND tl.work_date >= $${paramCount}`;
      params.push(start_date);
      paramCount++;
    }

    if (end_date) {
      query += ` AND tl.work_date <= $${paramCount}`;
      params.push(end_date);
      paramCount++;
    }

    query += ` GROUP BY DATE(tl.work_date) ORDER BY work_date DESC`;

    const result = await pool.query(query, params);
    res.json({ summary: result.rows });
  } catch (error) {
    console.error('Error fetching time summary:', error);
    res.status(500).json({ error: 'Failed to fetch time summary' });
  }
};

module.exports = exports;
