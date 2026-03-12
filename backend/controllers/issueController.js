const pool = require('../db/connection');
const { logAudit } = require('../middleware/logger');
const { logActivity } = require('../utils/activityLogger');
const notifications = require('../utils/notifications');

// Generate unique issue key
const generateIssueKey = async (projectId) => {
  const projectResult = await pool.query(
    'SELECT project_number FROM projects WHERE id = $1',
    [projectId]
  );
  
  if (projectResult.rows.length === 0) {
    throw new Error('Project not found');
  }
  
  const projectNumber = projectResult.rows[0].project_number;
  const prefix = projectNumber.replace('PRJ-', '');
  
  const countResult = await pool.query(
    'SELECT COUNT(*) as count FROM issues WHERE project_id = $1',
    [projectId]
  );
  
  const count = parseInt(countResult.rows[0].count) + 1;
  return `${prefix}-${count}`;
};

// Create Issue
exports.createIssue = async (req, res) => {
  const {
    project_id,
    parent_issue_id,
    issue_type = 'Task',
    title,
    description,
    priority = 'Medium',
    assignee_id,
    sprint_id,
    story_points,
    estimated_hours,
    due_date,
    labels = []
  } = req.body;

  if (!project_id || !title) {
    return res.status(400).json({ error: 'Project ID and title are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const issueKey = await generateIssueKey(project_id);

    const result = await client.query(
      `INSERT INTO issues (
        issue_key, project_id, parent_issue_id, issue_type, title, description,
        priority, assignee_id, reporter_id, sprint_id, story_points, estimated_hours, due_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [
        issueKey, project_id, parent_issue_id, issue_type, title, description,
        priority, assignee_id, req.user.id, sprint_id, story_points, estimated_hours, due_date
      ]
    );

    const issue = result.rows[0];

    // Add labels if provided
    if (labels && labels.length > 0) {
      for (const labelId of labels) {
        await client.query(
          'INSERT INTO issue_labels (issue_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [issue.id, labelId]
        );
      }
    }

    // Auto-watch the issue creator
    await client.query(
      'INSERT INTO issue_watchers (issue_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [issue.id, req.user.id]
    );

    // If assigned, add assignee as watcher
    if (assignee_id) {
      await client.query(
        'INSERT INTO issue_watchers (issue_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [issue.id, assignee_id]
      );
    }

    // Log activity
    await logActivity(client, {
      user_id: req.user.id,
      action_type: 'issue_created',
      entity_type: 'issue',
      entity_id: issue.id,
      project_id,
      issue_id: issue.id,
      description: `Created ${issue_type} ${issueKey}: ${title}`,
      metadata: { issue_type, priority, assignee_id }
    });

    // Notify assignee
    if (assignee_id && assignee_id !== req.user.id) {
      await client.query(
        `INSERT INTO notifications (user_id, title, message, type, entity_type, entity_id, action_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          assignee_id,
          'New Issue Assigned',
          `You have been assigned to ${issueKey}: ${title}`,
          'info',
          'issue',
          issue.id,
          `/issues/${issue.id}`
        ]
      );
    }

    await client.query('COMMIT');

    // Fetch complete issue with relations
    const completeIssue = await getIssueById(issue.id);
    res.status(201).json(completeIssue);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating issue:', error);
    res.status(500).json({ error: 'Failed to create issue' });
  } finally {
    client.release();
  }
};

// Get Issues
exports.getIssues = async (req, res) => {
  const {
    project_id,
    sprint_id,
    assignee_id,
    reporter_id,
    status,
    priority,
    issue_type,
    search,
    limit = 50,
    offset = 0
  } = req.query;

  try {
    let query = `
      SELECT 
        i.*,
        u_assignee.username as assignee_name,
        u_reporter.username as reporter_name,
        p.project_number,
        s.name as sprint_name,
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', l.id, 'name', l.name, 'color', l.color)) 
          FILTER (WHERE l.id IS NOT NULL), '[]') as labels,
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', w.user_id, 'username', u_watcher.username)) 
          FILTER (WHERE w.user_id IS NOT NULL), '[]') as watchers,
        (SELECT COUNT(*) FROM issue_comments WHERE issue_id = i.id) as comment_count
      FROM issues i
      LEFT JOIN users u_assignee ON i.assignee_id = u_assignee.id
      LEFT JOIN users u_reporter ON i.reporter_id = u_reporter.id
      LEFT JOIN projects p ON i.project_id = p.id
      LEFT JOIN sprints s ON i.sprint_id = s.id
      LEFT JOIN issue_labels il ON i.id = il.issue_id
      LEFT JOIN labels l ON il.label_id = l.id
      LEFT JOIN issue_watchers w ON i.id = w.issue_id
      LEFT JOIN users u_watcher ON w.user_id = u_watcher.id
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

    if (assignee_id) {
      query += ` AND i.assignee_id = $${paramCount}`;
      params.push(assignee_id);
      paramCount++;
    }

    if (reporter_id) {
      query += ` AND i.reporter_id = $${paramCount}`;
      params.push(reporter_id);
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

    if (issue_type) {
      query += ` AND i.issue_type = $${paramCount}`;
      params.push(issue_type);
      paramCount++;
    }

    if (search) {
      query += ` AND (i.title ILIKE $${paramCount} OR i.description ILIKE $${paramCount} OR i.issue_key ILIKE $${paramCount})`;
      params.push(`%${search}%`);
      paramCount++;
    }

    query += ` GROUP BY i.id, u_assignee.username, u_reporter.username, p.project_number, s.name`;
    query += ` ORDER BY i.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    res.json({ issues: result.rows, total: result.rows.length });
  } catch (error) {
    console.error('Error fetching issues:', error);
    res.status(500).json({ error: 'Failed to fetch issues' });
  }
};

// Get Issue by ID
const getIssueById = async (issueId) => {
  const result = await pool.query(
    `SELECT 
      i.*,
      u_assignee.username as assignee_name,
      u_assignee.email as assignee_email,
      u_reporter.username as reporter_name,
      p.project_number,
      p.company_name,
      s.name as sprint_name,
      COALESCE(json_agg(DISTINCT jsonb_build_object('id', l.id, 'name', l.name, 'color', l.color)) 
        FILTER (WHERE l.id IS NOT NULL), '[]') as labels,
      COALESCE(json_agg(DISTINCT jsonb_build_object('id', w.user_id, 'username', u_watcher.username)) 
        FILTER (WHERE w.user_id IS NOT NULL), '[]') as watchers
    FROM issues i
    LEFT JOIN users u_assignee ON i.assignee_id = u_assignee.id
    LEFT JOIN users u_reporter ON i.reporter_id = u_reporter.id
    LEFT JOIN projects p ON i.project_id = p.id
    LEFT JOIN sprints s ON i.sprint_id = s.id
    LEFT JOIN issue_labels il ON i.id = il.issue_id
    LEFT JOIN labels l ON il.label_id = l.id
    LEFT JOIN issue_watchers w ON i.id = w.issue_id
    LEFT JOIN users u_watcher ON w.user_id = u_watcher.id
    WHERE i.id = $1
    GROUP BY i.id, u_assignee.username, u_assignee.email, u_reporter.username, p.project_number, p.company_name, s.name`,
    [issueId]
  );

  return result.rows[0];
};

exports.getIssue = async (req, res) => {
  try {
    const issue = await getIssueById(req.params.id);
    if (!issue) {
      return res.status(404).json({ error: 'Issue not found' });
    }
    res.json(issue);
  } catch (error) {
    console.error('Error fetching issue:', error);
    res.status(500).json({ error: 'Failed to fetch issue' });
  }
};

// Update Issue
exports.updateIssue = async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get current issue state
    const currentIssue = await client.query('SELECT * FROM issues WHERE id = $1', [id]);
    if (currentIssue.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Issue not found' });
    }

    const oldIssue = currentIssue.rows[0];
    const changes = [];

    // Build update query dynamically
    const allowedFields = [
      'title', 'description', 'status', 'priority', 'assignee_id',
      'sprint_id', 'story_points', 'estimated_hours', 'due_date',
      'issue_type', 'resolution', 'environment', 'affects_version', 'fix_version'
    ];

    const updateFields = [];
    const updateValues = [];
    let paramCount = 1;

    for (const field of allowedFields) {
      if (updates[field] !== undefined && updates[field] !== oldIssue[field]) {
        updateFields.push(`${field} = $${paramCount}`);
        updateValues.push(updates[field]);
        paramCount++;
        changes.push({ field, old: oldIssue[field], new: updates[field] });
      }
    }

    if (updateFields.length === 0 && !updates.labels) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    if (updateFields.length > 0) {
      updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
      updateValues.push(id);

      const updateQuery = `
        UPDATE issues 
        SET ${updateFields.join(', ')}
        WHERE id = $${paramCount}
        RETURNING *
      `;

      await client.query(updateQuery, updateValues);
    }

    // Track status change
    if (updates.status && updates.status !== oldIssue.status) {
      await client.query(
        `INSERT INTO issue_status_history (issue_id, old_status, new_status, changed_by, comment)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, oldIssue.status, updates.status, req.user.id, updates.status_comment || null]
      );

      // Update resolved_at or closed_at
      if (updates.status === 'Done') {
        await client.query(
          'UPDATE issues SET resolved_at = CURRENT_TIMESTAMP WHERE id = $1 AND resolved_at IS NULL',
          [id]
        );
      }
    }

    // Update labels if provided
    if (updates.labels) {
      await client.query('DELETE FROM issue_labels WHERE issue_id = $1', [id]);
      for (const labelId of updates.labels) {
        await client.query(
          'INSERT INTO issue_labels (issue_id, label_id) VALUES ($1, $2)',
          [id, labelId]
        );
      }
    }

    // Log activity
    await logActivity(client, {
      user_id: req.user.id,
      action_type: 'issue_updated',
      entity_type: 'issue',
      entity_id: id,
      project_id: oldIssue.project_id,
      issue_id: id,
      description: `Updated issue ${oldIssue.issue_key}`,
      metadata: { changes }
    });

    // Notify watchers about significant changes
    if (changes.some(c => ['status', 'assignee_id', 'priority'].includes(c.field))) {
      const watchers = await client.query(
        'SELECT user_id FROM issue_watchers WHERE issue_id = $1 AND user_id != $2',
        [id, req.user.id]
      );

      for (const watcher of watchers.rows) {
        await client.query(
          `INSERT INTO notifications (user_id, title, message, type, entity_type, entity_id, action_url)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            watcher.user_id,
            'Issue Updated',
            `Issue ${oldIssue.issue_key} was updated`,
            'info',
            'issue',
            id,
            `/issues/${id}`
          ]
        );
      }
    }

    await client.query('COMMIT');

    const updatedIssue = await getIssueById(id);
    res.json(updatedIssue);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating issue:', error);
    res.status(500).json({ error: 'Failed to update issue' });
  } finally {
    client.release();
  }
};

// Delete Issue
exports.deleteIssue = async (req, res) => {
  const { id } = req.params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const issue = await client.query('SELECT * FROM issues WHERE id = $1', [id]);
    if (issue.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Issue not found' });
    }

    await client.query('DELETE FROM issues WHERE id = $1', [id]);

    await logActivity(client, {
      user_id: req.user.id,
      action_type: 'issue_deleted',
      entity_type: 'issue',
      entity_id: id,
      project_id: issue.rows[0].project_id,
      description: `Deleted issue ${issue.rows[0].issue_key}`,
      metadata: { issue: issue.rows[0] }
    });

    await client.query('COMMIT');
    res.json({ message: 'Issue deleted successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting issue:', error);
    res.status(500).json({ error: 'Failed to delete issue' });
  } finally {
    client.release();
  }
};

// Add Comment to Issue
exports.addComment = async (req, res) => {
  const { id } = req.params;
  const { content, is_internal = false } = req.body;

  if (!content) {
    return res.status(400).json({ error: 'Comment content is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const issue = await client.query('SELECT * FROM issues WHERE id = $1', [id]);
    if (issue.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Issue not found' });
    }

    const result = await client.query(
      `INSERT INTO issue_comments (issue_id, user_id, content, is_internal)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [id, req.user.id, content, is_internal]
    );

    await logActivity(client, {
      user_id: req.user.id,
      action_type: 'comment_added',
      entity_type: 'issue',
      entity_id: id,
      project_id: issue.rows[0].project_id,
      issue_id: id,
      description: `Commented on issue ${issue.rows[0].issue_key}`,
      metadata: { comment_id: result.rows[0].id }
    });

    // Notify watchers
    const watchers = await client.query(
      'SELECT user_id FROM issue_watchers WHERE issue_id = $1 AND user_id != $2',
      [id, req.user.id]
    );

    for (const watcher of watchers.rows) {
      await client.query(
        `INSERT INTO notifications (user_id, title, message, type, entity_type, entity_id, action_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          watcher.user_id,
          'New Comment',
          `New comment on ${issue.rows[0].issue_key}`,
          'info',
          'issue',
          id,
          `/issues/${id}`
        ]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error adding comment:', error);
    res.status(500).json({ error: 'Failed to add comment' });
  } finally {
    client.release();
  }
};

// Get Comments for Issue
exports.getComments = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT ic.*, u.username, u.first_name, u.last_name
       FROM issue_comments ic
       JOIN users u ON ic.user_id = u.id
       WHERE ic.issue_id = $1
       ORDER BY ic.created_at ASC`,
      [id]
    );

    res.json({ comments: result.rows });
  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
};

// Toggle Watcher
exports.toggleWatcher = async (req, res) => {
  const { id } = req.params;
  const { user_id } = req.body;

  const watcherId = user_id || req.user.id;

  try {
    const existing = await pool.query(
      'SELECT * FROM issue_watchers WHERE issue_id = $1 AND user_id = $2',
      [id, watcherId]
    );

    if (existing.rows.length > 0) {
      await pool.query(
        'DELETE FROM issue_watchers WHERE issue_id = $1 AND user_id = $2',
        [id, watcherId]
      );
      res.json({ watching: false });
    } else {
      await pool.query(
        'INSERT INTO issue_watchers (issue_id, user_id) VALUES ($1, $2)',
        [id, watcherId]
      );
      res.json({ watching: true });
    }
  } catch (error) {
    console.error('Error toggling watcher:', error);
    res.status(500).json({ error: 'Failed to toggle watcher' });
  }
};

module.exports = exports;
