const express = require('express');
const pool = require('../config/db');
const { ok, fail, asyncHandler } = require('../utils/response');
const { canWriteStudent } = require('../utils/permission');
const { dateRangeProblem } = require('../utils/fields');
const { isRealDate } = require('../utils/validate');
const { recalculateQuietly } = require('../utils/recalc');
const { RESEARCH_LEVELS } = require('../utils/enums');

const router = express.Router();

// 科研记录的字段校验（R20：日期必须真实、起止顺序合法、文本长度对齐数据库列）
function validateResearch(body) {
  const errors = [];
  const projectName = String(body.project_name || '').trim();
  if (!projectName) errors.push('项目名不能为空');
  else if (projectName.length > 200) errors.push('项目名不能超过200个字符');

  const role = body.role === undefined || body.role === '' ? null : String(body.role).trim();
  if (role && role.length > 50) errors.push('角色不能超过50个字符');

  const level = body.level === undefined || body.level === '' ? null : String(body.level).trim();
  if (level && level.length > 50) errors.push('级别不能超过50个字符');
  // G4：未知级别不允许静默入库，否则画像把它按 0 分处理
  else if (level && !RESEARCH_LEVELS.includes(level)) {
    errors.push(`科研级别只能是 ${RESEARCH_LEVELS.join(' / ')}`);
  }

  const result = body.result === undefined || body.result === '' ? null : String(body.result).trim();
  if (result && result.length > 200) errors.push('成果不能超过200个字符');

  const startDate = body.start_date === undefined || body.start_date === '' ? null : String(body.start_date).trim();
  const endDate = body.end_date === undefined || body.end_date === '' ? null : String(body.end_date).trim();
  if (startDate && !isRealDate(startDate)) errors.push('开始日期必须是有效日期（YYYY-MM-DD）');
  if (endDate && !isRealDate(endDate)) errors.push('结束日期必须是有效日期（YYYY-MM-DD）');
  if (!errors.length) {
    const rangeError = dateRangeProblem(startDate, endDate);
    if (rangeError) errors.push(rangeError);
  }

  return { errors, values: { projectName, role, level, result, startDate, endDate } };
}

// 录入科研项目
router.post('/', asyncHandler(async (req, res) => {
  const { student_id } = req.body;
  if (!student_id) return fail(res, 400, 400, '学号不能为空');

  const { errors, values } = validateResearch(req.body);
  if (errors.length > 0) return fail(res, 400, 400, errors.slice(0, 3).join('；'));

  const [stu] = await pool.query('SELECT student_id FROM student WHERE student_id = ?', [student_id]);
  if (stu.length === 0) return fail(res, 400, 400, '学号不存在，请先添加该学生');

  const perm = await canWriteStudent(req.user, student_id);
  if (!perm.allowed) return fail(res, 403, 403, perm.reason);

  await pool.query(
    'INSERT INTO research_project (student_id, project_name, role, level, start_date, end_date, result) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [student_id, values.projectName, values.role, values.level, values.startDate, values.endDate, values.result]
  );

  const recalc = await recalculateQuietly(student_id);
  ok(res, { recalculated: !!recalc }, '科研项目录入成功');
}));

// 修改单条科研项目
router.put('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return fail(res, 400, 400, '记录编号不合法');

  const { errors, values } = validateResearch(req.body);
  if (errors.length > 0) return fail(res, 400, 400, errors.slice(0, 3).join('；'));

  const [exists] = await pool.query('SELECT id, student_id FROM research_project WHERE id = ?', [id]);
  if (exists.length === 0) return fail(res, 404, 404, '科研项目不存在');

  const perm = await canWriteStudent(req.user, exists[0].student_id, { requireEditSwitch: true });
  if (!perm.allowed) return fail(res, 403, 403, perm.reason);

  await pool.query(
    'UPDATE research_project SET project_name = ?, role = ?, level = ?, start_date = ?, end_date = ?, result = ? WHERE id = ?',
    [values.projectName, values.role, values.level, values.startDate, values.endDate, values.result, id]
  );
  await recalculateQuietly(exists[0].student_id);
  ok(res, null, '科研项目已更新');
}));

// 删除单条科研项目
router.delete('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return fail(res, 400, 400, '记录编号不合法');

  const [rows] = await pool.query('SELECT id, student_id FROM research_project WHERE id = ?', [id]);
  if (rows.length === 0) return fail(res, 404, 404, '科研项目不存在');

  const perm = await canWriteStudent(req.user, rows[0].student_id, { requireEditSwitch: true });
  if (!perm.allowed) return fail(res, 403, 403, perm.reason);

  await pool.query('DELETE FROM research_project WHERE id = ?', [id]);
  await recalculateQuietly(rows[0].student_id);
  ok(res, null, '科研项目已删除');
}));

// 查询某学生科研项目（R35：学生不存在返回 404）
router.get('/:studentId', asyncHandler(async (req, res) => {
  const [stu] = await pool.query('SELECT student_id FROM student WHERE student_id = ?', [req.params.studentId]);
  if (stu.length === 0) return fail(res, 404, 404, '学生不存在');

  const [rows] = await pool.query(
    'SELECT * FROM research_project WHERE student_id = ? ORDER BY start_date DESC',
    [req.params.studentId]
  );
  ok(res, rows);
}));

module.exports = router;
