// 学生画像计算核心逻辑

// 常量（可按需调整）
const LIMITS = {
  researchScore: 100, // 科研分封顶
  practiceScore: 100, // 实践分封顶
};
const RESEARCH_POINTS = { 国家级: 10, 省级: 6, 校级: 3 };
const WEIGHTS = { academic: 0.4, research: 0.3, practice: 0.3 };

// 将满分制的 score（0-100）换算为 4.0 制 GPA。分数越高则绩点越高。
function scoreToGpa(score) {
  if (score >= 90) return 4.0; // 90-100
  if (score >= 80) return 3.0; // 80-89
  if (score >= 70) return 2.0; // 70-79
  if (score >= 60) return 1.0; // 60-69
  return 0;                    // <60（不及格）
}

// 统一保留两位小数，并防御 NaN
const round2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : 0);

// 计算学生画像，返回各维度得分。conn 需为 mysql2 连接（池连接或事务连接）。
async function computePortrait(studentId, conn) {
  // 1. 学业成绩 → GPA + 学业分
  const [academicRows] = await conn.query(
    'SELECT credit, score FROM academic_record WHERE student_id = ?',
    [studentId]
  );

  let gpa = 0;
  let academicScore = 0;
  if (academicRows.length > 0) {
    let totalWeightedGpa = 0;
    let totalCredit = 0;
    let totalWeightedScore = 0;
    for (const row of academicRows) {
      const score = Number(row.score);
      const credit = Number(row.credit) || 0;
      totalWeightedGpa += scoreToGpa(score) * credit;
      totalWeightedScore += score * credit;
      totalCredit += credit;
    }
    if (totalCredit > 0) {
      gpa = totalWeightedGpa / totalCredit;
      // 学业分：平均分 × 0.25（满分 100）
      academicScore = (totalWeightedScore / totalCredit) * 0.25;
    }
  }

  // 2. 科研项目 → 科研分
  const [researchRows] = await conn.query(
    'SELECT role, level FROM research_project WHERE student_id = ?',
    [studentId]
  );
  let researchScore = 0;
  for (const row of researchRows) {
    researchScore += RESEARCH_POINTS[row.level] || 0;
  }
  researchScore = Math.min(researchScore, LIMITS.researchScore);

  // 3. 实践经历 → 实践分（每 10 小时 = 1 分）
  const [practiceRows] = await conn.query(
    'SELECT hours FROM practice_activity WHERE student_id = ?',
    [studentId]
  );
  let practiceScore = 0;
  for (const row of practiceRows) {
    practiceScore += (Number(row.hours) || 0) / 10;
  }
  practiceScore = Math.min(practiceScore, LIMITS.practiceScore);

  // 4. 综合总分：学业 40% + 科研 30% + 实践 30%
  const totalScore =
    academicScore * WEIGHTS.academic + researchScore * WEIGHTS.research + practiceScore * WEIGHTS.practice;

  return {
    gpa: round2(gpa),
    academic_score: round2(academicScore),
    research_score: round2(researchScore),
    practice_score: round2(practiceScore),
    total_score: round2(totalScore),
  };
}

module.exports = { computePortrait };