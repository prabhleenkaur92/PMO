const pool = require('../db/connection');
const { logAudit } = require('../middleware/logger');
const { sendMail } = require('../utils/mailer');
const { getVisibilityMapForRole } = require('../utils/fieldVisibility');
const notifications = require('../utils/notifications');

// Generate project number
const generateProjectNumber = async () => {
  const result = await pool.query(
    `SELECT COUNT(*) + 1 as count FROM projects WHERE created_at > CURRENT_DATE - INTERVAL '1 year'`
  );
  const year = new Date().getFullYear();
  const count = String(result.rows[0].count).padStart(4, '0');
  return `PRJ-${year}-${count}`;
};

const generateWorkorderNumber = async () => {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const prefix = `WO-${year}-${month}-`;

  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM projects
     WHERE workorder_number LIKE $1`,
    [`${prefix}%`]
  );
  const serial = String((result.rows[0]?.count || 0) + 1).padStart(4, '0');
  return `${prefix}${serial}`;
};

let schemaEnsured = false;
let schemaEnsurePromise = null;

const ensureProjectExtendedColumns = async () => {
  if (schemaEnsured) return;
  if (schemaEnsurePromise) return schemaEnsurePromise;

  schemaEnsurePromise = (async () => {
    const client = await pool.connect();
    try {
      // Backward compatibility for environments where migration was not applied yet.
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
      await client.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_workorder_unique ON projects(workorder_number) WHERE workorder_number IS NOT NULL;`
      );
      schemaEnsured = true;
    } finally {
      client.release();
      schemaEnsurePromise = null;
    }
  })();

  return schemaEnsurePromise;
};

const getNextRolesForRole = (role) => {
  if (role === 'finance') return ['pmo'];
  if (role === 'pmo') return ['manager'];
  if (role === 'manager') return ['auditor'];
  return [];
};

const notifyRoles = async (roles, message, data = {}) => {
  try {
    await notifications.safeNotifyRoles(roles, message, data);
  } catch (err) {
    console.error('Role notification error:', err);
  }
};

const normalizeFinanceProjectType = (value) => {
  if (!value) return null;
  const v = String(value).trim().toLowerCase();
  if (v === 'one time' || v === 'one-time' || v === 'onetime') return 'One time';
  if (v === 'recurring') return 'Recurring';
  return value;
};

const canViewFinancialProjectFields = (role) => ['finance', 'admin'].includes(role);

const sanitizeProjectForRole = (project = {}, role) => {
  if (canViewFinancialProjectFields(role)) return project;
  const sanitized = { ...project };
  delete sanitized.po_number;
  delete sanitized.finance_project_type;
  delete sanitized.billing_cycle;
  delete sanitized.billing_start_date;
  delete sanitized.billing_end_date;
  return sanitized;
};

const tableExists = async (client, tableName) => {
  const result = await client.query(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [tableName]
  );
  return !!result.rows[0]?.exists;
};

const isValidUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));

let governanceSchemaReady = false;
let governanceSchemaPromise = null;

const ensureProjectGovernanceSchema = async () => {
  if (governanceSchemaReady) return;
  if (governanceSchemaPromise) return governanceSchemaPromise;

  governanceSchemaPromise = (async () => {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS project_milestones (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          title VARCHAR(255) NOT NULL,
          description TEXT,
          due_date DATE NOT NULL,
          status VARCHAR(30) NOT NULL DEFAULT 'Pending',
          progress_weight NUMERIC(8,2) NOT NULL DEFAULT 1 CHECK (progress_weight > 0),
          completion_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (completion_percent >= 0 AND completion_percent <= 100),
          completed_at TIMESTAMP,
          updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS project_escalations (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          escalation_type VARCHAR(50) NOT NULL,
          severity VARCHAR(20) NOT NULL,
          reason TEXT NOT NULL,
          is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
          resolved_at TIMESTAMP,
          resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await client.query(`CREATE INDEX IF NOT EXISTS idx_project_milestones_project_id ON project_milestones(project_id);`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_project_milestones_due_date ON project_milestones(due_date, status);`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_project_escalations_project_id ON project_escalations(project_id, is_resolved);`);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_project_escalations_open_unique
        ON project_escalations(project_id, escalation_type)
        WHERE is_resolved = FALSE;
      `);

      governanceSchemaReady = true;
    } finally {
      client.release();
      governanceSchemaPromise = null;
    }
  })();

  return governanceSchemaPromise;
};

const daysBetween = (fromDate, toDate) => {
  const from = new Date(fromDate);
  const to = new Date(toDate);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((to - from) / msPerDay);
};

const getHealthIndicator = ({ delayDays = 0, overdueMilestones = 0, inactiveDays = 0, dueSoonMilestones = 0 }) => {
  if (delayDays > 0 || overdueMilestones > 0) return 'Delayed';
  if (inactiveDays >= 7) return 'At Risk';
  if (dueSoonMilestones > 0) return 'At Risk';
  return 'On Track';
};

const buildGovernanceSnapshotForProjects = async (projects = []) => {
  await ensureProjectGovernanceSchema();
  if (!Array.isArray(projects) || projects.length === 0) return {};

  const projectIds = projects.map((p) => p.id).filter(Boolean);
  if (projectIds.length === 0) return {};

  const milestoneAggRes = await pool.query(
    `SELECT
       project_id,
       COUNT(*)::int AS total_milestones,
       COUNT(*) FILTER (WHERE status = 'Completed')::int AS completed_milestones,
       COUNT(*) FILTER (WHERE status <> 'Completed' AND due_date < CURRENT_DATE)::int AS overdue_milestones,
       COUNT(*) FILTER (WHERE status <> 'Completed' AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 day')::int AS due_soon_milestones,
       COALESCE(SUM(progress_weight), 0)::numeric AS total_weight,
       COALESCE(SUM(CASE WHEN status = 'Completed' THEN progress_weight ELSE 0 END), 0)::numeric AS completed_weight
     FROM project_milestones
     WHERE project_id = ANY($1::uuid[])
     GROUP BY project_id`,
    [projectIds]
  );

  let scheduleMilestonesByProject = new Map();
  try {
    const scheduleAggRes = await pool.query(
      `SELECT
         p.id AS project_id,
         COUNT(*)::int AS total_milestones,
         COUNT(*) FILTER (WHERE s.is_milestone_completed = TRUE)::int AS completed_milestones,
         COUNT(*) FILTER (
           WHERE s.is_milestone_completed = FALSE
             AND COALESCE(s.expected_completion_date, s.payment_date) < CURRENT_DATE
         )::int AS overdue_milestones,
         COUNT(*) FILTER (
           WHERE s.is_milestone_completed = FALSE
             AND COALESCE(s.expected_completion_date, s.payment_date) BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '7 day')
         )::int AS due_soon_milestones
       FROM projects p
       JOIN orders o ON o.project_id = p.id
       JOIN order_payment_schedules s ON s.order_id = o.id
       WHERE p.id = ANY($1::uuid[])
         AND s.schedule_type = 'milestone'
       GROUP BY p.id

       UNION ALL

       SELECT
         p.id AS project_id,
         COUNT(*)::int AS total_milestones,
         COUNT(*) FILTER (WHERE s.is_milestone_completed = TRUE)::int AS completed_milestones,
         COUNT(*) FILTER (
           WHERE s.is_milestone_completed = FALSE
             AND COALESCE(s.expected_completion_date, s.payment_date) < CURRENT_DATE
         )::int AS overdue_milestones,
         COUNT(*) FILTER (
           WHERE s.is_milestone_completed = FALSE
             AND COALESCE(s.expected_completion_date, s.payment_date) BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '7 day')
         )::int AS due_soon_milestones
       FROM projects p
       JOIN order_payment_schedules s ON s.subproject_id = p.origin_subproject_id
       WHERE p.id = ANY($1::uuid[])
         AND p.origin_subproject_id IS NOT NULL
         AND s.schedule_type = 'milestone'
       GROUP BY p.id`,
      [projectIds]
    );

    const aggregateMap = new Map();
    scheduleAggRes.rows.forEach((row) => {
      const existing = aggregateMap.get(row.project_id) || {
        total_milestones: 0,
        completed_milestones: 0,
        overdue_milestones: 0,
        due_soon_milestones: 0
      };
      aggregateMap.set(row.project_id, {
        total_milestones: existing.total_milestones + Number(row.total_milestones || 0),
        completed_milestones: existing.completed_milestones + Number(row.completed_milestones || 0),
        overdue_milestones: existing.overdue_milestones + Number(row.overdue_milestones || 0),
        due_soon_milestones: existing.due_soon_milestones + Number(row.due_soon_milestones || 0)
      });
    });
    scheduleMilestonesByProject = aggregateMap;
  } catch (_) {
    scheduleMilestonesByProject = new Map();
  }

  const activityRes = await pool.query(
    `SELECT
       p.id AS project_id,
       GREATEST(
         COALESCE(p.updated_at, p.created_at),
         COALESCE((SELECT MAX(changed_at) FROM project_status_history sh WHERE sh.project_id = p.id), to_timestamp(0)),
         COALESCE((SELECT MAX(created_at) FROM project_remarks pr WHERE pr.project_id = p.id), to_timestamp(0)),
         COALESCE((SELECT MAX(updated_at) FROM project_milestones pm WHERE pm.project_id = p.id), to_timestamp(0))
       ) AS last_activity_at
     FROM projects p
     WHERE p.id = ANY($1::uuid[])`,
    [projectIds]
  );

  const milestonesByProject = new Map(milestoneAggRes.rows.map((r) => [r.project_id, r]));
  const activityByProject = new Map(activityRes.rows.map((r) => [r.project_id, r.last_activity_at]));

  const byId = new Map(projects.map((p) => [p.id, p]));

  let parentLookup = new Map();
  const originOrderIds = projects.map((p) => p.origin_order_id).filter(Boolean);
  if (originOrderIds.length > 0) {
    try {
      const orderRes = await pool.query('SELECT id, project_id FROM orders WHERE id = ANY($1::uuid[])', [originOrderIds]);
      parentLookup = new Map(orderRes.rows.map((r) => [r.id, r.project_id]));
    } catch (_) {
      parentLookup = new Map();
    }
  }

  const managerBySubproject = new Map();
  const managerByParentProject = new Map();
  const originSubprojectIds = projects.map((p) => p.origin_subproject_id).filter(Boolean);
  if (originSubprojectIds.length > 0) {
    try {
      const subMgrRes = await pool.query(
        `SELECT sp.id, sp.assigned_team, u.username AS manager_name
         FROM order_subprojects sp
         LEFT JOIN users u ON u.id::text = sp.assigned_team
         WHERE sp.id = ANY($1::uuid[])`,
        [originSubprojectIds]
      );
      subMgrRes.rows.forEach((r) => managerBySubproject.set(r.id, r));
    } catch (_) {
      // keep empty map in environments without order schema
    }
  }

  try {
    const parentManagerRes = await pool.query(
      `SELECT o.project_id, STRING_AGG(DISTINCT u.username, ', ') AS manager_names
       FROM orders o
       JOIN order_subprojects sp ON sp.order_id = o.id
       LEFT JOIN users u ON u.id::text = sp.assigned_team
       WHERE o.project_id = ANY($1::uuid[])
       GROUP BY o.project_id`,
      [projectIds]
    );
    parentManagerRes.rows.forEach((r) => managerByParentProject.set(r.project_id, r.manager_names || null));
  } catch (_) {
    // ignore when order tables are unavailable in old deployments
  }

  const childrenByParent = new Map();
  projects.forEach((p) => {
    if (!p.origin_order_id) return;
    const parentId = parentLookup.get(p.origin_order_id);
    if (!parentId) return;
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(p.id);
  });

  const baseMetrics = new Map();
  const today = new Date();

  projects.forEach((project) => {
    const milestoneRow = milestonesByProject.get(project.id) || {};
    const scheduleFallback = scheduleMilestonesByProject.get(project.id) || {};
    const totalMilestones = Number(milestoneRow.total_milestones || 0) || Number(scheduleFallback.total_milestones || 0);
    const completedMilestones = Number(milestoneRow.completed_milestones || 0) || Number(scheduleFallback.completed_milestones || 0);
    const overdueMilestones = Number(milestoneRow.overdue_milestones || 0) || Number(scheduleFallback.overdue_milestones || 0);
    const dueSoonMilestones = Number(milestoneRow.due_soon_milestones || 0) || Number(scheduleFallback.due_soon_milestones || 0);
    const totalWeight = Number(milestoneRow.total_weight || 0);
    const completedWeight = Number(milestoneRow.completed_weight || 0);

    let progressPercent = 0;
    if (totalWeight > 0) {
      progressPercent = Math.round((completedWeight / totalWeight) * 100);
    } else if (totalMilestones > 0) {
      progressPercent = Math.round((completedMilestones / Math.max(1, totalMilestones)) * 100);
    } else {
      const status = String(project.status || '').toLowerCase();
      if (status.includes('closed') || status.includes('completed')) progressPercent = 100;
      else if (status.includes('in progress')) progressPercent = 60;
      else if (status.includes('assigned')) progressPercent = 25;
      else progressPercent = 5;
    }

    const expectedEndDate = project.expected_end_date ? new Date(project.expected_end_date) : null;
    const delayDays = expectedEndDate && expectedEndDate < today ? Math.max(0, daysBetween(expectedEndDate, today)) : 0;
    const lastActivity = activityByProject.get(project.id) || project.updated_at || project.created_at;
    const inactiveDays = lastActivity ? Math.max(0, daysBetween(lastActivity, today)) : 0;

    const rawManager = project.origin_subproject_id ? managerBySubproject.get(project.origin_subproject_id) : null;
    const assignedManagerId = rawManager?.assigned_team || null;
    const assignedManagerName = rawManager?.manager_name || managerByParentProject.get(project.id) || null;

    baseMetrics.set(project.id, {
      progress_percent: Math.max(0, Math.min(100, progressPercent)),
      total_milestones: totalMilestones,
      completed_milestones: completedMilestones,
      overdue_milestones: overdueMilestones,
      due_soon_milestones: dueSoonMilestones,
      delay_days: delayDays,
      inactive_days: inactiveDays,
      child_subproject_count: 0,
      parent_project_id: project.origin_order_id ? (parentLookup.get(project.origin_order_id) || null) : null,
      assigned_manager_id: assignedManagerId,
      assigned_manager_name: assignedManagerName,
      assigned_auditor_id: project.assigned_to || null,
      assigned_auditor_name: project.assigned_to_name || null
    });
  });

  const rolled = new Map();
  baseMetrics.forEach((metric, projectId) => {
    const childIds = childrenByParent.get(projectId) || [];
    if (childIds.length === 0) {
      const health = getHealthIndicator(metric);
      rolled.set(projectId, { ...metric, health_indicator: health, risk_flag: health !== 'On Track' });
      return;
    }

    const childMetrics = childIds.map((childId) => baseMetrics.get(childId)).filter(Boolean);
    const childProgressAvg = childMetrics.length > 0
      ? Math.round(childMetrics.reduce((sum, m) => sum + Number(m.progress_percent || 0), 0) / childMetrics.length)
      : 0;

    const progressPercent = Math.round((Number(metric.progress_percent || 0) * 0.4) + (childProgressAvg * 0.6));
    const overdueMilestones = Number(metric.overdue_milestones || 0) + childMetrics.reduce((sum, m) => sum + Number(m.overdue_milestones || 0), 0);
    const dueSoonMilestones = Number(metric.due_soon_milestones || 0) + childMetrics.reduce((sum, m) => sum + Number(m.due_soon_milestones || 0), 0);
    const delayDays = Math.max(Number(metric.delay_days || 0), ...childMetrics.map((m) => Number(m.delay_days || 0)));
    const inactiveDays = Math.max(Number(metric.inactive_days || 0), ...childMetrics.map((m) => Number(m.inactive_days || 0)));

    const merged = {
      ...metric,
      progress_percent: Math.max(0, Math.min(100, progressPercent)),
      overdue_milestones: overdueMilestones,
      due_soon_milestones: dueSoonMilestones,
      delay_days: delayDays,
      inactive_days: inactiveDays,
      child_subproject_count: childIds.length
    };
    const health = getHealthIndicator(merged);
    rolled.set(projectId, { ...merged, health_indicator: health, risk_flag: health !== 'On Track' });
  });

  const escalations = [];
  rolled.forEach((metric, projectId) => {
    if (metric.overdue_milestones > 0) {
      escalations.push([projectId, 'OVERDUE_MILESTONE', 'HIGH', `Project has ${metric.overdue_milestones} overdue milestone(s)`]);
    }
    if (metric.delay_days > 0) {
      escalations.push([projectId, 'PROJECT_DELAY', metric.delay_days > 7 ? 'HIGH' : 'MEDIUM', `Project is delayed by ${metric.delay_days} day(s)`]);
    }
    if (metric.inactive_days >= 7) {
      escalations.push([projectId, 'INACTIVE_UPDATES', 'MEDIUM', `No significant updates for ${metric.inactive_days} day(s)`]);
    }
  });

  for (const [projectId, escalationType, severity, reason] of escalations) {
    await pool.query(
      `INSERT INTO project_escalations (project_id, escalation_type, severity, reason)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_id, escalation_type) WHERE is_resolved = FALSE
       DO NOTHING`,
      [projectId, escalationType, severity, reason]
    );
  }

  const openEscRes = await pool.query(
    `SELECT project_id, COUNT(*)::int AS open_escalations
     FROM project_escalations
     WHERE project_id = ANY($1::uuid[]) AND is_resolved = FALSE
     GROUP BY project_id`,
    [projectIds]
  );
  const openEscMap = new Map(openEscRes.rows.map((r) => [r.project_id, Number(r.open_escalations || 0)]));

  const out = {};
  projects.forEach((project) => {
    const metric = rolled.get(project.id) || {};
    out[project.id] = {
      ...metric,
      open_escalations: openEscMap.get(project.id) || 0
    };
  });
  return out;
};

const attachGovernanceToProjects = async (projects = []) => {
  const governance = await buildGovernanceSnapshotForProjects(projects);
  return projects.map((project) => ({
    ...project,
    governance: governance[project.id] || {
      progress_percent: 0,
      total_milestones: 0,
      completed_milestones: 0,
      overdue_milestones: 0,
      due_soon_milestones: 0,
      delay_days: 0,
      inactive_days: 0,
      health_indicator: 'On Track',
      risk_flag: false,
      open_escalations: 0,
      child_subproject_count: 0,
      parent_project_id: null,
      assigned_manager_id: null,
      assigned_manager_name: null,
      assigned_auditor_id: project.assigned_to || null,
      assigned_auditor_name: project.assigned_to_name || null
    }
  }));
};

const managerCanAccessProject = async (projectId, userId) => {
  const direct = await pool.query('SELECT id FROM projects WHERE id = $1 AND assigned_to = $2', [projectId, userId]);
  if (direct.rows.length > 0) return true;

  try {
    const viaOrder = await pool.query(
      `SELECT 1
       FROM orders o
       JOIN order_subprojects sp ON sp.order_id = o.id
       WHERE o.project_id = $1
         AND sp.assigned_team = $2
       LIMIT 1`,
      [projectId, userId]
    );
    if (viaOrder.rows.length > 0) return true;
  } catch (_) {
    // ignore when order tables are unavailable in old deployments
  }

  return false;
};

const createProject = async (req, res) => {
  try {
    // Only Finance and Admin can create projects
    if (!['finance', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only Finance can create projects' });
    }

    const {
      companyName,
      companyAddress,
      workorderNumber,
      clientName,
      poc1Name,
      poc1Phone,
      poc1Email,
      poc1Designation,
      testingType,
      scopeDescription,
      startDate,
      expectedEndDate,
      poNumber,
      financeProjectType,
      billingCycle,
      billingStartDate,
      billingEndDate,
      organizationCategory,
      reasonToConductAudit,
      sectorOfOrganization,
      typeOfAudit,
      typeOfAuditOther
    } = req.body;

    const visibility = await getVisibilityMapForRole(req.user.role, 'project_form');
    const isVisible = (key) => visibility[key] !== false;

    if (
      (isVisible('companyName') && !companyName) ||
      (isVisible('companyAddress') && !companyAddress) ||
      (isVisible('spocName') && !poc1Name) ||
      (isVisible('spocEmail') && !poc1Email) ||
      (isVisible('testingType') && !testingType) ||
      (isVisible('scopeDescription') && !scopeDescription) ||
      (isVisible('startDate') && !startDate)
    ) {
      return res.status(400).json({ error: 'Missing required project details' });
    }

    if (
      (isVisible('organizationCategory') && !organizationCategory) ||
      (isVisible('reasonToConductAudit') && !reasonToConductAudit) ||
      (isVisible('sectorOfOrganization') && !sectorOfOrganization) ||
      (isVisible('typeOfAudit') && !typeOfAudit)
    ) {
      return res.status(400).json({ error: 'Missing required finance or audit metadata fields' });
    }

    if (typeOfAudit === 'Any other' && isVisible('typeOfAuditOther') && !typeOfAuditOther) {
      return res.status(400).json({ error: 'Please provide details for \"Any other\" audit type' });
    }

    // Determine client/company name (fallback to 'Unknown Client' to avoid DB constraint violations)
    const clientNameValue = companyName || clientName || 'Unknown Client';

    await ensureProjectExtendedColumns();

    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      // Create or get client (company)
      let clientResult = await client.query(
        'SELECT id FROM clients WHERE name = $1',
          [clientNameValue]
      );

      let clientId;
      if (clientResult.rows.length === 0) {
        const newClient = await client.query(
          'INSERT INTO clients (name, address) VALUES ($1, $2) RETURNING id',
            [clientNameValue, companyAddress || null]
        );
        clientId = newClient.rows[0].id;
      } else {
        clientId = clientResult.rows[0].id;
        if (companyAddress) {
          await client.query('UPDATE clients SET address = COALESCE($1, address), updated_at = CURRENT_TIMESTAMP WHERE id = $2', [companyAddress, clientId]);
        }
      }

      // Create points of contact
      // Insert primary SPOC
      if (poc1Name) {
        await client.query(
          'INSERT INTO points_of_contact (client_id, name, phone, email, is_primary) VALUES ($1, $2, $3, $4, $5)',
          [clientId, poc1Name, poc1Phone, poc1Email, true]
        );
      }

      // Generate project number
      const projectNumber = await generateProjectNumber();
      const workorderNumberValue = (workorderNumber || '').trim() || await generateWorkorderNumber();

      // Create project (include project_type to satisfy DB constraint)
      // `project_type` is an enum in the DB (e.g. 'VAPT'). Use provided projectType if present, otherwise default to 'VAPT'.
      const projectTypeValue = req.body.projectType || 'VAPT';
      const projectResult = await client.query(
        `INSERT INTO projects 
         (project_number, workorder_number, po_number, client_id, project_type, testing_type, scope_description, start_date, expected_end_date, created_by, status, company_name, company_address, finance_project_type, billing_cycle, billing_start_date, billing_end_date, organization_category, reason_to_conduct_audit, sector_of_organization, type_of_audit, type_of_audit_other, reason_for_conducting_audit, client_spoc_name, client_spoc_email, client_spoc_phone, spoc_designation)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)
         RETURNING *`,
        [
          projectNumber,
          workorderNumberValue,
          poNumber || null,
          clientId,
          projectTypeValue,
          testingType,
          scopeDescription,
          startDate,
          expectedEndDate || null,
          req.user.id,
          'Submitted_To_PMO',
          clientNameValue,
          companyAddress,
          normalizeFinanceProjectType(financeProjectType),
          normalizeFinanceProjectType(financeProjectType) === 'Recurring' ? billingCycle : null,
          normalizeFinanceProjectType(financeProjectType) === 'Recurring' ? billingStartDate : null,
          normalizeFinanceProjectType(financeProjectType) === 'Recurring' ? (billingEndDate || null) : null,
          organizationCategory,
          reasonToConductAudit,
          sectorOfOrganization,
          typeOfAudit,
          typeOfAudit === 'Any other' ? typeOfAuditOther : null,
          null,
          poc1Name,
          poc1Email,
          poc1Phone,
          poc1Designation
        ]
      );

      const project = projectResult.rows[0];

      // Notify next role in hierarchy (Finance -> PMO)
      try {
        const nextRoles = getNextRolesForRole(req.user.role);
        await notifyRoles(nextRoles, `Project submitted to PMO: ${projectNumber}`, { projectId: project.id });

        // Optional email for PMO users.
        const nextUsers = await pool.query(
          `SELECT email FROM users WHERE role = ANY($1::role_type[]) AND is_active = TRUE`,
          [nextRoles]
        );
        for (const u of nextUsers.rows) {
          if (!u.email) continue;
          sendMail({
            to: u.email,
            subject: `Project submitted to PMO: ${projectNumber}`,
            text: `Project ${projectNumber} has been submitted to PMO by ${req.user.username}.`
          }).catch(err => console.error('Email send error:', err));
        }
      } catch (notifErr) {
        console.error('Notification error:', notifErr);
      }

      // Log audit
      await logAudit(req.user.id, 'PROJECT_CREATED', 'projects', project.id, {}, project, req);

      await client.query('COMMIT');

      res.status(201).json({
        message: 'Project created successfully',
        project
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error creating project:', error);
    if (error.code === '23505' && String(error.constraint || '').includes('idx_projects_workorder_unique')) {
      return res.status(400).json({ error: 'Workorder number already exists' });
    }
    res.status(500).json({ error: error.message });
  }
};

const getProjects = async (req, res) => {
  try {
    const { status, clientId, auditedBy, projectType, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    let query = 'SELECT p.*, c.name as client_name, u.username as assigned_to_name FROM projects p LEFT JOIN clients c ON p.client_id = c.id LEFT JOIN users u ON p.assigned_to = u.id WHERE 1=1';
    const params = [];

    if (status) {
      query += ` AND p.status = $${params.length + 1}`;
      params.push(status);
    }

    if (clientId) {
      query += ` AND p.client_id = $${params.length + 1}`;
      params.push(clientId);
    }

    if (auditedBy) {
      query += ` AND p.assigned_to = $${params.length + 1}`;
      params.push(auditedBy);
    }

    if (projectType) {
      query += ` AND p.project_type = $${params.length + 1}`;
      params.push(projectType);
    }

    // Role-based filtering
    if (req.user.role === 'auditor') {
      // Auditor should only see projects assigned to them
      query += ` AND p.assigned_to = $${params.length + 1}`;
      params.push(req.user.id);
    } else if (req.user.role === 'finance') {
      query += ` AND p.created_by = $${params.length + 1}`;
      params.push(req.user.id);
    } else if (req.user.role === 'manager') {
      // Manager visibility is handled in a dedicated branch below.
      // Keeping base query free of manager-specific predicates avoids
      // type inference conflicts and allows merging parent + derived views.
    }

    // DEBUG: log constructed query and params for troubleshooting
    console.error('DEBUG getProjects query:', query);
    console.error('DEBUG getProjects params:', params);

    // For manager role we avoid mixing UUID and VARCHAR comparisons in a single
    // SQL statement which can cause Postgres to infer conflicting parameter types.
    // Instead, run targeted queries and merge parent + derived projects in JS,
    // then paginate.
    if (req.user.role === 'manager') {
      const baseQuery = query; // earlier filters already applied
      const baseParams = [...params];

      // Query A: projects directly assigned to manager
      const qA = `${baseQuery} AND p.assigned_to = $${baseParams.length + 1} ORDER BY p.created_at DESC`;
      const paramsA = [...baseParams, req.user.id];
      const resA = await pool.query(qA, paramsA);

      // Query B: parent projects that have order subprojects assigned to manager
      const projIdsRes = await pool.query(
        `SELECT DISTINCT o.project_id FROM orders o JOIN order_subprojects sp ON sp.order_id = o.id WHERE sp.assigned_team = $1`,
        [req.user.id]
      );
      const projIds = projIdsRes.rows.map(r => r.project_id).filter(Boolean);
      let resB = { rows: [] };
      if (projIds.length > 0) {
        const qB = `${baseQuery} AND p.id = ANY($${baseParams.length + 1}::uuid[]) ORDER BY p.created_at DESC`;
        const paramsB = [...baseParams, projIds];
        resB = await pool.query(qB, paramsB);
      }

      // Query C: derived subproject-projects where origin_subproject is assigned to manager
      const derivedIdsRes = await pool.query(
        `SELECT p.id
         FROM projects p
         JOIN order_subprojects sp ON sp.id = p.origin_subproject_id
         WHERE sp.assigned_team = $1`,
        [req.user.id]
      );
      const derivedIds = derivedIdsRes.rows.map((r) => r.id).filter(Boolean);
      let resC = { rows: [] };
      if (derivedIds.length > 0) {
        const qC = `${baseQuery} AND p.id = ANY($${baseParams.length + 1}::uuid[]) ORDER BY p.created_at DESC`;
        const paramsC = [...baseParams, derivedIds];
        resC = await pool.query(qC, paramsC);
      }

      // Merge unique projects by id (preserve order by created_at desc)
      const mergedMap = new Map();
      [...resA.rows, ...resB.rows, ...resC.rows].forEach(r => {
        if (!mergedMap.has(r.id)) mergedMap.set(r.id, r);
      });
      const merged = Array.from(mergedMap.values()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      const total = merged.length;
      const pages = Math.ceil(total / limit);
      const paged = merged.slice(offset, offset + Number(limit));

      return res.json({
        projects: paged.map((row) => sanitizeProjectForRole(row, req.user.role)),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages
        }
      });
    }

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM (${query}) as subquery`;
    const countResult = await pool.query(countQuery, params);
    const total = countResult.rows[0].total;

    // Get paginated results
    query += ` ORDER BY p.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.json({
      projects: result.rows.map((row) => sanitizeProjectForRole(row, req.user.role)),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).json({ error: error.message });
  }
};

const getNextWorkorderNumber = async (req, res) => {
  try {
    if (!['finance', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only Finance/Admin can access this' });
    }
    const workorderNumber = await generateWorkorderNumber();
    res.json({ workorderNumber });
  } catch (error) {
    console.error('Error generating next workorder number:', error);
    res.status(500).json({ error: error.message });
  }
};

const getProjectById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT p.*, c.name as client_name, u.username as created_by_name, a.username as assigned_to_name
       FROM projects p
       LEFT JOIN clients c ON p.client_id = c.id
       LEFT JOIN users u ON p.created_by = u.id
       LEFT JOIN users a ON p.assigned_to = a.id
       WHERE p.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const project = sanitizeProjectForRole(result.rows[0], req.user.role);

    // Get remarks
    const remarksResult = await pool.query(
      `SELECT pr.*, u.username as created_by_name FROM project_remarks pr
       LEFT JOIN users u ON pr.created_by = u.id
       WHERE pr.project_id = $1
       ORDER BY pr.created_at DESC`,
      [id]
    );

    // Get status history
    const statusResult = await pool.query(
      `SELECT psh.*, u.username as changed_by_name FROM project_status_history psh
       LEFT JOIN users u ON psh.changed_by = u.id
       WHERE psh.project_id = $1
       ORDER BY psh.changed_at DESC`,
      [id]
    );


    // Get attachments
    const attachmentsResult = await pool.query(
      'SELECT * FROM file_attachments WHERE project_id = $1',
      [id]
    );

    // Get points of contact
    const pocResult = await pool.query(
      'SELECT name, phone, email, is_primary FROM points_of_contact WHERE client_id = $1',
      [project.client_id]
    );

    const attachmentsByRemark = {};
    for (const a of attachmentsResult.rows) {
      if (!a.remark_id) continue;
      if (!attachmentsByRemark[a.remark_id]) attachmentsByRemark[a.remark_id] = [];
      attachmentsByRemark[a.remark_id].push({
        id: a.id,
        file_name: a.file_name,
        file_path: a.file_path,
        file_type: a.file_type,
        file_size: a.file_size,
        uploaded_at: a.uploaded_at,
        url: a.file_path ? `/uploads/remarks/${require('path').basename(a.file_path)}` : null
      });
    }

    const remarksWithAttachments = remarksResult.rows.map((r) => ({
      ...r,
      attachments: attachmentsByRemark[r.id] || []
    }));

    res.json({
      project,
      remarks: remarksWithAttachments,
      statusHistory: statusResult.rows,
      attachments: attachmentsResult.rows,
      pointsOfContact: pocResult.rows
    });
  } catch (error) {
    console.error('Error fetching project:', error);
    res.status(500).json({ error: error.message });
  }
};

const updateProjectStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { newStatus, comment } = req.body;

    if (!['pmo', 'manager', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only PMO, Manager, or Admin can update project status' });
    }

    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      const result = await client.query(
        'SELECT status FROM projects WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Project not found' });
      }

      const oldStatus = result.rows[0].status;

      // Update project status
      await client.query(
        'UPDATE projects SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [newStatus, id]
      );

      // Log status change
      await client.query(
        `INSERT INTO project_status_history (project_id, old_status, new_status, changed_by, comment)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, oldStatus, newStatus, req.user.id, comment]
      );

      // Log audit
      await logAudit(req.user.id, 'PROJECT_STATUS_CHANGED', 'projects', id, { status: oldStatus }, { status: newStatus }, req);

      // Hierarchy notifications: PMO forwards to Manager.
      if (req.user.role === 'pmo') {
        await notifyRoles(['manager'], `Project ${id} forwarded to Manager`, { projectId: id, status: newStatus });
      }

      await client.query('COMMIT');

      res.json({ message: 'Project status updated successfully' });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error updating project:', error);
    res.status(500).json({ error: error.message });
  }
};

const assignProject = async (req, res) => {
  try {
    const { id } = req.params;
    const { auditorId } = req.body;

    // Only manager and admin can assign
    if (!['manager', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only managers can assign projects' });
    }

    const result = await pool.query(
      'UPDATE projects SET assigned_to = $1, status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *',
      [auditorId, 'Assigned', id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const assignedProject = result.rows[0];
    let cascadedCount = 0;

    // If assigning a main project, cascade assignment to derived subproject-projects.
    if (!assignedProject.origin_subproject_id) {
      try {
        const derivedIdsRes = await pool.query(
          `SELECT dp.id
           FROM projects dp
           JOIN orders o ON o.id = dp.origin_order_id
           WHERE o.project_id = $1
             AND dp.origin_subproject_id IS NOT NULL`,
          [id]
        );
        const derivedIds = derivedIdsRes.rows.map((r) => r.id).filter(Boolean);
        if (derivedIds.length > 0) {
          const cascadeRes = await pool.query(
            `UPDATE projects
             SET assigned_to = $1,
                 status = 'Assigned',
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ANY($2::uuid[])
             RETURNING id`,
            [auditorId, derivedIds]
          );
          cascadedCount = cascadeRes.rowCount || 0;
        }
      } catch (cascadeErr) {
        console.warn('Could not cascade auditor assignment to derived subprojects:', cascadeErr.message || cascadeErr);
      }
    }

    // Log audit
    await logAudit(req.user.id, 'PROJECT_ASSIGNED', 'projects', id, { assigned_to: null }, { assigned_to: auditorId }, req);

    // Manager forwards to assigned auditor only.
    if (auditorId) {
      try {
        await notifications.safeInsertNotification(
          auditorId,
          cascadedCount > 0
            ? `You have been assigned project ${assignedProject.project_number || id} and ${cascadedCount} subproject(s)`
            : `You have been assigned project ${assignedProject.project_number || id}`,
          { projectId: assignedProject.id || id }
        );
      } catch (e) {
        console.warn('Failed to insert assignment notification:', e.message || e);
      }
    }

    res.json({
      message: cascadedCount > 0
        ? `Project assigned successfully (including ${cascadedCount} subproject(s))`
        : 'Project assigned successfully',
      project: assignedProject,
      cascadedSubprojects: cascadedCount
    });
  } catch (error) {
    console.error('Error assigning project:', error);
    res.status(500).json({ error: error.message });
  }
};

// Manager updates manager-specific status (visible to PMO and auditor)
const updateManagerStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { managerStatus, assignedAuditor } = req.body;

    if (req.user.role !== 'manager' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only managers can update manager status' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query('SELECT id, assigned_to, status FROM projects WHERE id = $1', [id]);
      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Project not found' });
      }

      const prevAssigned = result.rows[0].assigned_to;
      const prevStatus = result.rows[0].status;

      // Only update the manager_status and assigned_to. Don't overwrite the main `status` enum
      // with arbitrary manager labels which may not be part of the enum (e.g. 'Open').
      await client.query(
        'UPDATE projects SET manager_status = $1, assigned_to = COALESCE($2, assigned_to), updated_at = CURRENT_TIMESTAMP WHERE id = $3',
        [managerStatus, assignedAuditor || null, id]
      );

      // Do NOT record in project_status_history since managerStatus is not a valid enum value.
      // The manager_status is stored separately in the projects table (different from the status enum).

      await logAudit(req.user.id, 'PROJECT_MANAGER_STATUS_UPDATED', 'projects', id, { manager_status: prevStatus }, { manager_status: managerStatus }, req);

      // If assignedAuditor provided and changed, notify the assigned auditor
      try {
        if (assignedAuditor && assignedAuditor !== prevAssigned) {
          try {
            await notifications.safeInsertNotification(assignedAuditor, `You have been assigned project ${id}`, { projectId: id });
          } catch (e) {
            console.warn('Error creating assignment notification:', e.message || e);
          }
        }
      } catch (notifErr) {
        console.error('Error creating assignment notification:', notifErr);
      }

      await client.query('COMMIT');
      res.json({ message: 'Manager status updated' });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error updating manager status:', error);
    res.status(500).json({ error: error.message });
  }
};

// Finance and Admin edit project
const updateProject = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      companyName,
      companyAddress,
      clientName,
      workorderNumber,
      poNumber,
      financeProjectType,
      billingCycle,
      billingStartDate,
      billingEndDate,
      organizationCategory,
      reasonToConductAudit,
      sectorOfOrganization,
      typeOfAudit,
      typeOfAuditOther,
      poc1Name,
      poc1Phone,
      poc1Email,
      poc1Designation,
      testingType,
      scopeDescription,
      startDate,
      expectedEndDate,
      managerNotes
    } = req.body;

    // Only Finance and Admin can edit project form data
    if (!['finance', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only Finance and Admin can edit projects' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get current project
      const projectResult = await client.query('SELECT * FROM projects WHERE id = $1', [id]);
      if (projectResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Project not found' });
      }

      const project = projectResult.rows[0];
      const clientNameValue = companyName || clientName || project.company_name || 'Unknown Client';
      const normalizedFinanceProjectType = normalizeFinanceProjectType(financeProjectType || project.finance_project_type);

      if (normalizedFinanceProjectType === 'Recurring' && ((billingCycle !== undefined && !billingCycle) || (billingStartDate !== undefined && !billingStartDate))) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Billing cycle and billing start date are required for recurring projects' });
      }

      if ((typeOfAudit || project.type_of_audit) === 'Any other' && ((typeOfAuditOther !== undefined && !typeOfAuditOther) || (!typeOfAuditOther && !project.type_of_audit_other && typeOfAudit === 'Any other'))) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Please provide details for "Any other" audit type' });
      }

      // Update client if company name changed
      if (project.client_id) {
        await client.query(
          'UPDATE clients SET name = $1, address = COALESCE($2, address), updated_at = CURRENT_TIMESTAMP WHERE id = $3',
          [clientNameValue, companyAddress || null, project.client_id]
        );
      }

      // Update project details
      const updateResult = await client.query(
        `UPDATE projects SET 
         company_name = $1,
         company_address = COALESCE($2, company_address),
         workorder_number = COALESCE($3, workorder_number),
         po_number = COALESCE($4, po_number),
         finance_project_type = COALESCE($5, finance_project_type),
         billing_cycle = CASE WHEN COALESCE($5, finance_project_type) = 'Recurring' THEN COALESCE($6, billing_cycle) ELSE NULL END,
         billing_start_date = CASE WHEN COALESCE($5, finance_project_type) = 'Recurring' THEN COALESCE($7, billing_start_date) ELSE NULL END,
         billing_end_date = CASE WHEN COALESCE($5, finance_project_type) = 'Recurring' THEN COALESCE($8, billing_end_date) ELSE NULL END,
         organization_category = COALESCE($9, organization_category),
         reason_to_conduct_audit = COALESCE($10, reason_to_conduct_audit),
         sector_of_organization = COALESCE($11, sector_of_organization),
         type_of_audit = COALESCE($12, type_of_audit),
         type_of_audit_other = CASE WHEN COALESCE($12, type_of_audit) = 'Any other' THEN COALESCE($13, type_of_audit_other) ELSE NULL END,
         client_spoc_name = COALESCE($14, client_spoc_name),
         client_spoc_email = COALESCE($15, client_spoc_email),
         client_spoc_phone = COALESCE($16, client_spoc_phone),
         spoc_designation = COALESCE($17, spoc_designation),
         testing_type = COALESCE($18, testing_type),
         scope_description = COALESCE($19, scope_description),
         start_date = COALESCE($20, start_date),
         expected_end_date = COALESCE($21, expected_end_date),
         updated_at = CURRENT_TIMESTAMP
         WHERE id = $22
         RETURNING *`,
        [
          clientNameValue,
          companyAddress || null,
          workorderNumber || null,
          poNumber || null,
          normalizedFinanceProjectType || null,
          billingCycle || null,
          billingStartDate || null,
          billingEndDate || null,
          organizationCategory || null,
          reasonToConductAudit || null,
          sectorOfOrganization || null,
          typeOfAudit || null,
          typeOfAuditOther || null,
          poc1Name || null,
          poc1Email || null,
          poc1Phone || null,
          poc1Designation || null,
          testingType || null,
          scopeDescription || null,
          startDate || null,
          expectedEndDate || null,
          id
        ]
      );

      const updatedProject = updateResult.rows[0];

      // Add manager notes if provided
      if (managerNotes && req.user.role === 'manager') {
        await client.query(
          `INSERT INTO project_remarks (project_id, created_by, remark_type, content) VALUES ($1, $2, $3, $4)`,
          [id, req.user.id, 'manager', managerNotes]
        );
      }

      // Log audit
      await logAudit(req.user.id, 'PROJECT_UPDATED', 'projects', id, project, updatedProject, req);

      await client.query('COMMIT');

      const nextRoles = getNextRolesForRole(req.user.role);
      await notifyRoles(nextRoles, `Project ${updatedProject.project_number} was updated`, { projectId: id, isEdit: true });

      res.json({ message: 'Project updated successfully', project: updatedProject });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error updating project:', error);
    if (error.code === '23505' && String(error.constraint || '').includes('idx_projects_workorder_unique')) {
      return res.status(400).json({ error: 'Workorder number already exists' });
    }
    res.status(500).json({ error: error.message });
  }
};

// Add remark/note to project
const addRemark = async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    const files = req.files || [];

    if ((!content || !content.trim()) && files.length === 0) {
      return res.status(400).json({ error: 'Remark content or attachment is required' });
    }

    if (files.length > 0 && !['manager', 'pmo', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only Manager/PMO/Admin can attach files with notes' });
    }

    // Determine remark type based on user role
    const remarkType = req.user.role;

    // Insert remark
    const result = await pool.query(
      `INSERT INTO project_remarks (project_id, created_by, remark_type, content)
       VALUES ($1, $2, $3, $4)
       RETURNING id, project_id, created_by, remark_type, content, created_at`,
      [id, req.user.id, remarkType, (content || '').trim()]
    );

    const remark = result.rows[0];

    if (files.length > 0) {
      for (const f of files) {
        await pool.query(
          `INSERT INTO file_attachments (project_id, remark_id, file_name, file_path, file_type, file_size, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, remark.id, f.originalname, f.path, f.mimetype, f.size, req.user.id]
        );
      }
    }

    // Log audit
    await logAudit(req.user.id, 'REMARK_ADDED', 'project_remarks', remark.id, {}, { content, files: files.length }, req);

    // Notify next role in hierarchy about the new remark.
    try {
      const projRes = await pool.query('SELECT project_number FROM projects WHERE id = $1', [id]);
      const projectNumber = projRes.rows[0] ? projRes.rows[0].project_number : id;
      const snippet = (content || '').toString().trim().slice(0, 200);
      const noteMessage = `New note on ${projectNumber} by ${req.user.username || req.user.id}: "${snippet}"`;
      const noteTargetRoles = req.user.role === 'pmo' ? ['finance'] : getNextRolesForRole(req.user.role);
      await notifyRoles(noteTargetRoles, noteMessage, { projectId: id });
    } catch (notifErr) {
      console.error('Error sending remark notifications:', notifErr);
    }

    res.status(201).json({ message: 'Remark added successfully', remark });
  } catch (error) {
    console.error('Error adding remark:', error);
    res.status(500).json({ error: error.message });
  }
};

// Update remark/note (only by the user who created it)
const updateRemark = async (req, res) => {
  try {
    const { id, remarkId } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Remark content is required' });
    }

    // Get existing remark
    const remarkResult = await pool.query(
      'SELECT created_by FROM project_remarks WHERE id = $1 AND project_id = $2',
      [remarkId, id]
    );

    if (remarkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Remark not found' });
    }

    const remark = remarkResult.rows[0];

    // Only allow the user who created the remark to edit it
    if (remark.created_by !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'You can only edit your own remarks' });
    }

    // Update remark
    const updateResult = await pool.query(
      `UPDATE project_remarks SET content = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
      [content.trim(), remarkId]
    );

    // Log audit
    await logAudit(req.user.id, 'REMARK_UPDATED', 'project_remarks', remarkId, { content }, { content: content.trim() }, req);

    res.json({ message: 'Remark updated successfully', remark: updateResult.rows[0] });
  } catch (error) {
    console.error('Error updating remark:', error);
    res.status(500).json({ error: error.message });
  }
};

// Delete remark/note (only by the user who created it)
const deleteRemark = async (req, res) => {
  try {
    const { id, remarkId } = req.params;

    // Get existing remark
    const remarkResult = await pool.query(
      'SELECT created_by FROM project_remarks WHERE id = $1 AND project_id = $2',
      [remarkId, id]
    );

    if (remarkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Remark not found' });
    }

    const remark = remarkResult.rows[0];

    // Only allow the user who created the remark to delete it
    if (remark.created_by !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'You can only delete your own remarks' });
    }

    // Delete remark
    await pool.query('DELETE FROM project_remarks WHERE id = $1', [remarkId]);

    // Log audit
    await logAudit(req.user.id, 'REMARK_DELETED', 'project_remarks', remarkId, { content: 'deleted' }, {}, req);

    res.json({ message: 'Remark deleted successfully' });
  } catch (error) {
    console.error('Error deleting remark:', error);
    res.status(500).json({ error: error.message });
  }
};

const getProjectMilestones = async (req, res) => {
  try {
    await ensureProjectGovernanceSchema();
    const { id } = req.params;

    const projectRes = await pool.query('SELECT id FROM projects WHERE id = $1', [id]);
    if (projectRes.rows.length === 0) return res.status(404).json({ error: 'Project not found' });

    const milestonesRes = await pool.query(
      `SELECT pm.*, u.username AS updated_by_name
       FROM project_milestones pm
       LEFT JOIN users u ON u.id = pm.updated_by
       WHERE pm.project_id = $1
       ORDER BY pm.due_date ASC, pm.created_at ASC`,
      [id]
    );

    const escalationsRes = await pool.query(
      `SELECT * FROM project_escalations
       WHERE project_id = $1
       ORDER BY is_resolved ASC, created_at DESC`,
      [id]
    );

    const governed = await attachGovernanceToProjects(projectRes.rows);
    return res.json({
      governance: governed[0]?.governance || null,
      milestones: milestonesRes.rows,
      escalations: escalationsRes.rows
    });
  } catch (error) {
    console.error('Error fetching project milestones:', error);
    return res.status(500).json({ error: error.message });
  }
};

const createProjectMilestone = async (req, res) => {
  try {
    await ensureProjectGovernanceSchema();
    const { id } = req.params;
    const { title, description, dueDate, progressWeight = 1 } = req.body || {};

    if (!['pmo', 'manager', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only PMO/Manager/Admin can create milestones' });
    }

    if (req.user.role === 'manager') {
      const allowed = await managerCanAccessProject(id, req.user.id);
      if (!allowed) return res.status(403).json({ error: 'You can only add milestones for your assigned projects' });
    }

    if (!title || !String(title).trim()) return res.status(400).json({ error: 'Milestone title is required' });
    if (!dueDate) return res.status(400).json({ error: 'Milestone due date is required' });

    const projectRes = await pool.query('SELECT id FROM projects WHERE id = $1', [id]);
    if (projectRes.rows.length === 0) return res.status(404).json({ error: 'Project not found' });

    const result = await pool.query(
      `INSERT INTO project_milestones (project_id, title, description, due_date, progress_weight, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, String(title).trim(), description || null, dueDate, Number(progressWeight) > 0 ? Number(progressWeight) : 1, req.user.id]
    );

    await logAudit(req.user.id, 'PROJECT_MILESTONE_CREATED', 'project_milestones', result.rows[0].id, {}, result.rows[0], req);
    return res.status(201).json({ message: 'Milestone created successfully', milestone: result.rows[0] });
  } catch (error) {
    console.error('Error creating milestone:', error);
    return res.status(500).json({ error: error.message });
  }
};

const updateProjectMilestone = async (req, res) => {
  try {
    await ensureProjectGovernanceSchema();
    const { id, milestoneId } = req.params;
    const { title, description, dueDate, status, completionPercent, progressWeight } = req.body || {};

    if (!['pmo', 'manager', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only PMO/Manager/Admin can update milestones' });
    }

    if (req.user.role === 'manager') {
      const allowed = await managerCanAccessProject(id, req.user.id);
      if (!allowed) return res.status(403).json({ error: 'You can only update milestones for your assigned projects' });
    }

    const existingRes = await pool.query('SELECT * FROM project_milestones WHERE id = $1 AND project_id = $2', [milestoneId, id]);
    if (existingRes.rows.length === 0) return res.status(404).json({ error: 'Milestone not found' });

    const oldMilestone = existingRes.rows[0];
    const nextStatus = status || oldMilestone.status;
    const nextPercent = completionPercent !== undefined ? Number(completionPercent) : Number(oldMilestone.completion_percent || 0);
    const boundedPercent = Math.max(0, Math.min(100, Number.isNaN(nextPercent) ? 0 : nextPercent));
    const normalizedStatus = boundedPercent >= 100 ? 'Completed' : nextStatus;

    const updatedRes = await pool.query(
      `UPDATE project_milestones
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           due_date = COALESCE($3, due_date),
           status = $4,
           completion_percent = $5,
           progress_weight = COALESCE($6, progress_weight),
           completed_at = CASE WHEN $4 = 'Completed' THEN COALESCE(completed_at, CURRENT_TIMESTAMP) ELSE NULL END,
           updated_by = $7,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $8 AND project_id = $9
       RETURNING *`,
      [
        title ? String(title).trim() : null,
        description !== undefined ? description : null,
        dueDate || null,
        normalizedStatus,
        boundedPercent,
        progressWeight !== undefined ? (Number(progressWeight) > 0 ? Number(progressWeight) : oldMilestone.progress_weight) : null,
        req.user.id,
        milestoneId,
        id
      ]
    );

    await logAudit(req.user.id, 'PROJECT_MILESTONE_UPDATED', 'project_milestones', milestoneId, oldMilestone, updatedRes.rows[0], req);
    return res.json({ message: 'Milestone updated successfully', milestone: updatedRes.rows[0] });
  } catch (error) {
    console.error('Error updating milestone:', error);
    return res.status(500).json({ error: error.message });
  }
};

const resolveEscalation = async (req, res) => {
  try {
    await ensureProjectGovernanceSchema();
    const { id, escalationId } = req.params;

    if (!['pmo', 'manager', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only PMO/Manager/Admin can resolve escalations' });
    }

    if (req.user.role === 'manager') {
      const allowed = await managerCanAccessProject(id, req.user.id);
      if (!allowed) return res.status(403).json({ error: 'You can only resolve escalations for your assigned projects' });
    }

    const existingRes = await pool.query('SELECT * FROM project_escalations WHERE id = $1 AND project_id = $2', [escalationId, id]);
    if (existingRes.rows.length === 0) return res.status(404).json({ error: 'Escalation not found' });

    const updatedRes = await pool.query(
      `UPDATE project_escalations
       SET is_resolved = TRUE,
           resolved_at = CURRENT_TIMESTAMP,
           resolved_by = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND project_id = $3
       RETURNING *`,
      [req.user.id, escalationId, id]
    );

    await logAudit(req.user.id, 'PROJECT_ESCALATION_RESOLVED', 'project_escalations', escalationId, existingRes.rows[0], updatedRes.rows[0], req);
    return res.json({ message: 'Escalation resolved', escalation: updatedRes.rows[0] });
  } catch (error) {
    console.error('Error resolving escalation:', error);
    return res.status(500).json({ error: error.message });
  }
};

// Delete project (admin can delete any project; Finance can delete projects they created)
const deleteProject = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidUuid(id)) {
      return res.status(400).json({ error: 'Invalid project ID format' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const projResult = await client.query('SELECT id, created_by, project_number FROM projects WHERE id = $1', [id]);
      if (projResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Project not found' });
      }

      const project = projResult.rows[0];

      // Permission: admin can delete any project; Finance can delete projects they created
      if (req.user.role !== 'admin' && !(req.user.role === 'finance' && project.created_by === req.user.id)) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Not authorized to delete this project' });
      }

      // Remove related data to avoid FK issues (legacy-safe: only if tables exist)
      if (await tableExists(client, 'file_attachments')) {
        await client.query('DELETE FROM file_attachments WHERE project_id = $1', [id]);
      }

      if (await tableExists(client, 'project_remarks')) {
        await client.query('DELETE FROM project_remarks WHERE project_id = $1', [id]);
      }

      if (await tableExists(client, 'project_status_history')) {
        await client.query('DELETE FROM project_status_history WHERE project_id = $1', [id]);
      }

      // Invoice/order linkage in older deployments may not always cascade as expected.
      if (await tableExists(client, 'orders')) {
        await client.query('DELETE FROM orders WHERE project_id = $1', [id]);
      }

      // Delete project
      await client.query('DELETE FROM projects WHERE id = $1', [id]);

      await logAudit(req.user.id, 'PROJECT_DELETED', 'projects', id, project, {}, req);

      await client.query('COMMIT');

      // Best-effort notifications cleanup outside transaction so optional failures
      // cannot poison the delete transaction state.
      try {
        const notificationsExists = await pool.query(
          `SELECT EXISTS (
             SELECT 1
             FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = $1
           ) AS exists`,
          ['notifications']
        );

        if (notificationsExists.rows[0]?.exists) {
          await pool.query('DELETE FROM notifications WHERE data::text LIKE $1', [`%"projectId":"${id}"%`]);
        }
      } catch (notifErr) {
        console.warn('Notifications cleanup skipped:', notifErr.message || notifErr);
      }

      res.json({ message: 'Project deleted successfully' });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error deleting project:', error);
    if (error.code === '22P02') {
      return res.status(400).json({ error: 'Invalid project ID format' });
    }
    if (error.code === '23503') {
      return res.status(409).json({
        error: 'Project cannot be deleted because related records still exist',
        details: error.detail || null
      });
    }
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  createProject,
  getNextWorkorderNumber,
  getProjects,
  getProjectById,
  updateProjectStatus,
  assignProject,
  updateManagerStatus,
  updateProject,
  addRemark,
  updateRemark,
  deleteRemark,
  deleteProject
};
