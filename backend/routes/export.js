const express = require('express');
const pool = require('../config/db');
const { asyncHandler } = require('../utils/response');
const { toRates } = require('../utils/portrait');

const router = express.Router();

// CSV 转义：包含逗号、引号、换行时加引号并转义内部引号
function csvCell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function toCsv(headers, rows) {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(headers.map((_, i) => csvCell(row[i])).join(','));
  }
  return lines.join('\r\n');
}

// 导出学生列表
router.get('/students', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT student_id, name, gender, college, major, grade, phone, email FROM student ORDER BY student_id'
  );
  const csv = toCsv(
    ['学号', '姓名', '性别', '学院', '专业', '年级', '电话', '邮箱'],
    rows.map(r => [r.student_id, r.name, r.gender === 'M' ? '男' : '女', r.college, r.major, r.grade, r.phone, r.email])
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="students.csv"');
  // 加 BOM 让 Excel 正确识别 UTF-8
  res.send('\uFEFF' + csv);
}));

// 导出画像报告
router.get('/portraits', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.student_id, s.name, s.college, s.major, p.gpa,
            p.academic_score, p.research_score, p.practice_score, p.total_score
     FROM ability_profile p
     JOIN student s ON p.student_id = s.student_id
     ORDER BY p.total_score DESC`
  );
  const csv = toCsv(
    ['学号', '姓名', '学院', '专业', 'GPA', '学业分', '科研分', '实践分', '学业得分率%', '科研得分率%', '实践得分率%', '综合总分'],
    rows.map(r => {
      const rt = toRates(r);
      return [
        r.student_id, r.name, r.college, r.major, r.gpa,
        r.academic_score, r.research_score, r.practice_score,
        rt.academic, rt.research, rt.practice,
        r.total_score,
      ];
    })
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="portraits.csv"');
  res.send('\uFEFF' + csv);
}));

module.exports = router;
