const pool = require('../db/connection');

// Helper function to log activity in a transaction
exports.logActivity = async (client, activityData) => {
  const {
    user_id,
    action_type,
    entity_type,
    entity_id,
    project_id = null,
    issue_id = null,
    description,
    metadata = {}
  } = activityData;

  try {
    await client.query(
      `INSERT INTO activity_feed (
        user_id, action_type, entity_type, entity_id, 
        project_id, issue_id, description, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [user_id, action_type, entity_type, entity_id, project_id, issue_id, description, JSON.stringify(metadata)]
    );
  } catch (error) {
    console.error('Error logging activity:', error);
    // Don't throw - activity logging shouldn't break the main operation
  }
};

// Standalone version for non-transactional calls
exports.logActivityStandalone = async (activityData) => {
  const client = await pool.connect();
  try {
    await exports.logActivity(client, activityData);
  } catch (error) {
    console.error('Error in standalone activity logging:', error);
  } finally {
    client.release();
  }
};
