const pool = require('../db/connection');
const { PROJECT_FORM_FIELDS, ROLE_VALUES } = require('../config/projectFormFields');

let schemaReady = false;
let schemaPromise = null;

const ensureFieldVisibilityTable = async () => {
  if (schemaReady) return;
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS form_field_visibility (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        role role_type NOT NULL,
        module VARCHAR(100) NOT NULL,
        field_key VARCHAR(100) NOT NULL,
        is_visible BOOLEAN NOT NULL DEFAULT TRUE,
        updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(role, module, field_key)
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_form_field_visibility_role_module
      ON form_field_visibility(role, module);
    `);

    schemaReady = true;
    schemaPromise = null;
  })();

  return schemaPromise;
};

const getVisibilityMapForRole = async (role, module = 'project_form') => {
  await ensureFieldVisibilityTable();

  const result = await pool.query(
    'SELECT field_key, is_visible FROM form_field_visibility WHERE role = $1 AND module = $2',
    [role, module]
  );

  const map = {};
  for (const field of PROJECT_FORM_FIELDS) {
    map[field.key] = true;
  }

  for (const row of result.rows) {
    map[row.field_key] = row.is_visible;
  }

  return map;
};

const getVisibilityRowsForRole = async (role, module = 'project_form') => {
  const map = await getVisibilityMapForRole(role, module);
  return PROJECT_FORM_FIELDS.map((field) => ({
    key: field.key,
    label: field.label,
    isVisible: map[field.key] !== false
  }));
};

const upsertFieldVisibility = async ({ role, module = 'project_form', fieldKey, isVisible, updatedBy }) => {
  await ensureFieldVisibilityTable();

  if (!ROLE_VALUES.includes(role)) {
    throw new Error('Invalid role');
  }

  const fieldExists = PROJECT_FORM_FIELDS.some((f) => f.key === fieldKey);
  if (!fieldExists) {
    throw new Error('Invalid field key');
  }

  await pool.query(
    `INSERT INTO form_field_visibility (role, module, field_key, is_visible, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
     ON CONFLICT (role, module, field_key)
     DO UPDATE SET is_visible = EXCLUDED.is_visible, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
    [role, module, fieldKey, isVisible, updatedBy || null]
  );
};

module.exports = {
  ensureFieldVisibilityTable,
  getVisibilityMapForRole,
  getVisibilityRowsForRole,
  upsertFieldVisibility
};
