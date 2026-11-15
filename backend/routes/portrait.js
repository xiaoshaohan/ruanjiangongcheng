const express = require('express');
const pool = require('../config/db');
const { ok, fail, asyncHandler } = require('../utils/response');
const { computePortrait, computeCareerRecommendation, toRates } = require('../utils/portrait');
const { getPortraitConfig } = require('../utils/portraitConfig');
const { saveRecommendations } = require('../utils/recommendationStore');

const router = express.Router();

// 每个学生最多保留最近 5 批推荐记录
const KEEP_BATCHES = 5;

// 计算学生画像（同时生成并保存职业推荐）
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

    const config = await getPortraitConfig();
    const portrait = await computePortrait(studentId, conn, config);

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

    // 推荐结果落库，保留历史
    const recommendations = computeCareerRecommendation(portrait);
    const batchAt = await saveRecommendations(conn, studentId, portrait, recommendations);

    await conn.commit();
    ok(res, { student_id: studentId, ...portrait, recommendations, batch_at: batchAt }, '画像计算完成');
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
  // 附带三个维度的得分率（0-100），前端雷达图、对比表统一用它，避免各维量纲不一致
  const config = await getPortraitConfig();
  ok(res, { ...rows[0], rates: toRates(rows[0], config.limits) });
}));

// 职业推荐：优先返回最近一次保存的记录，没有历史时按当前画像实时计算
router.get('/career/:studentId', asyncHandler(async (req, res) => {
  const studentId = req.params.studentId;

  const [batches] = await pool.query(
    'SELECT batch_at, total_score FROM career_recommendation WHERE student_id = ? ORDER BY batch_at DESC LIMIT 1',
    [studentId]
  );

  if (batches.length > 0) {
    const batchAt = batches[0].batch_at;
    const [items] = await pool.query(
      `SELECT direction, score, reason FROM career_recommendation
       WHERE student_id = ? AND batch_at = ?
       ORDER BY score DESC`,
      [studentId, batchAt]
    );
    return ok(res, { batch_at: batchAt, total_score: batches[0].total_score, items }, '最近一次推荐');
  }

  const [rows] = await pool.query(
    'SELECT * FROM ability_profile WHERE student_id = ?',
    [studentId]
  );
  if (rows.length === 0) return fail(res, 404, 404, '画像不存在，请先计算');

  ok(res, {
    batch_at: null,
    total_score: rows[0].total_score,
    items: computeCareerRecommendation(rows[0]),
  }, '实时计算，尚未生成历史记录');
}));

// 推荐历史：按批次返回，最多 5 批
router.get('/career-history/:studentId', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT direction, score, reason, total_score, batch_at
     FROM career_recommendation
     WHERE student_id = ?
     ORDER BY batch_at DESC, score DESC`,
    [req.params.studentId]
  );

  const groups = [];
  const seen = new Map();

  for (const r of rows) {
    const key = r.batch_at instanceof Date ? String(r.batch_at.getTime()) : String(r.batch_at);
    let group = seen.get(key);
    if (!group) {
      if (groups.length >= KEEP_BATCHES) break;
      group = { batch_at: r.batch_at, total_score: r.total_score, items: [] };
      seen.set(key, group);
      groups.push(group);
    }
    group.items.push({ direction: r.direction, score: r.score, reason: r.reason });
  }

  ok(res, groups);
}));

module.exports = router;
