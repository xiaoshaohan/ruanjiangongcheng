const express = require('express');
const pool = require('../config/db');
const { ok, fail, asyncHandler } = require('../utils/response');
const { validate } = require('../utils/validate');
const { canWriteStudent } = require('../utils/permission');
const { recalculateQuietly } = require('../utils/recalc');

const router = express.Router();

// 录入学业成绩
router.post('/', validate({
  student_id: { required: true, label: '学号', type: 'string', maxLength: 20 },
  course_name: { required: true, label: '课程名', type: 'string', maxLength: 100 },
  credit: { required: true, label: '学分', type: 'number', min: 0.5, max: 20 },
  score: { required: true, label: '成绩', type: 'number', min: 0, max: 100 },
  semester: { label: '学期', type: 'string', maxLength: 20 },
}), asyncHandler(async (req, res) => {
  const { student_id, course_name, credit, score, semester } = req.body;

  const [stu] = await pool.query('SELECT student_id FROM student WHERE student_id = ?', [student_id]);
  if (stu.length === 0) return fail(res, 400, 400, '学号不存在，请先添加该学生');

  // 录入权限：管理员不限，教师只能录自己负责专业的学生
  const perm = await canWriteStudent(req.user, student_id);
  if (!perm.allowed) return fail(res, 403, 403, perm.reason);

  // R16：同一课程同一学期不允许重复录入，需要覆盖时显式传 overwrite=true
  const [dup] = await pool.query(
    'SELECT id FROM academic_record WHERE student_id = ? AND course_name = ? AND semester <=> ?',
    [student_id, course_name, semester || null]
  );
  if (dup.length > 0) {
    if (!req.body.overwrite) {
      return fail(res, 409, 409, '该课程在该学期已存在成绩，如需覆盖请勾选“覆盖已有记录”后重试');
    }
    await pool.query(
      'UPDATE academic_record SET credit = ?, score = ? WHERE id = ?',
      [credit, score, dup[0].id]
    );
    await recalculateQuietly(student_id);
    return ok(res, { overwritten: true }, '已覆盖该课程原有成绩');
  }

  await pool.query(
    'INSERT INTO academic_record (student_id, course_name, credit, score, semester) VALUES (?, ?, ?, ?, ?)',
    [student_id, course_name, credit, score, semester || null]
  );

  // 录入后自动重算画像，看板不再停留在旧分数
  const recalc = await recalculateQuietly(student_id);
  ok(res, { recalculated: !!recalc }, '成绩录入成功');
}));

// 修改单条成绩
router.put('/:id', validate({
  course_name: { required: true, label: '课程名', type: 'string', maxLength: 100 },
  credit: { required: true, label: '学分', type: 'number', min: 0.5, max: 20 },
  score: { required: true, label: '成绩', type: 'number', min: 0, max: 100 },
  semester: { label: '学期', type: 'string', maxLength: 20 },
}), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return fail(res, 400, 400, '记录编号不合法');

  const [exists] = await pool.query('SELECT id, student_id FROM academic_record WHERE id = ?', [id]);
  if (exists.length === 0) return fail(res, 404, 404, '成绩记录不存在');

  // 修改权限：管理员总是可以；教师需管理员开放开关且属于自己负责专业
  const perm = await canWriteStudent(req.user, exists[0].student_id, { requireEditSwitch: true });
  if (!perm.allowed) return fail(res, 403, 403, perm.reason);

  const { course_name, credit, score, semester } = req.body;

  // 改动课程名或学期后不能与另一条记录撞车
  const [dup] = await pool.query(
    'SELECT id FROM academic_record WHERE student_id = ? AND course_name = ? AND semester <=> ? AND id <> ?',
    [exists[0].student_id, course_name, semester || null, id]
  );
  if (dup.length > 0) {
    return fail(res, 409, 409, '该课程在该学期已有另一条成绩记录');
  }

  await pool.query(
    'UPDATE academic_record SET course_name = ?, credit = ?, score = ?, semester = ? WHERE id = ?',
    [course_name, credit, score, semester || null, id]
  );
  await recalculateQuietly(exists[0].student_id);
  ok(res, null, '成绩已更新');
}));

// 删除单条成绩（与修改同权限：管理员，或已获授权的教师）
router.delete('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return fail(res, 400, 400, '记录编号不合法');

  const [rows] = await pool.query('SELECT id, student_id FROM academic_record WHERE id = ?', [id]);
  if (rows.length === 0) return fail(res, 404, 404, '成绩记录不存在');

  const perm = await canWriteStudent(req.user, rows[0].student_id, { requireEditSwitch: true });
  if (!perm.allowed) return fail(res, 403, 403, perm.reason);

  await pool.query('DELETE FROM academic_record WHERE id = ?', [id]);
  await recalculateQuietly(rows[0].student_id);
  ok(res, null, '成绩已删除');
}));

// 查询某学生成绩（R35：学生不存在时返回 404，与其它资源一致）
router.get('/:studentId', asyncHandler(async (req, res) => {
  const [stu] = await pool.query('SELECT student_id FROM student WHERE student_id = ?', [req.params.studentId]);
  if (stu.length === 0) return fail(res, 404, 404, '学生不存在');

  const [rows] = await pool.query(
    'SELECT * FROM academic_record WHERE student_id = ? ORDER BY semester, course_name',
    [req.params.studentId]
  );
  ok(res, rows);
}));

module.exports = router;
