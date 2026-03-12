const pool = require('../db/connection');

async function run() {
  try {
    // Actual parent-child relationships (based on parent_project_id)
    const actualQ = `
      SELECT p.id AS parent_id, p.project_number AS parent_project_number, p.company_name AS parent_company,
             c.id AS child_id, c.project_number AS child_project_number, c.company_name AS child_company,
             'actual' AS match_type
      FROM projects p
      JOIN projects c ON c.parent_project_id = p.id
      WHERE p.parent_project_id IS NULL
      ORDER BY p.project_number, c.project_number
    `;

    // Pattern-suggested relationships (heuristic for reporting only)
    const suggestedQ = `
      SELECT p.id AS parent_id, p.project_number AS parent_project_number, p.company_name AS parent_company,
             c.id AS child_id, c.project_number AS child_project_number, c.company_name AS child_company,
             'pattern_suggested' AS match_type
      FROM projects p
      JOIN projects c ON c.parent_project_id IS NULL AND c.id <> p.id
      WHERE p.parent_project_id IS NULL
        AND c.project_number ILIKE p.project_number || '%-SP%'
      ORDER BY p.project_number, c.project_number
    `;

    // Orphan subproject-like records (project numbers that look like subprojects but have no parent set)
    const orphansQ = `
      SELECT id, project_number, company_name
      FROM projects
      WHERE parent_project_id IS NULL
        AND project_number ILIKE '%-SP%'
      ORDER BY project_number
    `;

    const [actualRes, suggestedRes, orphansRes] = await Promise.all([
      pool.query(actualQ),
      pool.query(suggestedQ),
      pool.query(orphansQ)
    ]);

    const report = {
      generated_at: new Date().toISOString(),
      actual_relations: actualRes.rows,
      pattern_suggestions: suggestedRes.rows,
      orphan_subproject_like: orphansRes.rows
    };

    console.log(JSON.stringify(report, null, 2));
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('Error generating parent-child report:', err);
    try { await pool.end(); } catch (e) {}
    process.exit(2);
  }
}

run();
