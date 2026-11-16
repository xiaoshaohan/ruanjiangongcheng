// 系统配置：画像权重与计分规则（仅管理员可改）
const express = require('express');
const pool = require('../config/db');
const { ok, fail, asyncHandler } = require('../utils/response');
const { adminOnly, staffOnly } = require('../utils/auth');
const {
  DEFAULT_CONFIG, getPortraitConfig, clearConfigCache, validateConfig, mergeConfig, configVersion,
} = require('../utils/portraitConfig');
const { computePortrait, computeCareerRecommendation } = require('../utils/portrait');
const { upsertProfile } = require('../utils/profileStore');
const { saveRecommendations } = require('../utils/recommendationStore');
const { isTeacherEditScoreAllowed } = require('../utils/permission');
const { writeAudit } = require('../utils/audit');

const router = express.Router();

// 查询当前画像配置（教师可读，用于解释分数口径）
router.get('/portrait', staffOnly, asyncHandler(async (req, res) => {
  const config = await getPortraitConfig({ force: true });
  ok(res, { config, defaults: DEFAULT_CONFIG, config_version: configVersion(config) });
}));

// 修改画像配置：以当前配置为底，只覆盖提交的字段（R21）
router.put('/portrait', adminOnly, asyncHandler(async (req, res) => {
  const current = await getPortraitConfig({ force: true });
  const error = validateConfig(req.body, current);
  if (error) return fail(res, 400, 400, error);

  const config = mergeConfig(req.body, current);
  await pool.query(
    `INSERT INTO portrait_config (config_key, config_value, description)
     VALUES ('portrait', ?, '画像权重与计分规则')
     ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
    [JSON.stringify(config)]
  );

  clearConfigCache();
  await writeAudit(req, {
    action: 'config.update_portrait',
    targetType: 'portrait_config',
    targetId: 'portrait',
    before: current,
    after: config,
  });
  ok(res, {
    config,
    config_version: configVersion(config),
    affected_profiles: '已保存，既有画像将标记为待重算',
  }, '配置已保存，重新计算画像后生效');
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
  await writeAudit(req, {
    action: 'config.reset_portrait',
    targetType: 'portrait_config',
    targetId: 'portrait',
    after: DEFAULT_CONFIG,
  });
  ok(res, { config: DEFAULT_CONFIG, config_version: configVersion(DEFAULT_CONFIG) }, '已恢复默认配置，重新计算画像后生效');
}));

// 按当前配置重算全部学生画像（顺手写一批推荐历史）
// R44：逐学生事务提交，单个学生失败只回滚该学生，返回失败清单供重试
router.post('/portrait/recalculate-all', adminOnly, asyncHandler(async (req, res) => {
  const [students] = await pool.query('SELECT student_id FROM student ORDER BY student_id');
  if (students.length === 0) return ok(res, { total: 0, done: 0, failed: [] }, '没有学生数据');

  const config = await getPortraitConfig({ force: true });
  const version = configVersion(config);
  const conn = await pool.getConnection();
  let done = 0;
  const failed = [];

  try {
    for (const s of students) {
      try {
        await conn.beginTransaction();
        const portrait = await computePortrait(s.student_id, conn, config);
        await upsertProfile(conn, s.student_id, portrait, config);

        const recommendations = computeCareerRecommendation(portrait, config.limits);
        await saveRecommendations(conn, s.student_id, portrait, recommendations);
        await conn.commit();
        done++;
      } catch (err) {
        await conn.rollback();
        failed.push({ student_id: s.student_id, reason: err.message });
        console.error('[全量重算失败]', s.student_id, err.message);
      }
    }
  } finally {
    conn.release();
  }

  await writeAudit(req, {
    action: 'config.recalculate_all',
    targetType: 'ability_profile',
    targetId: 'all',
    after: { total: students.length, done, failed: failed.length, config_version: version },
  });

  ok(res, {
    total: students.length,
    done,
    failed,
    config_version: version,
  }, `已重算 ${done}/${students.length} 名学生画像${failed.length ? `，失败 ${failed.length} 人可稍后重试` : ''}`);
}));

// ---------- 系统开关：是否允许教师修改成绩 ----------
router.get('/system', staffOnly, asyncHandler(async (req, res) => {
  const allowed = await isTeacherEditScoreAllowed();
  ok(res, { allow_teacher_edit_score: allowed });
}));

// R09：不能用 !! 判断字符串，'0' 也会被当成 true
router.put('/system', adminOnly, asyncHandler(async (req, res) => {
  const raw = req.body ? req.body.allow_teacher_edit_score : undefined;
  let allowed;
  if (raw === true || raw === 1 || raw === '1') allowed = true;
  else if (raw === false || raw === 0 || raw === '0') allowed = false;
  else return fail(res, 400, 400, 'allow_teacher_edit_score 只能是 true/false 或 1/0');

  await pool.query(
    `INSERT INTO sys_config (config_key, config_value, description)
     VALUES ('allow_teacher_edit_score', ?, '是否允许教师修改成绩：1 允许 / 0 仅管理员')
     ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
    [allowed ? '1' : '0']
  );
  await writeAudit(req, {
    action: 'config.update_system_switch',
    targetType: 'sys_config',
    targetId: 'allow_teacher_edit_score',
    after: { allow_teacher_edit_score: allowed },
  });
  ok(res, { allow_teacher_edit_score: allowed }, allowed ? '已开放教师修改成绩' : '已收回教师修改成绩的权限');
}));

module.exports = router;
