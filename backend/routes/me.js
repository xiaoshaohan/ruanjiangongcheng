// 学生个人视图：学生账号登录后只能看到自己的信息、画像和推荐
const express = require('express');
const pool = require('../config/db');
const { ok, fail, asyncHandler } = require('../utils/response');
const { authRequired } = require('../utils/auth');
const { computeCareerRecommendation, toRates } = require('../utils/portrait');
const { getPortraitConfig } = require('../utils/portraitConfig');

const router = express.Router();

// 当前学生自己的画像与推荐
router.get('/profile', authRequired, asyncHandler(async (req, res) => {
  if (req.user.role !== 'student') {
    return fail(res, 403, 403, '该页面仅供学生账号使用');
  }
  if (!req.user.student_id) {
    return fail(res, 400, 400, '当前账号还没有绑定学号，请联系管理员在“用户管理”里绑定');
  }

  const studentId = req.user.student_id;

  const [students] = await pool.query(
    'SELECT student_id, name, gender, college, major, grade, enrollment_year, phone, email FROM student WHERE student_id = ?',
    [studentId]
  );
  if (students.length === 0) return fail(res, 404, 404, '学生信息不存在，请联系管理员');

  const [profiles] = await pool.query(
    'SELECT gpa, academic_score, research_score, practice_score, total_score, update_time FROM ability_profile WHERE student_id = ?',
    [studentId]
  );

  const student = students[0];
  if (profiles.length === 0) {
    return ok(res, { student, portrait: null, rates: null, career: [], career_batch_at: null }, '尚未生成画像');
  }

  const portrait = profiles[0];

  // 推荐优先用最近一次落库的记录，没有历史时按当前画像实时算
  let career = [];
  let careerBatchAt = null;
  const [batches] = await pool.query(
    'SELECT batch_at FROM career_recommendation WHERE student_id = ? ORDER BY batch_at DESC LIMIT 1',
    [studentId]
  );
  if (batches.length > 0) {
    careerBatchAt = batches[0].batch_at;
    const [items] = await pool.query(
      `SELECT direction, score, reason FROM career_recommendation
       WHERE student_id = ? AND batch_at = ?
       ORDER BY score DESC`,
      [studentId, careerBatchAt]
    );
    career = items;
  } else {
    career = computeCareerRecommendation(portrait);
  }

  ok(res, {
    student,
    portrait,
    rates: toRates(portrait, (await getPortraitConfig()).limits),
    career,
    career_batch_at: careerBatchAt,
  });
}));

// 当前学生自己的明细记录（成绩 / 科研 / 实践），只读
router.get('/records', authRequired, asyncHandler(async (req, res) => {
  if (req.user.role !== 'student') return fail(res, 403, 403, '该页面仅供学生账号使用');
  if (!req.user.student_id) return fail(res, 400, 400, '当前账号还没有绑定学号');

  const sid = req.user.student_id;
  const [[academic], [research], [practice]] = await Promise.all([
    pool.query('SELECT course_name, credit, score, semester FROM academic_record WHERE student_id = ? ORDER BY semester, course_name', [sid]),
    pool.query('SELECT project_name, role, level, start_date, end_date, result FROM research_project WHERE student_id = ? ORDER BY start_date DESC', [sid]),
    pool.query('SELECT activity_name, type, start_date, end_date, hours, description FROM practice_activity WHERE student_id = ? ORDER BY start_date DESC', [sid]),
  ]);

  ok(res, { academic, research, practice });
}));

module.exports = router;
