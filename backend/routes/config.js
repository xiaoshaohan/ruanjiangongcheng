// 系统配置：画像权重与计分规则（仅管理员可改）
const express = require('express');
const pool = require('../config/db');
const { ok, fail, asyncHandler } = require('../utils/response');
const { adminOnly, staffOnly } = require('../utils/auth');
const { DEFAULT_CONFIG, getPortraitConfig, clearConfigCache, validateConfig, mergeConfig } = require('../utils/portraitConfig');
const { computePortrait, computeCareerRecommendation } = require('../utils/portrait');
const { saveRecommendations } = require('../utils/recommendationStore');
const { isTeacherEditScoreAllowed } = require('../utils/permission');

const router = express.Router();

// 查询当前画像配置（教师可读，用于解释分数口径）
router.get('/portrait', staffOnly, asyncHandler(async (req, res) => {
  const config = await getPortraitConfig({ force: true });
  ok(res, { config, defaults: DEFAULT_CONFIG });
}));

// 修改画像配置
router.put('/portrait', adminOnly, asyncHandler(async (req, res) => {
  const error = validateConfig(req.body);
  if (error) return fail(res, 400, 400, error);

  const config = mergeConfig(req.body);
  await pool.query(
    `INSERT INTO portrait_config (config_key, config_value, description)
     VALUES ('portrait', ?, '画像权重与计分规则')
     ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
    [JSON.stringify(config)]
  );

  clearConfigCache();
  ok(res, { config }, '配置已保存，重新计算画像后生效');
}));

// 恢复默认配置
router.post('/portrait/reset', adminOnly, asyncHandler(async (req, res) => {
  await pool.query(
    `INSERT INTO portrait_config (config_key, config_value, description)
     VALUES ('portrait', ?, '画像权重与计分规则')
     ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
    [JSON.stringify(DEFAULT_CONFIG)]
  );

  clearConfigCache();
  ok(res, { config: DEFAULT_CONFIG }, '已恢复默认配置，重新计算画像后生效');
}));

// 按当前配置重算全部学生画像（顺手写一批推荐历史）
router.post('/portrait/recalculate-all', adminOnly, asyncHandler(async (req, res) => {
  const [students] = await pool.query('SELECT student_id FROM student ORDER BY student_id');
  if (students.length === 0) return ok(res, { total: 0, done: 0 }, '没有学生数据');

  const config = await getPortraitConfig({ force: true });
  const conn = await pool.getConnection();
  let done = 0;

  try {
    for (const s of students) {
      const portrait = await computePortrait(s.student_id, conn, config);

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
        [s.student_id, portrait.gpa, portrait.academic_score,
         portrait.research_score, portrait.practice_score, portrait.total_score]
      );

      const recommendations = computeCareerRecommendation(portrait);
      await saveRecommendations(conn, s.student_id, portrait, recommendations);
      done++;
    }
  } finally {
    conn.release();
  }

  ok(res, { total: students.length, done }, `已按当前配置重算 ${done} 名学生的画像`);
}));

// ---------- 系统开关：是否允许教师修改成绩 ----------
router.get('/system', staffOnly, asyncHandler(async (req, res) => {
  const allowed = await isTeacherEditScoreAllowed();
  ok(res, { allow_teacher_edit_score: allowed });
}));

router.put('/system', adminOnly, asyncHandler(async (req, res) => {
  const allowed = !!req.body.allow_teacher_edit_score;
  await pool.query(
    `INSERT INTO sys_config (config_key, config_value, description)
     VALUES ('allow_teacher_edit_score', ?, '是否允许教师修改成绩：1 允许 / 0 仅管理员')
     ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
    [allowed ? '1' : '0']
  );
  ok(res, { allow_teacher_edit_score: allowed }, allowed ? '已开放教师修改成绩' : '已收回教师修改成绩的权限');
}));

module.exports = router;
