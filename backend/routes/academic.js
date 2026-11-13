const express = require('express');
const pool = require('../config/db');
const { ok, asyncHandler } = require('../utils/response');
const { validate } = require('../utils/validate');

const router = express.Router();

// 录入学业成绩
router.post('/', validate({
  student_id: { required: true, label: '学号', type: 'string' },
  course_name: { required: true, label: '课程名', type: 'string', maxLength: 100 },
  credit: { required: true, label: '学分', type: 'number', min: 0.5, max: 20 },
  score: { required: true, label: '成绩', type: 'number', min: 0, max: 100 },
  semester: { label: '学期', type: 'string', maxLength: 50 },
}), asyncHandler(async (req, res) => {
  const { student_id, course_name, credit, score, semester } = req.body;
  await pool.query(
    'INSERT INTO academic_record (student_id, course_name, credit, score, semester) VALUES (?, ?, ?, ?, ?)',
    [student_id, course_name, credit, score, semester || null]
  );
  ok(res, null, '成绩录入成功');
}));

// 查询某学生成绩
router.get('/:studentId', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM academic_record WHERE student_id = ? ORDER BY semester, course_name',
    [req.params.studentId]
  );
  ok(res, rows);
}));

module.exports = router;
