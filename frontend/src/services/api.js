import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || '/api';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Attach token from localStorage to each request if present
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers = config.headers || {};
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  return config;
}, (error) => Promise.reject(error));

// Auth Service
export const authService = {
  login: (username, password) => apiClient.post('/auth/login', { username, password }),
  register: (data) => apiClient.post('/auth/register', data),
  logout: () => apiClient.post('/auth/logout'),
  getCurrentUser: () => apiClient.get('/auth/me')
};

// Project Service
export const projectService = {
  createProject: (data) => apiClient.post('/projects', data),
  getNextWorkorderNumber: () => apiClient.get('/projects/next-workorder-number'),
  getProjects: (params) => apiClient.get('/projects', { params }),
  getProjectById: (id) => apiClient.get(`/projects/${id}`),
  updateProject: (id, data) => apiClient.patch(`/projects/${id}`, data),
  updateProjectStatus: (id, data) => apiClient.patch(`/projects/${id}/status`, data),
  assignProject: (id, data) => apiClient.patch(`/projects/${id}/assign`, data),
  updateManagerStatus: (id, data) => apiClient.patch(`/projects/${id}/manager-status`, data),
  addRemark: (projectId, remark) => apiClient.post(`/projects/${projectId}/remarks`, remark, {
    headers: remark instanceof FormData ? { 'Content-Type': 'multipart/form-data' } : undefined
  }),
  updateRemark: (projectId, remarkId, remark) => apiClient.patch(`/projects/${projectId}/remarks/${remarkId}`, remark),
  deleteRemark: (projectId, remarkId) => apiClient.delete(`/projects/${projectId}/remarks/${remarkId}`),
  deleteProject: (id) => apiClient.delete(`/projects/${id}`),
  uploadFile: (projectId, formData) => apiClient.post(`/projects/${projectId}/upload`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
};

// User Service
export const userService = {
  createUser: (data) => apiClient.post('/users', data),
  getAllUsers: () => apiClient.get('/users'),
  getUsersByRole: (role) => apiClient.get(`/users/role/${role}`),
  getUserById: (id) => apiClient.get(`/users/${id}`),
  updateUser: (id, data) => apiClient.patch(`/users/${id}`, data),
  changeUserRole: (id, data) => apiClient.patch(`/users/${id}/role`, data),
  changePassword: (id, data) => apiClient.patch(`/users/${id}/password`, data),
  deactivateUser: (id) => apiClient.patch(`/users/${id}/deactivate`),
  activateUser: (id) => apiClient.patch(`/users/${id}/activate`),
  deleteUser: (id) => apiClient.delete(`/users/${id}`)
};

// Role Service
export const roleService = {
  getAllRoles: () => apiClient.get('/roles'),
  getRolePermissions: (roleId) => apiClient.get(`/roles/${roleId}/permissions`),
  grantPermission: (roleId, data) => apiClient.post(`/roles/${roleId}/permissions`, data),
  revokePermission: (roleId, permissionId) => apiClient.delete(`/roles/${roleId}/permissions/${permissionId}`),
  getMyFieldVisibility: (module = 'project_form') => apiClient.get('/roles/field-visibility/me', { params: { module } }),
  getFieldVisibilityMatrix: (module = 'project_form') => apiClient.get('/roles/field-visibility', { params: { module } }),
  updateFieldVisibility: (data) => apiClient.patch('/roles/field-visibility', data)
};

// Audit Service
export const auditService = {
  getAuditLogs: (params) => apiClient.get('/audit/logs/audit', { params }),
  getAccessLogs: (params) => apiClient.get('/audit/logs/access', { params }),
  clearAuditLogs: () => apiClient.delete('/audit/logs/audit'),
  clearAccessLogs: () => apiClient.delete('/audit/logs/access'),
  exportAuditLogs: (params) => apiClient.get('/audit/logs/audit/export', { params, responseType: 'blob' }),
  exportAccessLogs: (params) => apiClient.get('/audit/logs/access/export', { params, responseType: 'blob' }),
  exportSystemBackup: (params) => apiClient.get('/audit/backup/export', { params, responseType: 'blob' }),
  importSystemBackup: (formData, params) => apiClient.post('/audit/backup/import', formData, {
    params,
    headers: { 'Content-Type': 'multipart/form-data' }
  })
};

// Notification Service
export const chatService = {
  getContacts: () => apiClient.get('/chat/contacts'),
  getOnlineUsers: () => apiClient.get('/chat/online-users'),
  getUnreadCounts: () => apiClient.get('/chat/unread-counts'),
  getMessages: (userId) => apiClient.get(`/chat/messages/${userId}`),
  sendMessage: (data) => apiClient.post('/chat/messages', data, {
    headers: data instanceof FormData ? { 'Content-Type': 'multipart/form-data' } : undefined
  }),
  sendTyping: (data) => apiClient.post('/chat/typing', data)
};

export const notificationService = {
  getUnreadCount: () => apiClient.get('/notifications/unread-count'),
  getNotifications: (params) => apiClient.get('/notifications', { params }),
  markAsRead: (id) => apiClient.patch(`/notifications/${id}/read`),
  markAllAsRead: () => apiClient.patch('/notifications/read-all')
};

export const orderService = {
  getOrders: (params) => apiClient.get('/orders', { params }),
  createOrder: (data) => apiClient.post('/orders', data),
  updateOrder: (orderId, data) => apiClient.patch(`/orders/${orderId}`, data),
  deleteOrder: (orderId) => apiClient.delete(`/orders/${orderId}`),
  markMilestoneCompleted: (orderId, scheduleId) => apiClient.patch(`/orders/${orderId}/milestones/${scheduleId}/complete`),
  assignSubprojectManager: (orderId, subprojectId, managerId, scopeDescription) =>
    apiClient.patch(`/orders/${orderId}/subprojects/${subprojectId}/assign-manager`, { managerId, scopeDescription })
};

export default apiClient;
