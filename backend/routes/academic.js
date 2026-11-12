const express = require('express');
const pool = require('../config/db');
const { ok, fail, asyncHandler } = require('../utils/response');

const router = express.Router();

// 录入学业成绩
router.post('/', asyncHandler(async (req, res) => {
  const { student_id, course_name, credit, score, semester } = req.body;
  if (!student_id || !course_name) {
    return fail(res, 400, 400, '学号和课程名不能为空');
  }
  const scoreNum = Number(score);
  const creditNum = Number(credit);
  if (!Number.isFinite(scoreNum) || scoreNum < 0 || scoreNum > 100) {
    return fail(res, 400, 400, '成绩必须是 0-100 之间的数字');
  }
  if (!Number.isFinite(creditNum) || creditNum <= 0) {
    return fail(res, 400, 400, '学分必须是大于 0 的数字');
  }
  await pool.query(
    'INSERT INTO academic_record (student_id, course_name, credit, score, semester) VALUES (?, ?, ?, ?, ?)',
    [student_id, course_name, creditNum, scoreNum, semester]
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