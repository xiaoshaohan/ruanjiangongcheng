const express = require('express');
const pool = require('../config/db');
const { ok, fail, asyncHandler } = require('../utils/response');

const router = express.Router();

// 录入科研项目
router.post('/', asyncHandler(async (req, res) => {
  const { student_id, project_name } = req.body;
  if (!student_id || !project_name) {
    return fail(res, 400, 400, '学号和项目名不能为空');
  }
  const { role, level, start_date, end_date, result } = req.body;
  await pool.query(
    'INSERT INTO research_project (student_id, project_name, role, level, start_date, end_date, result) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [student_id, project_name, role, level, start_date, end_date, result || null]
  );
  ok(res, null, '科研项目录入成功');
}));

// 修改单条科研项目
router.put('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return fail(res, 400, 400, '记录编号不合法');

  const { project_name, role, level, start_date, end_date, result } = req.body;
  if (!project_name) return fail(res, 400, 400, '项目名不能为空');

  const [exists] = await pool.query('SELECT id FROM research_project WHERE id = ?', [id]);
  if (exists.length === 0) return fail(res, 404, 404, '科研项目不存在');

  await pool.query(
    'UPDATE research_project SET project_name = ?, role = ?, level = ?, start_date = ?, end_date = ?, result = ? WHERE id = ?',
    [project_name, role || null, level || null, start_date || null, end_date || null, result || null, id]
  );
  ok(res, null, '科研项目已更新');
}));

// 删除单条科研项目
router.delete('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return fail(res, 400, 400, '记录编号不合法');

  const [result] = await pool.query('DELETE FROM research_project WHERE id = ?', [id]);
  if (result.affectedRows === 0) return fail(res, 404, 404, '科研项目不存在');
  ok(res, null, '科研项目已删除');
}));

// 查询某学生科研项目
router.get('/:studentId', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM research_project WHERE student_id = ? ORDER BY start_date DESC',
    [req.params.studentId]
  );
  ok(res, rows);
}));

module.exports = router;