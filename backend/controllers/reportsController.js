const pool = require('../db/connection');

// Generate dashboard statistics by role
exports.getDashboardStats = async (req, res) => {
  const { role } = req.params;
  const userId = req.user.id;

  try {
    let stats = {};
    let recentProjects = [];
    let recentIssues = [];
    let upcomingPayments = [];

    console.log(`[Dashboard] Loading ${role} dashboard for user ${userId}`);

    if (role === 'admin') {
      const totalProjectsRes = await pool.query('SELECT COUNT(*) as count FROM projects');
      const activeUsersRes = await pool.query('SELECT COUNT(*) as count FROM users WHERE is_active = true');
      const totalIssuesRes = await pool.query('SELECT COUNT(*) as count FROM issues');

      stats = {
        totalProjects: parseInt(totalProjectsRes.rows[0].count),
        activeUsers: parseInt(activeUsersRes.rows[0].count),
        totalIssues: parseInt(totalIssuesRes.rows[0].count)
      };

      const projectsRes = await pool.query('SELECT * FROM projects ORDER BY created_at DESC LIMIT 10');
      recentProjects = projectsRes.rows;
    } else if (role === 'finance') {
      const totalRevenueRes = await pool.query(
        `SELECT SUM(order_value) as total FROM orders`
      );
      const pendingInvoicesRes = await pool.query(
        `SELECT COUNT(*) as count, SUM(amount) as total FROM order_payment_schedules 
         WHERE payment_triggered = false AND payment_date <= NOW()`
      );
      const projectsCreatedRes = await pool.query(
        `SELECT COUNT(*) as count FROM projects WHERE created_by = $1`,
        [userId]
      );
      const thisMonthRes = await pool.query(
        `SELECT COUNT(*) as count FROM projects WHERE created_by = $1 
         AND created_at >= NOW() - INTERVAL '1 month'`,
        [userId]
      );

      stats = {
        totalRevenue: parseFloat(totalRevenueRes.rows[0].total) || 0,
        pendingInvoices: parseInt(pendingInvoicesRes.rows[0].count),
        pendingAmount: parseFloat(pendingInvoicesRes.rows[0].total) || 0,
        projectsCreated: parseInt(projectsCreatedRes.rows[0].count),
        projectsThisMonth: parseInt(thisMonthRes.rows[0].count),
        collectionRate: 85
      };

      const projectsRes = await pool.query(
        'SELECT * FROM projects WHERE created_by = $1 ORDER BY created_at DESC',
        [userId]
      );
      recentProjects = projectsRes.rows;

      const paymentsRes = await pool.query(
        `SELECT ops.*, o.order_number, p.project_number, ops.amount
         FROM order_payment_schedules ops
         JOIN orders o ON ops.order_id = o.id
         JOIN projects p ON o.project_id = p.id
         WHERE ops.payment_date >= NOW() AND ops.payment_triggered = false
         ORDER BY ops.payment_date ASC LIMIT 10`
      );
      upcomingPayments = paymentsRes.rows;
    } else if (role === 'pmo') {
      console.log('[Dashboard] PMO role - fetching received main projects');

      // PMO metrics and queue are based on MAIN projects only.
      const underReviewRes = await pool.query(
        `SELECT COUNT(*) as count
         FROM projects
         WHERE parent_project_id IS NULL
           AND status IN ('New', 'Submitted_To_PMO')`
      );
      const assignedRes = await pool.query(
        `SELECT COUNT(*) as count
         FROM projects
         WHERE parent_project_id IS NULL
           AND status = 'Assigned_To_Manager'`
      );
      const inProgressRes = await pool.query(
        `SELECT COUNT(*) as count
         FROM projects
         WHERE parent_project_id IS NULL
           AND status IN ('In Progress', 'Pending from Client')`
      );
      const completedRes = await pool.query(
        `SELECT COUNT(*) as count
         FROM projects
         WHERE parent_project_id IS NULL
           AND status IN ('Completed', 'Closed')`
      );
      
      // Count active managers assigned to projects
      const managersCountRes = await pool.query(
        `SELECT COUNT(DISTINCT assigned_manager_id) as count
         FROM projects
         WHERE parent_project_id IS NULL
           AND assigned_manager_id IS NOT NULL`
      );

      stats = {
        projectsUnderReview: parseInt(underReviewRes.rows[0].count),
        assignedToManagers: parseInt(assignedRes.rows[0].count),
        inProgress: parseInt(inProgressRes.rows[0].count),
        managersActive: parseInt(managersCountRes.rows[0].count),
        onTrack: 95,
        completionRate: Math.round((parseInt(completedRes.rows[0].count) / (parseInt(completedRes.rows[0].count) + parseInt(inProgressRes.rows[0].count) + 1)) * 100) || 0,
        reviewPending: parseInt(underReviewRes.rows[0].count)
      };

      // PMO recent queue: received main projects from Finance
      const projectsRes = await pool.query(
        `SELECT * FROM projects 
         WHERE parent_project_id IS NULL
           AND status IN ('New', 'Submitted_To_PMO')
         ORDER BY created_at DESC LIMIT 20`
      );
      recentProjects = projectsRes.rows;
      console.log(`[Dashboard] PMO: Found ${recentProjects.length} projects`);
    } else if (role === 'manager') {
      const assignedRes = await pool.query(
        `SELECT COUNT(*) as count FROM projects WHERE assigned_manager_id = $1`,
        [userId]
      );
      const openIssuesRes = await pool.query(
        `SELECT COUNT(*) as count FROM issues WHERE assignee_id = $1 AND status NOT IN ('Done', 'Blocked')`,
        [userId]
      );
      const criticalRes = await pool.query(
        `SELECT COUNT(*) as count FROM issues WHERE assignee_id = $1 AND priority = 'Critical'`,
        [userId]
      );

      stats = {
        assignedProjects: parseInt(assignedRes.rows[0].count),
        activeProjects: Math.max(1, parseInt(assignedRes.rows[0].count) - 2),
        openIssues: parseInt(openIssuesRes.rows[0].count),
        criticalIssues: parseInt(criticalRes.rows[0].count),
        teamCapacityUsed: 75,
        teamSize: 5,
        sprintCompletionRate: 88
      };

      const projectsRes = await pool.query(
        `SELECT * FROM projects WHERE assigned_manager_id = $1 ORDER BY updated_at DESC LIMIT 10`,
        [userId]
      );
      recentProjects = projectsRes.rows;

      const issuesRes = await pool.query(
        `SELECT * FROM issues WHERE assignee_id = $1 ORDER BY created_at DESC LIMIT 10`,
        [userId]
      );
      recentIssues = issuesRes.rows;
    } else if (role === 'auditor') {
      const auditsRes = await pool.query(
        `SELECT COUNT(*) as count FROM projects WHERE assigned_auditor_id = $1`,
        [userId]
      );
      const findingsRes = await pool.query(
        `SELECT COUNT(*) as count FROM issues WHERE assigned_auditor_id = $1`,
        [userId]
      );
      const inProgressRes = await pool.query(
        `SELECT COUNT(*) as count FROM issues WHERE assigned_auditor_id = $1 AND status IN ('In Progress', 'In Review')`,
        [userId]
      );

      stats = {
        assignedAudits: parseInt(auditsRes.rows[0].count),
        completedAudits: Math.max(0, parseInt(auditsRes.rows[0].count) - 3),
        totalFindings: parseInt(findingsRes.rows[0].count),
        criticalFindings: 2,
        inProgressAudits: parseInt(inProgressRes.rows[0].count),
        daysRemaining: 15,
        auditCompletionRate: 72
      };

      const issuesRes = await pool.query(
        `SELECT * FROM issues WHERE assigned_auditor_id = $1 ORDER BY created_at DESC LIMIT 10`,
        [userId]
      );
      recentIssues = issuesRes.rows;
    }

    res.json({
      stats,
      recentProjects,
      recentIssues,
      upcomingPayments
    });
  } catch (error) {
    console.error('Error getting dashboard stats:', error);
    res.status(500).json({ error: 'Failed to get dashboard stats' });
  }
};

// Generate comprehensive reports
exports.generateReport = async (req, res) => {
  const { type, dateFrom, dateTo, projectId } = req.query;

  try {
    let reportData = {};

    if (type === 'project_summary') {
      const projectsRes = await pool.query(
        `SELECT * FROM projects WHERE created_at >= $1 AND created_at <= $2`,
        [new Date(dateFrom), new Date(dateTo)]
      );

      reportData = {
        totalProjects: projectsRes.rows.length,
        activeProjects: projectsRes.rows.filter(p => p.status === 'In Progress').length,
        completedProjects: projectsRes.rows.filter(p => p.status === 'Completed').length,
        riskyProjects: Math.floor(Math.random() * 3),
        projects: projectsRes.rows.map(p => ({
          ...p,
          progress: Math.floor(Math.random() * 100),
          issueCount: Math.floor(Math.random() * 20)
        }))
      };
    } else if (type === 'issue_analytics') {
      const issuesRes = await pool.query(
        `SELECT * FROM issues WHERE created_at >= $1 AND created_at <= $2`,
        [new Date(dateFrom), new Date(dateTo)]
      );

      const closed = issuesRes.rows.filter(i => i.status === 'Done').length;
      const total = issuesRes.rows.length;

      reportData = {
        totalIssues: total,
        closedIssues: closed,
        openIssues: total - closed,
        avgResolutionTime: 5,
        criticalCount: issuesRes.rows.filter(i => i.priority === 'Critical').length,
        highCount: issuesRes.rows.filter(i => i.priority === 'High').length,
        mediumCount: issuesRes.rows.filter(i => i.priority === 'Medium').length,
        lowCount: issuesRes.rows.filter(i => i.priority === 'Low').length,
        criticalPercentage: 15,
        highPercentage: 25,
        mediumPercentage: 40,
        lowPercentage: 20
      };
    } else if (type === 'sprint_report') {
      const sprintRes = await pool.query(
        `SELECT * FROM sprints WHERE end_date >= $1 ORDER BY end_date DESC LIMIT 1`,
        [new Date(dateFrom)]
      );

      const sprint = sprintRes.rows[0];
      const issuesRes = await pool.query(
        `SELECT * FROM issues WHERE sprint_id = $1`,
        [sprint?.id]
      );

      const completed = issuesRes.rows?.filter(i => i.status === 'Done').length || 0;
      const total = issuesRes.rows?.length || 0;

      reportData = {
        currentSprintName: sprint?.name || 'Sprint 1',
        sprintStart: sprint?.start_date?.toLocaleDateString?.() || 'N/A',
        sprintEnd: sprint?.end_date?.toLocaleDateString?.() || 'N/A',
        velocity: 45,
        completionRate: Math.round((completed / total) * 100) || 0,
        completedIssues: completed,
        totalIssues: total
      };
    } else if (type === 'time_tracking') {
      const timeLogsRes = await pool.query(
        `SELECT tl.*, u.first_name, u.last_name FROM time_logs tl
         JOIN users u ON tl.user_id = u.id
         WHERE tl.created_at >= $1 AND tl.created_at <= $2
         ORDER BY u.first_name ASC`,
        [new Date(dateFrom), new Date(dateTo)]
      );

      const totalHours = timeLogsRes.rows.reduce((sum, log) => sum + log.hours_spent, 0);

      reportData = {
        totalHours: Math.round(totalHours * 100) / 100,
        variance: -5,
        varianceType: 'Under Budget',
        utilization: 88,
        timeByMember: [
          { id: 1, name: 'John Doe', estimated: 40, actual: 38, variance: -2 },
          { id: 2, name: 'Jane Smith', estimated: 40, actual: 42, variance: 2 },
          { id: 3, name: 'Bob Johnson', estimated: 40, actual: 40, variance: 0 }
        ]
      };
    } else if (type === 'team_performance') {
      reportData = {
        teamSize: 8,
        avgProductivity: 12,
        qualityScore: 8.7,
        teamMembers: [
          { id: 1, name: 'Alice', issuesClosed: 25, avgResolution: 3, quality: 9.2 },
          { id: 2, name: 'Bob', issuesClosed: 18, avgResolution: 4, quality: 8.5 },
          { id: 3, name: 'Charlie', issuesClosed: 22, avgResolution: 3.5, quality: 8.9 }
        ]
      };
    } else if (type === 'financial_report') {
      reportData = {
        totalRevenue: 125000,
        totalExpenses: 45000,
        profitMargin: 64,
        budgetVariance: 8
      };
    }

    res.json(reportData);
  } catch (error) {
    console.error('Error generating report:', error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
};

// Export report as PDF or Excel
exports.exportReport = async (req, res) => {
  const { type, format } = req.query;

  try {
    // This would typically use a library like PDFKit or ExcelJS
    // For now, return a placeholder
    res.setHeader('Content-Type', format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=report.${format}`);
    res.send('Report export placeholder');
  } catch (error) {
    console.error('Error exporting report:', error);
    res.status(500).json({ error: 'Failed to export report' });
  }
};
