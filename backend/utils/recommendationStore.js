// 职业推荐落库：写历史并控制保留批数
// R24：保留批数的清理条件曾多留一批，这里统一以 KEEP_BATCHES 为准
const KEEP_BATCHES = 5;

async function saveRecommendations(conn, studentId, portrait, recommendations) {
  const batchAt = new Date();

  for (const r of recommendations) {
    await conn.query(
      `INSERT INTO career_recommendation
         (student_id, direction, score, reason, total_score, batch_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [studentId, r.direction, r.score, r.reason, portrait.total_score, batchAt]
    );
  }

  // 只保留最近 N 批：多取一条用于判断是否超限，随后删除早于第 N 批的记录
  const [batches] = await conn.query(
    'SELECT DISTINCT batch_at FROM career_recommendation WHERE student_id = ? ORDER BY batch_at DESC LIMIT ?',
    [studentId, KEEP_BATCHES + 1]
  );
  if (batches.length > KEEP_BATCHES) {
    await conn.query(
      'DELETE FROM career_recommendation WHERE student_id = ? AND batch_at < ?',
      [studentId, batches[KEEP_BATCHES - 1].batch_at]
    );
  }

  return batchAt;
}

module.exports = { saveRecommendations, KEEP_BATCHES };
