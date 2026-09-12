const cycleFilter = '(@cycleId IS NULL OR a.cycle_id = @cycleId)';
const dateFilter = `
  (@from IS NULL OR date(a.submitted_at) >= date(@from))
  AND (@to IS NULL OR date(a.submitted_at) <= date(@to))
`;

export const reports = [
  {
    id: 'programme-demand',
    title: 'Programme demand and capacity',
    description: 'Compares first-choice demand, offers and accepted places against annual offering capacity.',
    purpose: 'Supports annual capacity allocation and highlights oversubscribed programmes.',
    category: 'Planning',
    visual: 'bar',
    parameters: ['cycleId', 'from', 'to'],
    advancedSql: 'Multi-table joins, conditional aggregation and a derived capacity view.',
    fixtureAssertions: { cycleId: 2, minimumRows: 6, totalFirstChoiceDemand: 24 },
    sql: `
      SELECT p.code, p.name, po.capacity,
        COUNT(DISTINCT CASE WHEN ac.preference_rank = 1 THEN ac.application_id END) AS first_choice_demand,
        COUNT(DISTINCT CASE WHEN cs.current_status IN ('OFFERED', 'ACCEPTED') THEN a.id END) AS offers,
        COUNT(DISTINCT CASE WHEN cs.current_status = 'ACCEPTED' THEN a.id END) AS accepted,
        po.capacity - COUNT(DISTINCT CASE WHEN cs.current_status = 'ACCEPTED' THEN a.id END) AS remaining_places,
        ROUND(100.0 * COUNT(DISTINCT CASE WHEN cs.current_status = 'ACCEPTED' THEN a.id END) / po.capacity, 1) AS fill_rate_pct
      FROM programme_offerings po
      JOIN programmes p ON p.id = po.programme_id
      LEFT JOIN application_choices ac ON ac.programme_offering_id = po.id AND ac.preference_rank = 1
      LEFT JOIN applications a ON a.id = ac.application_id AND ${cycleFilter} AND ${dateFilter}
      LEFT JOIN v_application_current_status cs ON cs.application_id = a.id
      WHERE (@cycleId IS NULL OR po.cycle_id = @cycleId)
      GROUP BY po.id
      ORDER BY first_choice_demand DESC, p.code
    `,
  },
  {
    id: 'pipeline',
    title: 'Application pipeline',
    description: 'Counts applications at every current admissions stage for the selected cycle and period.',
    purpose: 'Shows workflow bottlenecks and the size of each active or terminal cohort.',
    category: 'Operations',
    visual: 'bar',
    parameters: ['cycleId', 'from', 'to'],
    advancedSql: 'Current-state view over append-only history with conditional ordering.',
    fixtureAssertions: { cycleId: 2, totalApplications: 24 },
    sql: `
      SELECT COALESCE(cs.current_status, 'DRAFT') AS status, COUNT(*) AS applications
      FROM applications a
      LEFT JOIN v_application_current_status cs ON cs.application_id = a.id
      WHERE ${cycleFilter} AND ${dateFilter}
      GROUP BY COALESCE(cs.current_status, 'DRAFT')
      ORDER BY CASE COALESCE(cs.current_status, 'DRAFT')
        WHEN 'DRAFT' THEN 1 WHEN 'SUBMITTED' THEN 2 WHEN 'SCREENING' THEN 3
        WHEN 'REVIEW' THEN 4 WHEN 'INTERVIEW' THEN 5 WHEN 'WAITLISTED' THEN 6
        WHEN 'OFFERED' THEN 7 WHEN 'ACCEPTED' THEN 8 WHEN 'DECLINED' THEN 9 ELSE 10 END
    `,
  },
  {
    id: 'offer-yield',
    title: 'Offer yield by programme',
    description: 'Measures accepted offers as a percentage of offer outcomes by first-choice offering.',
    purpose: 'Helps admissions managers forecast conversion and tune future offer volumes.',
    category: 'Performance',
    visual: 'bar',
    parameters: ['cycleId', 'from', 'to'],
    advancedSql: 'Conditional aggregation with NULL-safe percentage calculation.',
    fixtureAssertions: { cycleId: 2, minimumRows: 6 },
    sql: `
      SELECT p.code,
        COUNT(CASE WHEN cs.current_status IN ('OFFERED', 'ACCEPTED') THEN 1 END) AS offers,
        COUNT(CASE WHEN cs.current_status = 'ACCEPTED' THEN 1 END) AS accepted,
        ROUND(100.0 * COUNT(CASE WHEN cs.current_status = 'ACCEPTED' THEN 1 END) /
          NULLIF(COUNT(CASE WHEN cs.current_status IN ('OFFERED', 'ACCEPTED') THEN 1 END), 0), 1) AS yield_pct
      FROM programme_offerings po
      JOIN programmes p ON p.id = po.programme_id
      LEFT JOIN application_choices ac ON ac.programme_offering_id = po.id AND ac.preference_rank = 1
      LEFT JOIN applications a ON a.id = ac.application_id AND ${cycleFilter} AND ${dateFilter}
      LEFT JOIN v_application_current_status cs ON cs.application_id = a.id
      WHERE (@cycleId IS NULL OR po.cycle_id = @cycleId)
      GROUP BY po.id
      ORDER BY yield_pct DESC, p.code
    `,
  },
  {
    id: 'reviewer-workload',
    title: 'Reviewer workload',
    description: 'Shows open cases and current-stage distribution by assigned admissions staff.',
    purpose: 'Supports fair case allocation and exposes operational backlogs.',
    category: 'Operations',
    visual: 'bar',
    parameters: ['cycleId', 'from', 'to'],
    advancedSql: 'Conditional aggregation across derived current status and staff ownership.',
    fixtureAssertions: { cycleId: 2, minimumRows: 3 },
    sql: `
      SELECT s.name,
        COUNT(CASE WHEN cs.current_status NOT IN ('ACCEPTED', 'DECLINED', 'WITHDRAWN') THEN 1 END) AS open_cases,
        COUNT(CASE WHEN cs.current_status = 'REVIEW' THEN 1 END) AS in_review,
        COUNT(CASE WHEN cs.current_status = 'INTERVIEW' THEN 1 END) AS interviews,
        COUNT(CASE WHEN cs.current_status = 'WAITLISTED' THEN 1 END) AS waitlisted,
        ROUND(AVG(CASE WHEN cs.current_status NOT IN ('ACCEPTED', 'DECLINED', 'WITHDRAWN')
          THEN julianday('now') - julianday(a.last_updated) END), 1) AS avg_days_since_update
      FROM staff_users s
      LEFT JOIN applications a ON a.assigned_to = s.id AND ${cycleFilter} AND ${dateFilter}
      LEFT JOIN v_application_current_status cs ON cs.application_id = a.id
      WHERE s.active = 1 AND s.role IN ('ADMISSIONS', 'REVIEWER')
      GROUP BY s.id
      ORDER BY open_cases DESC, s.name
    `,
  },
  {
    id: 'document-compliance',
    title: 'Document compliance exceptions',
    description: 'Lists applications with required documents that are missing, pending or rejected.',
    purpose: 'Directs evidence follow-up before decisions are attempted.',
    category: 'Integrity',
    visual: 'table',
    parameters: ['cycleId', 'from', 'to'],
    advancedSql: 'Requirement-driven compliance view rather than fixed document counts.',
    fixtureAssertions: { cycleId: 2, minimumRows: 1 },
    sql: `
      SELECT a.application_no,
        ap.first_name || ' ' || ap.last_name AS applicant,
        cs.current_status AS status,
        dc.required_count, dc.missing_count, dc.pending_count, dc.rejected_count
      FROM applications a
      JOIN applicants ap ON ap.id = a.applicant_id
      JOIN v_application_current_status cs ON cs.application_id = a.id
      JOIN v_document_compliance dc ON dc.application_id = a.id
      WHERE dc.compliant = 0 AND cs.current_status NOT IN ('DECLINED', 'WITHDRAWN')
        AND ${cycleFilter} AND ${dateFilter}
      ORDER BY dc.missing_count DESC, dc.rejected_count DESC, a.last_updated
    `,
  },
  {
    id: 'nationality-mix',
    title: 'Applicant nationality mix',
    description: 'Summarises applicant diversity and share of the selected application pool.',
    purpose: 'Informs geographic outreach and cohort-diversity monitoring.',
    category: 'Planning',
    visual: 'donut',
    parameters: ['cycleId', 'from', 'to'],
    advancedSql: 'Filtered CTE and window total for percentage-of-cohort analysis.',
    fixtureAssertions: { cycleId: 2, totalApplications: 24 },
    sql: `
      WITH cohort AS (
        SELECT ap.nationality
        FROM applications a JOIN applicants ap ON ap.id = a.applicant_id
        WHERE ${cycleFilter} AND ${dateFilter}
      ), grouped AS (
        SELECT nationality, COUNT(*) AS applicants FROM cohort GROUP BY nationality
      )
      SELECT nationality, applicants,
        ROUND(100.0 * applicants / NULLIF(SUM(applicants) OVER (), 0), 1) AS share_pct
      FROM grouped
      ORDER BY applicants DESC, nationality
    `,
  },
  {
    id: 'academic-bands',
    title: 'Academic score bands',
    description: 'Groups first-choice academic scores into calibration bands.',
    purpose: 'Provides a quick quality distribution for the selected intake.',
    category: 'Performance',
    visual: 'bar',
    parameters: ['cycleId', 'from', 'to'],
    advancedSql: 'CASE banding and filtered multi-relation aggregation.',
    fixtureAssertions: { cycleId: 2, totalApplications: 24 },
    sql: `
      SELECT CASE
        WHEN ac.academic_score >= 90 THEN '90-100'
        WHEN ac.academic_score >= 85 THEN '85-89.9'
        WHEN ac.academic_score >= 80 THEN '80-84.9'
        ELSE 'Below 80' END AS score_band,
        COUNT(*) AS applicants
      FROM application_choices ac
      JOIN applications a ON a.id = ac.application_id
      WHERE ac.preference_rank = 1 AND ${cycleFilter} AND ${dateFilter}
      GROUP BY score_band
      ORDER BY MIN(ac.academic_score) DESC
    `,
  },
  {
    id: 'interview-performance',
    title: 'Interview performance',
    description: 'Compares academic and completed interview scores by annual programme offering.',
    purpose: 'Supports panel calibration and comparison of academic versus interview evidence.',
    category: 'Performance',
    visual: 'bar',
    parameters: ['cycleId', 'from', 'to'],
    advancedSql: 'Completed interview facts joined through choice, offering and cycle.',
    fixtureAssertions: { cycleId: 2, minimumRows: 1 },
    sql: `
      SELECT p.code, COUNT(*) AS interviewed,
        ROUND(AVG(ac.academic_score), 1) AS avg_academic_score,
        ROUND(AVG(i.score), 1) AS avg_interview_score
      FROM interview_sessions i
      JOIN application_choices ac ON ac.id = i.application_choice_id
      JOIN applications a ON a.id = ac.application_id
      JOIN programme_offerings po ON po.id = ac.programme_offering_id
      JOIN programmes p ON p.id = po.programme_id
      WHERE i.status = 'COMPLETED' AND ac.preference_rank = 1
        AND ${cycleFilter} AND ${dateFilter}
      GROUP BY po.id
      ORDER BY avg_interview_score DESC, p.code
    `,
  },
  {
    id: 'decision-turnaround',
    title: 'Decision turnaround time',
    description: 'Calculates days from submission to each current decision by programme.',
    purpose: 'Measures service speed and identifies slow decision areas.',
    category: 'Operations',
    visual: 'bar',
    parameters: ['cycleId', 'from', 'to'],
    advancedSql: 'Latest-decision view with elapsed-date aggregation.',
    fixtureAssertions: { cycleId: 2, minimumRows: 1 },
    sql: `
      SELECT p.code, COUNT(*) AS decisions,
        ROUND(AVG(julianday(d.decided_at) - julianday(a.submitted_at)), 1) AS avg_days,
        ROUND(MAX(julianday(d.decided_at) - julianday(a.submitted_at)), 1) AS longest_days
      FROM v_current_decisions d
      JOIN application_choices ac ON ac.id = d.application_choice_id
      JOIN applications a ON a.id = ac.application_id
      JOIN programme_offerings po ON po.id = ac.programme_offering_id
      JOIN programmes p ON p.id = po.programme_id
      WHERE ${cycleFilter} AND ${dateFilter}
      GROUP BY po.id
      ORDER BY avg_days DESC, p.code
    `,
  },
  {
    id: 'scholarship-allocation',
    title: 'Scholarship allocation and remaining places',
    description: 'Tracks nominations, awards, places remaining and committed funding.',
    purpose: 'Prevents over-allocation and supports award budget decisions.',
    category: 'Planning',
    visual: 'bar',
    parameters: ['cycleId', 'from', 'to'],
    advancedSql: 'Conditional aggregation across optional nominations and cycle filters.',
    fixtureAssertions: { cycleId: 2, minimumRows: 4 },
    sql: `
      SELECT s.code, s.name, s.places,
        COUNT(CASE WHEN a.id IS NOT NULL AND sa.status = 'NOMINATED' THEN 1 END) AS nominated,
        COUNT(CASE WHEN a.id IS NOT NULL AND sa.status = 'AWARDED' THEN 1 END) AS awarded,
        s.places - COUNT(CASE WHEN a.id IS NOT NULL AND sa.status = 'AWARDED' THEN 1 END) AS remaining_places,
        COALESCE(SUM(CASE WHEN a.id IS NOT NULL AND sa.status = 'AWARDED' THEN sa.awarded_amount_hkd ELSE 0 END), 0) AS committed_hkd
      FROM scholarships s
      LEFT JOIN scholarship_applications sa ON sa.scholarship_id = s.id
      LEFT JOIN applications a ON a.id = sa.application_id AND ${cycleFilter} AND ${dateFilter}
      GROUP BY s.id
      ORDER BY committed_hkd DESC, s.code
    `,
  },
  {
    id: 'high-potential',
    title: 'High-potential pending cases',
    description: 'Finds high-scoring applicants who have not reached an offer decision.',
    purpose: 'Gives reviewers an actionable priority list before deadlines.',
    category: 'Actions',
    visual: 'table',
    parameters: ['cycleId', 'from', 'to'],
    advancedSql: 'Current-state filtering with score threshold and reviewer ownership.',
    fixtureAssertions: { cycleId: 2, minimumRows: 1 },
    sql: `
      SELECT a.application_no,
        ap.first_name || ' ' || ap.last_name AS applicant,
        p.code AS first_choice,
        ac.academic_score,
        cs.current_status AS status,
        s.name AS reviewer
      FROM applications a
      JOIN applicants ap ON ap.id = a.applicant_id
      JOIN application_choices ac ON ac.application_id = a.id AND ac.preference_rank = 1
      JOIN programme_offerings po ON po.id = ac.programme_offering_id
      JOIN programmes p ON p.id = po.programme_id
      JOIN v_application_current_status cs ON cs.application_id = a.id
      LEFT JOIN staff_users s ON s.id = a.assigned_to
      WHERE ac.academic_score >= 88
        AND cs.current_status IN ('SUBMITTED', 'SCREENING', 'REVIEW', 'INTERVIEW', 'WAITLISTED')
        AND ${cycleFilter} AND ${dateFilter}
      ORDER BY ac.academic_score DESC, a.submitted_at
    `,
  },
  {
    id: 'monthly-submissions',
    title: 'Monthly submissions',
    description: 'Shows application volume across multiple calendar months.',
    purpose: 'Supports campaign timing and admissions staffing forecasts.',
    category: 'Planning',
    visual: 'line',
    parameters: ['cycleId', 'from', 'to'],
    advancedSql: 'Date-series aggregation across nullable submission dates.',
    fixtureAssertions: { cycleId: 2, minimumRows: 6, totalApplications: 23 },
    sql: `
      SELECT strftime('%Y-%m', a.submitted_at) AS month, COUNT(*) AS submissions
      FROM applications a
      WHERE a.submitted_at IS NOT NULL AND ${cycleFilter} AND ${dateFilter}
      GROUP BY month
      ORDER BY month
    `,
  },
  {
    id: 'intake-comparison',
    title: 'Intake comparison',
    description: 'Compares demand, offers, acceptances and yield with the preceding cycle.',
    purpose: 'Shows year-on-year movement for strategic planning.',
    category: 'Planning',
    visual: 'bar',
    parameters: ['cycleId'],
    advancedSql: 'Layered CTEs and LAG window functions for year-on-year comparison.',
    fixtureAssertions: { cycleId: 2, minimumRows: 1 },
    sql: `
      WITH cycle_metrics AS (
        SELECT c.id AS cycle_id, c.cycle_year,
          COUNT(DISTINCT a.id) AS demand,
          COUNT(DISTINCT CASE WHEN cs.current_status IN ('OFFERED', 'ACCEPTED') THEN a.id END) AS offers,
          COUNT(DISTINCT CASE WHEN cs.current_status = 'ACCEPTED' THEN a.id END) AS accepted
        FROM admission_cycles c
        LEFT JOIN applications a ON a.cycle_id = c.id
        LEFT JOIN v_application_current_status cs ON cs.application_id = a.id
        GROUP BY c.id
      ), compared AS (
        SELECT *,
          ROUND(100.0 * accepted / NULLIF(offers, 0), 1) AS yield_pct,
          LAG(demand) OVER (ORDER BY cycle_year) AS previous_demand,
          LAG(offers) OVER (ORDER BY cycle_year) AS previous_offers,
          LAG(accepted) OVER (ORDER BY cycle_year) AS previous_accepted
        FROM cycle_metrics
      )
      SELECT cycle_year, demand, offers, accepted, yield_pct,
        demand - previous_demand AS demand_change,
        offers - previous_offers AS offer_change,
        accepted - previous_accepted AS acceptance_change
      FROM compared
      WHERE (@cycleId IS NULL OR cycle_id = @cycleId)
      ORDER BY cycle_year
    `,
  },
  {
    id: 'interview-pipeline',
    title: 'Interview pipeline',
    description: 'Analyses scheduled, completed, cancelled and no-show interviews with average scores.',
    purpose: 'Supports panel scheduling and interview completion monitoring.',
    category: 'Operations',
    visual: 'bar',
    parameters: ['cycleId', 'from', 'to'],
    advancedSql: 'Conditional aggregation over interview event facts.',
    fixtureAssertions: { cycleId: 2, minimumRows: 6 },
    sql: `
      SELECT p.code,
        COUNT(CASE WHEN i.status = 'SCHEDULED' THEN 1 END) AS scheduled,
        COUNT(CASE WHEN i.status = 'COMPLETED' THEN 1 END) AS completed,
        COUNT(CASE WHEN i.status = 'CANCELLED' THEN 1 END) AS cancelled,
        COUNT(CASE WHEN i.status = 'NO_SHOW' THEN 1 END) AS no_show,
        ROUND(AVG(CASE WHEN i.status = 'COMPLETED' THEN i.score END), 1) AS avg_score
      FROM programme_offerings po
      JOIN programmes p ON p.id = po.programme_id
      LEFT JOIN application_choices ac ON ac.programme_offering_id = po.id
      LEFT JOIN applications a ON a.id = ac.application_id AND ${cycleFilter} AND ${dateFilter}
      LEFT JOIN interview_sessions i ON i.application_choice_id = ac.id
      WHERE (@cycleId IS NULL OR po.cycle_id = @cycleId)
      GROUP BY po.id
      ORDER BY completed DESC, p.code
    `,
  },
  {
    id: 'waitlist-pressure',
    title: 'Waitlist pressure',
    description: 'Compares active waitlist demand, ranking, capacity and conversions by offering.',
    purpose: 'Helps managers decide where waitlist-to-offer conversion is feasible.',
    category: 'Actions',
    visual: 'bar',
    parameters: ['cycleId'],
    advancedSql: 'ROW_NUMBER ranking view, conditional aggregation and capacity join.',
    fixtureAssertions: { cycleId: 2, minimumRows: 6 },
    sql: `
      SELECT pc.code, pc.capacity, pc.accepted_count, pc.remaining_places,
        COUNT(DISTINCT wr.waitlist_entry_id) AS active_waitlist,
        COUNT(DISTINCT CASE WHEN we.status = 'CONVERTED' THEN we.id END) AS converted,
        ROUND(MAX(wr.ranking_score), 1) AS top_waitlist_score,
        CASE WHEN pc.remaining_places > 0 AND COUNT(DISTINCT wr.waitlist_entry_id) > 0 THEN 'ACTION' ELSE 'MONITOR' END AS pressure_action
      FROM v_programme_capacity pc
      LEFT JOIN v_waitlist_ranking wr ON wr.programme_offering_id = pc.programme_offering_id
      LEFT JOIN application_choices ac ON ac.programme_offering_id = pc.programme_offering_id
      LEFT JOIN waitlist_entries we ON we.application_choice_id = ac.id
      WHERE (@cycleId IS NULL OR pc.cycle_id = @cycleId)
      GROUP BY pc.programme_offering_id
      ORDER BY active_waitlist DESC, pc.remaining_places, pc.code
    `,
  },
];

export function getReport(id) {
  return reports.find((report) => report.id === id);
}

export async function runReport(db, report, parameters) {
  return db.prepare(report.sql).all({
    cycleId: parameters.cycleId ?? null,
    from: parameters.from ?? null,
    to: parameters.to ?? null,
  });
}
