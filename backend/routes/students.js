const express = require('express');
const pool = require('../config/db');
const { ok, fail, asyncHandler } = require('../utils/response');

const router = express.Router();

// 添加学生
router.post('/', asyncHandler(async (req, res) => {
  const { student_id, name } = req.body;
  if (!student_id || !name) {
    return fail(res, 400, 400, '学号和姓名不能为空');
  }
  const { gender, college, major, grade } = req.body;
  await pool.query(
    'INSERT INTO student (student_id, name, gender, college, major, grade) VALUES (?, ?, ?, ?, ?, ?)',
    [student_id, name, gender, college, major, grade]
  );
  ok(res, null, '学生添加成功');
}));

// 查询学生列表
router.get('/', asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM student ORDER BY student_id');
  ok(res, rows);
}));

// 查询单个学生
router.get('/:id', asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM student WHERE student_id = ?', [req.params.id]);
  if (rows.length === 0) return fail(res, 404, 404, '学生不存在');
  ok(res, rows[0]);
}));

// 编辑学生
router.put('/:id', asyncHandler(async (req, res) => {
  const { name, gender, college, major, grade, phone, email } = req.body;
  await pool.query(
    'UPDATE student SET name=?, gender=?, college=?, major=?, grade=?, phone=?, email=? WHERE student_id=?',
    [name, gender, college, major, grade, phone, email, req.params.id]
  );
  ok(res, null, '学生信息更新成功');
}));

// 删除学生
router.delete('/:id', asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM student WHERE student_id = ?', [req.params.id]);
  ok(res, null, '学生删除成功');
}));

module.exports = router;