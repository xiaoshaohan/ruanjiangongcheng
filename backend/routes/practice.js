const express = require('express');
const pool = require('../config/db');
const { ok, fail, asyncHandler } = require('../utils/response');

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
  await pool.query(
    'INSERT INTO practice_activity (student_id, activity_name, type, start_date, end_date, hours, description) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [student_id, activity_name, type, start_date, end_date, hoursNum, description]
  );
  ok(res, null, '实践经历录入成功');
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