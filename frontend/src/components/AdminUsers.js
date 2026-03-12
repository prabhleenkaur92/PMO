import React, { useState, useEffect } from 'react';
import { userService } from '../services/api';

export default function AdminUsers() {
  const [tab, setTab] = useState('list'); // 'list' or 'create'
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [editingPassword, setEditingPassword] = useState(null);
  const [newPassword, setNewPassword] = useState('');

  // Create form state
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('finance');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => {
    if (tab === 'list') {
      fetchUsers();
    }
  }, [tab]);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const response = await userService.getAllUsers();
      setUsers(response.data);
      setMessage('');
    } catch (err) {
      setMessage(`Error: ${err.response?.data?.error || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      await userService.createUser({
        username,
        email,
        password,
        role,
        firstName,
        lastName,
        phone
      });
      setMessage('User created successfully!');
      setUsername('');
      setEmail('');
      setPassword('');
      setFirstName('');
      setLastName('');
      setPhone('');
      setRole('finance');
      setTimeout(() => {
        setTab('list');
        fetchUsers();
      }, 1500);
    } catch (err) {
      setMessage(`Error: ${err.response?.data?.error || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (userId) => {
    if (!newPassword) {
      setMessage('Password cannot be empty');
      return;
    }
    try {
      await userService.changePassword(userId, { newPassword });
      setMessage('Password changed successfully!');
      setEditingPassword(null);
      setNewPassword('');
      fetchUsers();
    } catch (err) {
      setMessage(`Error: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleChangeRole = async (userId, newRole) => {
    try {
      await userService.changeUserRole(userId, { role: newRole });
      setMessage('Role changed successfully!');
      fetchUsers();
    } catch (err) {
      setMessage(`Error: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleDeleteUser = async (userId, username) => {
    if (window.confirm(`Are you sure you want to delete ${username}? This cannot be undone.`)) {
      try {
        await userService.deleteUser(userId);
        setMessage('User deleted successfully!');
        fetchUsers();
      } catch (err) {
        setMessage(`Error: ${err.response?.data?.error || err.message}`);
      }
    }
  };

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex space-x-4 border-b">
        <button
          onClick={() => setTab('list')}
          className={`px-4 py-2 font-medium border-b-2 ${
            tab === 'list'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          User List
        </button>
        <button
          onClick={() => setTab('create')}
          className={`px-4 py-2 font-medium border-b-2 ${
            tab === 'create'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          Create User
        </button>
      </div>

      {message && (
        <div className={`p-4 rounded ${message.includes('Error') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {message}
        </div>
      )}

      {/* User List Tab */}
      {tab === 'list' && (
        <div>
          <h3 className="text-xl font-semibold mb-4">Manage Users</h3>
          {loading ? (
            <p className="text-gray-600">Loading users...</p>
          ) : users.length === 0 ? (
            <p className="text-gray-600">No users found</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse border border-gray-200">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="border border-gray-200 px-4 py-2 text-left font-semibold">Username</th>
                    <th className="border border-gray-200 px-4 py-2 text-left font-semibold">Email</th>
                    <th className="border border-gray-200 px-4 py-2 text-left font-semibold">Name</th>
                    <th className="border border-gray-200 px-4 py-2 text-left font-semibold">Role</th>
                    <th className="border border-gray-200 px-4 py-2 text-left font-semibold">Status</th>
                    <th className="border border-gray-200 px-4 py-2 text-left font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id} className="hover:bg-gray-50">
                      <td className="border border-gray-200 px-4 py-2 font-medium">{u.username}</td>
                      <td className="border border-gray-200 px-4 py-2 text-sm">{u.email}</td>
                      <td className="border border-gray-200 px-4 py-2 text-sm">
                        {u.first_name} {u.last_name}
                      </td>
                      <td className="border border-gray-200 px-4 py-2">
                        <select
                          value={u.role}
                          onChange={e => handleChangeRole(u.id, e.target.value)}
                          className="px-2 py-1 border border-gray-300 rounded text-sm"
                        >
                          <option value="admin">Admin</option>
                          <option value="finance">Finance</option>
                          <option value="pmo">PMO</option>
                          <option value="manager">Manager</option>
                          <option value="auditor">Auditor</option>
                        </select>
                      </td>
                      <td className="border border-gray-200 px-4 py-2">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          u.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}>
                          {u.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="border border-gray-200 px-4 py-2 text-sm space-x-2">
                        {editingPassword === u.id ? (
                          <div className="flex space-x-2 py-2">
                            <input
                              type="password"
                              placeholder="New password"
                              value={newPassword}
                              onChange={e => setNewPassword(e.target.value)}
                              className="border px-2 py-1 rounded text-xs flex-1"
                            />
                            <button
                              onClick={() => handleChangePassword(u.id)}
                              className="bg-blue-600 text-white px-2 py-1 rounded text-xs hover:bg-blue-700"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => {
                                setEditingPassword(null);
                                setNewPassword('');
                              }}
                              className="bg-gray-400 text-white px-2 py-1 rounded text-xs hover:bg-gray-500"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <>
                            <button
                              onClick={() => {
                                setEditingPassword(u.id);
                                setNewPassword('');
                              }}
                              className="text-blue-600 hover:text-blue-800 font-medium text-xs"
                            >
                              Reset Password
                            </button>
                            <button
                              onClick={() => handleDeleteUser(u.id, u.username)}
                              className="text-red-600 hover:text-red-800 font-medium text-xs"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Create User Tab */}
      {tab === 'create' && (
        <div>
          <h3 className="text-xl font-semibold mb-4">Create New User</h3>
          <form onSubmit={handleCreateUser} className="bg-white p-4 rounded border space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                placeholder="Username *"
                value={username}
                onChange={e => setUsername(e.target.value)}
                required
                className="border p-2 rounded"
              />
              <input
                type="email"
                placeholder="Email *"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="border p-2 rounded"
              />
              <input
                type="password"
                placeholder="Password (min 8 chars) *"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength="8"
                className="border p-2 rounded"
              />
              <select value={role} onChange={e => setRole(e.target.value)} className="border p-2 rounded">
                <option value="admin">Admin</option>
                <option value="finance">Finance</option>
                <option value="pmo">PMO</option>
                <option value="manager">Manager</option>
                <option value="auditor">Auditor</option>
              </select>
              <input
                type="text"
                placeholder="First Name"
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                className="border p-2 rounded"
              />
              <input
                type="text"
                placeholder="Last Name"
                value={lastName}
                onChange={e => setLastName(e.target.value)}
                className="border p-2 rounded"
              />
              <input
                type="tel"
                placeholder="Phone"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                className="border p-2 rounded col-span-2"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:bg-gray-400"
            >
              {loading ? 'Creating...' : 'Create User'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
