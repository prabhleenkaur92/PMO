# PMO Portal - Backend

Secure, scalable backend API for Project Management Portal

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure `.env` file (copy from `.env.example`):
```bash
cp .env.example .env
```

3. Initialize database:
```bash
npm run migrate
```

4. Start development server:
```bash
npm run dev
```

## API Endpoints

### Authentication
- POST `/api/auth/register` - Register new user
- POST `/api/auth/login` - Login
- POST `/api/auth/logout` - Logout (protected)
- GET `/api/auth/me` - Get current user (protected)

### Projects
- POST `/api/projects` - Create project (PMO only)
- GET `/api/projects` - Get projects (filtered by role)
- GET `/api/projects/:id` - Get project details
- PATCH `/api/projects/:id/status` - Update status
- PATCH `/api/projects/:id/assign` - Assign to auditor

### Users
- GET `/api/users` - Get all users (admin only)
- GET `/api/users/:id` - Get user details
- PATCH `/api/users/:id` - Update user profile
- PATCH `/api/users/:id/role` - Change user role (admin only)
- PATCH `/api/users/:id/deactivate` - Deactivate user
- PATCH `/api/users/:id/activate` - Activate user

### Roles & Permissions
- GET `/api/roles` - Get all roles (admin only)
- GET `/api/roles/:roleId/permissions` - Get role permissions
- POST `/api/roles/:roleId/permissions` - Grant permission
- DELETE `/api/roles/:roleId/permissions/:permissionId` - Revoke permission

### Audit Logs
- GET `/api/audit/logs/audit` - View audit logs (admin only)
- GET `/api/audit/logs/access` - View access logs (admin only)

## Security Features

- JWT token-based authentication
- Bcrypt password hashing
- Role-based access control (RBAC)
- Comprehensive audit logging
- Access logs for all operations
- Rate limiting (100 requests per 15 minutes)
- CORS enabled
- Helmet.js for security headers
- Input validation with express-validator

## Database

PostgreSQL with 10 main tables:
- users
- roles
- permissions
- role_permissions
- clients
- points_of_contact
- projects
- project_status_history
- project_remarks
- file_attachments
- audit_logs
- access_logs
