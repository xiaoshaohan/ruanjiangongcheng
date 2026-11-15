// 学生画像计算核心逻辑
const { DEFAULT_CONFIG } = require('./portraitConfig');

// 默认常量，保留导出以兼容已有调用与测试
const LIMITS = {
  academicScore: DEFAULT_CONFIG.limits.academicScore,
  researchScore: DEFAULT_CONFIG.limits.researchScore,
  practiceScore: DEFAULT_CONFIG.limits.practiceScore,
};
const RESEARCH_POINTS = DEFAULT_CONFIG.research_points;
const WEIGHTS = DEFAULT_CONFIG.weights;

// 单维度得分率（0-100）：得分 / 标准分 × 100，用于雷达图与总分的统一口径
const rateOf = (score, full) => (full > 0 ? (score / full) * 100 : 0);

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
// config 不传时使用默认规则，便于单元测试与离线调用。
async function computePortrait(studentId, conn, config) {
  const cfg = config || DEFAULT_CONFIG;
  const limits = cfg.limits;
  const points = cfg.research_points;
  const weights = cfg.weights;
  const academicFactor = cfg.academic.factor;
  const hoursPerPoint = cfg.practice.hours_per_point;

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
      // 学业分：加权平均分 × 换算系数
      academicScore = (totalWeightedScore / totalCredit) * academicFactor;
    }
  }

  // 2. 科研项目 → 科研分
  const [researchRows] = await conn.query(
    'SELECT role, level FROM research_project WHERE student_id = ?',
    [studentId]
  );
  let researchScore = 0;
  for (const row of researchRows) {
    researchScore += points[row.level] || 0;
  }
  researchScore = Math.min(researchScore, limits.researchScore);

  // 3. 实践经历 → 实践分（按小时换算）
  const [practiceRows] = await conn.query(
    'SELECT hours FROM practice_activity WHERE student_id = ?',
    [studentId]
  );
  let practiceScore = 0;
  for (const row of practiceRows) {
    practiceScore += (Number(row.hours) || 0) / hoursPerPoint;
  }
  practiceScore = Math.min(practiceScore, limits.practiceScore);

  // 4. 综合总分：先各维归一到得分率（0-100），再按权重加权，上限 100
  const academicRate = rateOf(academicScore, limits.academicScore);
  const researchRate = rateOf(researchScore, limits.researchScore);
  const practiceRate = rateOf(practiceScore, limits.practiceScore);
  const totalScore = Math.min(
    100,
    academicRate * weights.academic + researchRate * weights.research + practiceRate * weights.practice
  );

  return {
    gpa: round2(gpa),
    academic_score: round2(academicScore),
    research_score: round2(researchScore),
    practice_score: round2(practiceScore),
    total_score: round2(totalScore),
  };
}

// 把一条画像换算成三个维度的得分率（0-100），供雷达图、对比表统一展示
function toRates(profile, limits) {
  const l = limits || LIMITS;
  return {
    academic: round2(rateOf(Number(profile.academic_score) || 0, l.academicScore)),
    research: round2(rateOf(Number(profile.research_score) || 0, l.researchScore)),
    practice: round2(rateOf(Number(profile.practice_score) || 0, l.practiceScore)),
  };
}

// 根据画像得分生成职业推荐
function computeCareerRecommendation(portrait) {
  const { academic_score, research_score, practice_score } = portrait;
  const recommendations = [];

  // 学术方向：学业强 + 科研强
  if (academic_score >= 20 && research_score >= 8) {
    recommendations.push({
      direction: '学术研究方向',
      reason: `学业成绩优秀(${academic_score}分)，科研经历丰富(${research_score}分)，适合考研深造、攻读硕士博士，从事科研院所或高校研究工作。`,
      score: Math.round(academic_score * 0.5 + research_score * 0.5),
    });
  }

  // 工程实践方向：实践分高
  if (practice_score >= 20) {
    recommendations.push({
      direction: '工程实践方向',
      reason: `实践经历丰富(${practice_score}分)，动手能力强，适合直接就业，从事软件开发、系统运维、技术支持等工程类岗位。`,
      score: practice_score,
    });
  }

  // 均衡发展方向
  if (recommendations.length === 0) {
    recommendations.push({
      direction: '综合发展方向',
      reason: `各方面发展均衡，建议根据个人兴趣选择考研或就业，目前可以通过参加竞赛、项目实践进一步明确方向。`,
      score: Math.round(portrait.total_score),
    });
  }

  // 按推荐度排序
  recommendations.sort((a, b) => b.score - a.score);
  return recommendations;
}

module.exports = {
  computePortrait, computeCareerRecommendation, toRates,
  LIMITS, RESEARCH_POINTS, WEIGHTS,
};
