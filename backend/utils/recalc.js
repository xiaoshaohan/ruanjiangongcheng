// 明细数据变更后同步重算画像，保证看板与画像不落后于录入（R15）
const pool = require('../config/db');
const { computePortrait, computeCareerRecommendation } = require('./portrait');
const { getPortraitConfig } = require('./portraitConfig');
const { upsertProfile } = require('./profileStore');
const { saveRecommendations } = require('./recommendationStore');

async function recalculateStudent(studentId) {
  const config = await getPortraitConfig();
  const portrait = await computePortrait(studentId, pool, config);
  const { version } = await upsertProfile(pool, studentId, portrait, config);

  const recommendations = computeCareerRecommendation(portrait, config.limits);
  await saveRecommendations(pool, studentId, portrait, recommendations);

  return { portrait, config_version: version, recommendations };
}

// 重算失败不阻断主流程，只记录日志（明细已成功写入）
async function recalculateQuietly(studentId) {
  try {
    return await recalculateStudent(studentId);
  } catch (err) {
    console.error('[画像重算失败]', studentId, err.message);
    return null;
  }
}

module.exports = { recalculateStudent, recalculateQuietly };
