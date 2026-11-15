const express = require('express');
const pool = require('../config/db');
const { ok, fail, asyncHandler } = require('../utils/response');
const { adminOnly } = require('../utils/auth');
const { canWriteStudent } = require('../utils/permission');

const router = express.Router();

// 添加学生
router.post('/', asyncHandler(async (req, res) => {
  const { student_id, name } = req.body;
  if (!student_id || !name) {
    return fail(res, 400, 400, '学号和姓名不能为空');
  }
  const { gender, college, major, grade } = req.body;

  // 先查重，给出"学号已存在"而不是让主键冲突冒成 500
  const [exists] = await pool.query('SELECT student_id FROM student WHERE student_id = ?', [student_id]);
  if (exists.length > 0) return fail(res, 400, 400, '学号已存在，请勿重复添加');

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

// 编辑学生（管理员不限；教师只能改自己负责专业的学生）
router.put('/:id', asyncHandler(async (req, res) => {
  const { name, gender, college, major, grade, phone, email } = req.body;
  if (!name) return fail(res, 400, 400, '姓名不能为空');

  const [exists] = await pool.query('SELECT student_id FROM student WHERE student_id = ?', [req.params.id]);
  if (exists.length === 0) return fail(res, 404, 404, '学生不存在');

  const perm = await canWriteStudent(req.user, req.params.id);
  if (!perm.allowed) return fail(res, 403, 403, perm.reason);

  await pool.query(
    'UPDATE student SET name=?, gender=?, college=?, major=?, grade=?, phone=?, email=? WHERE student_id=?',
    [name, gender, college, major, grade, phone, email, req.params.id]
  );
  ok(res, null, '学生信息更新成功');
}));

// 删除学生（事务级联清理成绩/科研/实践/画像，避免孤儿数据）
router.delete('/:id', adminOnly, asyncHandler(async (req, res) => {
  const sid = req.params.id;

  const [exists] = await pool.query('SELECT student_id FROM student WHERE student_id = ?', [sid]);
  if (exists.length === 0) return fail(res, 404, 404, '学生不存在');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM academic_record WHERE student_id = ?', [sid]);
    await conn.query('DELETE FROM research_project WHERE student_id = ?', [sid]);
    await conn.query('DELETE FROM practice_activity WHERE student_id = ?', [sid]);
    await conn.query('DELETE FROM ability_profile WHERE student_id = ?', [sid]);
    await conn.query('DELETE FROM student WHERE student_id = ?', [sid]);
    await conn.commit();
    ok(res, null, '学生及其关联数据删除成功');
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

module.exports = router;