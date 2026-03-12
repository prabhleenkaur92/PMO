import React, { useState, useEffect } from 'react';
import { roleService, auditService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import AdminUsers from '../components/AdminUsers';

const downloadBlob = (blob, filename) => {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};

const AdminPanel = () => {
  const { user } = useAuth();
  const [tab, setTab] = useState('users');
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedRole, setSelectedRole] = useState(null);

  const [logType, setLogType] = useState('audit');
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsPage, setLogsPage] = useState(1);
  const [logsPagination, setLogsPagination] = useState({ page: 1, pages: 1, total: 0, limit: 20 });
  const [actionFilter, setActionFilter] = useState('');
  const [endpointFilter, setEndpointFilter] = useState('');
  const [visibilityRole, setVisibilityRole] = useState('finance');
  const [visibilityFields, setVisibilityFields] = useState([]);
  const [visibilityLoading, setVisibilityLoading] = useState(false);
  const [backupFile, setBackupFile] = useState(null);
  const [backupLoading, setBackupLoading] = useState(false);

  useEffect(() => {
    if (user?.role === 'admin' && tab === 'roles') {
      fetchRoles();
    }
  }, [tab, user]);

  useEffect(() => {
    if (user?.role === 'admin' && tab === 'logs') {
      fetchLogs();
    }
  }, [tab, logType, logsPage, user]);

  useEffect(() => {
    if (user?.role === 'admin' && tab === 'fieldVisibility') {
      fetchFieldVisibility();
    }
  }, [tab, visibilityRole, user]);

  const fetchRoles = async () => {
    try {
      setLoading(true);
      const response = await roleService.getAllRoles();
      setRoles(response.data);
    } catch (err) {
      setError(`Failed to load roles: ${err.response?.data?.error || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const fetchRolePermissions = async (roleId) => {
    try {
      const response = await roleService.getRolePermissions(roleId);
      setPermissions((prev) => ({
        ...prev,
        [roleId]: response.data
      }));
    } catch (err) {
      setError(`Failed to load permissions: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleGrantPermission = async (roleId, permissionId) => {
    try {
      await roleService.grantPermission(roleId, { permissionId });
      fetchRolePermissions(roleId);
    } catch (err) {
      setError(`Failed to grant permission: ${err.response?.data?.error || err.message}`);
    }
  };

  const fetchLogs = async (page = logsPage) => {
    try {
      setLogsLoading(true);
      setError('');

      if (logType === 'audit') {
        const response = await auditService.getAuditLogs({ page, limit: 20, action: actionFilter || undefined });
        setLogs(response.data.logs || []);
        setLogsPagination(response.data.pagination || { page: 1, pages: 1, total: 0, limit: 20 });
      } else {
        const response = await auditService.getAccessLogs({ page, limit: 20, endpoint: endpointFilter || undefined });
        setLogs(response.data.logs || []);
        setLogsPagination(response.data.pagination || { page: 1, pages: 1, total: 0, limit: 20 });
      }
    } catch (err) {
      setError(`Failed to load logs: ${err.response?.data?.error || err.message}`);
    } finally {
      setLogsLoading(false);
    }
  };

  const applyLogFilters = async () => {
    setLogsPage(1);
    await fetchLogs(1);
  };

  const clearLogs = async () => {
    const label = logType === 'audit' ? 'audit' : 'access';
    if (!window.confirm(`Clear all ${label} logs? This action cannot be undone.`)) return;

    try {
      if (logType === 'audit') {
        await auditService.clearAuditLogs();
      } else {
        await auditService.clearAccessLogs();
      }
      await fetchLogs(1);
      setLogsPage(1);
    } catch (err) {
      setError(`Failed to clear logs: ${err.response?.data?.error || err.message}`);
    }
  };

  const exportLogs = async (format = 'csv') => {
    try {
      let response;
      if (logType === 'audit') {
        response = await auditService.exportAuditLogs({ format, action: actionFilter || undefined });
      } else {
        response = await auditService.exportAccessLogs({ format, endpoint: endpointFilter || undefined });
      }

      const now = new Date().toISOString().replace(/[:.]/g, '-');
      const ext = format === 'json' ? 'json' : 'csv';
      const filename = `${logType}-logs-${now}.${ext}`;
      downloadBlob(response.data, filename);
    } catch (err) {
      setError(`Failed to export logs: ${err.response?.data?.error || err.message}`);
    }
  };

  const exportSystemBackup = async () => {
    try {
      setBackupLoading(true);
      const response = await auditService.exportSystemBackup({ includeFiles: true });
      const now = new Date().toISOString().replace(/[:.]/g, '-');
      downloadBlob(response.data, `pmo-full-backup-${now}.json`);
    } catch (err) {
      setError(`Failed to export full backup: ${err.response?.data?.error || err.message}`);
    } finally {
      setBackupLoading(false);
    }
  };

  const importSystemBackup = async () => {
    if (!backupFile) {
      setError('Please choose a backup JSON file first');
      return;
    }
    if (!window.confirm('Import will replace ALL existing data (projects, chats, logs, users, attachments). Continue?')) {
      return;
    }

    try {
      setBackupLoading(true);
      setError('');
      const formData = new FormData();
      formData.append('file', backupFile);
      await auditService.importSystemBackup(formData, { replaceExisting: true });
      setBackupFile(null);
      window.alert('Full backup imported successfully');
      await fetchLogs(1);
      setLogsPage(1);
    } catch (err) {
      setError(`Failed to import full backup: ${err.response?.data?.error || err.message}`);
    } finally {
      setBackupLoading(false);
    }
  };

  const fetchFieldVisibility = async () => {
    try {
      setVisibilityLoading(true);
      const response = await roleService.getFieldVisibilityMatrix('project_form');
      const roleRows = response.data?.matrix?.[visibilityRole] || [];
      setVisibilityFields(roleRows);
    } catch (err) {
      setError(`Failed to load field visibility: ${err.response?.data?.error || err.message}`);
    } finally {
      setVisibilityLoading(false);
    }
  };

  const toggleFieldVisibility = async (fieldKey, nextVisible) => {
    try {
      await roleService.updateFieldVisibility({
        module: 'project_form',
        role: visibilityRole,
        fieldKey,
        isVisible: nextVisible
      });
      setVisibilityFields((prev) =>
        prev.map((f) => (f.key === fieldKey ? { ...f, isVisible: nextVisible } : f))
      );
    } catch (err) {
      setError(`Failed to update field visibility: ${err.response?.data?.error || err.message}`);
    }
  };

  if (user?.role !== 'admin') {
    return (
      <div className="py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8">
          <h1 className="text-3xl font-bold">Access Denied</h1>
          <p className="mt-2 text-gray-600">Only admins can access this page</p>
        </div>
      </div>
    );
  }

  return (
    <div className="py-6 bg-gray-50 min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Admin Panel</h1>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded text-red-700">
            {error}
          </div>
        )}

        <div className="flex space-x-4 mb-6 border-b">
          <button
            onClick={() => setTab('users')}
            className={`px-4 py-2 font-medium border-b-2 ${
              tab === 'users'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Create Users
          </button>
          <button
            onClick={() => { setTab('roles'); fetchRoles(); }}
            className={`px-4 py-2 font-medium border-b-2 ${
              tab === 'roles'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Roles & Permissions
          </button>
          <button
            onClick={() => { setTab('logs'); setLogsPage(1); }}
            className={`px-4 py-2 font-medium border-b-2 ${
              tab === 'logs'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Audit Logs
          </button>
          <button
            onClick={() => { setTab('fieldVisibility'); }}
            className={`px-4 py-2 font-medium border-b-2 ${
              tab === 'fieldVisibility'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Field Visibility
          </button>
        </div>

        {tab === 'users' && <AdminUsers />}

        {tab === 'roles' && (
          <div>
            <h2 className="text-2xl font-bold mb-4">Roles & Permissions</h2>
            {loading ? (
              <p>Loading...</p>
            ) : (
              <div className="space-y-4">
                {roles.map((role) => (
                  <div key={role.id} className="bg-white p-4 rounded border">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold text-lg">{role.name}</h3>
                        <p className="text-gray-600">{role.description}</p>
                      </div>
                      <button
                        onClick={() => {
                          setSelectedRole(selectedRole === role.id ? null : role.id);
                          if (!permissions[role.id]) {
                            fetchRolePermissions(role.id);
                          }
                        }}
                        className="text-blue-600 hover:text-blue-800 font-medium"
                      >
                        {selectedRole === role.id ? 'Hide' : 'Manage'}
                      </button>
                    </div>

                    {selectedRole === role.id && permissions[role.id] && (
                      <div className="mt-4 pt-4 border-t">
                        <h4 className="font-semibold mb-2">Permissions</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {permissions[role.id].map((perm) => (
                            <div key={perm.id} className="flex items-center space-x-2">
                              <input
                                type="checkbox"
                                id={`perm_${perm.id}`}
                                defaultChecked={perm.granted}
                                onChange={() => handleGrantPermission(role.id, perm.id)}
                                className="rounded"
                              />
                              <label htmlFor={`perm_${perm.id}`} className="text-sm">
                                {perm.name}
                              </label>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'logs' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Log Type</label>
                <select
                  value={logType}
                  onChange={(e) => {
                    setLogType(e.target.value);
                    setLogsPage(1);
                  }}
                  className="border border-gray-300 rounded px-3 py-2 text-sm"
                >
                  <option value="audit">Audit Logs</option>
                  <option value="access">Access Logs</option>
                </select>
              </div>

              {logType === 'audit' ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Action Filter</label>
                  <input
                    type="text"
                    value={actionFilter}
                    onChange={(e) => setActionFilter(e.target.value)}
                    placeholder="e.g. USER_LOGIN"
                    className="border border-gray-300 rounded px-3 py-2 text-sm"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Endpoint Filter</label>
                  <input
                    type="text"
                    value={endpointFilter}
                    onChange={(e) => setEndpointFilter(e.target.value)}
                    placeholder="e.g. /api/projects"
                    className="border border-gray-300 rounded px-3 py-2 text-sm"
                  />
                </div>
              )}

              <button
                onClick={applyLogFilters}
                className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700"
              >
                Apply Filter
              </button>
              <button
                onClick={() => exportLogs('csv')}
                className="bg-emerald-600 text-white px-4 py-2 rounded text-sm hover:bg-emerald-700"
              >
                Export CSV
              </button>
              <button
                onClick={() => exportLogs('json')}
                className="bg-slate-700 text-white px-4 py-2 rounded text-sm hover:bg-slate-800"
              >
                Export JSON
              </button>
              <button
                onClick={clearLogs}
                className="bg-red-600 text-white px-4 py-2 rounded text-sm hover:bg-red-700"
              >
                Clear Logs
              </button>
            </div>

            <div className="rounded border bg-amber-50 border-amber-200 p-3">
              <p className="text-sm font-semibold text-amber-900">Full System Backup (Admin Only)</p>
              <p className="text-xs text-amber-800 mt-1">
                Includes complete project data, all attachments, audit/access logs, and chats. Import replaces all current data.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={exportSystemBackup}
                  disabled={backupLoading}
                  className="bg-indigo-600 text-white px-4 py-2 rounded text-sm hover:bg-indigo-700 disabled:opacity-50"
                >
                  {backupLoading ? 'Processing...' : 'Export Full Backup'}
                </button>
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={(e) => setBackupFile(e.target.files?.[0] || null)}
                  className="text-sm"
                />
                <button
                  onClick={importSystemBackup}
                  disabled={backupLoading || !backupFile}
                  className="bg-orange-600 text-white px-4 py-2 rounded text-sm hover:bg-orange-700 disabled:opacity-50"
                >
                  {backupLoading ? 'Processing...' : 'Import Full Backup'}
                </button>
              </div>
            </div>

            <div className="bg-white rounded border overflow-auto">
              {logsLoading ? (
                <p className="p-4">Loading logs...</p>
              ) : logs.length === 0 ? (
                <p className="p-4 text-gray-500">No logs found.</p>
              ) : (
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left">Timestamp</th>
                      <th className="px-4 py-2 text-left">User</th>
                      {logType === 'audit' ? (
                        <>
                          <th className="px-4 py-2 text-left">Action</th>
                          <th className="px-4 py-2 text-left">Entity</th>
                          <th className="px-4 py-2 text-left">IP</th>
                        </>
                      ) : (
                        <>
                          <th className="px-4 py-2 text-left">Method</th>
                          <th className="px-4 py-2 text-left">Endpoint</th>
                          <th className="px-4 py-2 text-left">Status</th>
                          <th className="px-4 py-2 text-left">IP</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr key={log.id} className="border-t">
                        <td className="px-4 py-2 whitespace-nowrap">{new Date(log.created_at || log.accessed_at).toISOString()}</td>
                        <td className="px-4 py-2 whitespace-nowrap">{log.username || log.email || log.user_id || 'system'}</td>
                        {logType === 'audit' ? (
                          <>
                            <td className="px-4 py-2 whitespace-nowrap">{log.action}</td>
                            <td className="px-4 py-2 whitespace-nowrap">{log.entity_type || '-'}</td>
                            <td className="px-4 py-2 whitespace-nowrap">{log.ip_address || '-'}</td>
                          </>
                        ) : (
                          <>
                            <td className="px-4 py-2 whitespace-nowrap">{log.method}</td>
                            <td className="px-4 py-2">{log.endpoint}</td>
                            <td className="px-4 py-2 whitespace-nowrap">{log.status_code}</td>
                            <td className="px-4 py-2 whitespace-nowrap">{log.ip_address || '-'}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-600">
                Total: {logsPagination.total || 0}
              </p>
              <div className="flex items-center gap-2">
                <button
                  disabled={logsPage <= 1 || logsLoading}
                  onClick={() => setLogsPage((p) => Math.max(1, p - 1))}
                  className="px-3 py-1 border rounded text-sm disabled:opacity-50"
                >
                  Previous
                </button>
                <span className="text-sm">
                  Page {logsPagination.page || logsPage} of {logsPagination.pages || 1}
                </span>
                <button
                  disabled={logsPage >= (logsPagination.pages || 1) || logsLoading}
                  onClick={() => setLogsPage((p) => p + 1)}
                  className="px-3 py-1 border rounded text-sm disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === 'fieldVisibility' && (
          <div className="space-y-4">
            <div className="flex items-end gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <select
                  value={visibilityRole}
                  onChange={(e) => setVisibilityRole(e.target.value)}
                  className="border border-gray-300 rounded px-3 py-2 text-sm"
                >
                  <option value="admin">Admin</option>
                  <option value="finance">Finance</option>
                  <option value="pmo">PMO</option>
                  <option value="manager">Manager</option>
                  <option value="auditor">Auditor</option>
                </select>
              </div>
              <button
                onClick={fetchFieldVisibility}
                className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700"
              >
                Refresh
              </button>
            </div>

            <div className="bg-white border rounded p-4">
              <h3 className="font-semibold mb-3">Project Form Fields ({visibilityRole})</h3>
              {visibilityLoading ? (
                <p className="text-sm text-gray-600">Loading...</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {visibilityFields.map((field) => (
                    <label key={field.key} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={field.isVisible}
                        onChange={(e) => toggleFieldVisibility(field.key, e.target.checked)}
                        className="rounded"
                      />
                      <span>{field.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminPanel;
