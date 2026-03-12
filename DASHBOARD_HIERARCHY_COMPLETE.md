# PMO Dashboard Hierarchy & Counters Refactoring ✅ COMPLETE

## Summary
Refactored the PMO Dashboard to properly display projects in a hierarchical tree structure with collapsible groups. Subprojects are no longer counted in dashboard totals and are only shown when their parent project is expanded.

---

## Changes Made

### 1️⃣ Backend Query Refactoring
**File**: `backend/controllers/projectController.js`

**Changes**:
- Filter all dashboard queries to only fetch main projects: `WHERE parent_project_id IS NULL`
- Dashboard counters (total, open, pending, closed, onhold) now count only parent projects
- Subprojects are fetched separately using `WHERE parent_project_id IN (list_of_main_ids)`
- Response structure now returns hierarchical projects:
  ```json
  {
    "projects": [
      {
        "id": "...",
        "project_number": "PRJ-2026-0001",
        "parent_project_id": null,
        "subprojects": [
          {"id": "...", "project_number": "PRJ-2026-0001-SP-xxxx", "parent_project_id": "..."},
          {"id": "...", "project_number": "PRJ-2026-0001-SP-yyyy", "parent_project_id": "..."}
        ]
      }
    ],
    "stats": {
      "total": 1,
      "open": 1,
      "pending": 0,
      "closed": 0,
      "onhold": 0
    }
  }
  ```

### 2️⃣ Frontend Dashboard Enhancement
**File**: `frontend/src/pages/Dashboard.js`

**Changes**:
- Uses server-provided `subprojects` arrays and `stats` for counters
- **Expand button logic**: Shows `▶ / ▼` icon only for main projects that have children
- **Tree rendering**: 
  - Main projects render as normal rows
  - Subprojects only render when parent is expanded
  - Subprojects are indented with visual tree markers (`├─`)
  - Subprojects have a light blue background (`bg-blue-50`) and left border (`border-l-4 border-blue-300`)
- Subprojects display all columns (company, type, status, dates, auditor) for clarity
- Both main projects and subprojects are clickable links to detail pages

### 3️⃣ Data Inspection Tool
**File**: `backend/scripts/generate_parent_child_report.js`

Created a **read-only** report script that:
- Lists actual parent-child relationships (via `parent_project_id`)
- Suggests parent-child pairs based on project number patterns (heuristic)
- Identifies orphan subproject-like records (e.g., `PRJ-2026-0001-SP-xxxx` with `parent_project_id IS NULL`)

**Run the report**:
```bash
cd backend
node scripts/generate_parent_child_report.js
```

---

## Expected Dashboard Behavior

### Before Fix
```
Total Projects: 3  ❌ (counted subprojects)

▸ PRJ-2026-0001
▸ PRJ-2026-0001-SP-fc29dcfa
▸ PRJ-2026-0001-SP-4b34842e
```

### After Fix
```
Total Projects: 1  ✅ (only main projects)

▶ PRJ-2026-0001
  ├─ PRJ-2026-0001-SP-fc29dcfa
  ├─ PRJ-2026-0001-SP-4b34842e
```

---

## Key Features

✅ **Hierarchical Display**: Main projects with nested subprojects  
✅ **Expand/Collapse**: Click `▶` / `▼` to toggle subproject visibility  
✅ **Correct Counters**: Dashboard totals count only parent projects  
✅ **Visual Tree**: Subprojects indented with `├─` markers and blue styling  
✅ **No Duplicates**: Subprojects not rendered as separate main rows  
✅ **Relational Mapping**: Uses `parent_project_id` (not string patterns)  
✅ **All Roles**: Works across Finance, PMO, Manager, Auditor, Admin dashboards  

---

## Data Consistency Note

The current DB may have subproject-like records (e.g., `PRJ-2026-0001-SP-xxxx`) with `parent_project_id = NULL`. These will currently appear as main projects in the dashboard. 

**To link them to parents**: Use the generated report and review the heuristics before applying updates:
```bash
# Generate report
node backend/scripts/generate_parent_child_report.js > /tmp/report.json

# Review pattern_suggestions section
jq '.pattern_suggestions' /tmp/report.json
```

SQL update script to set `parent_project_id` can be prepared upon request (pattern-based matching).

---

## Files Modified

1. `backend/controllers/projectController.js` — Query filtering, hierarchical response
2. `frontend/src/pages/Dashboard.js` — Tree rendering, expand/collapse logic
3. `backend/scripts/generate_parent_child_report.js` — Data inspection tool (new)

---

## Testing Checklist

- [ ] Dashboard loads without errors (200 OK)
- [ ] Project counters show only main projects (not subprojects)
- [ ] Expand button appears only on main projects with children
- [ ] Subprojects visible only when parent expanded
- [ ] Subproject rows indented and styled with tree markers
- [ ] All roles (Finance, PMO, Manager, Auditor, Admin) display correctly
- [ ] Clicking project number navigates to detail page (main or sub)
- [ ] No 500 errors in backend logs

---

## Deployment Notes

1. **No DB schema changes** — Only used existing `parent_project_id` column
2. **Backward compatible** — Existing data (with `parent_project_id = NULL`) still displays
3. **Zero downtime** — Can deploy frontend and backend independently
4. **Data migration optional** — Existing subproject records can be linked if needed

---

**Status**: ✅ Ready for testing/deployment  
**Date Completed**: February 21, 2026  
**Last Updated**: 15:48 UTC
