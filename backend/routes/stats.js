const express = require('express');
const pool = require('../config/db');
const { ok, asyncHandler } = require('../utils/response');

const router = express.Router();

// 全局统计数据（数据看板）
router.get('/', asyncHandler(async (req, res) => {
  const [[studentCount]] = await pool.query('SELECT COUNT(*) AS total FROM student');
  const [[profileCount]] = await pool.query('SELECT COUNT(*) AS total FROM ability_profile');

  const [avgRows] = await pool.query(
    `SELECT
       ROUND(AVG(gpa), 2) AS avg_gpa,
       ROUND(AVG(academic_score), 2) AS avg_academic,
       ROUND(AVG(research_score), 2) AS avg_research,
       ROUND(AVG(practice_score), 2) AS avg_practice,
       ROUND(AVG(total_score), 2) AS avg_total
     FROM ability_profile`
  );

  const [distRows] = await pool.query(
    `SELECT
       SUM(CASE WHEN total_score < 5 THEN 1 ELSE 0 END) AS range_0_5,
       SUM(CASE WHEN total_score >= 5 AND total_score < 10 THEN 1 ELSE 0 END) AS range_5_10,
       SUM(CASE WHEN total_score >= 10 AND total_score < 15 THEN 1 ELSE 0 END) AS range_10_15,
       SUM(CASE WHEN total_score >= 15 THEN 1 ELSE 0 END) AS range_15_plus
     FROM ability_profile`
  );

  const [[acCount]] = await pool.query('SELECT COUNT(*) AS total FROM academic_record');
  const [[rsCount]] = await pool.query('SELECT COUNT(*) AS total FROM research_project');
  const [[prCount]] = await pool.query('SELECT COUNT(*) AS total FROM practice_activity');

  const [topStudents] = await pool.query(
    `SELECT p.student_id, s.name, p.total_score, p.academic_score, p.research_score, p.practice_score
     FROM ability_profile p
     JOIN student s ON p.student_id = s.student_id
     ORDER BY p.total_score DESC
     LIMIT 5`
  );

  ok(res, {
    overview: {
      student_total: studentCount.total,
      profile_total: profileCount.total,
      academic_records: acCount.total,
      research_projects: rsCount.total,
      practice_activities: prCount.total,
    },
    averages: avgRows[0],
    score_distribution: distRows[0],
    top_students: topStudents,
  });
}));

module.exports = router;
