// 画像落库的唯一入口：写入分数时同时保存配置版本与快照（R52）
// 三处调用（单生计算、自动重算、全量重算）原先各写一份 SQL，改列容易漏，这里统一。
const { configVersion } = require('./portraitConfig');

function buildSnapshot(config) {
  return JSON.stringify({
    limits: config.limits,
    weights: config.weights,
    research_points: config.research_points,
    academic: config.academic,
    practice: config.practice,
  });
}

async function upsertProfile(db, studentId, portrait, config) {
  const version = configVersion(config);
  const snapshot = buildSnapshot(config);

  await db.query(
    `INSERT INTO ability_profile
       (student_id, gpa, academic_score, research_score, practice_score, total_score, config_version, config_snapshot, calculated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       gpa = VALUES(gpa),
       academic_score = VALUES(academic_score),
       research_score = VALUES(research_score),
       practice_score = VALUES(practice_score),
       total_score = VALUES(total_score),
       config_version = VALUES(config_version),
       config_snapshot = VALUES(config_snapshot),
       calculated_at = VALUES(calculated_at)`,
    [
      studentId, portrait.gpa, portrait.academic_score,
      portrait.research_score, portrait.practice_score, portrait.total_score,
      version, snapshot,
    ]
  );

  return { version, snapshot };
}

module.exports = { upsertProfile, buildSnapshot };
