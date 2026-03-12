import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import '../styles/Reports.css';

const Reports = () => {
  const { user } = useAuth();
  const role = String(user?.role || '').trim().toLowerCase();
  const isPmo = role === 'pmo';
  const [reportType, setReportType] = useState('project_summary');
  const [dateRange, setDateRange] = useState({
    from: new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().split('T')[0],
    to: new Date().toISOString().split('T')[0]
  });
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedProject, setSelectedProject] = useState('');
  const [projects, setProjects] = useState([]);

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    if (isPmo && reportType === 'financial_report') {
      setReportType('project_summary');
    }
  }, [isPmo, reportType]);

  const loadProjects = async () => {
    try {
      const res = await api.get('/projects?limit=100');
      setProjects(res.data?.projects || []);
    } catch (error) {
      console.error('Error loading projects:', error);
    }
  };

  const generateReport = async () => {
    try {
      setLoading(true);
      const params = {
        type: reportType,
        dateFrom: dateRange.from,
        dateTo: dateRange.to,
        projectId: selectedProject
      };

      const res = await api.get('/reports/generate', { params });
      setReportData(res.data);
    } catch (error) {
      console.error('Error generating report:', error);
    } finally {
      setLoading(false);
    }
  };

  const exportReport = async (format) => {
    try {
      const params = {
        type: reportType,
        dateFrom: dateRange.from,
        dateTo: dateRange.to,
        projectId: selectedProject,
        format
      };

      const res = await api.get('/reports/export', { params, responseType: 'blob' });
      
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `report-${reportType}-${Date.now()}.${format}`);
      document.body.appendChild(link);
      link.click();
      link.parentElement.removeChild(link);
    } catch (error) {
      console.error('Error exporting report:', error);
    }
  };

  return (
    <div className="reports-container">
      <div className="reports-header">
        <h1>Reports & Analytics</h1>
        <p>Generate comprehensive reports and analytics for your projects</p>
      </div>

      <div className="reports-panel">
        <div className="report-controls">
          <div className="control-group">
            <label>Report Type</label>
            <select value={reportType} onChange={(e) => setReportType(e.target.value)}>
              <option value="project_summary">Project Summary</option>
              <option value="project_performance">Project Performance</option>
              <option value="issue_analytics">Issue Analytics</option>
              <option value="sprint_report">Sprint Report</option>
              <option value="time_tracking">Time Tracking Report</option>
              <option value="team_performance">Team Performance</option>
              <option value="risk_analysis">Risk Analysis</option>
              {!isPmo && <option value="financial_report">Financial Report</option>}
              <option value="resource_allocation">Resource Allocation</option>
              <option value="velocity_chart">Velocity Chart</option>
            </select>
          </div>

          <div className="control-group">
            <label>Project</label>
            <select value={selectedProject} onChange={(e) => setSelectedProject(e.target.value)}>
              <option value="">All Projects</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.project_number}</option>
              ))}
            </select>
          </div>

          <div className="control-group">
            <label>Date From</label>
            <input
              type="date"
              value={dateRange.from}
              onChange={(e) => setDateRange({ ...dateRange, from: e.target.value })}
            />
          </div>

          <div className="control-group">
            <label>Date To</label>
            <input
              type="date"
              value={dateRange.to}
              onChange={(e) => setDateRange({ ...dateRange, to: e.target.value })}
            />
          </div>

          <div className="control-actions">
            <button className="btn-generate" onClick={generateReport} disabled={loading}>
              {loading ? 'Generating...' : '📊 Generate Report'}
            </button>
            <button className="btn-export" onClick={() => exportReport('pdf')} disabled={!reportData}>
              📥 Export PDF
            </button>
            <button className="btn-export" onClick={() => exportReport('xlsx')} disabled={!reportData}>
              📥 Export Excel
            </button>
          </div>
        </div>
      </div>

      {reportData && (
        <div className="report-content">
          <ReportRenderer data={reportData} type={reportType} />
        </div>
      )}

      {!reportData && !loading && (
        <div className="report-placeholder">
          <div className="placeholder-content">
            <div className="placeholder-icon">📊</div>
            <h2>No Report Generated Yet</h2>
            <p>Select your filters above and click "Generate Report" to view analytics</p>
          </div>
        </div>
      )}

      {loading && (
        <div className="report-loading">
          <div className="spinner"></div>
          <p>Generating report...</p>
        </div>
      )}
    </div>
  );
};

const ReportRenderer = ({ data, type }) => {
  if (type === 'project_summary') {
    return <ProjectSummaryReport data={data} />;
  } else if (type === 'project_performance') {
    return <ProjectPerformanceReport data={data} />;
  } else if (type === 'issue_analytics') {
    return <IssueAnalyticsReport data={data} />;
  } else if (type === 'sprint_report') {
    return <SprintReport data={data} />;
  } else if (type === 'time_tracking') {
    return <TimeTrackingReport data={data} />;
  } else if (type === 'team_performance') {
    return <TeamPerformanceReport data={data} />;
  } else if (type === 'financial_report') {
    return <FinancialReport data={data} />;
  } else if (type === 'risk_analysis') {
    return <RiskAnalysisReport data={data} />;
  } else if (type === 'resource_allocation') {
    return <ResourceAllocationReport data={data} />;
  } else if (type === 'velocity_chart') {
    return <VelocityChartReport data={data} />;
  }
  return null;
};

const ProjectSummaryReport = ({ data }) => {
  return (
    <div className="report-section">
      <h2>Project Summary Report</h2>
      
      <div className="metrics-grid">
        <div className="metric-card">
          <h3>Total Projects</h3>
          <div className="metric-value">{data.totalProjects}</div>
        </div>
        <div className="metric-card">
          <h3>Active Projects</h3>
          <div className="metric-value">{data.activeProjects}</div>
        </div>
        <div className="metric-card">
          <h3>Completed</h3>
          <div className="metric-value">{data.completedProjects}</div>
        </div>
        <div className="metric-card">
          <h3>On Risk</h3>
          <div className="metric-value alert">{data.riskyProjects}</div>
        </div>
      </div>

      <div className="report-table">
        <table>
          <thead>
            <tr>
              <th>Project</th>
              <th>Status</th>
              <th>Progress</th>
              <th>Start Date</th>
              <th>Expected End</th>
              <th>Issues</th>
            </tr>
          </thead>
          <tbody>
            {data.projects?.map(p => (
              <tr key={p.id}>
                <td>{p.project_number}</td>
                <td><span className={`status ${p.status.toLowerCase()}`}>{p.status}</span></td>
                <td>
                  <div className="progress-mini">
                    <div className="progress-fill" style={{ width: `${p.progress || 0}%` }}></div>
                  </div>
                </td>
                <td>{new Date(p.start_date).toLocaleDateString()}</td>
                <td>{new Date(p.expected_end_date).toLocaleDateString()}</td>
                <td>{p.issueCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const ProjectPerformanceReport = ({ data }) => {
  return (
    <div className="report-section">
      <h2>Project Performance Report</h2>
      
      <div className="performance-metrics">
        <div className="perf-card">
          <h3>On-Time Delivery</h3>
          <div className="perf-value">{data.onTimeDelivery}%</div>
          <div className="perf-detail">{data.onTimeCount} of {data.totalProjects}</div>
        </div>
        <div className="perf-card">
          <h3>Budget Adherence</h3>
          <div className="perf-value">{data.budgetAdherence}%</div>
          <div className="perf-detail">Within budget</div>
        </div>
        <div className="perf-card">
          <h3>Quality Score</h3>
          <div className="perf-value">{data.qualityScore}/10</div>
          <div className="perf-detail">{data.defectCount} defects</div>
        </div>
        <div className="perf-card">
          <h3>Resource Utilization</h3>
          <div className="perf-value">{data.resourceUtilization}%</div>
          <div className="perf-detail">Optimal</div>
        </div>
      </div>

      <div className="chart-container">
        <h3>Performance Trends</h3>
        <div className="chart-placeholder">
          [Performance Trend Chart]
        </div>
      </div>
    </div>
  );
};

const IssueAnalyticsReport = ({ data }) => {
  return (
    <div className="report-section">
      <h2>Issue Analytics Report</h2>
      
      <div className="analytics-grid">
        <div className="analytics-card">
          <h3>Total Issues</h3>
          <div className="analytics-value">{data.totalIssues}</div>
        </div>
        <div className="analytics-card">
          <h3>Closed Issues</h3>
          <div className="analytics-value success">{data.closedIssues}</div>
        </div>
        <div className="analytics-card">
          <h3>Open Issues</h3>
          <div className="analytics-value alert">{data.openIssues}</div>
        </div>
        <div className="analytics-card">
          <h3>Average Resolution Time</h3>
          <div className="analytics-value">{data.avgResolutionTime} days</div>
        </div>
      </div>

      <div className="issues-breakdown">
        <h3>Issues by Priority</h3>
        <div className="breakdown-list">
          <div className="breakdown-item">
            <span>Critical</span>
            <span className="bar critical" style={{ width: `${data.criticalPercentage}%` }}></span>
            <span className="count">{data.criticalCount}</span>
          </div>
          <div className="breakdown-item">
            <span>High</span>
            <span className="bar high" style={{ width: `${data.highPercentage}%` }}></span>
            <span className="count">{data.highCount}</span>
          </div>
          <div className="breakdown-item">
            <span>Medium</span>
            <span className="bar medium" style={{ width: `${data.mediumPercentage}%` }}></span>
            <span className="count">{data.mediumCount}</span>
          </div>
          <div className="breakdown-item">
            <span>Low</span>
            <span className="bar low" style={{ width: `${data.lowPercentage}%` }}></span>
            <span className="count">{data.lowCount}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

const SprintReport = ({ data }) => {
  return (
    <div className="report-section">
      <h2>Sprint Report</h2>
      
      <div className="sprint-metrics">
        <div className="sprint-card">
          <h3>Current Sprint</h3>
          <div className="sprint-name">{data.currentSprintName}</div>
          <div className="sprint-dates">
            {data.sprintStart} - {data.sprintEnd}
          </div>
        </div>
        <div className="sprint-card">
          <h3>Sprint Velocity</h3>
          <div className="metric-large">{data.velocity}</div>
          <div className="metric-trend">Story Points</div>
        </div>
        <div className="sprint-card">
          <h3>Completion Rate</h3>
          <div className="metric-large">{data.completionRate}%</div>
          <div className="metric-trend">{data.completedIssues}/{data.totalIssues}</div>
        </div>
      </div>

      <div className="sprint-burndown">
        <h3>Sprint Burndown</h3>
        <div className="chart-placeholder">
          [Sprint Burndown Chart]
        </div>
      </div>
    </div>
  );
};

const TimeTrackingReport = ({ data }) => {
  return (
    <div className="report-section">
      <h2>Time Tracking Report</h2>
      
      <div className="time-metrics">
        <div className="time-card">
          <h3>Total Hours Logged</h3>
          <div className="time-value">{data.totalHours}</div>
        </div>
        <div className="time-card">
          <h3>Estimated vs Actual</h3>
          <div className="time-value">{data.variance}%</div>
          <div className="time-detail">{data.varianceType}</div>
        </div>
        <div className="time-card">
          <h3>Team Utilization</h3>
          <div className="time-value">{data.utilization}%</div>
        </div>
      </div>

      <div className="time-breakdown">
        <h3>Time by Team Member</h3>
        <table>
          <thead>
            <tr>
              <th>Team Member</th>
              <th>Estimated</th>
              <th>Actual</th>
              <th>Variance</th>
            </tr>
          </thead>
          <tbody>
            {data.timeByMember?.map(member => (
              <tr key={member.id}>
                <td>{member.name}</td>
                <td>{member.estimated}h</td>
                <td>{member.actual}h</td>
                <td className={member.variance > 0 ? 'over' : 'under'}>
                  {member.variance > 0 ? '+' : ''}{member.variance}h
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const TeamPerformanceReport = ({ data }) => {
  return (
    <div className="report-section">
      <h2>Team Performance Report</h2>
      
      <div className="team-metrics">
        <div className="team-card">
          <h3>Team Size</h3>
          <div className="team-value">{data.teamSize}</div>
        </div>
        <div className="team-card">
          <h3>Average Productivity</h3>
          <div className="team-value">{data.avgProductivity} issues/sprint</div>
        </div>
        <div className="team-card">
          <h3>Quality Score</h3>
          <div className="team-value">{data.qualityScore}/10</div>
        </div>
      </div>

      <div className="team-breakdown">
        <h3>Performance by Team Member</h3>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Issues Closed</th>
              <th>Avg Resolution</th>
              <th>Quality</th>
            </tr>
          </thead>
          <tbody>
            {data.teamMembers?.map(member => (
              <tr key={member.id}>
                <td>{member.name}</td>
                <td>{member.issuesClosed}</td>
                <td>{member.avgResolution} days</td>
                <td><span className="quality-badge">{member.quality}/10</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const FinancialReport = ({ data }) => {
  return (
    <div className="report-section">
      <h2>Financial Report</h2>
      
      <div className="financial-metrics">
        <div className="financial-card">
          <h3>Total Revenue</h3>
          <div className="financial-value">${(data.totalRevenue || 0).toLocaleString()}</div>
        </div>
        <div className="financial-card">
          <h3>Total Expenses</h3>
          <div className="financial-value">${(data.totalExpenses || 0).toLocaleString()}</div>
        </div>
        <div className="financial-card">
          <h3>Profit Margin</h3>
          <div className="financial-value">{data.profitMargin}%</div>
        </div>
        <div className="financial-card">
          <h3>Budget Variance</h3>
          <div className={`financial-value ${data.budgetVariance > 0 ? 'positive' : 'negative'}`}>
            {data.budgetVariance > 0 ? '+' : ''}{data.budgetVariance}%
          </div>
        </div>
      </div>
    </div>
  );
};

const RiskAnalysisReport = ({ data }) => {
  return (
    <div className="report-section">
      <h2>Risk Analysis Report</h2>
      
      <div className="risk-metrics">
        <div className="risk-card high">
          <h3>High Risk Projects</h3>
          <div className="risk-value">{data?.highRiskCount || 0}</div>
        </div>
        <div className="risk-card medium">
          <h3>Medium Risk Projects</h3>
          <div className="risk-value">{data?.mediumRiskCount || 0}</div>
        </div>
        <div className="risk-card low">
          <h3>Low Risk Projects</h3>
          <div className="risk-value">{data?.lowRiskCount || 0}</div>
        </div>
      </div>

      <div className="risk-breakdown">
        <h3>Risk Factors</h3>
        <table>
          <thead>
            <tr>
              <th>Project</th>
              <th>Risk Level</th>
              <th>Factors</th>
              <th>Mitigation</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan="4" style={{ textAlign: 'center', padding: '20px' }}>
                No high-risk projects identified
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

const ResourceAllocationReport = ({ data }) => {
  return (
    <div className="report-section">
      <h2>Resource Allocation Report</h2>
      
      <div className="resource-metrics">
        <div className="resource-card">
          <h3>Total Resources</h3>
          <div className="resource-value">{data?.totalResources || 0}</div>
        </div>
        <div className="resource-card">
          <h3>Allocated</h3>
          <div className="resource-value">{data?.allocatedResources || 0}</div>
        </div>
        <div className="resource-card">
          <h3>Available</h3>
          <div className="resource-value">{data?.availableResources || 0}</div>
        </div>
        <div className="resource-card">
          <h3>Utilization</h3>
          <div className="resource-value">{data?.utilizationRate || 0}%</div>
        </div>
      </div>

      <div className="resource-breakdown">
        <h3>Resource by Role</h3>
        <table>
          <thead>
            <tr>
              <th>Role</th>
              <th>Total</th>
              <th>Allocated</th>
              <th>Utilization %</th>
            </tr>
          </thead>
          <tbody>
            {data?.resourceByRole?.map((role, idx) => (
              <tr key={idx}>
                <td>{role.role}</td>
                <td>{role.total}</td>
                <td>{role.allocated}</td>
                <td>{role.utilization}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const VelocityChartReport = ({ data }) => {
  return (
    <div className="report-section">
      <h2>Velocity Chart Report</h2>
      
      <div className="velocity-metrics">
        <div className="velocity-card">
          <h3>Current Sprint Velocity</h3>
          <div className="velocity-value">{data?.currentVelocity || 0}</div>
          <div className="velocity-unit">Story Points</div>
        </div>
        <div className="velocity-card">
          <h3>Average Velocity</h3>
          <div className="velocity-value">{data?.averageVelocity || 0}</div>
          <div className="velocity-unit">Last 5 Sprints</div>
        </div>
        <div className="velocity-card">
          <h3>Trend</h3>
          <div className="velocity-value">{data?.trend || 'Stable'}</div>
          <div className="velocity-unit">{data?.trendPercent || '0'}%</div>
        </div>
      </div>

      <div className="velocity-chart">
        <h3>Sprint Velocity Trend</h3>
        <div className="chart-placeholder">
          [Velocity Trend Chart]
        </div>
      </div>
    </div>
  );
};

export default Reports;
