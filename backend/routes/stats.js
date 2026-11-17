const express = require('express');
const pool = require('../config/db');
const { ok, fail, asyncHandler } = require('../utils/response');
const { toRates, limitsFromSnapshot } = require('../utils/portrait');
const { getPortraitConfig, configVersion } = require('../utils/portraitConfig');

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
            p.total_score, p.academic_score, p.research_score, p.practice_score,
            p.config_snapshot, p.config_version
     FROM ability_profile p
     JOIN student s ON p.student_id = s.student_id
     WHERE 1=1` + sCond + `
     ORDER BY p.total_score DESC
     LIMIT 5`,
    sParams
  );

  // S4：平均得分率不再用"当前配置"套画像分数，而是逐条按画像快照换算后求平均，
  // 和画像页、导出、对比页保持同一口径（配置改了但没重算时也不会出现两个答案）。
  const [rateRows] = await pool.query(
    `SELECT p.academic_score, p.research_score, p.practice_score,
            p.config_snapshot, p.config_version
     FROM ability_profile p
     JOIN student s ON p.student_id = s.student_id
     WHERE 1=1` + sCond,
    sParams
  );
  const config = await getPortraitConfig();
  const currentVersion = configVersion(config);
  const round2 = (x) => Math.round((Number(x) || 0) * 100) / 100;

  let sumAcademicRate = 0;
  let sumResearchRate = 0;
  let sumPracticeRate = 0;
  let mixedSnapshot = false;
  for (const row of rateRows) {
    const limits = limitsFromSnapshot(row.config_snapshot, config.limits);
    const rt = toRates(row, limits);
    sumAcademicRate += rt.academic;
    sumResearchRate += rt.research;
    sumPracticeRate += rt.practice;
    if (row.config_version && row.config_version !== currentVersion) mixedSnapshot = true;
  }
  const rateCount = rateRows.length;

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
      // 三个维度的平均得分率，与画像页、对比页、导出一致，按各画像配置快照换算
      avg_academic_rate: rateCount ? round2(sumAcademicRate / rateCount) : 0,
      avg_research_rate: rateCount ? round2(sumResearchRate / rateCount) : 0,
      avg_practice_rate: rateCount ? round2(sumPracticeRate / rateCount) : 0,
    },
    // 口径标注：rates 一律来自画像快照，current_config_version 为当前生效配置
    rate_basis: {
      basis: 'portrait_config_snapshot',
      current_config_version: currentVersion,
      mixed_snapshot: mixedSnapshot,
    },
    score_distribution: distRows[0],
    top_students: topStudents.map((s) => {
      const { config_snapshot: snapshot, ...rest } = s;
      return { ...rest, rates: toRates(s, limitsFromSnapshot(snapshot, config.limits)) };
    }),
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
