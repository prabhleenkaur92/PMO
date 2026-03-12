# PMO Portal - Frontend

React-based frontend for Project Management Portal

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file:
```bash
REACT_APP_API_URL=http://localhost:5000/api
```

3. Start development server:
```bash
npm start
```

The app will open at http://localhost:3000

## Features

- **Authentication**: Login/Register with JWT token
- **Dashboard**: Project overview with statistics
- **Project Management**: Create, view, and manage projects
- **Role-based UI**: Different interfaces for Admin, PMO, Manager, Auditor
- **Real-time Updates**: Live project status updates
- **Responsive Design**: Works on all devices

## Project Structure

```
src/
  components/     # Reusable components
  pages/         # Page components
  services/      # API service calls
  context/       # React Context (Authentication)
  utils/         # Utility functions
  index.css      # Global styles with Tailwind
```

## Tech Stack

- React 18
- React Router DOM
- Axios
- Tailwind CSS
- React Icons
- Chart.js (for dashboards)

## Environment Variables

- `REACT_APP_API_URL` - Backend API URL (default: http://localhost:5000/api)
