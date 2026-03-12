const pool = require('../db/connection');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/documents');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
});

// Upload document
exports.uploadDocument = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const { entityType, entityId, description } = req.body;

  try {
    const client = await pool.connect();
    await client.query('BEGIN');

    // Check if this is a new file or a new version of existing file
    const existingRes = await client.query(
      `SELECT * FROM issue_attachments WHERE issue_id = $1 AND file_name = $2 
       ORDER BY version DESC LIMIT 1`,
      [entityId, req.file.originalname]
    );

    const version = existingRes.rows.length > 0 ? existingRes.rows[0].version + 1 : 1;
    const originalFileId = existingRes.rows.length > 0 ? existingRes.rows[0].id : uuidv4();

    // Mark old version as not latest
    if (existingRes.rows.length > 0) {
      await client.query(
        `UPDATE issue_attachments SET is_latest_version = false WHERE id = $1`,
        [existingRes.rows[0].id]
      );
    }

    // Insert new attachment
    const result = await client.query(
      `INSERT INTO issue_attachments (
        issue_id, file_name, file_path, file_type, file_size, 
        version, is_latest_version, uploaded_by, uploaded_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      RETURNING *`,
      [
        entityId, req.file.originalname, req.file.path, 
        req.file.mimetype, req.file.size, version, 
        true, req.user.id
      ]
    );

    // Also store in document_versions
    await client.query(
      `INSERT INTO document_versions (
        original_file_id, file_name, file_path, file_type, 
        file_size, version_number, change_description, uploaded_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        originalFileId, req.file.originalname, req.file.path, 
        req.file.mimetype, req.file.size, version, 
        description, req.user.id
      ]
    );

    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error uploading document:', error);
    res.status(500).json({ error: 'Failed to upload document' });
  } finally {
    client.release();
  }
};

// Get attachments for entity
exports.getAttachments = async (req, res) => {
  const { entityId } = req.params;

  try {
    const result = await pool.query(
      `SELECT ia.*, u.first_name as uploaded_by_name,
              (SELECT COUNT(*) FROM document_versions WHERE original_file_id = ia.id) as version_count
       FROM issue_attachments ia
       LEFT JOIN users u ON ia.uploaded_by = u.id
       WHERE ia.issue_id = $1
       ORDER BY ia.uploaded_at DESC`,
      [entityId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error getting attachments:', error);
    res.status(500).json({ error: 'Failed to get attachments' });
  }
};

// Get specific attachment
exports.getAttachment = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT * FROM issue_attachments WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error getting attachment:', error);
    res.status(500).json({ error: 'Failed to get attachment' });
  }
};

// Download attachment
exports.downloadAttachment = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT * FROM issue_attachments WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    const file = result.rows[0];
    res.download(file.file_path, file.file_name);
  } catch (error) {
    console.error('Error downloading attachment:', error);
    res.status(500).json({ error: 'Failed to download attachment' });
  }
};

// Get document versions
exports.getVersions = async (req, res) => {
  const { documentId } = req.params;

  try {
    const result = await pool.query(
      `SELECT dv.*, u.first_name as uploaded_by_name, u.last_name
       FROM document_versions dv
       LEFT JOIN users u ON dv.uploaded_by = u.id
       WHERE dv.original_file_id = $1
       ORDER BY dv.version_number DESC`,
      [documentId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error getting versions:', error);
    res.status(500).json({ error: 'Failed to get versions' });
  }
};

// Restore document version
exports.restoreVersion = async (req, res) => {
  const { versionId } = req.params;

  try {
    // Get the version to restore
    const versionRes = await pool.query(
      `SELECT * FROM document_versions WHERE id = $1`,
      [versionId]
    );

    if (versionRes.rows.length === 0) {
      return res.status(404).json({ error: 'Version not found' });
    }

    const version = versionRes.rows[0];

    // Mark current as not latest
    await pool.query(
      `UPDATE issue_attachments SET is_latest_version = false 
       WHERE original_file_id = $1 AND is_latest_version = true`,
      [version.original_file_id]
    );

    // Create new attachment for restored version
    await pool.query(
      `INSERT INTO issue_attachments (
        issue_id, file_name, file_path, file_type, file_size, 
        version, is_latest_version, uploaded_by
      ) SELECT ia.issue_id, ia.file_name, $2, ia.file_type, ia.file_size,
               (SELECT MAX(version) FROM issue_attachments WHERE original_file_id = ia.id) + 1,
               true, $3
       FROM issue_attachments ia WHERE ia.id = (
        SELECT id FROM issue_attachments WHERE original_file_id = $1 LIMIT 1
       )`,
      [version.original_file_id, version.file_path, req.user.id]
    );

    res.json({ success: true, message: 'Version restored' });
  } catch (error) {
    console.error('Error restoring version:', error);
    res.status(500).json({ error: 'Failed to restore version' });
  }
};

// Delete version
exports.deleteVersion = async (req, res) => {
  const { versionId } = req.params;

  try {
    const result = await pool.query(
      `SELECT * FROM document_versions WHERE id = $1`,
      [versionId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Version not found' });
    }

    const version = result.rows[0];

    // Delete file
    if (fs.existsSync(version.file_path)) {
      fs.unlinkSync(version.file_path);
    }

    // Delete from database
    await pool.query(
      `DELETE FROM document_versions WHERE id = $1`,
      [versionId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting version:', error);
    res.status(500).json({ error: 'Failed to delete version' });
  }
};

module.exports.upload = upload;
