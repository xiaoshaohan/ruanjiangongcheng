const express = require('express');
const pool = require('../config/db');
const { ok, fail, asyncHandler } = require('../utils/response');
const { computePortrait } = require('../utils/portrait');

const router = express.Router();

// 计算学生画像
router.post('/calculate/:studentId', asyncHandler(async (req, res) => {
  const studentId = req.params.studentId;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // 校验学生存在，避免外键报错
    const [studentRows] = await conn.query(
      'SELECT student_id FROM student WHERE student_id = ?',
      [studentId]
    );
    if (studentRows.length === 0) {
      await conn.rollback();
      return fail(res, 404, 404, '学生不存在，无法计算画像');
    }

    const portrait = await computePortrait(studentId, conn);

    await conn.query(
      `INSERT INTO ability_profile
         (student_id, gpa, academic_score, research_score, practice_score, total_score)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         gpa = VALUES(gpa),
         academic_score = VALUES(academic_score),
         research_score = VALUES(research_score),
         practice_score = VALUES(practice_score),
         total_score = VALUES(total_score)`,
      [
        studentId, portrait.gpa, portrait.academic_score,
        portrait.research_score, portrait.practice_score, portrait.total_score,
      ]
    );

    await conn.commit();
    ok(res, { student_id: studentId, ...portrait }, '画像计算完成');
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

// 查询学生画像
router.get('/:studentId', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.*, s.name, s.college, s.major
     FROM ability_profile p
     JOIN student s ON p.student_id = s.student_id
     WHERE p.student_id = ?`,
    [req.params.studentId]
  );
  if (rows.length === 0) return fail(res, 404, 404, '画像不存在，请先计算');
  ok(res, rows[0]);
}));

module.exports = router;