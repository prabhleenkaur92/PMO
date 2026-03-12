const pool = require('../db/connection');

// Create Label
exports.createLabel = async (req, res) => {
  const { name, color = '#3B82F6', description } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Label name is required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO labels (name, color, description)
       VALUES ($1, $2, $3) RETURNING *`,
      [name, color, description]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') { // Unique violation
      return res.status(400).json({ error: 'Label with this name already exists' });
    }
    console.error('Error creating label:', error);
    res.status(500).json({ error: 'Failed to create label' });
  }
};

// Get All Labels
exports.getLabels = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        l.*,
        COUNT(DISTINCT il.issue_id) as issue_count
      FROM labels l
      LEFT JOIN issue_labels il ON l.id = il.label_id
      GROUP BY l.id
      ORDER BY l.name ASC`
    );

    res.json({ labels: result.rows });
  } catch (error) {
    console.error('Error fetching labels:', error);
    res.status(500).json({ error: 'Failed to fetch labels' });
  }
};

// Get Label by ID
exports.getLabel = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT 
        l.*,
        COUNT(DISTINCT il.issue_id) as issue_count,
        COALESCE(json_agg(
          DISTINCT jsonb_build_object(
            'id', i.id,
            'issue_key', i.issue_key,
            'title', i.title,
            'status', i.status
          )
        ) FILTER (WHERE i.id IS NOT NULL), '[]') as issues
      FROM labels l
      LEFT JOIN issue_labels il ON l.id = il.label_id
      LEFT JOIN issues i ON il.issue_id = i.id
      WHERE l.id = $1
      GROUP BY l.id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Label not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching label:', error);
    res.status(500).json({ error: 'Failed to fetch label' });
  }
};

// Update Label
exports.updateLabel = async (req, res) => {
  const { id } = req.params;
  const { name, color, description } = req.body;

  const updateFields = [];
  const updateValues = [];
  let paramCount = 1;

  if (name) {
    updateFields.push(`name = $${paramCount}`);
    updateValues.push(name);
    paramCount++;
  }

  if (color) {
    updateFields.push(`color = $${paramCount}`);
    updateValues.push(color);
    paramCount++;
  }

  if (description !== undefined) {
    updateFields.push(`description = $${paramCount}`);
    updateValues.push(description);
    paramCount++;
  }

  if (updateFields.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  updateValues.push(id);

  try {
    const result = await pool.query(
      `UPDATE labels SET ${updateFields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      updateValues
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Label not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Label with this name already exists' });
    }
    console.error('Error updating label:', error);
    res.status(500).json({ error: 'Failed to update label' });
  }
};

// Delete Label
exports.deleteLabel = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM labels WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Label not found' });
    }

    res.json({ message: 'Label deleted successfully' });
  } catch (error) {
    console.error('Error deleting label:', error);
    res.status(500).json({ error: 'Failed to delete label' });
  }
};

module.exports = exports;
