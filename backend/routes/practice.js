const express = require('express');
const pool = require('../config/db');
const { ok, fail, asyncHandler } = require('../utils/response');
const { canWriteStudent } = require('../utils/permission');
const { dateRangeProblem } = require('../utils/fields');
const { isRealDate } = require('../utils/validate');
const { recalculateQuietly } = require('../utils/recalc');

const router = express.Router();

// 实践记录的字段校验（R20：日期真实、起止顺序、时长范围、文本长度）
function validatePractice(body) {
  const errors = [];
  const activityName = String(body.activity_name || '').trim();
  if (!activityName) errors.push('活动名称不能为空');
  else if (activityName.length > 200) errors.push('活动名称不能超过200个字符');

  const type = body.type === undefined || body.type === '' ? null : String(body.type).trim();
  if (type && type.length > 50) errors.push('类型不能超过50个字符');

  const description = body.description === undefined || body.description === '' ? null : String(body.description).trim();
  if (description && description.length > 500) errors.push('描述不能超过500个字符');

  const startDate = body.start_date === undefined || body.start_date === '' ? null : String(body.start_date).trim();
  const endDate = body.end_date === undefined || body.end_date === '' ? null : String(body.end_date).trim();
  if (startDate && !isRealDate(startDate)) errors.push('开始日期必须是有效日期（YYYY-MM-DD）');
  if (endDate && !isRealDate(endDate)) errors.push('结束日期必须是有效日期（YYYY-MM-DD）');
  if (!errors.length) {
    const rangeError = dateRangeProblem(startDate, endDate);
    if (rangeError) errors.push(rangeError);
  }

  let hours = null;
  if (body.hours !== undefined && body.hours !== null && body.hours !== '') {
    const num = Number(body.hours);
    if (!Number.isFinite(num) || num < 0) errors.push('时长必须是非负数字');
    else if (num > 1000) errors.push('时长不能超过1000小时');
    else hours = Math.round(num * 10) / 10; // 保留一位小数，与数据库列精度一致
  }

  return { errors, values: { activityName, type, description, startDate, endDate, hours } };
}

// 录入实践经历
router.post('/', asyncHandler(async (req, res) => {
  const { student_id } = req.body;
  if (!student_id) return fail(res, 400, 400, '学号不能为空');

  const { errors, values } = validatePractice(req.body);
  if (errors.length > 0) return fail(res, 400, 400, errors.slice(0, 3).join('；'));

  const [stu] = await pool.query('SELECT student_id FROM student WHERE student_id = ?', [student_id]);
  if (stu.length === 0) return fail(res, 400, 400, '学号不存在，请先添加该学生');

  const perm = await canWriteStudent(req.user, student_id);
  if (!perm.allowed) return fail(res, 403, 403, perm.reason);

  await pool.query(
    'INSERT INTO practice_activity (student_id, activity_name, type, start_date, end_date, hours, description) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [student_id, values.activityName, values.type, values.startDate, values.endDate, values.hours, values.description]
  );

  const recalc = await recalculateQuietly(student_id);
  ok(res, { recalculated: !!recalc }, '实践经历录入成功');
}));

// 修改单条实践经历
router.put('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return fail(res, 400, 400, '记录编号不合法');

  const { errors, values } = validatePractice(req.body);
  if (errors.length > 0) return fail(res, 400, 400, errors.slice(0, 3).join('；'));

  const [exists] = await pool.query('SELECT id, student_id FROM practice_activity WHERE id = ?', [id]);
  if (exists.length === 0) return fail(res, 404, 404, '实践记录不存在');

  const perm = await canWriteStudent(req.user, exists[0].student_id, { requireEditSwitch: true });
  if (!perm.allowed) return fail(res, 403, 403, perm.reason);

  await pool.query(
    'UPDATE practice_activity SET activity_name = ?, type = ?, start_date = ?, end_date = ?, hours = ?, description = ? WHERE id = ?',
    [values.activityName, values.type, values.startDate, values.endDate, values.hours, values.description, id]
  );
  await recalculateQuietly(exists[0].student_id);
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
  await recalculateQuietly(rows[0].student_id);
  ok(res, null, '实践记录已删除');
}));

// 查询某学生实践经历（R35：学生不存在返回 404）
router.get('/:studentId', asyncHandler(async (req, res) => {
  const [stu] = await pool.query('SELECT student_id FROM student WHERE student_id = ?', [req.params.studentId]);
  if (stu.length === 0) return fail(res, 404, 404, '学生不存在');

  const [rows] = await pool.query(
    'SELECT * FROM practice_activity WHERE student_id = ? ORDER BY start_date DESC',
    [req.params.studentId]
  );
  ok(res, rows);
}));

module.exports = router;
