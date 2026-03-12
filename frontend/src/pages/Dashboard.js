import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { orderService, projectService, userService } from '../services/api';
import { useAuth } from '../context/AuthContext';

const normalizeManagerStatus = (value) => {
  const normalized = (value || 'Open').toString().trim().toLowerCase().replace(/\s+/g, '');
  if (normalized === 'pendingfromclient') return 'Pending from Client';
  if (normalized === 'onhold') return 'OnHold';
  if (normalized === 'closed') return 'Closed';
  return 'Open';
};

const statusBadgeClass = (status) => {
  if (status === 'Closed') return 'bg-gray-100 text-gray-800';
  if (status === 'Pending from Client') return 'bg-orange-100 text-orange-800';
  if (status === 'OnHold') return 'bg-rose-100 text-rose-800';
  return 'bg-cyan-100 text-cyan-800';
};

const getApiErrorMessage = (err, fallbackMessage) => {
  const status = err?.response?.status;
  const backendMessage = err?.response?.data?.error || err?.response?.data?.message;

  if (status === 409) {
    return backendMessage || 'Project cannot be deleted because related records still exist.';
  }
  if (status === 404) {
    return backendMessage || 'Project no longer exists. Please refresh the list.';
  }
  if (status === 403) {
    return backendMessage || 'You are not authorized to delete this project.';
  }
  if (status === 400) {
    return backendMessage || 'Invalid delete request.';
  }

  return backendMessage || err?.message || fallbackMessage;
};

const isCompletedStatus = (status) => ['Closed', 'Completed'].includes(String(status || ''));

const calculateProgress = (status) => {
  const normalized = String(status || '').toLowerCase();
  if (normalized.includes('closed') || normalized.includes('completed')) return 100;
  if (normalized.includes('in progress')) return 60;
  if (normalized.includes('assigned')) return 25;
  if (normalized.includes('submitted_to_pmo') || normalized.includes('submitted')) return 10;
  return 5;
};

const daysUntil = (dateValue) => {
  if (!dateValue) return null;
  const end = new Date(dateValue);
  if (Number.isNaN(end.getTime())) return null;
  const now = new Date();
  return Math.ceil((end - now) / (1000 * 60 * 60 * 24));
};

const daysSince = (dateValue) => {
  if (!dateValue) return null;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  const now = new Date();
  return Math.floor((now - date) / (1000 * 60 * 60 * 24));
};

const formatRelativeTime = (dateValue) => {
  const days = daysSince(dateValue);
  if (days === null) return 'N/A';
  if (days <= 0) return 'Today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
};

const getProjectHealth = (project, subprojects = []) => {
  if (isCompletedStatus(project?.status) && subprojects.every((sp) => isCompletedStatus(sp.status))) return 'Completed';

  const projectDelayed = !isCompletedStatus(project?.status) && (daysUntil(project?.expected_end_date) ?? 0) < 0;
  const subDelayed = subprojects.some((sp) => !isCompletedStatus(sp.status) && (daysUntil(sp.expected_end_date) ?? 0) < 0);
  if (projectDelayed || subDelayed) return 'Delayed';

  const projectInactiveDays = daysSince(project?.updated_at || project?.created_at) || 0;
  const projectDueSoon = (() => {
    const left = daysUntil(project?.expected_end_date);
    return left !== null && left >= 0 && left <= 7;
  })();
  const subDueSoon = subprojects.some((sp) => {
    const left = daysUntil(sp.expected_end_date);
    return left !== null && left >= 0 && left <= 7;
  });

  if (projectInactiveDays >= 7 || projectDueSoon || subDueSoon) return 'At Risk';

  const progress = calculateProgress(project?.status);
  if (progress <= 5) return 'Not Started';

  return 'On Track';
};

const getHealthDotClass = (health) => {
  if (health === 'On Track') return 'bg-emerald-500';
  if (health === 'At Risk') return 'bg-amber-400';
  if (health === 'Delayed') return 'bg-rose-500';
  if (health === 'Completed') return 'bg-blue-500';
  return 'bg-gray-300';
};

const progressBarClass = (value) => {
  if (value < 30) return 'bg-rose-500';
  if (value < 70) return 'bg-amber-400';
  return 'bg-emerald-500';
};

const Dashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [projects, setProjects] = useState([]);
  const [workflowOrders, setWorkflowOrders] = useState([]);
  const [auditors, setAuditors] = useState([]);

  const [clientFilter, setClientFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [managerFilter, setManagerFilter] = useState('all');
  const [auditorFilter, setAuditorFilter] = useState('all');
  const [delayFilter, setDelayFilter] = useState('all');

  const [selectedAuditor, setSelectedAuditor] = useState({});
  const [expandedGroups, setExpandedGroups] = useState({});

  const [loading, setLoading] = useState(true);
  const [savingStatusFor, setSavingStatusFor] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    const run = async () => {
      await fetchProjects();
      if (['manager', 'pmo', 'admin'].includes(user?.role)) {
        await fetchWorkflowOrders();
      } else {
        setWorkflowOrders([]);
      }
      if (user?.role === 'manager') {
        try {
          const res = await userService.getUsersByRole('auditor');
          setAuditors(res.data || []);
        } catch {
          setAuditors([]);
        }
      } else {
        setAuditors([]);
      }
    };
    run();
  }, [user?.id, user?.role]);

  const fetchProjects = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await projectService.getProjects({ limit: 200 });
      setProjects(response.data?.projects || []);
    } catch (err) {
      setError(err.message || 'Failed to fetch projects');
    } finally {
      setLoading(false);
    }
  };

  const fetchWorkflowOrders = async () => {
    try {
      const response = await orderService.getOrders({ limit: 200 });
      setWorkflowOrders(response.data?.orders || []);
    } catch {
      setWorkflowOrders([]);
    }
  };

  const handleDeleteProject = async (project) => {
    if (!window.confirm(`Delete project ${project.project_number}? This action is irreversible.`)) return;

    try {
      setError('');
      await projectService.deleteProject(project.id);
      await fetchProjects();
      setSuccess(`Project ${project.project_number} deleted successfully.`);
    } catch (err) {
      setSuccess('');
      setError(getApiErrorMessage(err, 'Failed to delete project'));
    }
  };

  const workflowSubprojectById = useMemo(() => {
    const byId = {};
    workflowOrders.forEach((order) => {
      (order.subprojects || []).forEach((sp) => {
        byId[sp.id] = { ...sp, orderNumber: order.order_number, projectNumber: order.project_number };
      });
    });
    return byId;
  }, [workflowOrders]);

  const managerOptions = useMemo(() => {
    const values = new Set();
    workflowOrders.forEach((o) => {
      (o.subprojects || []).forEach((sp) => {
        if (sp.assigned_manager) values.add(sp.assigned_manager);
      });
    });
    return Array.from(values).sort();
  }, [workflowOrders]);

  const auditorOptions = useMemo(() => {
    const values = new Set();
    projects.forEach((p) => {
      if (p.assigned_to_name) values.add(p.assigned_to_name);
    });
    return Array.from(values).sort();
  }, [projects]);

  const groupedProjects = useMemo(() => {
    const filtered = projects
      .filter((project) => {
        if (!clientFilter) return true;
        return (project.company_name || project.client_name || '').toLowerCase().includes(clientFilter.toLowerCase());
      })
      .filter((project) => {
        if (statusFilter === 'all') return true;
        return String(project.status || '') === statusFilter;
      })
      .filter((project) => {
        if (auditorFilter === 'all') return true;
        return (project.assigned_to_name || '') === auditorFilter;
      })
      .filter((project) => {
        const left = daysUntil(project.expected_end_date);
        if (delayFilter === 'all') return true;
        if (delayFilter === 'overdue') return left !== null && left < 0;
        if (delayFilter === 'dueSoon') return left !== null && left >= 0 && left <= 7;
        if (delayFilter === 'onTime') return left === null || left > 7;
        return true;
      });

    const groups = {};
    filtered.forEach((project) => {
      const number = String(project.project_number || '');
      const key = number.includes('-SP-') ? number.split('-SP-')[0] : number || String(project.id);
      if (!groups[key]) groups[key] = [];
      groups[key].push(project);
    });

    return Object.keys(groups)
      .map((key) => {
        const sorted = groups[key].slice().sort((a, b) => {
          const aIsSub = String(a.project_number || '').includes('-SP-');
          const bIsSub = String(b.project_number || '').includes('-SP-');
          if (aIsSub !== bIsSub) return aIsSub ? 1 : -1;
          return String(a.project_number || '').localeCompare(String(b.project_number || ''));
        });
        const parent = sorted.find((p) => !String(p.project_number || '').includes('-SP-')) || sorted[0];
        const subprojects = sorted.filter((p) => p.id !== parent.id);
        const subAvgProgress = subprojects.length > 0
          ? Math.round(subprojects.reduce((sum, sp) => sum + calculateProgress(sp.status), 0) / subprojects.length)
          : calculateProgress(parent.status);
        const health = getProjectHealth(parent, subprojects);
        const lastUpdatedAt = [parent, ...subprojects]
          .map((p) => new Date(p.updated_at || p.created_at).getTime())
          .filter((v) => Number.isFinite(v))
          .sort((a, b) => b - a)[0] || null;
        const healthScore = Math.max(
          0,
          Math.min(
            100,
            subAvgProgress - (health === 'Delayed' ? 25 : health === 'At Risk' ? 10 : 0) - ((daysSince(lastUpdatedAt) || 0) >= 7 ? 10 : 0)
          )
        );

        const managers = new Set();
        subprojects.forEach((sp) => {
          const wf = workflowSubprojectById[sp.origin_subproject_id];
          if (wf?.assigned_manager) managers.add(wf.assigned_manager);
        });

        return {
          key,
          parent,
          subprojects,
          subAvgProgress,
          health,
          healthScore,
          lastUpdatedAt,
          managers: Array.from(managers)
        };
      })
      .filter((group) => {
        if (riskFilter !== 'all' && group.health !== riskFilter) return false;
        if (managerFilter !== 'all' && !group.managers.includes(managerFilter)) return false;
        return true;
      })
      .sort((a, b) => new Date(b.parent?.created_at || 0) - new Date(a.parent?.created_at || 0));
  }, [projects, clientFilter, statusFilter, riskFilter, managerFilter, auditorFilter, delayFilter, workflowSubprojectById]);

  const portfolioRiskSummary = useMemo(() => {
    const delayed = groupedProjects.filter((g) => g.health === 'Delayed').length;
    const atRisk = groupedProjects.filter((g) => g.health === 'At Risk').length;
    const unassignedAuditor = groupedProjects.filter((g) => !g.parent.assigned_to_name).length;

    let unassignedManager = 0;
    if (['pmo', 'admin'].includes(user?.role)) {
      workflowOrders.forEach((o) => {
        (o.subprojects || []).forEach((sp) => {
          if (!sp.assigned_manager_id) unassignedManager += 1;
        });
      });
    }

    return { delayed, atRisk, unassignedAuditor, unassignedManager };
  }, [groupedProjects, workflowOrders, user?.role]);

  const managerExecutionSummary = useMemo(() => {
    if (user?.role !== 'manager') {
      return { myActiveSubprojects: 0, dueThisWeek: 0, overdue: 0, pendingAuditorReview: 0, upcoming: [] };
    }

    const allSubprojects = groupedProjects.flatMap((g) => g.subprojects);
    const myActiveSubprojects = allSubprojects.filter((sp) => !isCompletedStatus(sp.status)).length;
    const dueThisWeek = allSubprojects.filter((sp) => {
      const left = daysUntil(sp.expected_end_date);
      return left !== null && left >= 0 && left <= 7 && !isCompletedStatus(sp.status);
    }).length;
    const overdue = allSubprojects.filter((sp) => {
      const left = daysUntil(sp.expected_end_date);
      return left !== null && left < 0 && !isCompletedStatus(sp.status);
    }).length;
    const pendingAuditorReview = allSubprojects.filter((sp) => !sp.assigned_to_name).length;

    const upcoming = allSubprojects
      .map((sp) => ({
        ...sp,
        daysLeft: daysUntil(sp.expected_end_date)
      }))
      .filter((sp) => sp.daysLeft !== null && sp.daysLeft >= 0 && sp.daysLeft <= 7 && !isCompletedStatus(sp.status))
      .sort((a, b) => a.daysLeft - b.daysLeft)
      .slice(0, 5);

    return { myActiveSubprojects, dueThisWeek, overdue, pendingAuditorReview, upcoming };
  }, [groupedProjects, user?.role]);

  const toggleGroup = (groupKey) => {
    setExpandedGroups((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }));
  };

  const groupsWithSubprojects = groupedProjects.filter((g) => g.subprojects.length > 0);
  const expandAllGroups = () => {
    const next = {};
    groupsWithSubprojects.forEach((g) => {
      next[g.key] = true;
    });
    setExpandedGroups(next);
  };
  const collapseAllGroups = () => setExpandedGroups({});

  const handleQuickManagerStatusChange = async (project, managerStatus) => {
    try {
      setSavingStatusFor(project.id);
      setError('');
      await projectService.updateManagerStatus(project.id, {
        managerStatus,
        assignedAuditor: project.assigned_to || null
      });
      await fetchProjects();
      setSuccess(`Updated status for ${project.project_number}`);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to update status'));
    } finally {
      setSavingStatusFor('');
    }
  };

  const projectStatusOptions = useMemo(() => {
    const values = new Set(projects.map((p) => p.status).filter(Boolean));
    return Array.from(values).sort();
  }, [projects]);

  return (
    <div className="py-6">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-600 mt-2">Welcome, {user?.username}!</p>

        {error && <div className="mt-4 rounded-md bg-red-50 p-4"><p className="text-sm text-red-700">{error}</p></div>}
        {success && <div className="mt-4 rounded-md bg-green-50 p-4"><p className="text-sm text-green-700">{success}</p></div>}

        {loading ? (
          <div className="flex items-center justify-center h-64">Loading...</div>
        ) : (
          <>
            {['pmo', 'admin'].includes(user?.role) && (
              <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border-l-4 border-rose-500 bg-white p-4 shadow">
                  <p className="text-sm text-gray-600">🚨 Delayed Projects</p>
                  <p className="mt-1 text-2xl font-bold text-gray-900">{portfolioRiskSummary.delayed}</p>
                </div>
                <div className="rounded-lg border-l-4 border-amber-400 bg-white p-4 shadow">
                  <p className="text-sm text-gray-600">⚠️ At Risk</p>
                  <p className="mt-1 text-2xl font-bold text-gray-900">{portfolioRiskSummary.atRisk}</p>
                </div>
                <div className="rounded-lg border-l-4 border-indigo-500 bg-white p-4 shadow">
                  <p className="text-sm text-gray-600">❗ Unassigned Auditor</p>
                  <p className="mt-1 text-2xl font-bold text-gray-900">{portfolioRiskSummary.unassignedAuditor}</p>
                </div>
                <div className="rounded-lg border-l-4 border-slate-500 bg-white p-4 shadow">
                  <p className="text-sm text-gray-600">❗ Unassigned Manager</p>
                  <p className="mt-1 text-2xl font-bold text-gray-900">{portfolioRiskSummary.unassignedManager}</p>
                </div>
              </div>
            )}

            {user?.role === 'manager' && (
              <>
                <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg border-l-4 border-cyan-500 bg-white p-4 shadow"><p className="text-sm text-gray-600">My Active Subprojects</p><p className="mt-1 text-2xl font-bold">{managerExecutionSummary.myActiveSubprojects}</p></div>
                  <div className="rounded-lg border-l-4 border-amber-400 bg-white p-4 shadow"><p className="text-sm text-gray-600">Due This Week</p><p className="mt-1 text-2xl font-bold">{managerExecutionSummary.dueThisWeek}</p></div>
                  <div className="rounded-lg border-l-4 border-rose-500 bg-white p-4 shadow"><p className="text-sm text-gray-600">Overdue</p><p className="mt-1 text-2xl font-bold">{managerExecutionSummary.overdue}</p></div>
                  <div className="rounded-lg border-l-4 border-indigo-500 bg-white p-4 shadow"><p className="text-sm text-gray-600">Pending Auditor Review</p><p className="mt-1 text-2xl font-bold">{managerExecutionSummary.pendingAuditorReview}</p></div>
                </div>
                <div className="mt-4 rounded-lg bg-white p-4 shadow">
                  <h3 className="text-base font-semibold text-gray-900">🔥 Next 7 Days</h3>
                  {managerExecutionSummary.upcoming.length === 0 ? (
                    <p className="mt-2 text-sm text-gray-500">No upcoming deadlines in next 7 days.</p>
                  ) : (
                    <ul className="mt-2 space-y-1 text-sm text-gray-700">
                      {managerExecutionSummary.upcoming.map((sp) => (
                        <li key={sp.id}>- {sp.project_number} ({sp.daysLeft} day{sp.daysLeft === 1 ? '' : 's'} left)</li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}

            <div className="mt-8">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between mb-4">
                <h3 className="text-lg font-medium text-gray-900">Recent Projects</h3>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-6">
                  <input
                    type="text"
                    placeholder="Filter by client"
                    value={clientFilter}
                    onChange={(e) => setClientFilter(e.target.value)}
                    className="px-3 py-2 border-2 border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 border rounded-md text-sm">
                    <option value="all">All Status</option>
                    {projectStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
                  </select>
                  <select value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)} className="px-3 py-2 border rounded-md text-sm">
                    <option value="all">All Risk</option>
                    <option value="On Track">On Track</option>
                    <option value="At Risk">At Risk</option>
                    <option value="Delayed">Delayed</option>
                    <option value="Completed">Completed</option>
                    <option value="Not Started">Not Started</option>
                  </select>
                  <select value={managerFilter} onChange={(e) => setManagerFilter(e.target.value)} className="px-3 py-2 border rounded-md text-sm">
                    <option value="all">All Manager</option>
                    {managerOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                  <select value={auditorFilter} onChange={(e) => setAuditorFilter(e.target.value)} className="px-3 py-2 border rounded-md text-sm">
                    <option value="all">All Auditor</option>
                    {auditorOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                  <select value={delayFilter} onChange={(e) => setDelayFilter(e.target.value)} className="px-3 py-2 border rounded-md text-sm">
                    <option value="all">All Delay</option>
                    <option value="overdue">Overdue</option>
                    <option value="dueSoon">Due ≤ 7 Days</option>
                    <option value="onTime">On Time</option>
                  </select>
                </div>
              </div>

              <p className="mb-3 text-sm text-gray-600">Showing {groupedProjects.length} project group(s)</p>

              {groupsWithSubprojects.length > 0 && (
                <div className="mb-3 flex gap-2">
                  <button type="button" onClick={expandAllGroups} className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Expand All Subprojects</button>
                  <button type="button" onClick={collapseAllGroups} className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Collapse All</button>
                </div>
              )}

              <div className="bg-white shadow rounded-lg">
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Project</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Health</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Manager Status</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Start</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">End</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Updated</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Auditor</th>
                        {user?.role === 'manager' && <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Quick Status</th>}
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {groupedProjects.length === 0 ? (
                        <tr>
                          <td colSpan={user?.role === 'manager' ? 10 : 9} className="px-6 py-4 text-sm text-gray-500">No projects found.</td>
                        </tr>
                      ) : (
                        groupedProjects.map((group) => {
                          const { key, parent, subprojects, subAvgProgress, health, healthScore, lastUpdatedAt } = group;
                          const isExpanded = !!expandedGroups[key];
                          const stale = (daysSince(lastUpdatedAt) || 0) >= 7;

                          return (
                            <React.Fragment key={key}>
                              <tr className="hover:bg-gray-50">
                                <td className="px-4 py-4 text-sm">
                                  {user?.role === 'admin' ? (
                                    <button onClick={() => handleDeleteProject(parent)} className="text-red-600 hover:text-red-800 text-sm">Delete</button>
                                  ) : (
                                    <span className="text-sm text-gray-400">-</span>
                                  )}
                                </td>
                                <td className="px-4 py-4 text-sm font-medium">
                                  <button onClick={() => (subprojects.length > 0 ? toggleGroup(key) : navigate(`/project/${parent.id}`))} className="text-blue-600 hover:text-blue-800 hover:underline">
                                    {subprojects.length > 0 ? (isExpanded ? '▾' : '▸') : ''} {parent.project_number}
                                  </button>
                                  {subprojects.length > 0 && (
                                    <div className="mt-2">
                                      <div className="flex items-center gap-2">
                                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{subprojects.length} subproject{subprojects.length > 1 ? 's' : ''}</span>
                                        <span className="text-xs text-slate-500">Progress: {subAvgProgress}%</span>
                                        <span className="text-xs text-slate-500">Health: {healthScore}%</span>
                                      </div>
                                      <div className="mt-1 w-36 bg-gray-200 rounded-full h-2">
                                        <div className={`h-2 rounded-full ${progressBarClass(subAvgProgress)}`} style={{ width: `${subAvgProgress}%` }} />
                                      </div>
                                    </div>
                                  )}
                                </td>
                                <td className="px-4 py-4 text-sm">
                                  <div className="flex items-center gap-2">
                                    <span className={`inline-block h-3 w-3 rounded-full ${getHealthDotClass(health)}`} />
                                    <span>{health}</span>
                                  </div>
                                </td>
                                <td className="px-4 py-4 text-sm text-gray-900">{parent.project_type}</td>
                                <td className="px-4 py-4 text-sm">
                                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusBadgeClass(normalizeManagerStatus(parent.manager_status))}`}>
                                    {normalizeManagerStatus(parent.manager_status)}
                                  </span>
                                </td>
                                <td className="px-4 py-4 text-sm text-gray-600">{parent.start_date || 'N/A'}</td>
                                <td className="px-4 py-4 text-sm text-gray-600">{parent.expected_end_date || 'N/A'}</td>
                                <td className={`px-4 py-4 text-sm ${stale ? 'text-rose-700 font-medium' : 'text-gray-600'}`}>{formatRelativeTime(lastUpdatedAt)}</td>
                                <td className="px-4 py-4 text-sm text-gray-600">
                                  {parent.assigned_to_name || 'Unassigned'}
                                  {user?.role === 'manager' && (
                                    <div className="mt-2">
                                      <select
                                        value={selectedAuditor[parent.id] || ''}
                                        onChange={(e) => setSelectedAuditor((prev) => ({ ...prev, [parent.id]: e.target.value }))}
                                        className="border px-2 py-1 rounded mr-2 text-sm"
                                      >
                                        <option value="">Select auditor</option>
                                        {auditors.map((a) => <option key={a.id} value={a.id}>{a.username}</option>)}
                                      </select>
                                      <button
                                        onClick={async () => {
                                          const auditorId = selectedAuditor[parent.id];
                                          if (!auditorId) return;
                                          try {
                                            await projectService.assignProject(parent.id, { auditorId });
                                            await fetchProjects();
                                          } catch (err) {
                                            setError(getApiErrorMessage(err, 'Failed to assign auditor'));
                                          }
                                        }}
                                        className="text-sm bg-blue-600 text-white px-2 py-1 rounded"
                                      >
                                        Assign
                                      </button>
                                    </div>
                                  )}
                                </td>
                                {user?.role === 'manager' && (
                                  <td className="px-4 py-4 text-sm">
                                    <select
                                      disabled={savingStatusFor === parent.id}
                                      value={normalizeManagerStatus(parent.manager_status)}
                                      onChange={(e) => handleQuickManagerStatusChange(parent, e.target.value)}
                                      className="border rounded px-2 py-1 text-sm"
                                    >
                                      <option value="Open">Open</option>
                                      <option value="In Progress">In Progress</option>
                                      <option value="Completed">Completed</option>
                                      <option value="OnHold">OnHold</option>
                                      <option value="Pending from Client">Pending from Client</option>
                                      <option value="Closed">Closed</option>
                                    </select>
                                  </td>
                                )}
                              </tr>

                              {isExpanded && subprojects.length > 0 && (
                                <tr>
                                  <td colSpan={user?.role === 'manager' ? 10 : 9} className="px-4 pb-4 pt-1">
                                    <div className="rounded border border-slate-200 bg-slate-50 p-3">
                                      <p className="text-xs font-semibold text-slate-600 mb-2">Subproject Status View</p>
                                      <div className="overflow-x-auto">
                                        <table className="min-w-full text-sm">
                                          <thead className="bg-white">
                                            <tr>
                                              <th className="px-3 py-2 text-left">Subproject</th>
                                              <th className="px-3 py-2 text-left">Manager</th>
                                              <th className="px-3 py-2 text-left">Auditor</th>
                                              <th className="px-3 py-2 text-left">Status</th>
                                              <th className="px-3 py-2 text-left">Progress</th>
                                              <th className="px-3 py-2 text-left">Risk</th>
                                              <th className="px-3 py-2 text-left">Timeline</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {subprojects.map((sp) => {
                                              const wf = workflowSubprojectById[sp.origin_subproject_id] || {};
                                              const progress = calculateProgress(sp.status);
                                              const risk = getProjectHealth(sp, []);
                                              const delayed = risk === 'Delayed';
                                              return (
                                                <tr key={sp.id} className="border-t bg-white">
                                                  <td className="px-3 py-2">{wf.subproject_name || sp.project_number}</td>
                                                  <td className="px-3 py-2">{wf.assigned_manager || 'Unassigned'}</td>
                                                  <td className="px-3 py-2">{sp.assigned_to_name || 'Unassigned'}</td>
                                                  <td className="px-3 py-2">{sp.status || 'N/A'}</td>
                                                  <td className="px-3 py-2">
                                                    <div className="flex items-center gap-2">
                                                      <div className="w-20 bg-gray-200 rounded-full h-2">
                                                        <div className={`h-2 rounded-full ${progressBarClass(progress)}`} style={{ width: `${progress}%` }} />
                                                      </div>
                                                      <span>{progress}%</span>
                                                    </div>
                                                  </td>
                                                  <td className="px-3 py-2">
                                                    <div className="flex items-center gap-2">
                                                      <span className={`inline-block h-2.5 w-2.5 rounded-full ${getHealthDotClass(risk)}`} />
                                                      <span>{risk}</span>
                                                      {delayed && <span className="text-rose-600 text-xs font-semibold">🚨 Escalated to PMO</span>}
                                                    </div>
                                                  </td>
                                                  <td className="px-3 py-2">
                                                    <button onClick={() => navigate(`/project/${sp.id}`)} className="text-blue-600 hover:underline">View timeline</button>
                                                  </td>
                                                </tr>
                                              );
                                            })}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
