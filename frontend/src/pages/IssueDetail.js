import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';
import DocumentManager from '../components/DocumentManager';
import '../styles/IssueDetail.css';

const IssueDetail = () => {
  const { issueId } = useParams();
  const navigate = useNavigate();
  const [issue, setIssue] = useState(null);
  const [comments, setComments] = useState([]);
  const [timeLogs, setTimeLogs] = useState([]);
  const [watchers, setWatchers] = useState([]);
  const [labels, setLabels] = useState([]);
  const [allLabels, setAllLabels] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [editingComment, setEditingComment] = useState(null);
  const [newTimeLog, setNewTimeLog] = useState({ hours: '', description: '' });
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({});

  useEffect(() => {
    loadIssueDetail();
  }, [issueId]);

  const loadIssueDetail = async () => {
    try {
      setLoading(true);
      const [issueRes, commentsRes, timeLogsRes, watchersRes, labelsRes, allLabelsRes] = await Promise.all([
        api.get(`/issues/${issueId}`),
        api.get(`/issues/${issueId}/comments`),
        api.get(`/issues/${issueId}/time-logs`),
        api.get(`/issues/${issueId}/watchers`),
        api.get(`/issues/${issueId}/labels`),
        api.get('/labels')
      ]);

      setIssue(issueRes.data);
      setEditData(issueRes.data);
      setComments(commentsRes.data);
      setTimeLogs(timeLogsRes.data);
      setWatchers(watchersRes.data);
      setLabels(labelsRes.data);
      setAllLabels(allLabelsRes.data);
    } catch (error) {
      console.error('Error loading issue:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (newStatus) => {
    try {
      await api.put(`/issues/${issueId}`, { status: newStatus });
      setIssue(prev => ({ ...prev, status: newStatus }));
    } catch (error) {
      console.error('Error updating status:', error);
    }
  };

  const handlePriorityChange = async (newPriority) => {
    try {
      await api.put(`/issues/${issueId}`, { priority: newPriority });
      setIssue(prev => ({ ...prev, priority: newPriority }));
    } catch (error) {
      console.error('Error updating priority:', error);
    }
  };

  const addComment = async () => {
    if (!newComment.trim()) return;

    try {
      await api.post(`/issues/${issueId}/comments`, { content: newComment });
      setNewComment('');
      loadIssueDetail();
    } catch (error) {
      console.error('Error adding comment:', error);
    }
  };

  const editComment = async (commentId, newContent) => {
    try {
      await api.put(`/issues/comments/${commentId}`, { content: newContent });
      setEditingComment(null);
      loadIssueDetail();
    } catch (error) {
      console.error('Error editing comment:', error);
    }
  };

  const deleteComment = async (commentId) => {
    if (!window.confirm('Delete this comment?')) return;

    try {
      await api.delete(`/issues/comments/${commentId}`);
      loadIssueDetail();
    } catch (error) {
      console.error('Error deleting comment:', error);
    }
  };

  const addTimeLog = async () => {
    if (!newTimeLog.hours || newTimeLog.hours <= 0) {
      alert('Please enter valid hours');
      return;
    }

    try {
      await api.post(`/issues/${issueId}/time-logs`, {
        hours_spent: parseFloat(newTimeLog.hours),
        work_date: new Date().toISOString().split('T')[0],
        description: newTimeLog.description
      });
      setNewTimeLog({ hours: '', description: '' });
      loadIssueDetail();
    } catch (error) {
      console.error('Error adding time log:', error);
    }
  };

  const toggleWatcher = async () => {
    try {
      const isWatching = watchers.some(w => w.user_id === JSON.parse(localStorage.getItem('user')).id);
      
      if (isWatching) {
        await api.delete(`/issues/${issueId}/watchers`);
      } else {
        await api.post(`/issues/${issueId}/watchers`);
      }
      
      loadIssueDetail();
    } catch (error) {
      console.error('Error toggling watcher:', error);
    }
  };

  const toggleLabel = async (labelId) => {
    try {
      const isLabeled = labels.some(l => l.id === labelId);
      
      if (isLabeled) {
        await api.delete(`/issues/${issueId}/labels/${labelId}`);
      } else {
        await api.post(`/issues/${issueId}/labels`, { label_id: labelId });
      }
      
      loadIssueDetail();
    } catch (error) {
      console.error('Error toggling label:', error);
    }
  };

  if (loading) return <div className="issue-detail-loading">Loading...</div>;
  if (!issue) return <div className="issue-detail-error">Issue not found</div>;

  return (
    <div className="issue-detail">
      <div className="issue-header">
        <button className="btn-back" onClick={() => navigate(-1)}>← Back</button>
        <div className="issue-key-title">
          <h1>{issue.issue_key}</h1>
          <p>{issue.title}</p>
        </div>
      </div>

      <div className="issue-content">
        <div className="issue-main">
          <div className="issue-details">
            <h3>Description</h3>
            <p className="description">{issue.description || 'No description'}</p>
          </div>

          <div className="issue-comments">
            <h3>💬 Comments ({comments.length})</h3>
            <div className="comment-form">
              <textarea
                placeholder="Add a comment..."
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
              ></textarea>
              <button 
                className="btn-comment"
                onClick={addComment}
                disabled={!newComment.trim()}
              >
                Post Comment
              </button>
            </div>

            <div className="comments-list">
              {comments.map(comment => (
                <div key={comment.id} className="comment-item">
                  <div className="comment-header">
                    <strong>{comment.user_name}</strong>
                    <span className="comment-date">{new Date(comment.created_at).toLocaleString()}</span>
                  </div>
                  {editingComment === comment.id ? (
                    <div className="comment-edit">
                      <textarea defaultValue={comment.content}></textarea>
                      <button 
                        onClick={() => editComment(comment.id, document.querySelector('textarea').value)}
                        className="btn-save"
                      >
                        Save
                      </button>
                      <button 
                        onClick={() => setEditingComment(null)}
                        className="btn-cancel"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <p className="comment-content">{comment.content}</p>
                      <div className="comment-actions">
                        <button 
                          className="btn-action"
                          onClick={() => setEditingComment(comment.id)}
                        >
                          Edit
                        </button>
                        <button 
                          className="btn-action delete"
                          onClick={() => deleteComment(comment.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="issue-time-logs">
            <h3>⏱️ Time Tracking</h3>
            <div className="time-log-form">
              <input
                type="number"
                placeholder="Hours"
                value={newTimeLog.hours}
                onChange={(e) => setNewTimeLog({ ...newTimeLog, hours: e.target.value })}
              />
              <input
                type="text"
                placeholder="Description"
                value={newTimeLog.description}
                onChange={(e) => setNewTimeLog({ ...newTimeLog, description: e.target.value })}
              />
              <button className="btn-log" onClick={addTimeLog}>Log Time</button>
            </div>

            {timeLogs.length > 0 && (
              <div className="time-logs-list">
                <p className="total-time">Total: {timeLogs.reduce((sum, log) => sum + log.hours_spent, 0)} hours</p>
                {timeLogs.map(log => (
                  <div key={log.id} className="time-log-item">
                    <span className="hours">{log.hours_spent}h</span>
                    <span className="date">{new Date(log.work_date).toLocaleDateString()}</span>
                    <span className="user">{log.user_name}</span>
                    {log.description && <p className="description">{log.description}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <DocumentManager entityType="issue" entityId={issueId} />
        </div>

        <div className="issue-sidebar">
          <div className="sidebar-section">
            <h4>Status</h4>
            <select 
              value={issue.status}
              onChange={(e) => handleStatusChange(e.target.value)}
              className="status-select"
            >
              <option value="Backlog">Backlog</option>
              <option value="Todo">Todo</option>
              <option value="In Progress">In Progress</option>
              <option value="In Review">In Review</option>
              <option value="Testing">Testing</option>
              <option value="Done">Done</option>
              <option value="Blocked">Blocked</option>
            </select>
          </div>

          <div className="sidebar-section">
            <h4>Priority</h4>
            <select 
              value={issue.priority}
              onChange={(e) => handlePriorityChange(e.target.value)}
              className={`priority-select priority-${issue.priority.toLowerCase()}`}
            >
              <option value="Critical">Critical</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
              <option value="Trivial">Trivial</option>
            </select>
          </div>

          <div className="sidebar-section">
            <h4>Type</h4>
            <span className="badge">{issue.issue_type}</span>
          </div>

          <div className="sidebar-section">
            <h4>Assignee</h4>
            <span className="badge">{issue.assignee || 'Unassigned'}</span>
          </div>

          <div className="sidebar-section">
            <h4>Story Points</h4>
            <span className="badge">{issue.story_points || 'Not set'}</span>
          </div>

          <div className="sidebar-section">
            <h4>Due Date</h4>
            <span className="badge">{issue.due_date ? new Date(issue.due_date).toLocaleDateString() : 'Not set'}</span>
          </div>

          <div className="sidebar-section">
            <h4>Labels</h4>
            <div className="labels-list">
              {labels.map(label => (
                <span key={label.id} className="label-tag" style={{ backgroundColor: label.color }}>
                  {label.name}
                </span>
              ))}
            </div>
            <div className="add-labels">
              {allLabels.map(label => {
                const hasLabel = labels.some(l => l.id === label.id);
                return (
                  <button
                    key={label.id}
                    className={`label-option ${hasLabel ? 'active' : ''}`}
                    onClick={() => toggleLabel(label.id)}
                    style={hasLabel ? { backgroundColor: label.color } : {}}
                  >
                    {label.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="sidebar-section">
            <h4>Watchers ({watchers.length})</h4>
            <button 
              className="btn-watch"
              onClick={toggleWatcher}
            >
              👁️ Watch Issue
            </button>
            <div className="watchers-list">
              {watchers.map(watcher => (
                <div key={watcher.id} className="watcher">{watcher.user_name}</div>
              ))}
            </div>
          </div>

          <div className="sidebar-section">
            <h4>Created</h4>
            <small>{new Date(issue.created_at).toLocaleString()}</small>
          </div>

          <div className="sidebar-section">
            <h4>Updated</h4>
            <small>{new Date(issue.updated_at).toLocaleString()}</small>
          </div>
        </div>
      </div>
    </div>
  );
};

export default IssueDetail;
