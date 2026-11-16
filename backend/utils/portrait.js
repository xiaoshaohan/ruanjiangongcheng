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

// 统一保留两位小数，并防御 NaN
const round2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : 0);

// 数值截断到 [min, max]，避免配置变小或历史脏数据算出 127% 这类不可能值（R05）
const clamp = (n, min, max) => Math.min(max, Math.max(min, Number.isFinite(n) ? n : 0));

// 将满分制的 score（0-100）换算为 4.0 制 GPA，按分数段线性插值：
// 90-100 → 4.0；80-89 → 3.0~3.9；70-79 → 2.0~2.9；60-69 → 1.0~1.9；<60 → 0
function scoreToGpa(score) {
  const s = Number(score);
  if (!Number.isFinite(s) || s < 60) return 0;   // 不及格记 0
  if (s >= 90) return 4.0;                       // 90 分及以上满绩
  if (s >= 80) return round2(3.0 + (s - 80) / 10); // 81→3.1 … 89→3.9
  if (s >= 70) return round2(2.0 + (s - 70) / 10); // 71→2.1 … 79→2.9
  return round2(1.0 + (s - 60) / 10);              // 61→1.1 … 69→1.9
}

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
  // 上限截断：配置里的标准分是这一维的满分，不允许超过
  academicScore = clamp(academicScore, 0, limits.academicScore);

  // 2. 科研项目 → 科研分
  const [researchRows] = await conn.query(
    'SELECT role, level FROM research_project WHERE student_id = ?',
    [studentId]
  );
  let researchScore = 0;
  for (const row of researchRows) {
    researchScore += points[row.level] || 0;
  }
  researchScore = clamp(researchScore, 0, limits.researchScore);

  // 3. 实践经历 → 实践分（按小时换算）
  const [practiceRows] = await conn.query(
    'SELECT hours FROM practice_activity WHERE student_id = ?',
    [studentId]
  );
  let practiceScore = 0;
  for (const row of practiceRows) {
    practiceScore += (Number(row.hours) || 0) / hoursPerPoint;
  }
  practiceScore = clamp(practiceScore, 0, limits.practiceScore);

  // 4. 综合总分：先各维归一到得分率（0-100），再按权重加权，上限 100
  const academicRate = rateOf(academicScore, limits.academicScore);
  const researchRate = rateOf(researchScore, limits.researchScore);
  const practiceRate = rateOf(practiceScore, limits.practiceScore);
  const totalScore = clamp(
    academicRate * weights.academic + researchRate * weights.research + practiceRate * weights.practice,
    0, 100
  );

  return {
    gpa: clamp(round2(gpa), 0, 4),
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

// R52：画像保存了计算当时的配置快照，读取时按快照里的标准分换算得分率，
// 避免"旧分数套新分母"；快照缺失或损坏时退回当前配置。
function limitsFromSnapshot(snapshot, fallback) {
  if (!snapshot) return fallback;
  try {
    const parsed = typeof snapshot === 'string' ? JSON.parse(snapshot) : snapshot;
    const l = parsed && parsed.limits;
    if (!l) return fallback;
    const academic = Number(l.academicScore);
    const research = Number(l.researchScore);
    const practice = Number(l.practiceScore);
    if ([academic, research, practice].every((n) => Number.isFinite(n) && n > 0)) {
      return { academicScore: academic, researchScore: research, practiceScore: practice };
    }
  } catch (e) {
    // 快照格式异常时不做任何处理，退回当前配置
  }
  return fallback;
}

// 根据画像得分生成职业推荐（R23：全部用得分率判断，不再用原始分阈值）
// 阈值：某一维得分率 >= 60% 视为"强"；学术方向还要求科研得分率 >= 40%
const STRONG_RATE = 60;
const RESEARCH_SUPPORT_RATE = 40;

function computeCareerRecommendation(portrait, limits) {
  const l = limits || LIMITS;
  const academic = Number(portrait.academic_score) || 0;
  const research = Number(portrait.research_score) || 0;
  const practice = Number(portrait.practice_score) || 0;
  const totalScore = Number(portrait.total_score) || 0;

  const academicRate = round2(rateOf(academic, l.academicScore));
  const researchRate = round2(rateOf(research, l.researchScore));
  const practiceRate = round2(rateOf(practice, l.practiceScore));

  const recommendations = [];

  // 学术研究方向：学业强且有科研支撑
  if (academicRate >= STRONG_RATE && researchRate >= RESEARCH_SUPPORT_RATE) {
    recommendations.push({
      direction: '学术研究方向',
      reason: `学业得分率 ${academicRate}%，科研得分率 ${researchRate}%，具备继续深造的基础，适合考研或进入科研院所、高校从事研究工作。`,
      score: Math.round(academicRate * 0.5 + researchRate * 0.5),
    });
  }

  // 工程实践方向：实践经历达到"强"
  if (practiceRate >= STRONG_RATE) {
    recommendations.push({
      direction: '工程实践方向',
      reason: `实践得分率 ${practiceRate}%，动手与项目落地能力较强，适合直接就业，从事软件开发、系统运维、技术支持等工程岗位。`,
      score: Math.round(practiceRate),
    });
  }

  if (recommendations.length === 0) {
    const topRate = Math.max(academicRate, researchRate, practiceRate);
    const otherRates = Math.max(researchRate, practiceRate);

    if (academicRate >= STRONG_RATE && academicRate - otherRates >= 20) {
      // 学业一枝独秀、科研实践明显偏低：不能称为均衡
      recommendations.push({
        direction: '学业基础方向',
        reason: `学业得分率 ${academicRate}%，但科研 ${researchRate}%、实践 ${practiceRate}%，后两项明显偏低，目前缺少科研项目与实践经历支撑。建议先参加学科竞赛、加入课题组或寻找实习，补齐科研或实践后再确定考研或就业方向。`,
        score: Math.round(totalScore),
      });
    } else if (topRate < 40) {
      recommendations.push({
        direction: '基础积累方向',
        reason: `三维得分率最高仅 ${topRate}%（学业 ${academicRate}%、科研 ${researchRate}%、实践 ${practiceRate}%），尚未形成明显优势。建议先稳住课程成绩，同时开始积累科研或实践经历，再考虑方向选择。`,
        score: Math.round(totalScore),
      });
    } else {
      recommendations.push({
        direction: '基础积累方向',
        reason: `三维得分率为学业 ${academicRate}%、科研 ${researchRate}%、实践 ${practiceRate}%，暂无单维达到 ${STRONG_RATE}%。建议在保持学业的同时，集中精力补强最有基础的一维，形成可展示的优势。`,
        score: Math.round(totalScore),
      });
    }
  }

  // 按推荐度排序
  recommendations.sort((a, b) => b.score - a.score);
  return recommendations;
}

module.exports = {
  computePortrait, computeCareerRecommendation, toRates, scoreToGpa,
  limitsFromSnapshot,
  LIMITS, RESEARCH_POINTS, WEIGHTS,
  STRONG_RATE, RESEARCH_SUPPORT_RATE,
};
