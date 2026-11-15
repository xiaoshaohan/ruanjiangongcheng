// 职业推荐落库：写历史并控制保留批数
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

  // 只保留最近 N 批
  const [batches] = await conn.query(
    'SELECT DISTINCT batch_at FROM career_recommendation WHERE student_id = ? ORDER BY batch_at DESC LIMIT 6',
    [studentId]
  );
  if (batches.length > KEEP_BATCHES) {
    await conn.query(
      'DELETE FROM career_recommendation WHERE student_id = ? AND batch_at < ?',
      [studentId, batches[KEEP_BATCHES].batch_at]
    );
  }

  return batchAt;
}

module.exports = { saveRecommendations, KEEP_BATCHES };
