// 学生个人视图：学生账号登录后只能看到自己的信息、画像和推荐
const express = require('express');
const pool = require('../config/db');
const { ok, fail, asyncHandler } = require('../utils/response');
const { authRequired } = require('../utils/auth');
const { computeCareerRecommendation, toRates, limitsFromSnapshot } = require('../utils/portrait');
const { getPortraitConfig, configVersion } = require('../utils/portraitConfig');
const { normalizeGender, genderLabel } = require('../utils/fields');

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

  const config = await getPortraitConfig();
  const version = configVersion(config);

  const [profiles] = await pool.query(
    `SELECT gpa, academic_score, research_score, practice_score, total_score,
            config_version, config_snapshot, calculated_at, update_time
     FROM ability_profile WHERE student_id = ?`,
    [studentId]
  );

  const student = {
    ...students[0],
    // R13：统一用 M/F 存储，展示层显式映射，未知值不再默认成"女"
    gender_label: genderLabel(students[0].gender),
  };

  if (profiles.length === 0) {
    return ok(res, {
      student,
      portrait: null,
      rates: null,
      limits: config.limits,
      config_version: version,
      career: [],
      career_batch_at: null,
    }, '尚未生成画像');
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
    career = computeCareerRecommendation(portrait, config.limits);
  }

  ok(res, {
    student,
    portrait,
    // R52：按画像保存时的标准分换算，避免旧分数套新分母
    rates: toRates(portrait, limitsFromSnapshot(portrait.config_snapshot, config.limits)),
    limits: limitsFromSnapshot(portrait.config_snapshot, config.limits),
    current_limits: config.limits,
    config_version: version,
    stale: !portrait.config_version || portrait.config_version !== version,
    career,
    career_batch_at: careerBatchAt,
  });
}));

// 学生修改自己的基本资料（仅姓名、性别；成绩/科研/实践保持只读）
// G1：按 PATCH 语义只更新请求体里出现的字段，只改姓名时不再把性别清空
router.put('/profile', authRequired, asyncHandler(async (req, res) => {
  if (req.user.role !== 'student') return fail(res, 403, 403, '该操作仅供学生账号使用');
  if (!req.user.student_id) return fail(res, 400, 400, '当前账号还没有绑定学号');

  const body = req.body || {};
  const updates = {};

  if (body.name !== undefined) {
    const nameStr = String(body.name || '').trim();
    if (!nameStr) return fail(res, 400, 400, '姓名不能为空');
    if (nameStr.length > 50) return fail(res, 400, 400, '姓名不能超过50个字符');
    updates.name = nameStr;
  }

  if (body.gender !== undefined) {
    // R13：允许提交中文，但统一存 M/F；非法值直接拒绝
    const normalized = normalizeGender(body.gender);
    if (normalized === 'INVALID') return fail(res, 400, 400, '性别只能是 男 / 女 或 M / F');
    updates.gender = normalized;
  }

  if (Object.keys(updates).length === 0) return fail(res, 400, 400, '没有需要更新的字段');

  const [rows] = await pool.query(
    'SELECT student_id, name, gender FROM student WHERE student_id = ?',
    [req.user.student_id]
  );
  if (rows.length === 0) return fail(res, 404, 404, '学生信息不存在');

  const keys = Object.keys(updates);
  await pool.query(
    `UPDATE student SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE student_id = ?`,
    [...keys.map((k) => updates[k]), req.user.student_id]
  );

  const current = rows[0];
  const nextName = updates.name !== undefined ? updates.name : current.name;
  const nextGender = updates.gender !== undefined ? updates.gender : current.gender;

  ok(res, {
    student_id: req.user.student_id,
    name: nextName,
    gender: nextGender,
    gender_label: genderLabel(nextGender),
    updated: keys,
  }, '资料已更新');
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
