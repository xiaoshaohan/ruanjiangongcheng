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

// 查询某学生科研项目
router.get('/:studentId', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM research_project WHERE student_id = ? ORDER BY start_date DESC',
    [req.params.studentId]
  );
  ok(res, rows);
}));

module.exports = router;