const express = require('express');
const pool = require('../config/db');
const { ok, fail, asyncHandler } = require('../utils/response');
const { toRates } = require('../utils/portrait');
const { getPortraitConfig } = require('../utils/portraitConfig');

const router = express.Router();

// 根据查询参数拼学生维度的过滤条件，字段统一加 s. 前缀
// R40：年级参数必须先校验为整数，否则 Number('abc') 会把 NaN 拼进 SQL 导致 500
function buildStudentConditions(query) {
  const conds = [];
  const params = [];
  if (query.college) {
    conds.push('s.college = ?');
    params.push(query.college);
  }
  if (query.major) {
    conds.push('s.major = ?');
    params.push(query.major);
  }
  if (query.grade !== undefined && query.grade !== '') {
    const grade = Number(query.grade);
    if (!Number.isInteger(grade)) return { error: '年级参数必须是整数' };
    conds.push('s.grade = ?');
    params.push(grade);
  }
  return { sql: conds.length ? ' AND ' + conds.join(' AND ') : '', params };
}

// 数据看板：支持按学院 / 专业 / 年级 / 学期筛选
router.get('/', asyncHandler(async (req, res) => {
  const { college, major, grade, semester } = req.query;

  // 学期参数长度对齐数据库列，超长直接拒绝，避免截断查询
  if (semester && String(semester).length > 20) {
    return fail(res, 400, 400, '学期参数不能超过20个字符');
  }

  const { sql: sCond, params: sParams, error: condError } = buildStudentConditions(req.query);
  if (condError) return fail(res, 400, 400, condError);

  const [[studentCount]] = await pool.query(
    'SELECT COUNT(*) AS total FROM student s WHERE 1=1' + sCond,
    sParams
  );
  const [[profileCount]] = await pool.query(
    'SELECT COUNT(*) AS total FROM ability_profile p JOIN student s ON p.student_id = s.student_id WHERE 1=1' + sCond,
    sParams
  );

  const [avgRows] = await pool.query(
    `SELECT
       ROUND(AVG(p.gpa), 2) AS avg_gpa,
       ROUND(AVG(p.academic_score), 2) AS avg_academic,
       ROUND(AVG(p.research_score), 2) AS avg_research,
       ROUND(AVG(p.practice_score), 2) AS avg_practice,
       ROUND(AVG(p.total_score), 2) AS avg_total
     FROM ability_profile p
     JOIN student s ON p.student_id = s.student_id
     WHERE 1=1` + sCond,
    sParams
  );

  const [distRows] = await pool.query(
    `SELECT
       SUM(CASE WHEN p.total_score < 20 THEN 1 ELSE 0 END) AS range_0_20,
       SUM(CASE WHEN p.total_score >= 20 AND p.total_score < 40 THEN 1 ELSE 0 END) AS range_20_40,
       SUM(CASE WHEN p.total_score >= 40 AND p.total_score < 60 THEN 1 ELSE 0 END) AS range_40_60,
       SUM(CASE WHEN p.total_score >= 60 AND p.total_score < 80 THEN 1 ELSE 0 END) AS range_60_80,
       SUM(CASE WHEN p.total_score >= 80 THEN 1 ELSE 0 END) AS range_80_100
     FROM ability_profile p
     JOIN student s ON p.student_id = s.student_id
     WHERE 1=1` + sCond,
    sParams
  );

  // 成绩记录数可按学期进一步过滤；科研/实践没有学期字段，只受学生维度影响
  const acParams = semester ? [...sParams, semester] : [...sParams];
  const [[acCount]] = await pool.query(
    'SELECT COUNT(*) AS total FROM academic_record r JOIN student s ON r.student_id = s.student_id WHERE 1=1' +
      sCond +
      (semester ? ' AND r.semester = ?' : ''),
    acParams
  );
  const [[rsCount]] = await pool.query(
    'SELECT COUNT(*) AS total FROM research_project r JOIN student s ON r.student_id = s.student_id WHERE 1=1' + sCond,
    sParams
  );
  const [[prCount]] = await pool.query(
    'SELECT COUNT(*) AS total FROM practice_activity r JOIN student s ON r.student_id = s.student_id WHERE 1=1' + sCond,
    sParams
  );

  const [topStudents] = await pool.query(
    `SELECT p.student_id, s.name, s.college, s.major, s.grade,
            p.total_score, p.academic_score, p.research_score, p.practice_score
     FROM ability_profile p
     JOIN student s ON p.student_id = s.student_id
     WHERE 1=1` + sCond + `
     ORDER BY p.total_score DESC
     LIMIT 5`,
    sParams
  );

  const avgAcademic = avgRows[0].avg_academic;
  const avgResearch = avgRows[0].avg_research;
  const avgPractice = avgRows[0].avg_practice;
  const limits = (await getPortraitConfig()).limits;

  ok(res, {
    filters: { college: college || '', major: major || '', grade: grade || '', semester: semester || '' },
    overview: {
      student_total: studentCount.total,
      profile_total: profileCount.total,
      academic_records: acCount.total,
      research_projects: rsCount.total,
      practice_activities: prCount.total,
    },
    averages: {
      ...avgRows[0],
      // 三个维度的平均得分率，与画像页、对比页同一口径；无数据时为 0
      avg_academic_rate: avgAcademic == null ? 0 : toRates({ academic_score: avgAcademic }, limits).academic,
      avg_research_rate: avgResearch == null ? 0 : toRates({ research_score: avgResearch }, limits).research,
      avg_practice_rate: avgPractice == null ? 0 : toRates({ practice_score: avgPractice }, limits).practice,
    },
    score_distribution: distRows[0],
    top_students: topStudents.map((s) => ({ ...s, rates: toRates(s, limits) })),
  });
}));

// 筛选项：学院 / 专业 / 年级 / 学期，供看板下拉使用
router.get('/options', asyncHandler(async (req, res) => {
  const [colleges] = await pool.query(
    "SELECT DISTINCT college FROM student WHERE college IS NOT NULL AND college <> '' ORDER BY college"
  );
  const [majors] = await pool.query(
    "SELECT DISTINCT major FROM student WHERE major IS NOT NULL AND major <> '' ORDER BY major"
  );
  const [grades] = await pool.query(
    'SELECT DISTINCT grade FROM student WHERE grade IS NOT NULL ORDER BY grade'
  );
  const [semesters] = await pool.query(
    "SELECT DISTINCT semester FROM academic_record WHERE semester IS NOT NULL AND semester <> '' ORDER BY semester"
  );

  ok(res, {
    colleges: colleges.map((r) => r.college),
    majors: majors.map((r) => r.major),
    grades: grades.map((r) => r.grade),
    semesters: semesters.map((r) => r.semester),
  });
}));

module.exports = router;
