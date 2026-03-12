import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import '../styles/AdvancedSearch.css';

const AdvancedSearch = () => {
  const [filters, setFilters] = useState({
    searchText: '',
    entityType: 'issue',
    project: '',
    status: '',
    priority: '',
    assignee: '',
    reporter: '',
    label: '',
    dateFrom: '',
    dateTo: '',
    issueType: '',
    sprint: ''
  });

  const [results, setResults] = useState([]);
  const [savedFilters, setSavedFilters] = useState([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(false);
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [labels, setLabels] = useState([]);
  const [sprints, setSprints] = useState([]);

  useEffect(() => {
    loadMetadata();
    loadSavedFilters();
  }, []);

  const loadMetadata = async () => {
    try {
      const [projectsRes, usersRes, labelsRes, sprintsRes] = await Promise.all([
        api.get('/projects?limit=100'),
        api.get('/users'),
        api.get('/labels'),
        api.get('/sprints')
      ]);
      
      setProjects(projectsRes.data);
      setUsers(usersRes.data);
      setLabels(labelsRes.data);
      setSprints(sprintsRes.data);
    } catch (error) {
      console.error('Error loading metadata:', error);
    }
  };

  const loadSavedFilters = async () => {
    try {
      const res = await api.get('/saved-filters');
      setSavedFilters(res.data);
    } catch (error) {
      console.error('Error loading saved filters:', error);
    }
  };

  const handleSearch = useCallback(async (e) => {
    e?.preventDefault();
    
    try {
      setLoading(true);
      const params = new URLSearchParams();
      
      Object.entries(filters).forEach(([key, value]) => {
        if (value) {
          params.append(key, value);
        }
      });

      const res = await api.get(`/search?${params.toString()}`);
      setResults(res.data);
    } catch (error) {
      console.error('Error searching:', error);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const saveCurrentFilter = async () => {
    const filterName = prompt('Enter a name for this filter:');
    if (!filterName) return;

    try {
      await api.post('/saved-filters', {
        name: filterName,
        filter_criteria: filters,
        filter_type: filters.entityType,
        is_favorite: false,
        is_shared: false
      });
      loadSavedFilters();
    } catch (error) {
      console.error('Error saving filter:', error);
    }
  };

  const loadSavedFilter = (savedFilter) => {
    setFilters(savedFilter.filter_criteria);
  };

  const clearFilters = () => {
    setFilters({
      searchText: '',
      entityType: 'issue',
      project: '',
      status: '',
      priority: '',
      assignee: '',
      reporter: '',
      label: '',
      dateFrom: '',
      dateTo: '',
      issueType: '',
      sprint: ''
    });
    setResults([]);
  };

  return (
    <div className="advanced-search">
      <div className="search-container">
        <h1>Advanced Search</h1>
        
        <div className="quick-search">
          <form onSubmit={handleSearch} className="search-form">
            <input
              type="text"
              name="searchText"
              placeholder="Search projects, issues, users..."
              value={filters.searchText}
              onChange={handleFilterChange}
              className="search-input"
            />
            <button type="submit" className="btn-search">
              🔍 Search
            </button>
            <button 
              type="button" 
              className="btn-advanced"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              Advanced
            </button>
          </form>
        </div>

        {showAdvanced && (
          <div className="advanced-filters">
            <div className="filters-grid">
              <div className="filter-group">
                <label>Entity Type</label>
                <select 
                  name="entityType" 
                  value={filters.entityType}
                  onChange={handleFilterChange}
                >
                  <option value="issue">Issue</option>
                  <option value="project">Project</option>
                  <option value="user">User</option>
                </select>
              </div>

              <div className="filter-group">
                <label>Project</label>
                <select 
                  name="project" 
                  value={filters.project}
                  onChange={handleFilterChange}
                >
                  <option value="">All Projects</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.project_number}</option>
                  ))}
                </select>
              </div>

              <div className="filter-group">
                <label>Status</label>
                <select 
                  name="status" 
                  value={filters.status}
                  onChange={handleFilterChange}
                >
                  <option value="">All Status</option>
                  <option value="Backlog">Backlog</option>
                  <option value="Todo">Todo</option>
                  <option value="In Progress">In Progress</option>
                  <option value="In Review">In Review</option>
                  <option value="Testing">Testing</option>
                  <option value="Done">Done</option>
                </select>
              </div>

              <div className="filter-group">
                <label>Priority</label>
                <select 
                  name="priority" 
                  value={filters.priority}
                  onChange={handleFilterChange}
                >
                  <option value="">All Priorities</option>
                  <option value="Critical">Critical</option>
                  <option value="High">High</option>
                  <option value="Medium">Medium</option>
                  <option value="Low">Low</option>
                  <option value="Trivial">Trivial</option>
                </select>
              </div>

              <div className="filter-group">
                <label>Assignee</label>
                <select 
                  name="assignee" 
                  value={filters.assignee}
                  onChange={handleFilterChange}
                >
                  <option value="">Unassigned</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.first_name} {u.last_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="filter-group">
                <label>Label</label>
                <select 
                  name="label" 
                  value={filters.label}
                  onChange={handleFilterChange}
                >
                  <option value="">All Labels</option>
                  {labels.map(l => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>

              <div className="filter-group">
                <label>Date From</label>
                <input
                  type="date"
                  name="dateFrom"
                  value={filters.dateFrom}
                  onChange={handleFilterChange}
                />
              </div>

              <div className="filter-group">
                <label>Date To</label>
                <input
                  type="date"
                  name="dateTo"
                  value={filters.dateTo}
                  onChange={handleFilterChange}
                />
              </div>

              <div className="filter-group">
                <label>Issue Type</label>
                <select 
                  name="issueType" 
                  value={filters.issueType}
                  onChange={handleFilterChange}
                >
                  <option value="">All Types</option>
                  <option value="Task">Task</option>
                  <option value="Bug">Bug</option>
                  <option value="Story">Story</option>
                  <option value="Epic">Epic</option>
                  <option value="Improvement">Improvement</option>
                </select>
              </div>

              <div className="filter-group">
                <label>Sprint</label>
                <select 
                  name="sprint" 
                  value={filters.sprint}
                  onChange={handleFilterChange}
                >
                  <option value="">All Sprints</option>
                  {sprints.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="filter-actions">
              <button className="btn-primary" onClick={handleSearch}>
                Apply Filters
              </button>
              <button className="btn-secondary" onClick={saveCurrentFilter}>
                Save Filter
              </button>
              <button className="btn-secondary" onClick={clearFilters}>
                Clear All
              </button>
            </div>
          </div>
        )}

        {savedFilters.length > 0 && (
          <div className="saved-filters">
            <h3>Saved Filters</h3>
            <div className="filters-list">
              {savedFilters.map(filter => (
                <button
                  key={filter.id}
                  className="saved-filter-btn"
                  onClick={() => loadSavedFilter(filter)}
                >
                  {filter.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="search-results">
        {loading ? (
          <div className="loading-state">Searching...</div>
        ) : results.length === 0 ? (
          <div className="empty-state">
            {filters.searchText ? 'No results found' : 'Enter filters and click search'}
          </div>
        ) : (
          <div className="results-container">
            <h2>Results ({results.length})</h2>
            {results.map(result => (
              <div key={result.id} className="result-item">
                <div className="result-icon">
                  {result.issue_key && '🐛'}
                  {result.project_number && '📂'}
                  {result.username && '👤'}
                </div>
                <div className="result-content">
                  <h3>{result.title || result.project_number || result.username}</h3>
                  {result.description && <p>{result.description}</p>}
                  {result.company_name && <p>Company: {result.company_name}</p>}
                </div>
                <div className="result-meta">
                  {result.status && <span className="badge">{result.status}</span>}
                  {result.priority && <span className="badge">{result.priority}</span>}
                  {result.role && <span className="badge">{result.role}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AdvancedSearch;
