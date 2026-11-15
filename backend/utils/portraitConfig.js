// 画像计分规则的默认值与持久化读写
// 注意：数据库连接按需加载，避免纯单元测试引入本模块时建立连接池导致进程不退出

const DEFAULT_CONFIG = {
  // 三维权重，合计必须为 1（学业为主，科研与实践各占一成）
  weights: { academic: 0.8, research: 0.1, practice: 0.1 },
  // 各维度标准分（满分），用于换算得分率
  limits: { academicScore: 25, researchScore: 100, practiceScore: 100 },
  // 学业分 = 加权平均分 × factor
  academic: { factor: 0.25 },
  // 科研项目按级别计分
  research_points: { 国家级: 10, 省级: 6, 校级: 3 },
  // 实践时长换算：每多少小时记 1 分
  practice: { hours_per_point: 10 },
};

let cache = null;

// 深合并：只接受已知字段，缺失部分回退默认值，避免脏数据把画像算崩
function mergeConfig(raw) {
  const cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  if (!raw || typeof raw !== 'object') return cfg;

  const pickNumber = (obj, key, fallback) => {
    const v = Number(obj && obj[key]);
    return Number.isFinite(v) ? v : fallback;
  };

  if (raw.weights) {
    cfg.weights = {
      academic: pickNumber(raw.weights, 'academic', cfg.weights.academic),
      research: pickNumber(raw.weights, 'research', cfg.weights.research),
      practice: pickNumber(raw.weights, 'practice', cfg.weights.practice),
    };
  }
  if (raw.limits) {
    cfg.limits = {
      academicScore: pickNumber(raw.limits, 'academicScore', cfg.limits.academicScore),
      researchScore: pickNumber(raw.limits, 'researchScore', cfg.limits.researchScore),
      practiceScore: pickNumber(raw.limits, 'practiceScore', cfg.limits.practiceScore),
    };
  }
  if (raw.academic) {
    cfg.academic = { factor: pickNumber(raw.academic, 'factor', cfg.academic.factor) };
  }
  if (raw.research_points) {
    cfg.research_points = {
      国家级: pickNumber(raw.research_points, '国家级', cfg.research_points['国家级']),
      省级: pickNumber(raw.research_points, '省级', cfg.research_points['省级']),
      校级: pickNumber(raw.research_points, '校级', cfg.research_points['校级']),
    };
  }
  if (raw.practice) {
    cfg.practice = { hours_per_point: pickNumber(raw.practice, 'hours_per_point', cfg.practice.hours_per_point) };
  }

  return cfg;
}

// 校验配置合法性，返回 null 表示通过，否则返回错误说明
function validateConfig(raw) {
  if (!raw || typeof raw !== 'object') return '配置格式不正确';

  const cfg = mergeConfig(raw);

  const { academic, research, practice } = cfg.weights;
  if (academic < 0 || research < 0 || practice < 0) return '权重不能为负数';
  const sum = academic + research + practice;
  if (Math.abs(sum - 1) > 0.001) return `三项权重之和必须为 1，当前为 ${sum.toFixed(2)}`;

  if (cfg.limits.academicScore <= 0 || cfg.limits.researchScore <= 0 || cfg.limits.practiceScore <= 0) {
    return '各维度标准分必须大于 0';
  }
  if (cfg.academic.factor <= 0) return '学业换算系数必须大于 0';
  if (cfg.practice.hours_per_point <= 0) return '实践换算小时数必须大于 0';
  if (cfg.research_points['国家级'] < 0 || cfg.research_points['省级'] < 0 || cfg.research_points['校级'] < 0) {
    return '科研计分不能为负数';
  }

  return null;
}

// 读取配置：优先内存缓存，其次数据库，表不存在或读取失败时回退默认值
async function getPortraitConfig({ force = false } = {}) {
  if (!force && cache) return cache;

  try {
    const pool = require('../config/db');
    const [rows] = await pool.query(
      'SELECT config_value FROM portrait_config WHERE config_key = ?',
      ['portrait']
    );
    if (rows.length > 0) {
      const value = typeof rows[0].config_value === 'string'
        ? JSON.parse(rows[0].config_value)
        : rows[0].config_value;
      cache = mergeConfig(value);
      return cache;
    }
  } catch (e) {
    // 迁移脚本还没执行时不影响主流程
  }

  cache = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  return cache;
}

function clearConfigCache() {
  cache = null;
}

module.exports = { DEFAULT_CONFIG, getPortraitConfig, clearConfigCache, validateConfig, mergeConfig };
