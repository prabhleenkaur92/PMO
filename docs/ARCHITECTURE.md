# PMO Portal - Complete System Design

## Table of Contents
1. System Architecture
2. Database Schema
3. API Specification
4. User Roles & Permissions
5. Security Considerations
6. Deployment Guide
7. Future Enhancements

---

## 1. System Architecture

### High-Level Architecture

```
┌─────────────────┐        ┌──────────────────┐        ┌─────────────────┐
│                 │        │                  │        │                 │
│  React Frontend │◄──────►│  Node.js/Express │◄──────►│   PostgreSQL    │
│  (Port 3000)    │ HTTP   │  API Server      │ SQL    │   (Port 5432)   │
│                 │        │  (Port 5000)     │        │                 │
└─────────────────┘        └──────────────────┘        └─────────────────┘
       │                            │                            │
       │                            │                            │
       └────────────────────────────┴────────────────────────────┘
                           JWT Tokens & Auth
```

### Technology Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18, React Router, Axios, Tailwind CSS |
| **Backend** | Node.js, Express.js |
| **Database** | PostgreSQL 12+ |
| **Authentication** | JWT (JsonWebToken) |
| **Password Security** | bcryptjs (10 rounds) |
| **Validation** | express-validator |
| **File Storage** | Local filesystem (upgradeable to S3) |
| **Rate Limiting** | express-rate-limit |
| **Security Headers** | helmet.js |
| **CORS** | cors middleware |

---

## 2. Database Schema

### Entity Relationship Diagram

```
users ──┐
        ├─→ projects (created_by, assigned_to)
        ├─→ project_remarks (created_by)
        ├─→ project_status_history (changed_by)
        ├─→ file_attachments (uploaded_by)
        ├─→ audit_logs (user_id)
        └─→ access_logs (user_id)

roles ──┐
        └─→ role_permissions ←─ permissions

clients ──┐
          ├─→ projects (client_id)
          └─→ points_of_contact
```

### Key Tables

#### users
```sql
id (UUID, PK)
username (VARCHAR, UNIQUE)
email (VARCHAR, UNIQUE)
password_hash (VARCHAR)
first_name, last_name (VARCHAR)
phone (VARCHAR)
role (ENUM: admin, pmo, manager, auditor)
is_active (BOOLEAN)
two_factor_enabled (BOOLEAN)
created_at, updated_at (TIMESTAMP)
last_login (TIMESTAMP)
```

#### projects
```sql
id (UUID, PK)
project_number (VARCHAR, UNIQUE) -- PRJ-2024-0001
client_id (UUID, FK)
project_type (ENUM: VAPT, Compliance, Both)
testing_type (ENUM: Blackbox, Whitebox, Graybox)
scope_description (TEXT)
status (ENUM: New, Assigned, In Progress, Pending from Client, Completed, Closed)
start_date, expected_end_date, actual_end_date (DATE)
created_by (UUID, FK) -- PMO who created
assigned_to (UUID, FK) -- Auditor assigned
created_at, updated_at (TIMESTAMP)
```

#### project_status_history
```sql
id (UUID, PK)
project_id (UUID, FK)
old_status, new_status (ENUM)
changed_by (UUID, FK)
comment (TEXT)
changed_at (TIMESTAMP) -- Immutable audit trail
```

#### project_remarks
```sql
id (UUID, PK)
project_id (UUID, FK)
created_by (UUID, FK)
remark_type (VARCHAR: 'manager', 'auditor', 'pmo')
content (TEXT)
is_visible_to_client (BOOLEAN)
created_at, updated_at (TIMESTAMP)
```

#### audit_logs
```sql
id (UUID, PK)
user_id (UUID, FK)
action (VARCHAR) -- e.g., 'PROJECT_CREATED', 'USER_ROLE_CHANGED'
entity_type (VARCHAR) -- e.g., 'projects', 'users'
entity_id (UUID)
old_values (JSONB)
new_values (JSONB)
ip_address (VARCHAR)
user_agent (TEXT)
created_at (TIMESTAMP)
```

---

## 3. API Specification

### Authentication Endpoints

#### POST `/api/auth/register`
```json
Request:
{
  "username": "john_doe",
  "email": "john@example.com",
  "password": "SecurePass123!",
  "firstName": "John",
  "lastName": "Doe"
}

Response (201):
{
  "message": "User registered successfully",
  "user": {
    "id": "uuid",
    "username": "john_doe",
    "email": "john@example.com",
    "role": "pmo"
  }
}
```

#### POST `/api/auth/login`
```json
Request:
{
  "username": "john_doe",
  "password": "SecurePass123!"
}

Response (200):
{
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "username": "john_doe",
    "email": "john@example.com",
    "role": "pmo"
  }
}
```

### Project Endpoints

#### POST `/api/projects` (PMO only)
```json
Request:
{
  "clientName": "TechCorp Inc",
  "clientAddress": "123 Business St",
  "projectType": "Both",
  "testingType": "Blackbox",
  "poc1Name": "Jane Smith",
  "poc1Phone": "+1234567890",
  "poc1Email": "jane@techcorp.com",
  "scopeDescription": "Full VAPT assessment...",
  "startDate": "2024-02-15",
  "expectedEndDate": "2024-03-15"
}

Response (201):
{
  "message": "Project created successfully",
  "project": {
    "id": "uuid",
    "project_number": "PRJ-2024-0001",
    "status": "New",
    ...
  }
}
```

#### GET `/api/projects`
```
Query Parameters:
- status: Filter by status
- clientId: Filter by client
- auditedBy: Filter by assigned auditor
- projectType: Filter by project type
- page: Pagination (default: 1)
- limit: Records per page (default: 10)

Response (200):
{
  "projects": [...],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 50,
    "pages": 5
  }
}
```

#### PATCH `/api/projects/:id/status` (Manager/Admin)
```json
Request:
{
  "newStatus": "In Progress",
  "comment": "Work started on scope items"
}

Response (200):
{
  "message": "Project status updated successfully"
}
```

#### PATCH `/api/projects/:id/assign` (Manager/Admin)
```json
Request:
{
  "auditorId": "uuid-of-auditor"
}

Response (200):
{
  "message": "Project assigned successfully"
}
```

### User Management Endpoints

#### GET `/api/users` (Admin only)
Returns all users with pagination

#### PATCH `/api/users/:id/role` (Admin only)
```json
Request:
{
  "role": "manager"
}

Response (200):
{
  "message": "User role updated successfully"
}
```

### Role & Permissions Endpoints

#### GET `/api/roles` (Admin only)
Returns all system roles

#### POST `/api/roles/:roleId/permissions` (Admin only)
```json
Request:
{
  "permissionId": "uuid"
}

Response (200):
{
  "message": "Permission granted successfully"
}
```

### Audit Endpoints

#### GET `/api/audit/logs/audit` (Admin only)
Query parameters: userId, action, entityType, page, limit

#### GET `/api/audit/logs/access` (Admin only)
Query parameters: userId, endpoint, page, limit

---

## 4. User Roles & Permissions Matrix

### Role: Admin
| Module | Read | Write | Edit | Approve |
|--------|------|-------|------|---------|
| Projects | ✓ | ✓ | ✓ | ✓ |
| Users | ✓ | ✓ | ✓ | ✓ |
| Roles | ✓ | ✓ | ✓ | ✓ |
| Audit Logs | ✓ | ✗ | ✗ | ✗ |

**Special Permissions:**
- Create/Deactivate users
- Assign/Modify roles
- Manage permissions
- View all audit trails

### Role: PMO
| Module | Read | Write | Edit | Approve |
|--------|------|-------|------|---------|
| Projects | ✓ | ✓ | Own | ✗ |
| Users | ✓ | ✗ | Own | ✗ |
| Roles | ✗ | ✗ | ✗ | ✗ |
| Audit Logs | ✗ | ✗ | ✗ | ✗ |

**Special Permissions:**
- Create new projects
- View own projects
- View manager remarks
- Respond to queries
- Close completed projects

### Role: Manager
| Module | Read | Write | Edit | Approve |
|--------|------|-------|------|---------|
| Projects | ✓ | ✓ | ✓ | ✓ |
| Users | ✓ | ✗ | ✗ | ✗ |
| Roles | ✗ | ✗ | ✗ | ✗ |
| Audit Logs | ✗ | ✗ | ✗ | ✗ |

**Special Permissions:**
- Review projects from PMO
- Add remarks/instructions
- Assign to auditors
- Approve scope modifications
- Update project status
- Escalate to PMO

### Role: Auditor
| Module | Read | Write | Edit | Approve |
|--------|------|-------|------|---------|
| Projects | Assigned | ✓ | ✓ | ✗ |
| Users | Own | ✗ | Own | ✗ |
| Roles | ✗ | ✗ | ✗ | ✗ |
| Audit Logs | ✗ | ✗ | ✗ | ✗ |

**Special Permissions:**
- View assigned projects only
- Add findings/progress updates
- Upload evidence
- Update own status
- View manager instructions
- Send remarks to manager

---

## 5. Security Considerations

### Authentication & Authorization

1. **JWT Token Management**
   - Expiry: 7 days (configurable)
   - Refresh mechanism: Implement refresh tokens for long sessions
   - Token storage: localStorage (consider secure cookies)

2. **Password Security**
   - Minimum 8 characters
   - Hashed with bcryptjs (10 rounds, ~100ms per hash)
   - No password storage in logs
   - Implement password reset flow

3. **Role-Based Access Control (RBAC)**
   - Enforced at middleware level
   - Database-driven permissions
   - Granular module/action permissions

### Data Protection

1. **Encryption**
   - TLS/HTTPS required for all communication
   - Database at-rest encryption (PostgreSQL pgcrypto)
   - Sensitive fields encrypted (SSN, credit cards if needed)

2. **Data Validation**
   - Input validation on both client and server
   - Parameterized queries (prepared statements) for SQL injection prevention
   - File upload validation (type, size, malware scanning)

3. **Audit Logging**
   - All user actions logged with timestamp and IP
   - Before/after values for modifications
   - Immutable audit trail (append-only)
   - Access logs for compliance

### API Security

1. **Rate Limiting**
   - 100 requests per 15 minutes per IP
   - Stricter limits for authentication endpoints
   - Configurable by environment

2. **CORS**
   - Restricted to frontend origin
   - Credentials allowed

3. **Security Headers** (via Helmet.js)
   - Content-Security-Policy
   - X-Frame-Options
   - X-Content-Type-Options
   - Strict-Transport-Security

### Infrastructure Security

1. **Environment Variables**
   - All secrets in .env (never committed)
   - Different keys per environment
   - Rotation policy for JWT secret

2. **Database Security**
   - Connection pooling
   - Minimum privilege user account
   - Regular backups
   - Point-in-time recovery

3. **File Upload Security**
   - Virus scanning (integrate ClamAV)
   - Size limits (10MB default)
   - Filename sanitization
   - Storage outside web root

### Compliance

- GDPR: Data retention policies, right to be forgotten
- SOC2: Audit trails, access controls
- ISO 27001: Information security management

---

## 6. Deployment Guide

### Prerequisites
- Node.js 16+
- PostgreSQL 12+
- Docker (optional)
- Nginx (for reverse proxy)

### Local Development Setup

```bash
# Backend
cd backend
cp .env.example .env
npm install
npm run migrate
npm run dev

# Frontend (in another terminal)
cd frontend
npm install
npm start
```

### Production Deployment

#### Option 1: Traditional VM

```bash
# Server setup
sudo apt update && sudo apt upgrade
sudo apt install nodejs npm postgresql

# Clone repository
git clone <repo> /var/www/pmo-portal
cd /var/www/pmo-portal

# Backend setup
cd backend
npm install --production
npm run migrate
# Use PM2 to manage process
npm install -g pm2
pm2 start server.js --name "pmo-api"

# Frontend build
cd ../frontend
npm install
npm run build
# Serve with Nginx

# Configure Nginx
sudo cp nginx.conf /etc/nginx/sites-available/pmo-portal
sudo ln -s /etc/nginx/sites-available/pmo-portal /etc/nginx/sites-enabled/
sudo systemctl restart nginx
```

#### Option 2: Docker Deployment

```dockerfile
# Dockerfile.backend
FROM node:18-alpine
WORKDIR /app
COPY backend .
RUN npm install --production
EXPOSE 5000
CMD ["npm", "start"]

# Dockerfile.frontend
FROM node:18-alpine AS build
WORKDIR /app
COPY frontend .
RUN npm install && npm run build

FROM nginx:alpine
COPY --from=build /app/build /usr/share/nginx/html
EXPOSE 80
```

```bash
# Docker Compose
docker-compose up -d
```

### Environment Configuration

**Production .env**
```
NODE_ENV=production
PORT=5000
POSTGRES_HOST=db.internal
POSTGRES_USER=pmo_user
POSTGRES_PASSWORD=<strong-password>
JWT_SECRET=<strong-secret>
CORS_ORIGIN=https://pmo.yourdomain.com
```

---

## 7. Future Enhancements

### Phase 2

1. **SLA Tracking**
   - Deadline management
   - Escalation rules
   - Breach notifications

2. **Compliance Framework Mapping**
   - ISO 27001, SOC2, PCI-DSS
   - Requirement tracking
   - Evidence mapping

3. **Advanced Reporting**
   - Custom report builder
   - Export to PDF/Excel
   - Scheduled reports
   - Compliance certificates

### Phase 3

1. **Client Portal**
   - Read-only access to own projects
   - Status updates
   - Document submission

2. **Integration APIs**
   - Jira integration
   - Slack notifications
   - Email automation

3. **AI/ML Features**
   - Risk scoring
   - Anomaly detection
   - Predictive analytics

4. **Mobile App**
   - iOS/Android native apps
   - Offline capability
   - Push notifications

### Phase 4

1. **Multi-tenancy**
   - Separate instances per company
   - Data isolation
   - Custom branding

2. **Advanced Analytics**
   - Real-time dashboards
   - KPI tracking
   - Custom metrics

3. **Blockchain Integration**
   - Immutable audit logs
   - Compliance certificates on blockchain

---

## File Structure

```
pmo-portal/
├── backend/
│   ├── db/
│   │   ├── connection.js
│   │   └── migrate.js
│   ├── middleware/
│   │   ├── auth.js
│   │   ├── permissions.js
│   │   └── logger.js
│   ├── routes/
│   │   ├── auth.js
│   │   ├── projects.js
│   │   ├── users.js
│   │   ├── roles.js
│   │   └── audit.js
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── projectController.js
│   │   ├── userController.js
│   │   ├── roleController.js
│   │   └── auditController.js
│   ├── .env.example
│   ├── package.json
│   ├── README.md
│   └── server.js
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Navbar.js
│   │   │   └── ProtectedRoute.js
│   │   ├── pages/
│   │   │   ├── Login.js
│   │   │   ├── Register.js
│   │   │   └── Dashboard.js
│   │   ├── services/
│   │   │   └── api.js
│   │   ├── context/
│   │   │   └── AuthContext.js
│   │   ├── App.js
│   │   ├── index.js
│   │   └── index.css
│   ├── public/
│   │   └── index.html
│   ├── package.json
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── README.md
│   └── .env.example
└── docs/
    └── ARCHITECTURE.md
```

---

## Testing Workflow

### Sample Test Cases

**Create Project (PMO)**
```bash
POST /api/projects
Authorization: Bearer <pmo-token>
{
  "clientName": "TestCorp",
  "projectType": "VAPT",
  "testingType": "Blackbox",
  "scopeDescription": "Test scope",
  "startDate": "2024-02-15",
  "expectedEndDate": "2024-03-15"
}
# Expected: 201, project_number = PRJ-2024-0001
```

**Assign Project (Manager)**
```bash
PATCH /api/projects/{project-id}/assign
Authorization: Bearer <manager-token>
{
  "auditorId": "<auditor-uuid>"
}
# Expected: 200, status changes to "Assigned"
```

**Update Status (Auditor)**
```bash
PATCH /api/projects/{project-id}/status
Authorization: Bearer <auditor-token>
{
  "newStatus": "In Progress",
  "comment": "Started testing"
}
# Expected: 200, status_history entry created
```

---

## Support & Maintenance

- **Bug Reporting**: GitHub Issues
- **Feature Requests**: GitHub Discussions
- **Security Vulnerabilities**: security@company.com
- **Documentation**: Wiki

---

**Last Updated**: February 4, 2026
**Version**: 1.0.0
