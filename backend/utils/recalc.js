// 明细数据变更后同步重算画像，保证看板与画像不落后于录入（R15）
const pool = require('../config/db');
const { computePortrait, computeCareerRecommendation } = require('./portrait');
const { getPortraitConfig } = require('./portraitConfig');
const { upsertProfile } = require('./profileStore');
const { saveRecommendations } = require('./recommendationStore');

async function recalculateStudent(studentId, conn = pool) {
  const config = await getPortraitConfig();
  const portrait = await computePortrait(studentId, conn, config);
  const { version } = await upsertProfile(conn, studentId, portrait, config);

  const recommendations = computeCareerRecommendation(portrait, config.limits);
  await saveRecommendations(conn, studentId, portrait, recommendations);

  return { portrait, config_version: version, recommendations };
}

// 重算失败不阻断主流程，只记录日志（明细已成功写入）
async function recalculateQuietly(studentId, conn) {
  try {
    return await recalculateStudent(studentId, conn);
  } catch (err) {
    console.error('[画像重算失败]', studentId, err.message);
    return null;
  }
}

// 批量重算：并行执行，单个失败只影响自己，避免长串行耗时
async function recalculateMany(studentIds, { limit = Infinity } = {}) {
  const total = studentIds && typeof studentIds.size === 'number' ? studentIds.size : (studentIds ? studentIds.length : 0);
  const ids = [...studentIds].slice(0, limit);
  const results = await Promise.all(ids.map((sid) => recalculateQuietly(sid)));
  return { recalculated: results.filter(Boolean).length, skipped: Math.max(0, total - ids.length) };
}

module.exports = { recalculateStudent, recalculateQuietly, recalculateMany };
