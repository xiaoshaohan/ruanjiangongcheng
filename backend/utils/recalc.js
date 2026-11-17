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

// 批量重算：分批并行，单批 50 人，避免几千人导入时一次性打满连接池；
// 单个失败只影响自己，并返回 skipped/failed 明细供调用方提示（S3）
async function recalculateMany(studentIds, { limit = Infinity } = {}) {
  const all = [...(studentIds || [])];
  const target = limit === Infinity ? all : all.slice(0, limit);
  const skippedIds = all.slice(target.length);

  const BATCH_SIZE = 50;
  const okIds = [];
  const failedIds = [];
  for (let i = 0; i < target.length; i += BATCH_SIZE) {
    const chunk = target.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      chunk.map(async (sid) => ({ sid, ok: !!(await recalculateQuietly(sid)) }))
    );
    for (const r of results) {
      if (r.ok) okIds.push(r.sid);
      else failedIds.push(r.sid);
    }
  }

  return {
    total: all.length,
    recalculated: okIds.length,
    failed: failedIds.length,
    failed_ids: failedIds,
    skipped: skippedIds.length,
    skipped_ids: skippedIds,
  };
}

module.exports = { recalculateStudent, recalculateQuietly, recalculateMany };
