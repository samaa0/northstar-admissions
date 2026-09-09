export const reports = [
  {
    id: 'programme-demand',
    title: 'Programme demand and capacity',
    description: 'Compares first-choice demand, offers and accepted places against programme capacity.',
    category: 'Planning',
    visual: 'bar',
    sql: `
      SELECT p.code, p.name, p.capacity,
        COUNT(DISTINCT ac.application_id) AS first_choice_demand,
        COUNT(DISTINCT CASE WHEN a.status IN ('OFFERED', 'ACCEPTED') THEN a.id END) AS offers,
        COUNT(DISTINCT CASE WHEN a.status = 'ACCEPTED' THEN a.id END) AS accepted,
        ROUND(100.0 * COUNT(DISTINCT CASE WHEN a.status = 'ACCEPTED' THEN a.id END) / p.capacity, 1) AS fill_rate_pct
      FROM programmes p
      LEFT JOIN application_choices ac ON ac.programme_id = p.id AND ac.preference_rank = 1
      LEFT JOIN applications a ON a.id = ac.application_id
      GROUP BY p.id
      ORDER BY first_choice_demand DESC, p.code
    `,
  },
  {
    id: 'pipeline',
    title: 'Application pipeline',
    description: 'Counts applications at every current admissions stage.',
    category: 'Operations',
    visual: 'bar',
    sql: `
      SELECT status, COUNT(*) AS applications
      FROM applications
      GROUP BY status
      ORDER BY CASE status
        WHEN 'SUBMITTED' THEN 1 WHEN 'SCREENING' THEN 2 WHEN 'REVIEW' THEN 3
        WHEN 'INTERVIEW' THEN 4 WHEN 'OFFERED' THEN 5 WHEN 'ACCEPTED' THEN 6
        WHEN 'DECLINED' THEN 7 WHEN 'WITHDRAWN' THEN 8 ELSE 9 END
    `,
  },
  {
    id: 'offer-yield',
    title: 'Offer yield by programme',
    description: 'Measures accepted offers as a percentage of all offers by first-choice programme.',
    category: 'Performance',
    visual: 'bar',
    sql: `
      SELECT p.code,
        COUNT(CASE WHEN a.status IN ('OFFERED', 'ACCEPTED') THEN 1 END) AS offers,
        COUNT(CASE WHEN a.status = 'ACCEPTED' THEN 1 END) AS accepted,
        ROUND(100.0 * COUNT(CASE WHEN a.status = 'ACCEPTED' THEN 1 END) /
          NULLIF(COUNT(CASE WHEN a.status IN ('OFFERED', 'ACCEPTED') THEN 1 END), 0), 1) AS yield_pct
      FROM programmes p
      LEFT JOIN application_choices ac ON ac.programme_id = p.id AND ac.preference_rank = 1
      LEFT JOIN applications a ON a.id = ac.application_id
      GROUP BY p.id
      ORDER BY yield_pct DESC
    `,
  },
  {
    id: 'reviewer-workload',
    title: 'Reviewer workload',
    description: 'Shows open cases and current-stage distribution by assigned staff member.',
    category: 'Operations',
    visual: 'bar',
    sql: `
      SELECT s.name,
        COUNT(CASE WHEN a.status IN ('SUBMITTED', 'SCREENING', 'REVIEW', 'INTERVIEW') THEN 1 END) AS open_cases,
        COUNT(CASE WHEN a.status = 'REVIEW' THEN 1 END) AS in_review,
        COUNT(CASE WHEN a.status = 'INTERVIEW' THEN 1 END) AS interviews,
        ROUND(AVG(julianday('now') - julianday(a.last_updated)), 1) AS avg_days_since_update
      FROM staff_users s
      LEFT JOIN applications a ON a.assigned_to = s.id
      WHERE s.role IN ('ADMISSIONS', 'REVIEWER')
      GROUP BY s.id
      ORDER BY open_cases DESC
    `,
  },
  {
    id: 'missing-documents',
    title: 'Document completion exceptions',
    description: 'Identifies active applications without all three required core documents.',
    category: 'Integrity',
    visual: 'table',
    sql: `
      SELECT a.application_no,
        ap.first_name || ' ' || ap.last_name AS applicant,
        a.status,
        3 - COUNT(DISTINCT CASE WHEN d.document_type IN ('ID', 'TRANSCRIPT', 'PERSONAL_STATEMENT') THEN d.document_type END) AS missing_documents,
        GROUP_CONCAT(DISTINCT d.verification_status) AS verification_states
      FROM applications a
      JOIN applicants ap ON ap.id = a.applicant_id
      LEFT JOIN documents d ON d.application_id = a.id
      WHERE a.status NOT IN ('DECLINED', 'WITHDRAWN')
      GROUP BY a.id
      HAVING missing_documents > 0 OR SUM(CASE WHEN d.verification_status = 'REJECTED' THEN 1 ELSE 0 END) > 0
      ORDER BY missing_documents DESC, a.last_updated
    `,
  },
  {
    id: 'nationality-mix',
    title: 'Applicant nationality mix',
    description: 'Summarises applicant diversity and share of the total pool.',
    category: 'Planning',
    visual: 'donut',
    sql: `
      SELECT nationality, COUNT(*) AS applicants,
        ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM applicants), 1) AS share_pct
      FROM applicants
      GROUP BY nationality
      ORDER BY applicants DESC, nationality
    `,
  },
  {
    id: 'academic-bands',
    title: 'Academic score bands',
    description: 'Groups first-choice academic scores into review bands for cohort calibration.',
    category: 'Performance',
    visual: 'bar',
    sql: `
      SELECT CASE
        WHEN academic_score >= 90 THEN '90-100'
        WHEN academic_score >= 85 THEN '85-89.9'
        WHEN academic_score >= 80 THEN '80-84.9'
        ELSE 'Below 80' END AS score_band,
        COUNT(*) AS applicants
      FROM application_choices
      WHERE preference_rank = 1
      GROUP BY score_band
      ORDER BY MIN(academic_score) DESC
    `,
  },
  {
    id: 'interview-performance',
    title: 'Interview performance',
    description: 'Compares average academic and interview scores for interviewed applicants by programme.',
    category: 'Performance',
    visual: 'bar',
    sql: `
      SELECT p.code, COUNT(*) AS interviewed,
        ROUND(AVG(ac.academic_score), 1) AS avg_academic_score,
        ROUND(AVG(ac.interview_score), 1) AS avg_interview_score
      FROM application_choices ac
      JOIN programmes p ON p.id = ac.programme_id
      WHERE ac.preference_rank = 1 AND ac.interview_score IS NOT NULL
      GROUP BY p.id
      ORDER BY avg_interview_score DESC
    `,
  },
  {
    id: 'decision-turnaround',
    title: 'Decision turnaround time',
    description: 'Calculates elapsed days from submission to a recorded decision by programme.',
    category: 'Operations',
    visual: 'bar',
    sql: `
      SELECT p.code, COUNT(*) AS decisions,
        ROUND(AVG(julianday(d.decided_at) - julianday(a.submitted_at)), 1) AS avg_days,
        ROUND(MAX(julianday(d.decided_at) - julianday(a.submitted_at)), 1) AS longest_days
      FROM decisions d
      JOIN application_choices ac ON ac.id = d.application_choice_id
      JOIN applications a ON a.id = ac.application_id
      JOIN programmes p ON p.id = ac.programme_id
      GROUP BY p.id
      ORDER BY avg_days DESC
    `,
  },
  {
    id: 'scholarship-budget',
    title: 'Scholarship allocation',
    description: 'Tracks nominations, awards, available places and committed funding.',
    category: 'Planning',
    visual: 'bar',
    sql: `
      SELECT s.code, s.name, s.places,
        COUNT(CASE WHEN sa.status = 'NOMINATED' THEN 1 END) AS nominated,
        COUNT(CASE WHEN sa.status = 'AWARDED' THEN 1 END) AS awarded,
        COALESCE(SUM(sa.awarded_amount_hkd), 0) AS committed_hkd
      FROM scholarships s
      LEFT JOIN scholarship_applications sa ON sa.scholarship_id = s.id
      GROUP BY s.id
      ORDER BY committed_hkd DESC, s.code
    `,
  },
  {
    id: 'high-potential',
    title: 'High-potential pending cases',
    description: 'Finds high-scoring applicants who have not yet reached an offer decision.',
    category: 'Actions',
    visual: 'table',
    sql: `
      SELECT a.application_no,
        ap.first_name || ' ' || ap.last_name AS applicant,
        p.code AS first_choice,
        ac.academic_score,
        a.status,
        s.name AS reviewer
      FROM applications a
      JOIN applicants ap ON ap.id = a.applicant_id
      JOIN application_choices ac ON ac.application_id = a.id AND ac.preference_rank = 1
      JOIN programmes p ON p.id = ac.programme_id
      LEFT JOIN staff_users s ON s.id = a.assigned_to
      WHERE ac.academic_score >= 88 AND a.status IN ('SUBMITTED', 'SCREENING', 'REVIEW', 'INTERVIEW')
      ORDER BY ac.academic_score DESC, a.submitted_at
    `,
  },
  {
    id: 'monthly-submissions',
    title: 'Submission volume by month',
    description: 'Provides the intake trend used for staffing and campaign planning.',
    category: 'Planning',
    visual: 'line',
    sql: `
      SELECT strftime('%Y-%m', submitted_at) AS month, COUNT(*) AS submissions
      FROM applications
      WHERE submitted_at IS NOT NULL
      GROUP BY month
      ORDER BY month
    `,
  },
];

export function getReport(id) {
  return reports.find((report) => report.id === id);
}
