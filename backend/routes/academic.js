const express = require('express');
const pool = require('../config/db');
const { ok, fail, asyncHandler } = require('../utils/response');
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

  const [stu] = await pool.query('SELECT student_id FROM student WHERE student_id = ?', [student_id]);
  if (stu.length === 0) return fail(res, 400, 400, '学号不存在，请先添加该学生');

  await pool.query(
    'INSERT INTO academic_record (student_id, course_name, credit, score, semester) VALUES (?, ?, ?, ?, ?)',
    [student_id, course_name, credit, score, semester || null]
  );
  ok(res, null, '成绩录入成功');
}));

// 修改单条成绩
router.put('/:id', validate({
  course_name: { required: true, label: '课程名', type: 'string', maxLength: 100 },
  credit: { required: true, label: '学分', type: 'number', min: 0.5, max: 20 },
  score: { required: true, label: '成绩', type: 'number', min: 0, max: 100 },
  semester: { label: '学期', type: 'string', maxLength: 50 },
}), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return fail(res, 400, 400, '记录编号不合法');

  const [exists] = await pool.query('SELECT id FROM academic_record WHERE id = ?', [id]);
  if (exists.length === 0) return fail(res, 404, 404, '成绩记录不存在');

  const { course_name, credit, score, semester } = req.body;
  await pool.query(
    'UPDATE academic_record SET course_name = ?, credit = ?, score = ?, semester = ? WHERE id = ?',
    [course_name, credit, score, semester || null, id]
  );
  ok(res, null, '成绩已更新');
}));

// 删除单条成绩
router.delete('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return fail(res, 400, 400, '记录编号不合法');

  const [result] = await pool.query('DELETE FROM academic_record WHERE id = ?', [id]);
  if (result.affectedRows === 0) return fail(res, 404, 404, '成绩记录不存在');
  ok(res, null, '成绩已删除');
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
