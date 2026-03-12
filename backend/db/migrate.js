const pool = require('./connection');
const bcrypt = require('bcryptjs');

const initializeDatabase = async () => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Create enum types
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE role_type AS ENUM ('admin', 'finance', 'pmo', 'manager', 'auditor');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await client.query(`
      DO $$ BEGIN
        ALTER TYPE role_type ADD VALUE IF NOT EXISTS 'finance';
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await client.query(`
      DO $$ BEGIN
        CREATE TYPE project_type AS ENUM ('VAPT', 'Compliance', 'Both');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await client.query(`
      DO $$ BEGIN
        CREATE TYPE testing_type AS ENUM ('Blackbox', 'Whitebox', 'Graybox');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await client.query(`
      DO $$ BEGIN
        CREATE TYPE project_status AS ENUM ('New', 'Submitted_To_PMO', 'Assigned_To_Manager', 'Assigned', 'In Progress', 'Pending from Client', 'Completed', 'Closed');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await client.query(`
      DO $$ BEGIN
        ALTER TYPE project_status ADD VALUE IF NOT EXISTS 'Submitted_To_PMO';
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await client.query(`
      DO $$ BEGIN
        ALTER TYPE project_status ADD VALUE IF NOT EXISTS 'Assigned_To_Manager';
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    // Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        first_name VARCHAR(255),
        last_name VARCHAR(255),
        phone VARCHAR(20),
        role role_type NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        two_factor_enabled BOOLEAN DEFAULT FALSE,
        two_factor_secret VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP
      );
    `);

    // Roles table
    await client.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) UNIQUE NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Permissions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS permissions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) UNIQUE NOT NULL,
        module VARCHAR(50) NOT NULL,
        action VARCHAR(50) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Role permissions junction table
    await client.query(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
        permission_id UUID REFERENCES permissions(id) ON DELETE CASCADE,
        PRIMARY KEY (role_id, permission_id)
      );
    `);

    // Clients table
    await client.query(`
      CREATE TABLE IF NOT EXISTS clients (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        address TEXT,
        email VARCHAR(255),
        phone VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Points of Contact table
    await client.query(`
      CREATE TABLE IF NOT EXISTS points_of_contact (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(20),
        email VARCHAR(255),
        is_primary BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Projects table
    await client.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_number VARCHAR(50) UNIQUE NOT NULL,
        workorder_number VARCHAR(50),
        po_number VARCHAR(100),
        client_id UUID REFERENCES clients(id),
          company_name VARCHAR(255),
        company_address TEXT,
        project_type project_type NOT NULL,
        testing_type testing_type NOT NULL,
        scope_description TEXT NOT NULL,
        finance_project_type VARCHAR(50),
        billing_cycle VARCHAR(50),
        billing_start_date DATE,
        billing_end_date DATE,
        organization_category VARCHAR(255),
        reason_to_conduct_audit TEXT,
        sector_of_organization VARCHAR(255),
        type_of_audit VARCHAR(255),
        type_of_audit_other TEXT,
        reason_for_conducting_audit TEXT,
        client_spoc_name VARCHAR(255),
        client_spoc_email VARCHAR(255),
        client_spoc_phone VARCHAR(50),
        spoc_designation VARCHAR(255),
        manager_status VARCHAR(50),
        manager_notes TEXT,
        status project_status DEFAULT 'New',
        start_date DATE,
        expected_end_date DATE,
        actual_end_date DATE,
        created_by UUID REFERENCES users(id) ON DELETE CASCADE,
        assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Backward-compatible schema updates for existing deployments
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS workorder_number VARCHAR(50);`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS po_number VARCHAR(100);`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS company_address TEXT;`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS finance_project_type VARCHAR(50);`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS billing_cycle VARCHAR(50);`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS billing_start_date DATE;`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS billing_end_date DATE;`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS organization_category VARCHAR(255);`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS reason_to_conduct_audit TEXT;`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS sector_of_organization VARCHAR(255);`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS type_of_audit VARCHAR(255);`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS type_of_audit_other TEXT;`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS reason_for_conducting_audit TEXT;`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS origin_order_id UUID;`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS origin_subproject_id UUID;`);

    // Project Status History table
    await client.query(`
      CREATE TABLE IF NOT EXISTS project_status_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
        old_status project_status,
        new_status project_status,
        changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
        comment TEXT,
        changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Project Remarks/Comments table
    await client.query(`
      CREATE TABLE IF NOT EXISTS project_remarks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        remark_type VARCHAR(50), -- 'manager', 'auditor', 'pmo'
        content TEXT NOT NULL,
        is_visible_to_client BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // File Attachments table
    await client.query(`
      CREATE TABLE IF NOT EXISTS file_attachments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
        remark_id UUID REFERENCES project_remarks(id) ON DELETE CASCADE,
        file_name VARCHAR(255) NOT NULL,
        file_path TEXT NOT NULL,
        file_type VARCHAR(50),
        file_size BIGINT,
        uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Audit Logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        action VARCHAR(255) NOT NULL,
        entity_type VARCHAR(50),
        entity_id UUID,
        old_values JSONB,
        new_values JSONB,
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Access Logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS access_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        endpoint VARCHAR(255),
        method VARCHAR(10),
        status_code INTEGER,
        ip_address VARCHAR(45),
        user_agent TEXT,
        accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Chat messages table
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        sender_id UUID REFERENCES users(id) ON DELETE CASCADE,
        recipient_id UUID REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        read_at TIMESTAMP
      );
    `);

    // Invoice tracker: orders table
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
        order_number VARCHAR(100) UNIQUE NOT NULL,
        order_value NUMERIC(14,2) NOT NULL CHECK (order_value > 0),
        collection_strategy VARCHAR(30) NOT NULL,
        recurring_frequency VARCHAR(20),
        recurring_start_date DATE,
        recurring_end_date DATE,
        recurring_cycles INTEGER,
        recurring_amount_per_cycle NUMERIC(14,2),
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS order_subprojects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
        subproject_name VARCHAR(255) NOT NULL,
        assigned_team VARCHAR(100),
        subproject_value NUMERIC(14,2) NOT NULL CHECK (subproject_value > 0),
        collection_strategy VARCHAR(30) NOT NULL,
        recurring_frequency VARCHAR(20),
        recurring_start_date DATE,
        recurring_end_date DATE,
        recurring_cycles INTEGER,
        recurring_amount_per_cycle NUMERIC(14,2),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Invoice tracker: schedule rows (specific dates, recurring generated dates, milestone rows)
    await client.query(`
      CREATE TABLE IF NOT EXISTS order_payment_schedules (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
        subproject_id UUID REFERENCES order_subprojects(id) ON DELETE CASCADE,
        schedule_type VARCHAR(20) NOT NULL,
        payment_date DATE,
        amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
        milestone_name VARCHAR(255),
        expected_completion_date DATE,
        is_milestone_completed BOOLEAN DEFAULT FALSE,
        milestone_completed_at TIMESTAMP,
        payment_triggered BOOLEAN DEFAULT FALSE,
        payment_triggered_at TIMESTAMP,
        notified_upcoming_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE;`);
    await client.query(`ALTER TABLE order_payment_schedules ADD COLUMN IF NOT EXISTS subproject_id UUID REFERENCES order_subprojects(id) ON DELETE CASCADE;`);
    await client.query(`ALTER TABLE order_payment_schedules ADD COLUMN IF NOT EXISTS notified_upcoming_at TIMESTAMP;`);
    await client.query(`ALTER TABLE access_logs DROP CONSTRAINT IF EXISTS access_logs_user_id_fkey;`);
    await client.query(`ALTER TABLE access_logs ADD CONSTRAINT access_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;`);

    // Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_projects_client_id ON projects(client_id);
      CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
      CREATE INDEX IF NOT EXISTS idx_projects_assigned_to ON projects(assigned_to);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_workorder_unique ON projects(workorder_number) WHERE workorder_number IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_project_remarks_project_id ON project_remarks(project_id);
      CREATE INDEX IF NOT EXISTS idx_project_remarks_created_by ON project_remarks(created_by);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_id ON audit_logs(entity_id);
      CREATE INDEX IF NOT EXISTS idx_access_logs_user_id ON access_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_pair_time ON chat_messages(sender_id, recipient_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_recipient_unread ON chat_messages(recipient_id, is_read, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_orders_created_by ON orders(created_by);
      CREATE INDEX IF NOT EXISTS idx_orders_project_id ON orders(project_id);
      CREATE INDEX IF NOT EXISTS idx_order_subprojects_order_id ON order_subprojects(order_id);
      CREATE INDEX IF NOT EXISTS idx_order_payment_schedules_order_id ON order_payment_schedules(order_id);
      CREATE INDEX IF NOT EXISTS idx_order_payment_schedules_subproject_id ON order_payment_schedules(subproject_id);
      CREATE INDEX IF NOT EXISTS idx_order_payment_schedules_upcoming ON order_payment_schedules(payment_date, notified_upcoming_at);
    `);

    // Insert default roles
    await client.query(`
      INSERT INTO roles (name, description) VALUES
        ('Admin', 'Full system access'),
        ('Finance', 'Project creation and handoff to PMO'),
        ('PMO', 'Project review, clarification, and handoff to Manager'),
        ('Manager', 'Project review and coordination'),
        ('Auditor', 'Project execution and reporting')
      ON CONFLICT (name) DO NOTHING;
    `);

    // Migrate legacy PMO users to Finance role to preserve old behavior.
    await client.query(`
      UPDATE users
      SET role = 'finance'
      WHERE role = 'pmo'
        AND id IN (
          SELECT id FROM users WHERE role = 'pmo'
        );
    `);

    // Insert permissions
    const permissions = [
      // Project permissions
      { name: 'project_create', module: 'projects', action: 'create', description: 'Create new projects' },
      { name: 'project_read', module: 'projects', action: 'read', description: 'View projects' },
      { name: 'project_edit', module: 'projects', action: 'edit', description: 'Edit projects' },
      { name: 'project_approve', module: 'projects', action: 'approve', description: 'Approve projects' },
      { name: 'project_delete', module: 'projects', action: 'delete', description: 'Delete projects' },
      
      // User management permissions
      { name: 'user_create', module: 'users', action: 'create', description: 'Create users' },
      { name: 'user_read', module: 'users', action: 'read', description: 'View users' },
      { name: 'user_edit', module: 'users', action: 'edit', description: 'Edit users' },
      { name: 'user_delete', module: 'users', action: 'delete', description: 'Delete users' },
      
      // Role permissions
      { name: 'role_manage', module: 'roles', action: 'manage', description: 'Manage roles and permissions' },
      
      // Audit permissions
      { name: 'audit_view', module: 'audit', action: 'view', description: 'View audit logs' }
    ];

    for (const perm of permissions) {
      await client.query(
        `INSERT INTO permissions (name, module, action, description) VALUES ($1, $2, $3, $4) ON CONFLICT (name) DO NOTHING`,
        [perm.name, perm.module, perm.action, perm.description]
      );
    }

    // Insert default admin user
    const adminPassword = await bcrypt.hash('admin', 10);
    await client.query(
      `INSERT INTO users (username, email, password_hash, first_name, last_name, role, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (username) DO NOTHING`,
      ['admin', 'admin@pmo-portal.local', adminPassword, 'Admin', 'User', 'admin', true]
    );

    await client.query('COMMIT');
    console.log('Database initialized successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error initializing database:', error);
    throw error;
  } finally {
    client.release();
  }
};

// Run if executed directly
if (require.main === module) {
  initializeDatabase()
    .then(() => {
      console.log('Migration completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = { initializeDatabase };
