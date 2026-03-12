import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import api from '../services/api';
import '../styles/KanbanBoard.css';

const KanbanBoard = () => {
  const { projectId } = useParams();
  const [issues, setIssues] = useState([]);
  const [sprints, setSprints] = useState([]);
  const [activeSprint, setActiveSprint] = useState(null);
  const [loading, setLoading] = useState(true);
  const [draggedIssue, setDraggedIssue] = useState(null);
  const [filters, setFilters] = useState({
    assignee: '',
    priority: '',
    sprint: '',
    label: ''
  });

  const statusColumns = ['Backlog', 'Todo', 'In Progress', 'In Review', 'Testing', 'Done'];

  useEffect(() => {
    fetchData();
  }, [projectId, activeSprint]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [issuesRes, sprintsRes] = await Promise.all([
        api.get(`/issues?project_id=${projectId}`),
        api.get(`/sprints?project_id=${projectId}`)
      ]);
      
      setIssues(issuesRes.data);
      setSprints(sprintsRes.data);
      
      // Set active sprint to the first active one
      const active = sprintsRes.data.find(s => s.status === 'active');
      if (active) setActiveSprint(active.id);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDragStart = (e, issue) => {
    setDraggedIssue(issue);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e, status) => {
    e.preventDefault();
    
    if (!draggedIssue) return;

    try {
      await api.put(`/issues/${draggedIssue.id}`, { status });
      
      setIssues(issues.map(issue =>
        issue.id === draggedIssue.id ? { ...issue, status } : issue
      ));
    } catch (error) {
      console.error('Error updating issue:', error);
    } finally {
      setDraggedIssue(null);
    }
  };

  const getFilteredIssues = (status) => {
    return issues.filter(issue => {
      if (issue.status !== status) return false;
      if (activeSprint && issue.sprint_id !== activeSprint) return false;
      if (filters.assignee && issue.assignee_id !== filters.assignee) return false;
      if (filters.priority && issue.priority !== filters.priority) return false;
      return true;
    });
  };

  const getPriorityColor = (priority) => {
    const colors = {
      'Critical': '#dc2626',
      'High': '#ea580c',
      'Medium': '#f59e0b',
      'Low': '#10b981',
      'Trivial': '#6b7280'
    };
    return colors[priority] || '#6b7280';
  };

  if (loading) return <div className="kanban-loading">Loading...</div>;

  return (
    <div className="kanban-board">
      <div className="kanban-header">
        <h2>Kanban Board</h2>
        <div className="kanban-filters">
          <select 
            value={activeSprint || ''} 
            onChange={(e) => setActiveSprint(e.target.value)}>
            <option value="">All Issues</option>
            {sprints.map(sprint => (
              <option key={sprint.id} value={sprint.id}>
                {sprint.name}
              </option>
            ))}
          </select>
          <select 
            value={filters.priority} 
            onChange={(e) => setFilters({ ...filters, priority: e.target.value })}>
            <option value="">All Priorities</option>
            <option value="Critical">Critical</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
            <option value="Trivial">Trivial</option>
          </select>
        </div>
      </div>

      <div className="kanban-columns">
        {statusColumns.map(status => (
          <div 
            key={status} 
            className="kanban-column"
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, status)}
          >
            <div className="column-header">
              <h3>{status}</h3>
              <span className="issue-count">
                {getFilteredIssues(status).length}
              </span>
            </div>
            <div className="column-content">
              {getFilteredIssues(status).map(issue => (
                <div
                  key={issue.id}
                  className="issue-card"
                  draggable
                  onDragStart={(e) => handleDragStart(e, issue)}
                >
                  <div className="issue-key">{issue.issue_key}</div>
                  <div className="issue-title">{issue.title}</div>
                  <div className="issue-meta">
                    <span 
                      className="priority-badge"
                      style={{ backgroundColor: getPriorityColor(issue.priority) }}
                    >
                      {issue.priority}
                    </span>
                    <span className="issue-type">{issue.issue_type}</span>
                  </div>
                  {issue.assignee && (
                    <div className="issue-assignee">{issue.assignee}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default KanbanBoard;
