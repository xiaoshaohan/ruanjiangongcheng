const express = require('express');
const pool = require('../config/db');
const { asyncHandler, fail } = require('../utils/response');
const { toRates, limitsFromSnapshot } = require('../utils/portrait');
const { getPortraitConfig, configVersion } = require('../utils/portraitConfig');
const { csvCell, genderLabel, maskContact } = require('../utils/fields');
const { teacherMajors } = require('../utils/permission');

const router = express.Router();

function toCsv(headers, rows) {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(headers.map((_, i) => csvCell(row[i])).join(','));
  }
  return lines.join('\r\n');
}

// 与列表一致的筛选条件（R11）
function buildConditions(query, alias = 's') {
  const conds = [];
  const params = [];

  if (query.search && String(query.search).trim()) {
    const kw = `%${String(query.search).trim()}%`;
    conds.push(`(${alias}.student_id LIKE ? OR ${alias}.name LIKE ?)`);
    params.push(kw, kw);
  }
  if (query.college) { conds.push(`${alias}.college = ?`); params.push(query.college); }
  if (query.major) { conds.push(`${alias}.major = ?`); params.push(query.major); }
  if (query.grade !== undefined && query.grade !== '') {
    const g = Number(query.grade);
    // G3：非法年级直接报错，不能静默忽略后返回全量数据
    if (!Number.isInteger(g)) return { error: '年级参数必须是整数' };
    conds.push(`${alias}.grade = ?`);
    params.push(g);
  }

  return { sql: conds.length ? ' AND ' + conds.join(' AND ') : '', params };
}

// 教师导出只覆盖自己负责的专业（R19）
async function teacherScope(user) {
  if (user.role === 'admin') return null;
  return teacherMajors(user.teacher_no);
}

function sendCsv(res, filename, csv) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  // 加 BOM 让 Excel 正确识别 UTF-8
  res.send('\uFEFF' + csv);
}

// 导出学生列表：按当前筛选条件导出，教师仅本专业且联系方式脱敏
router.get('/students', asyncHandler(async (req, res) => {
  const { sql: cond, params, error } = buildConditions(req.query);
  if (error) return fail(res, 400, 400, error);
  const majors = await teacherScope(req.user);

  let where = ' WHERE 1=1' + cond;
  const queryParams = [...params];
  if (majors !== null) {
    if (majors.length === 0) {
      // 教师未设置负责专业时导出空表，避免越权拿到全量数据
      return sendCsv(res, 'students.csv', toCsv(['学号', '姓名', '性别', '学院', '专业', '年级', '电话', '邮箱'], []));
    }
    where += ' AND s.major IN (?)';
    queryParams.push(majors);
  }

  const [rows] = await pool.query(
    `SELECT s.student_id, s.name, s.gender, s.college, s.major, s.grade, s.phone, s.email
     FROM student s${where}
     ORDER BY s.student_id`,
    queryParams
  );

  const masked = majors !== null;
  const csv = toCsv(
    ['学号', '姓名', '性别', '学院', '专业', '年级', '电话', '邮箱'],
    rows.map((r) => [
      r.student_id, r.name, genderLabel(r.gender), r.college, r.major, r.grade,
      masked ? maskContact(r.phone, 'phone') : r.phone,
      masked ? maskContact(r.email, 'email') : r.email,
    ])
  );
  sendCsv(res, 'students.csv', csv);
}));

// 导出画像报告：使用当前配置换算得分率，并注明配置版本（R12）
router.get('/portraits', asyncHandler(async (req, res) => {
  const { sql: cond, params, error } = buildConditions(req.query);
  if (error) return fail(res, 400, 400, error);
  const majors = await teacherScope(req.user);

  let where = ' WHERE 1=1' + cond;
  const queryParams = [...params];
  if (majors !== null) {
    if (majors.length === 0) {
      return sendCsv(res, 'portraits.csv', toCsv(['学号', '姓名', '学院', '专业', 'GPA', '综合总分'], []));
    }
    where += ' AND s.major IN (?)';
    queryParams.push(majors);
  }

  const config = await getPortraitConfig({ force: true });
  const version = configVersion(config);

  const [rows] = await pool.query(
    `SELECT p.student_id, s.name, s.college, s.major, p.gpa,
            p.academic_score, p.research_score, p.practice_score, p.total_score,
            p.config_version, p.config_snapshot
     FROM ability_profile p
     JOIN student s ON p.student_id = s.student_id${where}
     ORDER BY p.total_score DESC`,
    queryParams
  );

  const csv = toCsv(
    [
      '学号', '姓名', '学院', '专业', 'GPA', '学业分', '科研分', '实践分',
      '学业得分率%', '科研得分率%', '实践得分率%', '综合总分',
      '学业标准分', '科研标准分', '实践标准分', '配置版本', '画像配置版本',
    ],
    rows.map((r) => {
      // R52：每行按自己的配置快照换算得分率与标准分，历史画像不会被新配置改写
      const limits = limitsFromSnapshot(r.config_snapshot, config.limits);
      const rt = toRates(r, limits);
      return [
        r.student_id, r.name, r.college, r.major, r.gpa,
        r.academic_score, r.research_score, r.practice_score,
        rt.academic, rt.research, rt.practice,
        r.total_score,
        limits.academicScore, limits.researchScore, limits.practiceScore,
        version, r.config_version || '',
      ];
    })
  );
  sendCsv(res, 'portraits.csv', csv);
}));

module.exports = router;
