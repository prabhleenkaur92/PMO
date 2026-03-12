const pool = require('../db/connection');

const ensureFinanceAndPmoRoles = async () => {
  // Ensure enum values exist.
  await pool.query(`
    DO $$ BEGIN
      ALTER TYPE role_type ADD VALUE IF NOT EXISTS 'finance';
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);

  await pool.query(`
    DO $$ BEGIN
      ALTER TYPE role_type ADD VALUE IF NOT EXISTS 'pmo';
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);

  // Ensure role metadata rows exist for admin UI role management.
  await pool.query(`
    INSERT INTO roles (name, description) VALUES
      ('Finance', 'Project creation and handoff to PMO'),
      ('PMO', 'Project review, clarification, and handoff to Manager')
    ON CONFLICT (name) DO NOTHING;
  `);
};

module.exports = { ensureFinanceAndPmoRoles };
