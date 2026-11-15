const express = require('express');
const pool = require('../config/db');
const { ok, fail, asyncHandler } = require('../utils/response');
const { canWriteStudent } = require('../utils/permission');

const router = express.Router();

// 录入实践经历
router.post('/', asyncHandler(async (req, res) => {
  const { student_id, activity_name } = req.body;
  if (!student_id || !activity_name) {
    return fail(res, 400, 400, '学号和活动名称不能为空');
  }
  const { type, start_date, end_date, hours, description } = req.body;
  const hoursNum = hours == null ? null : Number(hours);
  if (hoursNum != null && (!Number.isFinite(hoursNum) || hoursNum < 0)) {
    return fail(res, 400, 400, '时长必须是非负数字');
  }

  const [stu] = await pool.query('SELECT student_id FROM student WHERE student_id = ?', [student_id]);
  if (stu.length === 0) return fail(res, 400, 400, '学号不存在，请先添加该学生');

  const perm = await canWriteStudent(req.user, student_id);
  if (!perm.allowed) return fail(res, 403, 403, perm.reason);

  await pool.query(
    'INSERT INTO practice_activity (student_id, activity_name, type, start_date, end_date, hours, description) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [student_id, activity_name, type, start_date, end_date, hoursNum, description]
  );
  ok(res, null, '实践经历录入成功');
}));

// 修改单条实践经历
router.put('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return fail(res, 400, 400, '记录编号不合法');

  const { activity_name, type, start_date, end_date, hours, description } = req.body;
  if (!activity_name) return fail(res, 400, 400, '活动名称不能为空');

  const hoursNum = hours == null || hours === '' ? null : Number(hours);
  if (hoursNum != null && (!Number.isFinite(hoursNum) || hoursNum < 0)) {
    return fail(res, 400, 400, '时长必须是非负数字');
  }

  const [exists] = await pool.query('SELECT id, student_id FROM practice_activity WHERE id = ?', [id]);
  if (exists.length === 0) return fail(res, 404, 404, '实践记录不存在');

  const perm = await canWriteStudent(req.user, exists[0].student_id, { requireEditSwitch: true });
  if (!perm.allowed) return fail(res, 403, 403, perm.reason);

  await pool.query(
    'UPDATE practice_activity SET activity_name = ?, type = ?, start_date = ?, end_date = ?, hours = ?, description = ? WHERE id = ?',
    [activity_name, type || null, start_date || null, end_date || null, hoursNum, description || null, id]
  );
  ok(res, null, '实践经历已更新');
}));

// 删除单条实践经历
router.delete('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return fail(res, 400, 400, '记录编号不合法');

  const [rows] = await pool.query('SELECT id, student_id FROM practice_activity WHERE id = ?', [id]);
  if (rows.length === 0) return fail(res, 404, 404, '实践记录不存在');

  const perm = await canWriteStudent(req.user, rows[0].student_id, { requireEditSwitch: true });
  if (!perm.allowed) return fail(res, 403, 403, perm.reason);

  await pool.query('DELETE FROM practice_activity WHERE id = ?', [id]);
  ok(res, null, '实践记录已删除');
}));

// 查询某学生实践经历
router.get('/:studentId', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM practice_activity WHERE student_id = ? ORDER BY start_date DESC',
    [req.params.studentId]
  );
  ok(res, rows);
}));

module.exports = router;