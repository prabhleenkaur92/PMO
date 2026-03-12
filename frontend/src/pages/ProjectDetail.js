import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { orderService, projectService, roleService, userService } from '../services/api';
import { useAuth } from '../context/AuthContext';

const statusClasses = {
  New: 'bg-amber-100 text-amber-800 border border-amber-200',
  Submitted_To_PMO: 'bg-indigo-100 text-indigo-800 border border-indigo-200',
  Assigned_To_Manager: 'bg-sky-100 text-sky-800 border border-sky-200',
  Assigned: 'bg-indigo-100 text-indigo-800 border border-indigo-200',
  'In Progress': 'bg-sky-100 text-sky-800 border border-sky-200',
  'Pending from Client': 'bg-orange-100 text-orange-800 border border-orange-200',
  Completed: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
  Closed: 'bg-slate-100 text-slate-800 border border-slate-200'
};

const managerStatusClasses = {
  Open: 'bg-blue-100 text-blue-800 border border-blue-200',
  'Pending from Client': 'bg-orange-100 text-orange-800 border border-orange-200',
  Closed: 'bg-slate-100 text-slate-800 border border-slate-200',
  OnHold: 'bg-rose-100 text-rose-800 border border-rose-200'
};

const formatDate = (value) => {
  if (!value) return 'Not Set';
  return new Date(value).toLocaleDateString();
};

const toPublicUrl = (relativeOrAbsolute) => {
  if (!relativeOrAbsolute) return null;
  if (/^https?:\/\//i.test(relativeOrAbsolute)) return relativeOrAbsolute;
  const apiBase = process.env.REACT_APP_API_URL || '/api';
  const serverBase = apiBase.replace(/\/api\/?$/, '');
  return `${serverBase}${relativeOrAbsolute}`;
};

const badgeClass = (status) => statusClasses[status] || 'bg-gray-100 text-gray-700 border border-gray-200';
const managerBadgeClass = (status) => managerStatusClasses[status] || 'bg-gray-100 text-gray-700 border border-gray-200';
const isRecurringType = (value) => String(value || '').toLowerCase() === 'recurring';

export default function ProjectDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [project, setProject] = useState(null);
  const [remarks, setRemarks] = useState([]);
  const [newRemark, setNewRemark] = useState('');
  const [noteFiles, setNoteFiles] = useState([]);
  const [auditors, setAuditors] = useState([]);
  const [managers, setManagers] = useState([]);
  const [projectOrders, setProjectOrders] = useState([]);
  const [subprojectManagerSelection, setSubprojectManagerSelection] = useState({});
  const [subprojectScopeInput, setSubprojectScopeInput] = useState({});
  const [expandedOrderSections, setExpandedOrderSections] = useState({});
  const [managerStatus, setManagerStatus] = useState('Open');
  const [assignedAuditor, setAssignedAuditor] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({});
  const [message, setMessage] = useState('');
  const [editingRemarkId, setEditingRemarkId] = useState(null);
  const [editingRemarkContent, setEditingRemarkContent] = useState('');
  const [visibilityMap, setVisibilityMap] = useState({});

  useEffect(() => {
    const load = async () => {
      try {
        const res = await projectService.getProjectById(id);
        setProject(res.data.project);
        setRemarks(res.data.remarks || []);
        setEditData(res.data.project);
        setManagerStatus(res.data.project.manager_status || 'Open');
        setAssignedAuditor(res.data.project.assigned_to || '');
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  useEffect(() => {
    const loadAuditors = async () => {
      try {
        const res = await userService.getUsersByRole('auditor');
        setAuditors(res.data || []);
      } catch (err) {
        console.error('Could not load auditors', err);
      }
    };
    if (user && (user.role === 'manager' || user.role === 'admin')) loadAuditors();
  }, [user]);

  const loadOrderWorkflow = async () => {
    if (!['pmo', 'admin', 'manager', 'finance'].includes(user?.role)) return;
    try {
      const requests = [orderService.getOrders({ projectId: id })];
      if (['pmo', 'admin'].includes(user?.role)) {
        requests.push(userService.getUsersByRole('manager'));
      }
      const [ordersRes, managersRes] = await Promise.all(requests);
      const orders = ordersRes.data?.orders || [];
      setProjectOrders(orders);
      setManagers(managersRes?.data || []);

      const nextExpanded = {};
      orders.forEach((o) => {
        if (['pmo', 'admin'].includes(user?.role) || (o.subprojects || []).length <= 1) nextExpanded[o.id] = true;
      });
      setExpandedOrderSections(nextExpanded);

      const nextSelection = {};
      const nextScopes = {};
      orders.forEach((o) => {
        (o.subprojects || []).forEach((sp) => {
          nextSelection[sp.id] = sp.assigned_manager_id || '';
          nextScopes[sp.id] = sp.subproject_scope || '';
        });
      });
      setSubprojectManagerSelection(nextSelection);
      setSubprojectScopeInput(nextScopes);
    } catch (err) {
      console.error('Could not load PMO manager assignment data', err);
    }
  };

  useEffect(() => {
    loadOrderWorkflow();
  }, [id, user?.role]);

  useEffect(() => {
    const loadVisibility = async () => {
      try {
        const res = await roleService.getMyFieldVisibility('project_form');
        const nextMap = {};
        (res.data?.fields || []).forEach((f) => {
          nextMap[f.key] = f.isVisible;
        });
        setVisibilityMap(nextMap);
      } catch (_) {
        setVisibilityMap({});
      }
    };
    loadVisibility();
  }, []);

  const addRemark = async () => {
    if (!newRemark.trim() && noteFiles.length === 0) return;
    setSaving(true);
    setMessage('');
    try {
      const formData = new FormData();
      formData.append('content', newRemark);
      Array.from(noteFiles).forEach((f) => formData.append('files', f));
      await projectService.addRemark(id, formData);
      const res = await projectService.getProjectById(id);
      setRemarks(res.data.remarks || []);
      setNewRemark('');
      setNoteFiles([]);
      setMessage('Note added successfully');
      setTimeout(() => setMessage(''), 3000);
    } catch (err) {
      console.error(err);
      setMessage('Error adding note: ' + (err.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  };

  const editRemark = async (remarkId) => {
    if (!editingRemarkContent.trim()) return;
    setSaving(true);
    setMessage('');
    try {
      await projectService.updateRemark(id, remarkId, { content: editingRemarkContent });
      const res = await projectService.getProjectById(id);
      setRemarks(res.data.remarks || []);
      setEditingRemarkId(null);
      setEditingRemarkContent('');
      setMessage('Note updated successfully');
      setTimeout(() => setMessage(''), 3000);
    } catch (err) {
      console.error(err);
      setMessage('Error updating note: ' + (err.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  };

  const deleteRemark = async (remarkId) => {
    if (!window.confirm('Are you sure you want to delete this note?')) return;
    setSaving(true);
    setMessage('');
    try {
      await projectService.deleteRemark(id, remarkId);
      const res = await projectService.getProjectById(id);
      setRemarks(res.data.remarks || []);
      setMessage('Note deleted successfully');
      setTimeout(() => setMessage(''), 3000);
    } catch (err) {
      console.error(err);
      setMessage('Error deleting note: ' + (err.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  };

  const saveManagerStatus = async () => {
    setSaving(true);
    setMessage('');
    try {
      const assignedId = assignedAuditor || null;
      await projectService.updateManagerStatus(id, { managerStatus, assignedAuditor: assignedId });
      const res = await projectService.getProjectById(id);
      setProject(res.data.project);
      setMessage('Manager status updated successfully');
      window.dispatchEvent(new Event('projectsUpdated'));
    } catch (err) {
      console.error(err);
      setMessage('Error saving manager status: ' + (err.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  };

  const handleEditProject = async () => {
    setSaving(true);
    setMessage('');
    try {
      await projectService.updateProject(id, {
        companyName: editData.company_name,
        companyAddress: editData.company_address,
        workorderNumber: editData.workorder_number,
        poNumber: editData.po_number,
        financeProjectType: editData.finance_project_type,
        billingCycle: editData.billing_cycle,
        billingStartDate: editData.billing_start_date,
        billingEndDate: editData.billing_end_date,
        organizationCategory: editData.organization_category,
        reasonToConductAudit: editData.reason_to_conduct_audit,
        sectorOfOrganization: editData.sector_of_organization,
        typeOfAudit: editData.type_of_audit,
        typeOfAuditOther: editData.type_of_audit_other,
        scopeDescription: editData.scope_description,
        projectType: editData.project_type,
        testingType: editData.testing_type,
        managerNotes: editData.managerNotes || ''
      });
      const res = await projectService.getProjectById(id);
      setProject(res.data.project);
      setEditData(res.data.project);
      setIsEditing(false);
      setMessage('Project updated successfully');
    } catch (err) {
      console.error(err);
      setMessage(`Error updating project: ${err.response?.data?.error || err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const forwardToManager = async () => {
    setSaving(true);
    setMessage('');
    try {
      await projectService.updateProjectStatus(id, {
        newStatus: 'Assigned_To_Manager',
        comment: 'Forwarded by PMO to Manager'
      });
      const res = await projectService.getProjectById(id);
      setProject(res.data.project);
      setMessage('Project forwarded to Manager successfully');
      window.dispatchEvent(new Event('projectsUpdated'));
    } catch (err) {
      console.error(err);
      setMessage('Error forwarding project: ' + (err.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  };

  const assignManagerToSubproject = async (orderId, subprojectId) => {
    const managerId = subprojectManagerSelection[subprojectId];
    const scopeText = (subprojectScopeInput[subprojectId] || '').trim();
    if (!managerId) {
      setMessage('Error assigning manager: please select a manager');
      return;
    }
    if (!scopeText) {
      setMessage('Error assigning manager: please provide a subproject scope');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      await orderService.assignSubprojectManager(orderId, subprojectId, managerId, scopeText);
      await loadOrderWorkflow();
      const res = await projectService.getProjectById(id);
      setProject(res.data.project);
      setMessage('Manager assigned to subproject successfully');
      window.dispatchEvent(new Event('projectsUpdated'));
    } catch (err) {
      console.error(err);
      setMessage('Error assigning manager: ' + (err.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  };

  const toggleOrderSection = (orderId) => {
    setExpandedOrderSections((prev) => ({
      ...prev,
      [orderId]: !prev[orderId]
    }));
  };

  if (loading) {
    return (
      <div className="px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <p className="text-lg font-semibold text-slate-700">Loading project details...</p>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl rounded-2xl border border-rose-200 bg-rose-50 p-10 text-center shadow-sm">
          <p className="text-lg font-semibold text-rose-700">Project not found</p>
        </div>
      </div>
    );
  }

  const canEdit = user?.role === 'finance' || user?.role === 'admin';
  const canShowField = (key) => visibilityMap[key] !== false;
  const canViewFinancialFields = user?.role === 'finance' || user?.role === 'admin';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-sky-50 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Project Overview</p>
              <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">{project.project_number}</h2>
              <p className="text-base text-slate-600">{project.company_name || project.client_name || 'Unknown Company'}</p>
              <div className="flex flex-wrap gap-2 pt-1">
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${badgeClass(project.status)}`}>
                  Status: {project.status}
                </span>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${managerBadgeClass(project.manager_status || 'Open')}`}>
                  Manager: {project.manager_status || 'Open'}
                </span>
              </div>
            </div>
            {canEdit && !isEditing && (
              <button
                onClick={() => setIsEditing(true)}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Edit Project
              </button>
            )}
          </div>
        </div>

        {message && (
          <div className={`rounded-xl border px-4 py-3 text-sm font-medium ${message.includes('Error') ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
            {message}
          </div>
        )}

        {isEditing ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <h3 className="text-xl font-semibold text-slate-900">Edit Project</h3>
            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
              {canShowField('companyName') && <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Company Name</label>
                <input
                  type="text"
                  value={editData.company_name || ''}
                  onChange={(e) => setEditData({ ...editData, company_name: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
                />
              </div>}
              {canShowField('companyAddress') && <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Company Address</label>
                <input
                  type="text"
                  value={editData.company_address || ''}
                  onChange={(e) => setEditData({ ...editData, company_address: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
                />
              </div>}
              {canShowField('projectType') && <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Project Type</label>
                <select
                  value={editData.project_type || ''}
                  onChange={(e) => setEditData({ ...editData, project_type: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
                >
                  <option value="VAPT">VAPT</option>
                  <option value="Compliance">Compliance</option>
                  <option value="Both">Both</option>
                </select>
              </div>}
              {canShowField('workorderNumber') && <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Workorder Number</label>
                <input
                  type="text"
                  value={editData.workorder_number || ''}
                  onChange={(e) => setEditData({ ...editData, workorder_number: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
                />
              </div>}
              {canShowField('testingType') && <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Testing Type</label>
                <select
                  value={editData.testing_type || ''}
                  onChange={(e) => setEditData({ ...editData, testing_type: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
                >
                  <option value="Blackbox">Blackbox</option>
                  <option value="Whitebox">Whitebox</option>
                  <option value="Graybox">Graybox</option>
                </select>
              </div>}
              {canViewFinancialFields && canShowField('poNumber') && <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">PO Number</label>
                <input
                  type="text"
                  value={editData.po_number || ''}
                  onChange={(e) => setEditData({ ...editData, po_number: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
                />
              </div>}
              {canViewFinancialFields && canShowField('financeProjectType') && <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Finance Project Type</label>
                <select
                  value={editData.finance_project_type || 'One time'}
                  onChange={(e) => {
                    const nextType = e.target.value;
                    setEditData({
                      ...editData,
                      finance_project_type: nextType,
                      ...(nextType === 'One time' ? { billing_cycle: '', billing_start_date: '', billing_end_date: '' } : {})
                    });
                  }}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
                >
                  <option value="One time">One time</option>
                  <option value="Recurring">Recurring</option>
                </select>
              </div>}
              {canViewFinancialFields && canShowField('billingCycle') && <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Billing Cycle</label>
                <select
                  value={editData.billing_cycle || ''}
                  disabled={!isRecurringType(editData.finance_project_type)}
                  onChange={(e) => setEditData({ ...editData, billing_cycle: e.target.value })}
                  className={`w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200 ${!isRecurringType(editData.finance_project_type) ? 'bg-slate-100 text-slate-500' : ''}`}
                >
                  <option value="">Select Billing Cycle</option>
                  <option value="Weekly">Weekly</option>
                  <option value="Monthly">Monthly</option>
                  <option value="Quarterly">Quarterly</option>
                  <option value="Half-Yearly">Half-Yearly</option>
                  <option value="Yearly">Yearly</option>
                </select>
              </div>}
              {canViewFinancialFields && canShowField('billingStartDate') && <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Billing Start Date</label>
                <input
                  type="date"
                  value={editData.billing_start_date ? String(editData.billing_start_date).slice(0, 10) : ''}
                  disabled={!isRecurringType(editData.finance_project_type)}
                  onChange={(e) => setEditData({ ...editData, billing_start_date: e.target.value })}
                  className={`w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200 ${!isRecurringType(editData.finance_project_type) ? 'bg-slate-100 text-slate-500' : ''}`}
                />
              </div>}
              {canViewFinancialFields && canShowField('billingEndDate') && <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Billing End Date</label>
                <input
                  type="date"
                  value={editData.billing_end_date ? String(editData.billing_end_date).slice(0, 10) : ''}
                  disabled={!isRecurringType(editData.finance_project_type)}
                  onChange={(e) => setEditData({ ...editData, billing_end_date: e.target.value })}
                  className={`w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200 ${!isRecurringType(editData.finance_project_type) ? 'bg-slate-100 text-slate-500' : ''}`}
                />
              </div>}
              {canShowField('organizationCategory') && <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Category of Organization</label>
                <input
                  type="text"
                  value={editData.organization_category || ''}
                  onChange={(e) => setEditData({ ...editData, organization_category: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
                />
              </div>}
              {canShowField('reasonToConductAudit') && <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Reason to Conduct Audit</label>
                <input
                  type="text"
                  value={editData.reason_to_conduct_audit || ''}
                  onChange={(e) => setEditData({ ...editData, reason_to_conduct_audit: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
                />
              </div>}
              {canShowField('sectorOfOrganization') && <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Sector of Organization</label>
                <input
                  type="text"
                  value={editData.sector_of_organization || ''}
                  onChange={(e) => setEditData({ ...editData, sector_of_organization: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
                />
              </div>}
              {canShowField('typeOfAudit') && <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Type of Audit</label>
                <input
                  type="text"
                  value={editData.type_of_audit || ''}
                  onChange={(e) => setEditData({ ...editData, type_of_audit: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
                />
              </div>}
              {canShowField('typeOfAuditOther') && editData.type_of_audit === 'Any other' && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Any Other Type of Audit</label>
                  <input
                    type="text"
                    value={editData.type_of_audit_other || ''}
                    onChange={(e) => setEditData({ ...editData, type_of_audit_other: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
                  />
                </div>
              )}
              {canShowField('scopeDescription') && <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium text-slate-700">Scope Description</label>
                <textarea
                  value={editData.scope_description || ''}
                  onChange={(e) => setEditData({ ...editData, scope_description: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
                  rows="4"
                />
              </div>}
              {user?.role === 'manager' && (
                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Manager Notes</label>
                  <textarea
                    value={editData.managerNotes || ''}
                    onChange={(e) => setEditData({ ...editData, managerNotes: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
                    rows="3"
                  />
                </div>
              )}
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                onClick={handleEditProject}
                disabled={saving}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                onClick={() => {
                  setIsEditing(false);
                  setEditData(project);
                }}
                className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-300"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
              <h3 className="text-lg font-semibold text-slate-900">Project Details</h3>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {canShowField('projectType') && <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Project Type</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">{project.project_type}</p>
                </div>}
                {canShowField('testingType') && <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Testing Type</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">{project.testing_type}</p>
                </div>}
                {canShowField('workorderNumber') && <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Workorder Number</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">{project.workorder_number || 'Not Set'}</p>
                </div>}
                {canViewFinancialFields && canShowField('poNumber') && <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">PO Number</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">{project.po_number || 'Not Set'}</p>
                </div>}
                {canViewFinancialFields && canShowField('financeProjectType') && <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Finance Project Type</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">{project.finance_project_type || 'Not Set'}</p>
                </div>}
                {canViewFinancialFields && canShowField('billingCycle') && <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Billing Cycle</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">{project.billing_cycle || 'Not Set'}</p>
                </div>}
                {canViewFinancialFields && canShowField('billingStartDate') && <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Billing Start Date</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">{formatDate(project.billing_start_date)}</p>
                </div>}
                {canViewFinancialFields && canShowField('billingEndDate') && <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Billing End Date</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">{formatDate(project.billing_end_date)}</p>
                </div>}
                {canShowField('organizationCategory') && <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Category of Organization</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">{project.organization_category || 'Not Set'}</p>
                </div>}
                {canShowField('reasonToConductAudit') && <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reason to Conduct Audit</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">{project.reason_to_conduct_audit || 'Not Set'}</p>
                </div>}
                {canShowField('sectorOfOrganization') && <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sector of Organization</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">{project.sector_of_organization || 'Not Set'}</p>
                </div>}
                {canShowField('typeOfAudit') && <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Type of Audit</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">{project.type_of_audit || 'Not Set'}</p>
                </div>}
                {canShowField('typeOfAuditOther') && project.type_of_audit === 'Any other' && (
                  <div className="rounded-xl bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Any Other Type of Audit</p>
                    <p className="mt-1 text-sm font-medium text-slate-900">{project.type_of_audit_other || 'Not Set'}</p>
                  </div>
                )}
                {canShowField('startDate') && <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Start Date</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">{formatDate(project.start_date)}</p>
                </div>}
                {canShowField('expectedEndDate') && <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Expected End Date</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">{formatDate(project.expected_end_date)}</p>
                </div>}
                {canShowField('spocName') && <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Client SPOC Name</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">{project.client_spoc_name || 'Not Set'}</p>
                </div>}
                {canShowField('spocEmail') && <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Client SPOC Email</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">{project.client_spoc_email || 'Not Set'}</p>
                </div>}
              </div>
              {canShowField('scopeDescription') && <div className="mt-4 rounded-xl bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Scope Description</p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{project.scope_description}</p>
              </div>}
            </div>

            <div className="space-y-6">
              {(user?.role === 'pmo' || user?.role === 'admin') && (
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="text-lg font-semibold text-slate-900">PMO Actions</h3>
                  <p className="mt-2 text-sm text-slate-600">Assign manager for each subproject, then forward this project to Manager.</p>
                  <div className="mt-4 space-y-3">
                    {projectOrders.length === 0 ? (
                      <p className="text-xs text-slate-500">No subprojects found for manager assignment.</p>
                    ) : (
                      projectOrders.map((o) => {
                        const subprojectCount = (o.subprojects || []).length;
                        const expanded = !!expandedOrderSections[o.id];
                        return (
                          <div key={o.id} className="rounded-lg border border-slate-200 p-3">
                            <button
                              type="button"
                              onClick={() => toggleOrderSection(o.id)}
                              className="w-full text-left"
                            >
                              <p className="text-xs font-semibold text-slate-700">
                                {expanded ? '▾' : '▸'} Order: {o.order_number} <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{subprojectCount} subproject{subprojectCount === 1 ? '' : 's'}</span>
                              </p>
                            </button>
                            {expanded && (
                              <div className="mt-2 space-y-2">
                                {(o.subprojects || []).map((sp) => (
                                  <div key={sp.id} className="rounded border border-slate-200 p-2">
                                    <p className="text-xs font-medium text-slate-700">{sp.subproject_name}</p>
                                    <div className="mt-2">
                                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Scope for this subproject</label>
                                      <textarea
                                        value={subprojectScopeInput[sp.id] || ''}
                                        onChange={(e) => setSubprojectScopeInput((prev) => ({ ...prev, [sp.id]: e.target.value }))}
                                        placeholder="Write manager-specific scope for this subproject"
                                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
                                        rows={3}
                                      />
                                    </div>
                                    <div className="mt-2 flex gap-2">
                                      <select
                                        value={subprojectManagerSelection[sp.id] || ''}
                                        onChange={(e) => setSubprojectManagerSelection((prev) => ({ ...prev, [sp.id]: e.target.value }))}
                                        className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
                                      >
                                        <option value="">-- Select Manager --</option>
                                        {managers.map((m) => (
                                          <option key={m.id} value={m.id}>
                                            {m.username}{m.email ? ` - ${m.email}` : ''}
                                          </option>
                                        ))}
                                      </select>
                                      <button
                                        type="button"
                                        disabled={saving}
                                        onClick={() => assignManagerToSubproject(o.id, sp.id)}
                                        className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                                      >
                                        Assign
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                  <button
                    disabled={saving}
                    onClick={forwardToManager}
                    className="mt-4 w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                  >
                    {saving ? 'Forwarding...' : 'Forward to Manager'}
                  </button>
                </div>
              )}

              {projectOrders.length > 0 && !['pmo', 'admin'].includes(user?.role) && (
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="text-lg font-semibold text-slate-900">Subprojects</h3>
                  <p className="mt-2 text-sm text-slate-600">Click an order to expand its subprojects.</p>
                  <div className="mt-4 space-y-3">
                    {projectOrders.map((o) => {
                      const subprojectCount = (o.subprojects || []).length;
                      const expanded = !!expandedOrderSections[o.id];
                      return (
                        <div key={o.id} className="rounded-lg border border-slate-200 p-3">
                          <button
                            type="button"
                            onClick={() => toggleOrderSection(o.id)}
                            className="w-full text-left"
                          >
                            <p className="text-sm font-semibold text-slate-700">
                              {expanded ? '▾' : '▸'} {o.order_number}
                              <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{subprojectCount} subproject{subprojectCount === 1 ? '' : 's'}</span>
                            </p>
                          </button>
                          {expanded && (
                            <div className="mt-2 space-y-2">
                              {(o.subprojects || []).map((sp) => (
                                <div key={sp.id} className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                                  {sp.subproject_name}
                                  {sp.assigned_manager && <span className="ml-2 text-xs text-slate-500">({sp.assigned_manager})</span>}
                                  {sp.subproject_scope && <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600">{sp.subproject_scope}</p>}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {(user?.role === 'manager' || user?.role === 'admin') && (
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="text-lg font-semibold text-slate-900">Manager Actions</h3>
                  <div className="mt-4 space-y-4">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">Manager Status</label>
                      <select
                        value={managerStatus}
                        onChange={(e) => setManagerStatus(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
                      >
                        <option value="Open">Open</option>
                        <option value="Pending from Client">Pending from Client</option>
                        <option value="Closed">Closed</option>
                        <option value="OnHold">OnHold</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">Assign Auditor</label>
                      <select
                        value={assignedAuditor || ''}
                        onChange={(e) => setAssignedAuditor(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
                      >
                        <option value="">-- Select Auditor --</option>
                        {auditors.map((a) => (
                          <option key={a.id} value={a.id}>{a.username}{a.email ? ` - ${a.email}` : ''}</option>
                        ))}
                      </select>
                    </div>
                    <button
                      disabled={saving}
                      onClick={saveManagerStatus}
                      className="w-full rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                    >
                      {saving ? 'Saving...' : 'Save Status'}
                    </button>
                  </div>
                </div>
              )}

              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-slate-900">At a Glance</h3>
                <div className="mt-3 space-y-2 text-sm text-slate-700">
                  <p><span className="font-medium text-slate-900">Created:</span> {formatDate(project.created_at)}</p>
                  <p><span className="font-medium text-slate-900">Last Updated:</span> {formatDate(project.updated_at)}</p>
                  <p><span className="font-medium text-slate-900">Assigned Auditor:</span> {project.assigned_to_name || 'Not Assigned'}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h3 className="text-lg font-semibold text-slate-900">Notes & Remarks</h3>
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <label className="mb-2 block text-sm font-medium text-slate-700">Add Note</label>
            <textarea
              value={newRemark}
              onChange={(e) => setNewRemark(e.target.value)}
              placeholder="Add a note visible to all roles..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
              rows="3"
            />
            {(user?.role === 'manager' || user?.role === 'pmo' || user?.role === 'admin') && (
              <input
                type="file"
                multiple
                onChange={(e) => setNoteFiles(e.target.files || [])}
                className="mt-2 block w-full text-sm text-slate-700"
              />
            )}
            <button
              onClick={addRemark}
              disabled={saving || (!newRemark.trim() && noteFiles.length === 0)}
              className="mt-3 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {saving ? 'Adding...' : 'Add Note'}
            </button>
          </div>

          <div className="mt-6 space-y-3">
            {remarks.length === 0 ? (
              <p className="text-sm text-slate-500">No notes yet</p>
            ) : (
              remarks.map((remark) => (
                <div key={remark.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900">{remark.created_by_name || 'Unknown'}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{remark.remark_type || 'note'}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{new Date(remark.created_at).toLocaleString()}</p>
                    </div>
                    {(user?.id === remark.created_by || user?.role === 'admin') && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setEditingRemarkId(remark.id);
                            setEditingRemarkContent(remark.content);
                          }}
                          className="rounded-md bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-100"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteRemark(remark.id)}
                          disabled={saving}
                          className="rounded-md bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>

                  {editingRemarkId === remark.id ? (
                    <div className="mt-3">
                      <textarea
                        value={editingRemarkContent}
                        onChange={(e) => setEditingRemarkContent(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
                        rows="2"
                      />
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => editRemark(remark.id)}
                          disabled={saving}
                          className="rounded-md bg-sky-600 px-3 py-1 text-xs font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                        >
                          {saving ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={() => {
                            setEditingRemarkId(null);
                            setEditingRemarkContent('');
                          }}
                          className="rounded-md bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-300"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{remark.content}</p>
                      {Array.isArray(remark.attachments) && remark.attachments.length > 0 && (
                        <div className="mt-3 space-y-1">
                          <p className="text-xs font-semibold text-slate-500">Attachments</p>
                          {remark.attachments.map((a) => (
                            <a
                              key={a.id}
                              href={toPublicUrl(a.url) || '#'}
                              target="_blank"
                              rel="noreferrer"
                              className="block text-sm text-blue-600 hover:underline"
                            >
                              {a.file_name}
                            </a>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
