import React, { useState, useEffect } from 'react';
import api from '../services/api';
import '../styles/DocumentManager.css';

const DocumentManager = ({ entityType, entityId }) => {
  const [documents, setDocuments] = useState([]);
  const [versions, setVersions] = useState({});
  const [selectedFile, setSelectedFile] = useState(null);
  const [description, setDescription] = useState('');
  const [uploading, setUploading] = useState(false);
  const [expandedDoc, setExpandedDoc] = useState(null);

  useEffect(() => {
    loadDocuments();
  }, [entityId]);

  const loadDocuments = async () => {
    try {
      const res = await api.get(`/${entityType}/${entityId}/attachments`);
      setDocuments(res.data);
    } catch (error) {
      console.error('Error loading documents:', error);
    }
  };

  const handleFileSelect = (e) => {
    setSelectedFile(e.target.files[0]);
  };

  const uploadDocument = async () => {
    if (!selectedFile) {
      alert('Please select a file');
      return;
    }

    try {
      setUploading(true);
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('description', description);
      formData.append('entityType', entityType);
      formData.append('entityId', entityId);

      await api.post('/documents/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      setSelectedFile(null);
      setDescription('');
      loadDocuments();
    } catch (error) {
      console.error('Error uploading document:', error);
    } finally {
      setUploading(false);
    }
  };

  const loadVersions = async (docId) => {
    try {
      const res = await api.get(`/documents/${docId}/versions`);
      setVersions(prev => ({ ...prev, [docId]: res.data }));
    } catch (error) {
      console.error('Error loading versions:', error);
    }
  };

  const toggleExpanded = (docId) => {
    if (expandedDoc === docId) {
      setExpandedDoc(null);
    } else {
      setExpandedDoc(docId);
      loadVersions(docId);
    }
  };

  const downloadFile = async (fileId, fileName) => {
    try {
      const res = await api.get(`/documents/${fileId}/download`, { 
        responseType: 'blob' 
      });
      
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', fileName);
      document.body.appendChild(link);
      link.click();
      link.parentElement.removeChild(link);
    } catch (error) {
      console.error('Error downloading file:', error);
    }
  };

  const deleteVersion = async (versionId) => {
    if (!window.confirm('Are you sure you want to delete this version?')) return;

    try {
      await api.delete(`/documents/versions/${versionId}`);
      loadDocuments();
    } catch (error) {
      console.error('Error deleting version:', error);
    }
  };

  const restoreVersion = async (versionId) => {
    try {
      await api.post(`/documents/versions/${versionId}/restore`);
      loadDocuments();
    } catch (error) {
      console.error('Error restoring version:', error);
    }
  };

  return (
    <div className="document-manager">
      <div className="document-upload">
        <h3>📄 Upload Document</h3>
        <div className="upload-form">
          <div className="form-group">
            <input
              type="file"
              onChange={handleFileSelect}
              disabled={uploading}
            />
          </div>
          <div className="form-group">
            <input
              type="text"
              placeholder="Description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={uploading}
            />
          </div>
          <button 
            className="btn-upload"
            onClick={uploadDocument}
            disabled={uploading || !selectedFile}
          >
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>
      </div>

      <div className="documents-list">
        <h3>📁 Documents ({documents.length})</h3>
        {documents.length === 0 ? (
          <div className="empty-state">No documents uploaded yet</div>
        ) : (
          documents.map(doc => (
            <div key={doc.id} className="document-item">
              <div 
                className="document-header"
                onClick={() => toggleExpanded(doc.id)}
              >
                <div className="document-info">
                  <div className="file-icon">
                    {getFileIcon(doc.file_type)}
                  </div>
                  <div className="file-details">
                    <h4>{doc.file_name}</h4>
                    <p>
                      <small>
                        {formatDate(doc.uploaded_at)} • {formatFileSize(doc.file_size)} •
                        <span className="uploader"> by {doc.uploaded_by_name}</span>
                      </small>
                    </p>
                    {doc.description && (
                      <p className="description">{doc.description}</p>
                    )}
                  </div>
                </div>
                <div className="document-actions">
                  <button 
                    className="btn-icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      downloadFile(doc.id, doc.file_name);
                    }}
                    title="Download"
                  >
                    ⬇️
                  </button>
                  <button 
                    className={`btn-icon ${expandedDoc === doc.id ? 'active' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpanded(doc.id);
                    }}
                    title="Show versions"
                  >
                    📚 ({doc.version_count})
                  </button>
                </div>
              </div>

              {expandedDoc === doc.id && versions[doc.id] && (
                <div className="document-versions">
                  <h4>Version History</h4>
                  <div className="versions-list">
                    {versions[doc.id].map(version => (
                      <div key={version.id} className="version-item">
                        <div className="version-info">
                          <span className="version-number">v{version.version_number}</span>
                          <span className="version-date">{formatDate(version.created_at)}</span>
                          <span className="version-uploader">by {version.uploaded_by_name}</span>
                          {version.is_latest_version && (
                            <span className="version-badge">Latest</span>
                          )}
                        </div>
                        {version.change_description && (
                          <p className="version-description">{version.change_description}</p>
                        )}
                        <div className="version-actions">
                          <button 
                            className="version-btn download"
                            onClick={() => downloadFile(version.id, `${doc.file_name}-v${version.version_number}`)}
                          >
                            Download
                          </button>
                          {!version.is_latest_version && (
                            <button 
                              className="version-btn restore"
                              onClick={() => restoreVersion(version.id)}
                            >
                              Restore
                            </button>
                          )}
                          <button 
                            className="version-btn delete"
                            onClick={() => deleteVersion(version.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

const getFileIcon = (fileType) => {
  if (!fileType) return '📄';
  
  const type = fileType.toLowerCase();
  if (type.includes('pdf')) return '📕';
  if (type.includes('image')) return '🖼️';
  if (type.includes('video')) return '🎥';
  if (type.includes('audio')) return '🎵';
  if (type.includes('excel') || type.includes('spreadsheet')) return '📊';
  if (type.includes('word') || type.includes('document')) return '📗';
  if (type.includes('powerpoint') || type.includes('presentation')) return '📈';
  if (type.includes('zip') || type.includes('compress')) return '🗜️';
  if (type.includes('text')) return '📝';
  
  return '📄';
};

const formatFileSize = (bytes) => {
  if (!bytes) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
};

const formatDate = (dateString) => {
  const date = new Date(dateString);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export default DocumentManager;
