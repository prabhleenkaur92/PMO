import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Navigate } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import StatCard from '../components/StatCard';
import '../styles/DashboardEnhanced.css';

const EnhancedDashboard = () => {
  const { user } = useAuth();
  const role = String(user?.role || '').trim().toLowerCase();
  const [stats, setStats] = useState(null);
  const [recentProjects, setRecentProjects] = useState([]);
  const [recentIssues, setRecentIssues] = useState([]);
  const [upcomingPayments, setUpcomingPayments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, [user?.role]);

  if (role === 'pmo') {
    return <Navigate to="/dashboard" replace />;
  }

  const loadDashboard = async () => {
    try {
      setLoading(true);
      const dashboardData = await api.get(`/reports/dashboard/${user.role}`);
      setStats(dashboardData.data.stats);
      setRecentProjects(dashboardData.data.recentProjects || []);
      setRecentIssues(dashboardData.data.recentIssues || []);
      setUpcomingPayments(dashboardData.data.upcomingPayments || []);
    } catch (error) {
      console.error('Error loading dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  const renderDashboardByRole = () => {
    switch (user?.role) {
      case 'admin':
        return <AdminDashboard stats={stats} recentProjects={recentProjects} />;
      case 'finance':
        return <FinanceDashboard stats={stats} recentProjects={recentProjects} upcomingPayments={upcomingPayments} />;
      case 'pmo':
        return <PMODashboard stats={stats} recentProjects={recentProjects} />;
      case 'manager':
        return <ManagerDashboard stats={stats} recentProjects={recentProjects} recentIssues={recentIssues} />;
      case 'auditor':
        return <AuditorDashboard stats={stats} recentIssues={recentIssues} />;
      default:
        return null;
    }
  };

  if (loading) return <div className="dashboard-loading">Loading dashboard...</div>;

  return (
    <div className="enhanced-dashboard">
      <div className="dashboard-header">
        <h1>Welcome, {user?.first_name || 'User'}</h1>
        <p className="role-badge">{user?.role.toUpperCase()}</p>
      </div>
      {renderDashboardByRole()}
    </div>
  );
};

const AdminDashboard = ({ stats, recentProjects }) => {
  return (
    <div className="dashboard-content">
      <div className="stats-grid">
        <StatCard 
          title="Total Projects" 
          value={stats?.totalProjects || 0}
          icon="📊"
          trend="+12% this month"
          color="blue"
        />
        <StatCard 
          title="Active Users" 
          value={stats?.activeUsers || 0}
          icon="👥"
          trend="+5 this month"
          color="green"
        />
        <StatCard 
          title="Total Issues" 
          value={stats?.totalIssues || 0}
          icon="🐛"
          trend="+28 this week"
          color="purple"
        />
        <StatCard 
          title="Systems Health" 
          value="98.5%"
          icon="💚"
          trend="All systems operational"
          color="emerald"
        />
      </div>

      <div className="dashboard-sections">
        <div className="section">
          <h2>System Overview</h2>
          <div className="overview-grid">
            <div className="overview-item">
              <span className="label">Database Status</span>
              <span className="status-indicator online">Connected</span>
            </div>
            <div className="overview-item">
              <span className="label">API Status</span>
              <span className="status-indicator online">Running</span>
            </div>
            <div className="overview-item">
              <span className="label">Email Service</span>
              <span className="status-indicator online">Active</span>
            </div>
            <div className="overview-item">
              <span className="label">Backup Status</span>
              <span className="status-indicator online">Success</span>
            </div>
          </div>
        </div>

        <div className="section">
          <h2>Recent Projects</h2>
          <div className="project-list">
            {recentProjects.slice(0, 5).map(project => (
              <div key={project.id} className="project-item">
                <div className="project-info">
                  <h3>{project.project_number}</h3>
                  <p>{project.company_name}</p>
                </div>
                <span className={`status-badge ${project.status.toLowerCase()}`}>
                  {project.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const FinanceDashboard = ({ stats, recentProjects, upcomingPayments }) => {
  const navigate = useNavigate();

  const getCollectionInfo = (project) => {
    const type = String(project?.finance_project_type || '').toLowerCase();
    if (type === 'recurring') {
      const cycle = project?.billing_cycle || 'Recurring';
      const start = project?.billing_start_date ? new Date(project.billing_start_date).toLocaleDateString() : 'N/A';
      const end = project?.billing_end_date ? new Date(project.billing_end_date).toLocaleDateString() : 'Ongoing';
      return `${cycle} collection (${start} - ${end})`;
    }
    if (type === 'one time' || type === 'one-time' || type === 'onetime') {
      return 'One-time collection';
    }
    return 'Collection plan not set';
  };

  return (
    <div className="dashboard-content">
      <div className="stats-grid">
        <StatCard 
          title="Total Revenue" 
          value={`$${stats?.totalRevenue?.toLocaleString() || '0'}`}
          icon="💰"
          trend={`+$${stats?.revenueThisMonth || '0'} this month`}
          color="green"
        />
        <StatCard 
          title="Pending Invoices" 
          value={stats?.pendingInvoices || 0}
          icon="📄"
          trend={`$${stats?.pendingAmount?.toLocaleString() || '0'} pending`}
          color="orange"
        />
        <StatCard 
          title="Projects Created" 
          value={stats?.projectsCreated || 0}
          icon="📋"
          trend={`${stats?.projectsThisMonth || 0} this month`}
          color="blue"
        />
        <StatCard 
          title="Collector Status" 
          value={`${stats?.collectionRate || 0}%`}
          icon="📈"
          trend="On track"
          color="purple"
        />
      </div>

      <div className="dashboard-sections">
        <div className="section full-width">
          <h2>Upcoming Payments</h2>
          <div className="payments-table">
            <table>
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Order</th>
                  <th>Amount</th>
                  <th>Due Date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {upcomingPayments.slice(0, 10).map(payment => (
                  <tr key={payment.id}>
                    <td>{payment.project_number}</td>
                    <td>{payment.order_number}</td>
                    <td>${payment.amount.toLocaleString()}</td>
                    <td>{new Date(payment.payment_date).toLocaleDateString()}</td>
                    <td><span className="status-badge pending">{payment.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="section">
          <h2>Recent Projects</h2>
          <div className="project-list">
            {recentProjects.map(project => (
              <div
                key={project.id}
                className="project-item cursor-pointer"
                onClick={() => navigate(`/project/${project.id}`)}
              >
                <div className="project-info">
                  <h3>{project.project_number}</h3>
                  <p>{project.company_name}</p>
                  <p className="text-xs text-slate-500 mt-1">{project.scope_description?.slice(0, 90) || 'No description available'}</p>
                  <p className="text-xs text-indigo-600 mt-1">{getCollectionInfo(project)}</p>
                </div>
                <span className="badge">${project.total_value?.toLocaleString() || '0'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const PMODashboard = ({ stats, recentProjects }) => {
  return (
    <div className="dashboard-content">
      <div className="stats-grid">
        <StatCard 
          title="Projects Under Review" 
          value={stats?.projectsUnderReview || 0}
          icon="🔍"
          trend={`${stats?.reviewPending || 0} awaiting approval`}
          color="orange"
        />
        <StatCard 
          title="Assigned to Managers" 
          value={stats?.assignedToManagers || 0}
          icon="👨‍💼"
          trend={`${stats?.managersActive || 0} active managers`}
          color="blue"
        />
        <StatCard 
          title="In Progress" 
          value={stats?.inProgress || 0}
          icon="⚙️"
          trend={`${stats?.onTrack || 0}% on track`}
          color="green"
        />
        <StatCard 
          title="Completion Rate" 
          value={`${stats?.completionRate || 0}%`}
          icon="✅"
          trend="Target: 100%"
          color="purple"
        />
      </div>

      <div className="dashboard-sections">
        <div className="section full-width">
          <h2>Project Assignment Queue</h2>
          <div className="project-queue">
            {recentProjects.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px', color: '#9ca3af' }}>
                <p>No projects available for assignment</p>
              </div>
            ) : (
              recentProjects.slice(0, 8).map(project => (
                <div key={project.id} className="queue-item">
                  <div className="queue-info">
                    <h3>{project.project_number}</h3>
                    <p>{project.company_name}</p>
                    <small>{project.scope_description?.substring(0, 100)}...</small>
                  </div>
                  <div className="queue-actions">
                    <span className={`status-badge ${project.status.toLowerCase()}`}>
                      {project.status}
                    </span>
                    <button className="btn-assign">Assign Manager</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const ManagerDashboard = ({ stats, recentProjects, recentIssues }) => {
  return (
    <div className="dashboard-content">
      <div className="stats-grid">
        <StatCard 
          title="Assigned Projects" 
          value={stats?.assignedProjects || 0}
          icon="📂"
          trend={`${stats?.activeProjects || 0} active`}
          color="blue"
        />
        <StatCard 
          title="Open Issues" 
          value={stats?.openIssues || 0}
          icon="🐛"
          trend={`${stats?.criticalIssues || 0} critical`}
          color="red"
        />
        <StatCard 
          title="Team Capacity" 
          value={`${stats?.teamCapacityUsed || 0}%`}
          icon="👥"
          trend={`${stats?.teamSize || 0} team members`}
          color="green"
        />
        <StatCard 
          title="Sprint Progress" 
          value={`${stats?.sprintCompletionRate || 0}%`}
          icon="🏃"
          trend="Current sprint"
          color="purple"
        />
      </div>

      <div className="dashboard-sections">
        <div className="section">
          <h2>My Projects</h2>
          <div className="project-list">
            {recentProjects.slice(0, 5).map(project => (
              <div key={project.id} className="project-item">
                <div className="project-info">
                  <h3>{project.project_number}</h3>
                  <p>{project.company_name}</p>
                </div>
                <div className="progress-bar">
                  <div 
                    className="progress-fill"
                    style={{ width: `${project.completion || 0}%` }}
                  ></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="section">
          <h2>Recent Issues</h2>
          <div className="issues-list">
            {recentIssues.slice(0, 5).map(issue => (
              <div key={issue.id} className="issue-item">
                <span className="issue-key">{issue.issue_key}</span>
                <span className="issue-title">{issue.title}</span>
                <span className={`priority ${issue.priority.toLowerCase()}`}>
                  {issue.priority}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const AuditorDashboard = ({ stats, recentIssues }) => {
  return (
    <div className="dashboard-content">
      <div className="stats-grid">
        <StatCard 
          title="Assigned Audits" 
          value={stats?.assignedAudits || 0}
          icon="✓"
          trend={`${stats?.completedAudits || 0} completed`}
          color="green"
        />
        <StatCard 
          title="Findings" 
          value={stats?.totalFindings || 0}
          icon="⚠️"
          trend={`${stats?.criticalFindings || 0} critical`}
          color="red"
        />
        <StatCard 
          title="In Progress" 
          value={stats?.inProgressAudits || 0}
          icon="⏳"
          trend={`${stats?.daysRemaining || 0} days avg remaining`}
          color="orange"
        />
        <StatCard 
          title="Completion Rate" 
          value={`${stats?.auditCompletionRate || 0}%`}
          icon="📊"
          trend="Target: 100%"
          color="blue"
        />
      </div>

      <div className="dashboard-sections">
        <div className="section full-width">
          <h2>My Work Items</h2>
          <div className="work-items">
            {recentIssues.slice(0, 10).map(issue => (
              <div key={issue.id} className="work-item">
                <div className="item-header">
                  <h4>{issue.title}</h4>
                  <span className={`status-badge ${issue.status.toLowerCase()}`}>
                    {issue.status}
                  </span>
                </div>
                <p>{issue.description?.substring(0, 100)}...</p>
                <div className="item-footer">
                  <span>Due: {new Date(issue.due_date).toLocaleDateString()}</span>
                  <span className={`priority ${issue.priority.toLowerCase()}`}>
                    {issue.priority}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EnhancedDashboard;
