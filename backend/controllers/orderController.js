const pool = require('../db/connection');
const { logAudit } = require('../middleware/logger');
const notifications = require('../utils/notifications');

let schemaReady = false;
let schemaPromise = null;

const ALLOWED_STRATEGIES = ['Specific Dates', 'Recurring', 'Milestone Based'];
const ALLOWED_FREQUENCIES = ['Weekly', 'Monthly', 'Quarterly', 'Yearly'];
const FINANCIAL_DATA_ROLES = new Set(['finance', 'admin']);
const ORDER_ACCESS_ROLES = new Set(['finance', 'admin', 'pmo', 'manager']);

const roundMoney = (v) => Math.round((Number(v) || 0) * 100) / 100;
const toDateOnly = (value) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};
const dateToISO = (d) => (d ? d.toISOString().slice(0, 10) : null);

const addFrequency = (d, f) => {
  const n = new Date(d.getTime());
  if (f === 'Weekly') n.setUTCDate(n.getUTCDate() + 7);
  if (f === 'Monthly') n.setUTCMonth(n.getUTCMonth() + 1);
  if (f === 'Quarterly') n.setUTCMonth(n.getUTCMonth() + 3);
  if (f === 'Yearly') n.setUTCFullYear(n.getUTCFullYear() + 1);
  return n;
};

const canViewFinancialData = (role) => FINANCIAL_DATA_ROLES.has(role);
const canAccessOrders = (role) => ORDER_ACCESS_ROLES.has(role);

const tableExists = async (tableName) => {
  const result = await pool.query(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name = $1
    ) AS exists`,
    [tableName]
  );
  return !!result.rows[0]?.exists;
};

const ensureOrderSchema = async () => {
  if (schemaReady) return;
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
        order_number VARCHAR(100) UNIQUE NOT NULL,
        order_value NUMERIC(14,2) NOT NULL CHECK (order_value > 0),
        collection_strategy VARCHAR(30),
        recurring_frequency VARCHAR(20),
        recurring_start_date DATE,
        recurring_end_date DATE,
        recurring_cycles INTEGER,
        recurring_amount_per_cycle NUMERIC(14,2),
        status VARCHAR(20) DEFAULT 'Draft',
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP DEFAULT NULL
      );
    `);

    await pool.query(`
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

    await pool.query(`
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

    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE;`);
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Draft';`);
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP DEFAULT NULL;`);
    await pool.query(`ALTER TABLE order_payment_schedules ADD COLUMN IF NOT EXISTS subproject_id UUID REFERENCES order_subprojects(id) ON DELETE CASCADE;`);
    await pool.query(`ALTER TABLE order_payment_schedules ADD COLUMN IF NOT EXISTS notified_upcoming_at TIMESTAMP;`);
    await pool.query(`ALTER TABLE order_subprojects ADD COLUMN IF NOT EXISTS subproject_scope TEXT;`);
    await pool.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS origin_order_id UUID;`);
    await pool.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS origin_subproject_id UUID;`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_created_by ON orders(created_by);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_project_id ON orders(project_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_order_subprojects_order_id ON order_subprojects(order_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_schedules_order ON order_payment_schedules(order_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_schedules_subproject ON order_payment_schedules(subproject_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_schedules_upcoming_notify ON order_payment_schedules(payment_date, notified_upcoming_at);`);

    // cache notifications table existence via helper
    // (we don't rely on a local cache variable here; helper caches internally)
    await notifications.tableExists();
    schemaReady = true;
    schemaPromise = null;
  })();

  return schemaPromise;
};

const assertFinanceOrAdmin = (req, res) => {
  if (!['finance', 'admin'].includes(req.user.role)) {
    res.status(403).json({ error: 'Only Finance/Admin can manage invoices' });
    return false;
  }
  return true;
};

const assertOrderReadAccess = (req, res) => {
  if (!canAccessOrders(req.user.role)) {
    res.status(403).json({ error: 'Order access is not allowed for current role' });
    return false;
  }
  return true;
};

const sanitizeSubprojectForRole = (subproject, role, order) => {
  if (canViewFinancialData(role)) return subproject;
  return {
    id: subproject.id,
    order_id: subproject.order_id,
    subproject_name: subproject.subproject_name,
    subproject_scope: subproject.subproject_scope || null,
    assigned_manager: subproject.assigned_manager_name || null,
    assigned_manager_id: subproject.assigned_team || null,
    created_at: subproject.created_at,
    assignment_status: order.assignment_status || null
  };
};

const sanitizeOrderForRole = (order, role) => {
  if (canViewFinancialData(role)) return order;

  const base = {
    id: order.id,
    project_id: order.project_id,
    order_number: order.order_number,
    project_number: order.project_number,
    company_name: order.company_name,
    assignment_status: order.assignment_status || null,
    assigned_manager: order.assigned_manager_name || null,
    assigned_manager_id: order.assigned_manager_id || null,
    assigned_auditor: order.assigned_to_name || null,
    created_at: order.created_at,
    updated_at: order.updated_at,
    subprojects: (order.subprojects || []).map((sp) => sanitizeSubprojectForRole(sp, role, order))
  };
  if (role === 'pmo') {
    return { ...base, order_value: order.order_value };
  }
  return base;
};

const ensureProjectAccess = async (projectId, user) => {
  const result = await pool.query('SELECT id, created_by FROM projects WHERE id = $1', [projectId]);
  if (result.rows.length === 0) return { ok: false, status: 404, error: 'Project not found' };
  if (user.role === 'finance' && result.rows[0].created_by !== user.id) {
    return { ok: false, status: 403, error: 'You can only map invoices to your own projects' };
  }
  return { ok: true };
};

const normalizeSubprojects = (payload = {}) => {
  if (Array.isArray(payload.subprojects) && payload.subprojects.length > 0) {
    return payload.subprojects.map((sp) => ({
      subprojectName: sp.subprojectName,
      collectionStrategy: sp.collectionStrategy || payload.collectionStrategy || 'Specific Dates',
      recurring: sp.recurring || null,
      specificDates: sp.specificDates || [],
      milestones: sp.milestones || []
    }));
  }
  return [{
    subprojectName: 'Default Subproject',
    collectionStrategy: payload.collectionStrategy || 'Specific Dates',
    recurring: payload.recurring || null,
    specificDates: payload.specificDates || [],
    milestones: payload.milestones || []
  }];
};

const hasProjectLevelPayments = (payload = {}) => {
  if (!payload.collectionStrategy) return false;
  const hasSpecific = Array.isArray(payload.specificDates) && payload.specificDates.length > 0;
  const hasMilestones = Array.isArray(payload.milestones) && payload.milestones.length > 0;
  const hasRecurring = !!payload.recurring;
  return hasSpecific || hasMilestones || hasRecurring;
};

const buildRecurringRows = ({ frequency, startDate, endDate, cycles, amountPerCycle }) => {
  const rows = [];
  let cursor = toDateOnly(startDate);
  if (!cursor || !ALLOWED_FREQUENCIES.includes(frequency)) return rows;
  const maxRows = 500;
  while (rows.length < maxRows) {
    if (endDate) {
      const end = toDateOnly(endDate);
      if (!end || cursor > end) break;
    }
    if (cycles && rows.length >= cycles) break;
    rows.push({ paymentDate: dateToISO(cursor), amount: roundMoney(amountPerCycle) });
    cursor = addFrequency(cursor, frequency);
  }
  return rows;
};

const calculateSubprojectTotal = (sp) => {
  if (sp.collectionStrategy === 'Specific Dates') {
    return roundMoney((sp.specificDates || []).reduce((sum, r) => sum + roundMoney(r.amount), 0));
  }
  if (sp.collectionStrategy === 'Recurring') {
    const recurring = sp.recurring || {};
    const rows = buildRecurringRows({
      frequency: recurring.frequency,
      startDate: recurring.startDate,
      endDate: recurring.endDate || null,
      cycles: recurring.cycles ? Number(recurring.cycles) : null,
      amountPerCycle: roundMoney(recurring.amountPerCycle)
    });
    return roundMoney(rows.reduce((sum, r) => sum + roundMoney(r.amount), 0));
  }
  // Milestone Based: use calculatedAmount if available, else value
  return roundMoney((sp.milestones || []).reduce((sum, m) => sum + roundMoney(m.calculatedAmount || m.value), 0));
};

const validatePayload = (payload = {}) => {
  const errors = [];
  const orderValue = roundMoney(payload.orderValue);
  const subprojects = normalizeSubprojects(payload);

  if (!payload.projectId) errors.push('Project is required');
  if (!payload.orderNumber || !String(payload.orderNumber).trim()) errors.push('Order Number is required');
  if (!(orderValue > 0)) errors.push('Order Value must be greater than 0');
  if (!Array.isArray(subprojects) || subprojects.length < 1) errors.push('At least one subproject is required');
  
  const projectLevelPayments = hasProjectLevelPayments(payload);

  // ============================================
  // PROJECT-LEVEL PAYMENT VALIDATION
  // ============================================
  if (projectLevelPayments) {
    const strategy = payload.collectionStrategy;
    if (!ALLOWED_STRATEGIES.includes(strategy)) errors.push('Invalid project payment collection strategy');
    subprojects.forEach((sp, i) => {
      if (!String(sp.subprojectName || '').trim()) errors.push(`Subproject ${i + 1}: Name is required`);
    });

    // Strategy-specific validation
    let projectTotal = 0;
    switch (strategy) {
      case 'Specific Dates': {
        const rows = Array.isArray(payload.specificDates) ? payload.specificDates : [];
        if (rows.length < 1) errors.push('Project payment: at least one payment date is required');
        const seen = new Set();
        rows.forEach((r, k) => {
          const idx = k + 1;
          const d = toDateOnly(r.paymentDate);
          const key = d ? dateToISO(d) : null;
          const amt = roundMoney(r.amount);
          if (!d) errors.push(`Project payment row ${idx}: payment date required`);
          if (d && d <= new Date()) errors.push(`Project payment row ${idx}: payment date must be future`);
          if (key && seen.has(key)) errors.push(`Project payment row ${idx}: duplicate date`);
          if (key) seen.add(key);
          if (!(amt > 0)) errors.push(`Project payment row ${idx}: amount must be > 0`);
          projectTotal += amt;
        });
        break;
      }

      case 'Recurring': {
        const recurring = payload.recurring || {};
        const frequency = recurring.frequency;
        const cycles = Number(recurring.cycles || 0);
        const amount = roundMoney(recurring.amountPerCycle);
        if (!ALLOWED_FREQUENCIES.includes(frequency)) errors.push('Project payment recurring frequency required');
        if (!toDateOnly(recurring.startDate)) errors.push('Project payment recurring start date required');
        if (!recurring.endDate && !(cycles > 0)) errors.push('Project payment recurring end date or cycles required');
        if (!(amount > 0)) errors.push('Project payment recurring amount per cycle must be > 0');
        const preview = buildRecurringRows({
          frequency,
          startDate: recurring.startDate,
          endDate: recurring.endDate || null,
          cycles: cycles > 0 ? cycles : null,
          amountPerCycle: amount
        });
        if (preview.length < 1) errors.push('Project payment recurring: schedule generation failed or produced zero payments');
        projectTotal = roundMoney(preview.reduce((s, r) => s + roundMoney(r.amount), 0));
        break;
      }

      case 'Milestone Based': {
        const rows = Array.isArray(payload.milestones) ? payload.milestones : [];
        if (rows.length < 1) errors.push('Project payment: at least one milestone is required');
        
        let totalPercentage = 0;
        let hasPercentage = false;
        let hasFixedAmount = false;

        rows.forEach((m, k) => {
          const idx = k + 1;
          const milestoneName = String(m.milestoneName || '').trim();
          const mType = String(m.type || '').toLowerCase();
          const value = roundMoney(m.value);

          // Validate milestone fields
          if (!milestoneName) errors.push(`Project payment milestone ${idx}: name required`);
          if (!mType || !['fixed', 'fixed amount', 'percentage'].includes(mType)) {
            errors.push(`Project payment milestone ${idx}: type required (must be "fixed" or "percentage")`);
          }
          if (!(value > 0)) errors.push(`Project payment milestone ${idx}: value must be > 0`);

          // Track type consistency
          if (mType === 'percentage') {
            hasPercentage = true;
            totalPercentage = roundMoney(totalPercentage + value);
          } else if (mType === 'fixed' || mType === 'fixed amount') {
            hasFixedAmount = true;
          }
        });

        // Validate type consistency
        if (hasPercentage && hasFixedAmount) {
          errors.push('Project payment: cannot mix percentage and fixed amount milestones');
        }

        // Validate totals based on type
        if (hasPercentage && totalPercentage > 0 && totalPercentage !== 100) {
          errors.push(`Project payment: milestone percentages total (${totalPercentage}%) must equal 100%`);
        }
        if (hasPercentage && !hasFixedAmount && totalPercentage === 100) {
          projectTotal = roundMoney(
            rows.reduce((s, m) => s + roundMoney((roundMoney(m.value) / 100) * orderValue), 0)
          );
        }
        if (hasFixedAmount && !hasPercentage) {
          projectTotal = rows.reduce((s, m) => s + roundMoney(m.value), 0);
        }
        break;
      }
    }

    // Validate total matches order value
    if (errors.length === 0 && roundMoney(projectTotal) !== orderValue) {
      errors.push(`Project payment total (${roundMoney(projectTotal)}) must equal order value (${orderValue})`);
    }
    return errors;
  }

  // ============================================
  // SUBPROJECT-LEVEL PAYMENT VALIDATION
  // (Only validate if NOT using project-level payments)
  // ============================================
  let allocatedTotal = 0;
  if (!projectLevelPayments) {
    subprojects.forEach((sp, i) => {
      const rowIndex = i + 1;
      const strategy = sp.collectionStrategy;

      if (!String(sp.subprojectName || '').trim()) errors.push(`Subproject ${rowIndex}: Name is required`);
      if (!ALLOWED_STRATEGIES.includes(strategy)) errors.push(`Subproject ${rowIndex}: Invalid collection strategy`);

      // Strategy-specific validation
      switch (strategy) {
        case 'Specific Dates': {
          const rows = Array.isArray(sp.specificDates) ? sp.specificDates : [];
          if (rows.length < 1) errors.push(`Subproject ${rowIndex}: At least one payment date is required`);
          const seen = new Set();
          let total = 0;
          rows.forEach((r, k) => {
            const idx = k + 1;
            const d = toDateOnly(r.paymentDate);
            const key = d ? dateToISO(d) : null;
            const amt = roundMoney(r.amount);
            if (!d) errors.push(`Subproject ${rowIndex}, row ${idx}: payment date required`);
            if (d && d <= new Date()) errors.push(`Subproject ${rowIndex}, row ${idx}: payment date must be future`);
            if (key && seen.has(key)) errors.push(`Subproject ${rowIndex}, row ${idx}: duplicate date`);
            if (key) seen.add(key);
            if (!(amt > 0)) errors.push(`Subproject ${rowIndex}, row ${idx}: amount must be > 0`);
            total += amt;
          });
          if (!(roundMoney(total) > 0)) errors.push(`Subproject ${rowIndex}: schedule total must be > 0`);
          break;
        }

        case 'Recurring': {
          const recurring = sp.recurring || {};
          const frequency = recurring.frequency;
          const cycles = Number(recurring.cycles || 0);
          const amount = roundMoney(recurring.amountPerCycle);
          if (!ALLOWED_FREQUENCIES.includes(frequency)) errors.push(`Subproject ${rowIndex}: recurring frequency required`);
          if (!toDateOnly(recurring.startDate)) errors.push(`Subproject ${rowIndex}: recurring start date required`);
          if (!recurring.endDate && !(cycles > 0)) errors.push(`Subproject ${rowIndex}: end date or cycles required`);
          if (!(amount > 0)) errors.push(`Subproject ${rowIndex}: amount per cycle must be > 0`);
          const preview = buildRecurringRows({
            frequency,
            startDate: recurring.startDate,
            endDate: recurring.endDate || null,
            cycles: cycles > 0 ? cycles : null,
            amountPerCycle: amount
          });
          if (preview.length < 1) errors.push(`Subproject ${rowIndex}: recurring schedule generation failed`);
          if (!(roundMoney(preview.reduce((s, r) => s + roundMoney(r.amount), 0)) > 0)) {
            errors.push(`Subproject ${rowIndex}: recurring total must be > 0`);
          }
          break;
        }

        case 'Milestone Based': {
          const rows = Array.isArray(sp.milestones) ? sp.milestones : [];
          if (rows.length < 1) errors.push(`Subproject ${rowIndex}: at least one milestone required`);
          
          let totalPercentage = 0;
          let hasPercentage = false;
          let hasFixedAmount = false;

          rows.forEach((m, k) => {
            const idx = k + 1;
            const milestoneName = String(m.milestoneName || '').trim();
            const mType = String(m.type || '').toLowerCase();
            const value = roundMoney(m.value);

            // Validate milestone fields
            if (!milestoneName) errors.push(`Subproject ${rowIndex}, milestone ${idx}: name required`);
            if (!mType || !['fixed', 'fixed amount', 'percentage'].includes(mType)) {
              errors.push(`Subproject ${rowIndex}, milestone ${idx}: type required (must be "fixed" or "percentage")`);
            }
            if (!(value > 0)) errors.push(`Subproject ${rowIndex}, milestone ${idx}: value must be > 0`);

            // Track type consistency
            if (mType === 'percentage') {
              hasPercentage = true;
              totalPercentage += value;
            } else if (mType === 'fixed' || mType === 'fixed amount') {
              hasFixedAmount = true;
            }
          });

          // Validate type consistency
          if (hasPercentage && hasFixedAmount) {
            errors.push(`Subproject ${rowIndex}: cannot mix percentage and fixed amount milestones`);
          }

          // Validate totals based on type
          if (hasPercentage && totalPercentage > 0 && totalPercentage !== 100) {
            errors.push(`Subproject ${rowIndex}: milestone percentages total (${totalPercentage}%) must equal 100%`);
          }
          break;
        }
      }

      allocatedTotal += calculateSubprojectTotal(sp);
    });

    // Validate total allocation matches order value (only for subproject-level payments)
    if (errors.length === 0 && roundMoney(allocatedTotal) !== orderValue) {
      errors.push(`Allocated to subprojects (${roundMoney(allocatedTotal)}) must equal order value (${orderValue})`);
    }
  } else {
    // For project-level payments, just validate subproject names exist
    subprojects.forEach((sp, i) => {
      if (!String(sp.subprojectName || '').trim()) errors.push(`Subproject ${i + 1}: Name is required`);
    });
  }
  return errors;
};

const buildSchedulesForSubproject = (sp) => {
  if (sp.collectionStrategy === 'Specific Dates') {
    return (sp.specificDates || []).map((r) => ({
      schedule_type: 'specific',
      payment_date: r.paymentDate,
      amount: roundMoney(r.amount),
      milestone_name: null,
      expected_completion_date: null
    }));
  }
  if (sp.collectionStrategy === 'Recurring') {
    const recurring = sp.recurring || {};
    return buildRecurringRows({
      frequency: recurring.frequency,
      startDate: recurring.startDate,
      endDate: recurring.endDate || null,
      cycles: recurring.cycles ? Number(recurring.cycles) : null,
      amountPerCycle: roundMoney(recurring.amountPerCycle)
    }).map((r) => ({
      schedule_type: 'recurring',
      payment_date: r.paymentDate,
      amount: roundMoney(r.amount),
      milestone_name: null,
      expected_completion_date: null
    }));
  }
  return (sp.milestones || []).map((m) => ({
    schedule_type: 'milestone',
    payment_date: null,
    amount: roundMoney(m.calculatedAmount || m.value),
    milestone_name: String(m.milestoneName || '').trim(),
    expected_completion_date: null
  }));
};

const buildSchedulesForOrder = (payload = {}) => {
  const strategy = payload.collectionStrategy || 'Specific Dates';
  if (strategy === 'Specific Dates') {
    return (payload.specificDates || []).map((r) => ({
      schedule_type: 'specific',
      payment_date: r.paymentDate,
      amount: roundMoney(r.amount),
      milestone_name: null,
      expected_completion_date: null
    }));
  }
  if (strategy === 'Recurring') {
    const recurring = payload.recurring || {};
    return buildRecurringRows({
      frequency: recurring.frequency,
      startDate: recurring.startDate,
      endDate: recurring.endDate || null,
      cycles: recurring.cycles ? Number(recurring.cycles) : null,
      amountPerCycle: roundMoney(recurring.amountPerCycle)
    }).map((r) => ({
      schedule_type: 'recurring',
      payment_date: r.paymentDate,
      amount: roundMoney(r.amount),
      milestone_name: null,
      expected_completion_date: null
    }));
  }
  return (payload.milestones || []).map((m) => ({
    schedule_type: 'milestone',
    payment_date: null,
    amount: roundMoney(m.calculatedAmount || m.value),
    milestone_name: String(m.milestoneName || '').trim(),
    expected_completion_date: null
  }));
};

const createUpcomingPaymentNotifications = async (financeUserId) => {
  if (!financeUserId) return;
  const notificationsTableExists = await notifications.tableExists();
  if (!notificationsTableExists) return;

  const due = await pool.query(
    `SELECT s.id, s.payment_date, s.amount, o.id AS order_id, o.order_number, p.project_number, sp.subproject_name
     FROM order_payment_schedules s
     JOIN orders o ON o.id = s.order_id
     LEFT JOIN order_subprojects sp ON sp.id = s.subproject_id
     JOIN projects p ON p.id = o.project_id
     WHERE o.created_by = $1
       AND s.payment_date IS NOT NULL
       AND s.notified_upcoming_at IS NULL
       AND s.payment_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '3 day')
     ORDER BY s.payment_date ASC`,
    [financeUserId]
  );

  for (const row of due.rows) {
    const msg = `Upcoming payment: ${row.order_number} / ${row.subproject_name || 'Subproject'} on ${row.payment_date} amount ${row.amount}`;
    try {
      await notifications.safeInsertNotification(financeUserId, msg, { orderId: row.order_id, scheduleId: row.id, projectNumber: row.project_number });
    } catch (e) {
      console.warn('Failed to create upcoming payment notification:', e.message || e);
    }
    await pool.query(`UPDATE order_payment_schedules SET notified_upcoming_at = CURRENT_TIMESTAMP WHERE id = $1`, [row.id]);
  }
};

const getOrders = async (req, res) => {
  try {
    await ensureOrderSchema();
    if (!assertOrderReadAccess(req, res)) return;

    if (req.user.role === 'finance') await createUpcomingPaymentNotifications(req.user.id);

    const { q = '', projectId } = req.query;
    const params = [];
    let query = `
      SELECT o.*, u.username AS created_by_name, p.project_number, p.company_name, p.manager_status AS assignment_status,
             au.username AS assigned_to_name, mgr.user_id AS assigned_manager_id, mgr.username AS assigned_manager_name
      FROM orders o
      LEFT JOIN users u ON u.id = o.created_by
      LEFT JOIN projects p ON p.id = o.project_id
      LEFT JOIN users au ON au.id = p.assigned_to
      LEFT JOIN LATERAL (
        SELECT al.user_id, usr.username
        FROM audit_logs al
        LEFT JOIN users usr ON usr.id = al.user_id
        WHERE al.entity_type = 'projects'
          AND al.entity_id = p.id
          AND al.action = 'PROJECT_MANAGER_STATUS_UPDATED'
        ORDER BY al.created_at DESC
        LIMIT 1
      ) mgr ON TRUE
      WHERE o.deleted_at IS NULL
    `;
    if (req.user.role === 'finance') {
      params.push(req.user.id);
      query += ` AND o.created_by = $${params.length}`;
    } else if (req.user.role === 'manager') {
      params.push(req.user.id);
      query += ` AND (
        p.assigned_to = $${params.length}
        OR EXISTS (
          SELECT 1 FROM order_subprojects spm
          WHERE spm.order_id = o.id
            AND spm.assigned_team = $${params.length}::text
        )
      )`;
    }
    if (projectId) {
      params.push(projectId);
      query += ` AND o.project_id = $${params.length}`;
    }
    if (q) {
      params.push(`%${q}%`);
      query += ` AND (COALESCE(p.company_name,'') ILIKE $${params.length} OR COALESCE(o.order_number,'') ILIKE $${params.length} OR COALESCE(p.project_number,'') ILIKE $${params.length})`;
    }
    query += ' ORDER BY o.created_at DESC';

    const ordersResult = await pool.query(query, params);
    const orderIds = ordersResult.rows.map((o) => o.id);
    if (orderIds.length === 0) return res.json({ orders: [] });

    const subParams = [orderIds];
    let subQuery = `
      SELECT sp.*, mu.username AS assigned_manager_name
      FROM order_subprojects sp
      LEFT JOIN users mu ON mu.id::text = sp.assigned_team
      WHERE sp.order_id = ANY($1::uuid[])
    `;
    if (req.user.role === 'manager') {
      subParams.push(req.user.id);
      subQuery += ` AND sp.assigned_team = $2::text`;
    }
    subQuery += ' ORDER BY sp.created_at ASC';
    const subRes = await pool.query(subQuery, subParams);
    const fetchSchedules = canViewFinancialData(req.user.role);
    const schedRes = fetchSchedules
      ? await pool.query(
          `SELECT * FROM order_payment_schedules WHERE order_id = ANY($1::uuid[]) ORDER BY created_at ASC`,
          [orderIds]
        )
      : { rows: [] };

    const schedBySub = {};
    const orderLevelSchedByOrder = {};
    schedRes.rows.forEach((s) => {
      if (!s.subproject_id) {
        if (!orderLevelSchedByOrder[s.order_id]) orderLevelSchedByOrder[s.order_id] = [];
        orderLevelSchedByOrder[s.order_id].push(s);
        return;
      }
      if (!schedBySub[s.subproject_id]) schedBySub[s.subproject_id] = [];
      schedBySub[s.subproject_id].push(s);
    });
    const subByOrder = {};
    subRes.rows.forEach((sp) => {
      if (!subByOrder[sp.order_id]) subByOrder[sp.order_id] = [];
      subByOrder[sp.order_id].push({ ...sp, schedules: schedBySub[sp.id] || [] });
    });
    const allSchedByOrder = {};
    if (fetchSchedules) {
      schedRes.rows.forEach((s) => {
        if (!allSchedByOrder[s.order_id]) allSchedByOrder[s.order_id] = [];
        allSchedByOrder[s.order_id].push(s);
      });
    }

    const orders = ordersResult.rows.map((o) => ({
      ...o,
      subprojects: subByOrder[o.id] || [],
      order_level_schedules: fetchSchedules ? (orderLevelSchedByOrder[o.id] || []) : [],
      schedules: fetchSchedules ? (allSchedByOrder[o.id] || []) : []
    }));

    res.json({
      orders: orders.map((order) => sanitizeOrderForRole(order, req.user.role))
    });
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ error: error.message });
  }
};

const createOrder = async (req, res) => {
  try {
    await ensureOrderSchema();
    if (!assertFinanceOrAdmin(req, res)) return;

    const payload = req.body || {};

    // ============================================
    // PHASE 1: STRICT PRE-VALIDATION (NO DB READS/WRITES)
    // ============================================
    const validationErrors = validatePayload(payload);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        errors: validationErrors,
        message: 'Invoice validation failed. All errors must be resolved before creation.'
      });
    }

    // ============================================
    // PHASE 2: CONDITIONAL VALIDATION (READ-ONLY)
    // ============================================
    const access = await ensureProjectAccess(payload.projectId, req.user);
    if (!access.ok) {
      return res.status(access.status).json({
        success: false,
        errors: [access.error],
        message: access.error
      });
    }

    // Check for duplicate Draft invoice for the same project
    const existingDraft = await pool.query(
      `SELECT id FROM orders WHERE project_id = $1 AND status = 'Draft' AND deleted_at IS NULL LIMIT 1`,
      [payload.projectId]
    );
    if (existingDraft.rows.length > 0) {
      return res.status(400).json({
        success: false,
        errors: ['A Draft invoice already exists for this project. Please complete or delete it first.'],
        message: 'Cannot create duplicate Draft invoice for this project'
      });
    }

    // ============================================
    // PHASE 3: PRE-BUILD SCHEDULES (VALIDATION)
    // ============================================
    // Build and validate all schedules before DB transaction
    const subprojects = normalizeSubprojects(payload);
    const projectLevelPayments = hasProjectLevelPayments(payload);
    
    // Pre-build subproject schedules ONLY if using subproject-level payments
    const subprojectSchedulesMap = new Map();
    if (!projectLevelPayments) {
      for (const sp of subprojects) {
        const schedules = buildSchedulesForSubproject(sp);
        if (!schedules || schedules.length === 0) {
          return res.status(400).json({
            success: false,
            errors: [`Subproject "${sp.subprojectName}": Payment schedule generation failed. Check dates and amounts.`],
            message: 'Schedule generation failed'
          });
        }
        subprojectSchedulesMap.set(sp.subprojectName, schedules);
      }
    }

    // Pre-build order-level schedules if applicable
    let orderSchedules = [];
    if (projectLevelPayments) {
      orderSchedules = buildSchedulesForOrder(payload);
      if (!orderSchedules || orderSchedules.length === 0) {
        return res.status(400).json({
          success: false,
          errors: ['Project payment schedule generation failed. Check dates, cycles, and amounts.'],
          message: 'Schedule generation failed'
        });
      }
    }

    // ============================================
    // PHASE 4: DATABASE TRANSACTION (ATOMIC WRITE)
    // ============================================
    const orderLevelStrategy = payload.collectionStrategy || (subprojects.length > 1
      ? 'Subproject Based'
      : (subprojects[0]?.collectionStrategy || 'Specific Dates'));
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Create order
      const orderInsert = await client.query(
        `INSERT INTO orders (project_id, order_number, order_value, collection_strategy, created_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)
         RETURNING *`,
        [
          payload.projectId,
          String(payload.orderNumber).trim(),
          roundMoney(payload.orderValue),
          orderLevelStrategy,
          req.user.id
        ]
      );
      const order = orderInsert.rows[0];

      // Create subprojects and their schedules
      for (const sp of subprojects) {
        const recurring = sp.recurring || {};
        const subprojectTotal = projectLevelPayments ? roundMoney(payload.orderValue) : calculateSubprojectTotal(sp);
        const subprojectStrategy = projectLevelPayments ? (payload.collectionStrategy || 'Specific Dates') : sp.collectionStrategy;
        
        const subInsert = await client.query(
          `INSERT INTO order_subprojects (
             order_id, subproject_name, assigned_team, subproject_value, collection_strategy,
             recurring_frequency, recurring_start_date, recurring_end_date, recurring_cycles, recurring_amount_per_cycle
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING *`,
          [
            order.id,
            String(sp.subprojectName || '').trim(),
            null,
            subprojectTotal,
            subprojectStrategy,
            !projectLevelPayments && subprojectStrategy === 'Recurring' ? recurring.frequency : null,
            !projectLevelPayments && subprojectStrategy === 'Recurring' ? recurring.startDate : null,
            !projectLevelPayments && subprojectStrategy === 'Recurring' ? (recurring.endDate || null) : null,
            !projectLevelPayments && subprojectStrategy === 'Recurring' && recurring.cycles ? Number(recurring.cycles) : null,
            !projectLevelPayments && subprojectStrategy === 'Recurring' ? roundMoney(recurring.amountPerCycle) : null
          ]
        );
        const sub = subInsert.rows[0];

        // Insert subproject schedules (only if not project-level payments)
        if (!projectLevelPayments) {
          const schedules = subprojectSchedulesMap.get(sp.subprojectName) || [];
          for (const row of schedules) {
            await client.query(
              `INSERT INTO order_payment_schedules (
                 order_id, subproject_id, schedule_type, payment_date, amount, milestone_name, expected_completion_date
               ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [order.id, sub.id, row.schedule_type, row.payment_date, row.amount, row.milestone_name, row.expected_completion_date]
            );
          }
        }
      }

      // Insert project-level schedules if applicable
      if (projectLevelPayments) {
        for (const row of orderSchedules) {
          await client.query(
            `INSERT INTO order_payment_schedules (
               order_id, subproject_id, schedule_type, payment_date, amount, milestone_name, expected_completion_date
             ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [order.id, null, row.schedule_type, row.payment_date, row.amount, row.milestone_name, row.expected_completion_date]
          );
        }
      }

      await client.query('COMMIT');
      
      // Audit and respond
      await logAudit(req.user.id, 'ORDER_CREATED', 'orders', order.id, {}, 
        { orderNumber: payload.orderNumber, projectId: payload.projectId }, req);
      
      return res.status(201).json({
        success: true,
        message: 'Invoice created successfully',
        order
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error creating order:', error);
    if (error.code === '23505') {
      return res.status(400).json({
        success: false,
        errors: ['Order Number already exists'],
        message: 'Order Number already exists'
      });
    }
    return res.status(500).json({
      success: false,
      errors: [error.message || 'Internal server error'],
      message: 'An unexpected error occurred during invoice creation'
    });
  }
};

const updateOrder = async (req, res) => {
  try {
    await ensureOrderSchema();
    if (!assertFinanceOrAdmin(req, res)) return;
    const { id } = req.params;

    // PHASE 1: Check if invoice exists and user has permission
    const current = await pool.query('SELECT * FROM orders WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (current.rows.length === 0) {
      return res.status(404).json({
        success: false,
        errors: ['Invoice not found'],
        message: 'Invoice not found'
      });
    }
    
    const invoice = current.rows[0];
    if (req.user.role === 'finance' && invoice.created_by !== req.user.id) {
      return res.status(403).json({
        success: false,
        errors: ['You can only edit invoices you created'],
        message: 'Permission denied'
      });
    }
    if (req.user.role === 'finance' && invoice.status !== 'Draft') {
      return res.status(403).json({
        success: false,
        errors: ['Only Draft invoices can be edited'],
        message: 'Cannot edit non-Draft invoice'
      });
    }

    // PHASE 2: Validate entire payload before any updates
    const payload = req.body || {};
    const validationErrors = validatePayload(payload);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        errors: validationErrors,
        message: 'Invoice validation failed. All errors must be resolved before update.'
      });
    }

    const access = await ensureProjectAccess(payload.projectId, req.user);
    if (!access.ok) {
      return res.status(access.status).json({
        success: false,
        errors: [access.error],
        message: access.error
      });
    }

    // PHASE 3: Pre-build schedules (validation without DB writes)
    const subprojects = normalizeSubprojects(payload);
    const projectLevelPayments = hasProjectLevelPayments(payload);
    
    // Pre-build subproject schedules ONLY if using subproject-level payments
    const subprojectSchedulesMap = new Map();
    if (!projectLevelPayments) {
      for (const sp of subprojects) {
        const schedules = buildSchedulesForSubproject(sp);
        if (!schedules || schedules.length === 0) {
          return res.status(400).json({
            success: false,
            errors: [`Subproject "${sp.subprojectName}": Payment schedule generation failed. Check dates and amounts.`],
            message: 'Schedule generation failed'
          });
        }
        subprojectSchedulesMap.set(sp.subprojectName, schedules);
      }
    }

    let orderSchedules = [];
    if (projectLevelPayments) {
      orderSchedules = buildSchedulesForOrder(payload);
      if (!orderSchedules || orderSchedules.length === 0) {
        return res.status(400).json({
          success: false,
          errors: ['Project payment schedule generation failed. Check dates, cycles, and amounts.'],
          message: 'Schedule generation failed'
        });
      }
    }

    // PHASE 4: Database transaction (atomic update)
    const orderLevelStrategy = payload.collectionStrategy || (subprojects.length > 1
      ? 'Subproject Based'
      : (subprojects[0]?.collectionStrategy || 'Specific Dates'));
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Update order
      await client.query(
        `UPDATE orders
         SET project_id = $1, order_number = $2, order_value = $3, collection_strategy = $4, updated_at = CURRENT_TIMESTAMP
         WHERE id = $5`,
        [
          payload.projectId,
          String(payload.orderNumber).trim(),
          roundMoney(payload.orderValue),
          orderLevelStrategy,
          id
        ]
      );

      // Delete old schedules and subprojects
      await client.query('DELETE FROM order_payment_schedules WHERE order_id = $1', [id]);
      await client.query('DELETE FROM order_subprojects WHERE order_id = $1', [id]);

      // Create new subprojects and schedules
      for (const sp of subprojects) {
        const recurring = sp.recurring || {};
        const subprojectTotal = projectLevelPayments ? roundMoney(payload.orderValue) : calculateSubprojectTotal(sp);
        const subprojectStrategy = projectLevelPayments ? (payload.collectionStrategy || 'Specific Dates') : sp.collectionStrategy;
        const subInsert = await client.query(
          `INSERT INTO order_subprojects (
             order_id, subproject_name, assigned_team, subproject_value, collection_strategy,
             recurring_frequency, recurring_start_date, recurring_end_date, recurring_cycles, recurring_amount_per_cycle
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING id`,
          [
            id,
            String(sp.subprojectName || '').trim(),
            null,
            subprojectTotal,
            subprojectStrategy,
            !projectLevelPayments && subprojectStrategy === 'Recurring' ? recurring.frequency : null,
            !projectLevelPayments && subprojectStrategy === 'Recurring' ? recurring.startDate : null,
            !projectLevelPayments && subprojectStrategy === 'Recurring' ? (recurring.endDate || null) : null,
            !projectLevelPayments && subprojectStrategy === 'Recurring' && recurring.cycles ? Number(recurring.cycles) : null,
            !projectLevelPayments && subprojectStrategy === 'Recurring' ? roundMoney(recurring.amountPerCycle) : null
          ]
        );
        const subprojectId = subInsert.rows[0].id;
        if (!projectLevelPayments) {
          const schedules = subprojectSchedulesMap.get(sp.subprojectName) || [];
          for (const row of schedules) {
            await client.query(
              `INSERT INTO order_payment_schedules (
                 order_id, subproject_id, schedule_type, payment_date, amount, milestone_name, expected_completion_date
               ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [id, subprojectId, row.schedule_type, row.payment_date, row.amount, row.milestone_name, row.expected_completion_date]
            );
          }
        }
      }

      if (projectLevelPayments) {
        for (const row of orderSchedules) {
          await client.query(
            `INSERT INTO order_payment_schedules (
               order_id, subproject_id, schedule_type, payment_date, amount, milestone_name, expected_completion_date
             ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [id, null, row.schedule_type, row.payment_date, row.amount, row.milestone_name, row.expected_completion_date]
          );
        }
      }

      await client.query('COMMIT');
      await logAudit(req.user.id, 'ORDER_UPDATED', 'orders', id, {}, { orderNumber: payload.orderNumber, projectId: payload.projectId }, req);
      
      // Fetch full updated order with related data
      const fullOrder = await pool.query(
        `SELECT o.*, u.username as created_by_name, p.project_number, p.company_name
         FROM orders o
         LEFT JOIN users u ON u.id = o.created_by
         LEFT JOIN projects p ON p.id = o.project_id
         WHERE o.id = $1`,
        [id]
      );
      
      return res.json({
        success: true,
        message: 'Invoice updated successfully',
        invoice: fullOrder.rows[0]
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error updating order:', error);
    if (error.code === '23505') {
      return res.status(400).json({
        success: false,
        errors: ['Order Number already exists'],
        message: 'Order Number already exists'
      });
    }
    return res.status(500).json({
      success: false,
      errors: [error.message || 'Internal server error'],
      message: 'An unexpected error occurred during invoice update'
    });
  }
};

const deleteOrder = async (req, res) => {
  try {
    await ensureOrderSchema();
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admin can delete invoices' });
    }
    const { id } = req.params;
    const existing = await pool.query('SELECT * FROM orders WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Invoice not found' });
    
    // Soft delete: set deleted_at timestamp
    await pool.query('UPDATE orders SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
    await logAudit(req.user.id, 'ORDER_DELETED', 'orders', id, existing.rows[0], { deleted_at: new Date().toISOString() }, req);
    return res.json({ message: 'Invoice deleted successfully' });
  } catch (error) {
    console.error('Error deleting order:', error);
    res.status(500).json({ error: error.message });
  }
};

const markMilestoneCompleted = async (req, res) => {
  try {
    await ensureOrderSchema();
    if (!assertFinanceOrAdmin(req, res)) return;

    const { orderId, scheduleId } = req.params;
    const check = await pool.query(
      `SELECT s.*, o.created_by
       FROM order_payment_schedules s
       JOIN orders o ON o.id = s.order_id
       WHERE s.id = $1 AND s.order_id = $2`,
      [scheduleId, orderId]
    );
    if (check.rows.length === 0) return res.status(404).json({ error: 'Milestone schedule not found' });
    const row = check.rows[0];
    if (row.schedule_type !== 'milestone') return res.status(400).json({ error: 'Only milestone rows can be completed' });
    if (req.user.role === 'finance' && row.created_by !== req.user.id) return res.status(403).json({ error: 'Unauthorized' });

    const result = await pool.query(
      `UPDATE order_payment_schedules
       SET is_milestone_completed = TRUE,
           milestone_completed_at = CURRENT_TIMESTAMP,
           payment_triggered = TRUE,
           payment_triggered_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [scheduleId]
    );

    await logAudit(req.user.id, 'ORDER_MILESTONE_COMPLETED', 'order_payment_schedules', scheduleId, {}, { orderId }, req);
    res.json({ message: 'Milestone marked completed and payment triggered', schedule: result.rows[0] });
  } catch (error) {
    console.error('Error completing milestone:', error);
    res.status(500).json({ error: error.message });
  }
};

const assignSubprojectManager = async (req, res) => {
  try {
    await ensureOrderSchema();
    if (!['pmo', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only PMO/Admin can assign managers to subprojects' });
    }

    const { orderId, subprojectId } = req.params;
    const { managerId, scopeDescription } = req.body || {};
    if (!managerId) return res.status(400).json({ error: 'managerId is required' });
    const normalizedScope = String(scopeDescription || '').trim();
    if (!normalizedScope) return res.status(400).json({ error: 'scopeDescription is required for subproject assignment' });

    const managerRes = await pool.query(
      'SELECT id, username FROM users WHERE id = $1 AND role = $2 AND is_active = TRUE',
      [managerId, 'manager']
    );
    if (managerRes.rows.length === 0) return res.status(400).json({ error: 'Selected user is not an active manager' });

    const subRes = await pool.query(
      `SELECT sp.id, sp.order_id, sp.assigned_team, o.project_id, o.order_number, sp.subproject_name
       FROM order_subprojects sp
       JOIN orders o ON o.id = sp.order_id
       WHERE sp.id = $1 AND sp.order_id = $2`,
      [subprojectId, orderId]
    );
    if (subRes.rows.length === 0) return res.status(404).json({ error: 'Subproject not found for the given order' });
    const current = subRes.rows[0];

    await pool.query('UPDATE order_subprojects SET assigned_team = $1, subproject_scope = $2 WHERE id = $3', [managerId, normalizedScope, subprojectId]);

    // Update the parent project status to reflect assignment
    await pool.query(
      `UPDATE projects
       SET status = CASE WHEN status = 'Submitted_To_PMO' THEN 'Assigned_To_Manager' ELSE status END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [current.project_id]
    );

    // Create/update a derived project for the assigned subproject so manager gets a dedicated scoped view.
    let derivedProjectId = null;
    try {
      const projRes = await pool.query('SELECT project_number, client_id, company_name, project_type, testing_type, start_date, expected_end_date FROM projects WHERE id = $1', [current.project_id]);
      if (projRes.rows.length > 0) {
        const p = projRes.rows[0];
        const safeSubId = String(subprojectId).replace(/-/g, '').slice(0, 8);
        const newProjectNumber = `${p.project_number || 'PRJ'}-SP-${safeSubId}`;

        const existingDerived = await pool.query(
          'SELECT id FROM projects WHERE origin_subproject_id = $1 ORDER BY created_at DESC LIMIT 1',
          [subprojectId]
        );

        if (existingDerived.rows.length > 0) {
          derivedProjectId = existingDerived.rows[0].id;
          const updateRes = await pool.query(
            `UPDATE projects
             SET assigned_to = $1,
                 status = 'Assigned_To_Manager',
                 scope_description = $2,
                 start_date = COALESCE($3, start_date),
                 expected_end_date = COALESCE($4, expected_end_date),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $5
             RETURNING id`,
            [managerId, normalizedScope, p.start_date, p.expected_end_date, derivedProjectId]
          );
          derivedProjectId = updateRes.rows[0]?.id || derivedProjectId;
        } else {
          const insertRes = await pool.query(
            `INSERT INTO projects (project_number, client_id, company_name, project_type, testing_type, scope_description, created_by, assigned_to, status, start_date, expected_end_date, origin_order_id, origin_subproject_id, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
             RETURNING id` ,
            [
              newProjectNumber,
              p.client_id,
              p.company_name,
              p.project_type,
              p.testing_type,
              normalizedScope,
              req.user.id,
              managerId,
              'Assigned_To_Manager',
              p.start_date,
              p.expected_end_date,
              current.order_id,
              subprojectId
            ]
          );
          derivedProjectId = insertRes.rows[0]?.id || null;
        }
      }
    } catch (e) {
      console.error('Failed to create derived project for subproject assignment:', e.message || e);
    }

    try {
      const msg = `Subproject assigned: ${current.order_number} / ${current.subproject_name}`;
      await notifications.safeInsertNotification(managerId, msg, {
        orderId,
        subprojectId,
        projectId: derivedProjectId || current.project_id,
        parentProjectId: current.project_id
      });
    } catch (e) {
      console.warn('Failed to create subproject assignment notification:', e.message || e);
    }

    await logAudit(
      req.user.id,
      'SUBPROJECT_MANAGER_ASSIGNED',
      'order_subprojects',
      subprojectId,
      { assigned_team: current.assigned_team || null, subproject_scope: null },
      { assigned_team: managerId, subproject_scope: normalizedScope, derived_project_id: derivedProjectId },
      req
    );

    return res.json({ message: 'Manager assigned to subproject successfully' });
  } catch (error) {
    console.error('Error assigning manager to subproject:', error);
    return res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getOrders,
  createOrder,
  updateOrder,
  deleteOrder,
  markMilestoneCompleted,
  assignSubprojectManager
};
