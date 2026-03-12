export const formatDate = (date) => {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
};

export const formatDateTime = (date) => {
  if (!date) return '-';
  return new Date(date).toLocaleString('en-US');
};

export const getStatusColor = (status) => {
  const colors = {
    'New': 'bg-yellow-100 text-yellow-800',
    'Assigned': 'bg-purple-100 text-purple-800',
    'In Progress': 'bg-blue-100 text-blue-800',
    'Pending from Client': 'bg-orange-100 text-orange-800',
    'Completed': 'bg-green-100 text-green-800',
    'Closed': 'bg-gray-100 text-gray-800'
  };
  return colors[status] || 'bg-gray-100 text-gray-800';
};

export const getRoleColor = (role) => {
  const colors = {
    admin: 'bg-red-100 text-red-800',
    finance: 'bg-emerald-100 text-emerald-800',
    pmo: 'bg-blue-100 text-blue-800',
    manager: 'bg-purple-100 text-purple-800',
    auditor: 'bg-green-100 text-green-800'
  };
  return colors[role] || 'bg-gray-100 text-gray-800';
};

export const getRoleBadge = (role) => {
  const badges = {
    admin: '👑',
    finance: '💰',
    pmo: '📋',
    manager: '👔',
    auditor: '🔍'
  };
  return badges[role] || '•';
};
