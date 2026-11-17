// 画像计分规则的默认值与持久化读写
// 注意：数据库连接按需加载，避免纯单元测试引入本模块时建立连接池导致进程不退出

const crypto = require('crypto');

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

// 缓存带 TTL：多实例部署时旧配置最多存活 5 秒（G7，原 30 秒收敛过慢）；
// 配置写入时本实例会立即清缓存，其他实例最迟 5 秒后读到新值。
const CACHE_TTL_MS = 5 * 1000;
let cache = null;
let cacheAt = 0;

// 配置的允许字段与层级（G2：递归校验形状，数组/非法类型一律拒绝）
const CONFIG_SHAPE = {
  weights: ['academic', 'research', 'practice'],
  limits: ['academicScore', 'researchScore', 'practiceScore'],
  academic: ['factor'],
  research_points: ['国家级', '省级', '校级'],
  practice: ['hours_per_point'],
};

function shapeProblem(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return '配置格式不正确';
  for (const key of Object.keys(raw)) {
    if (!CONFIG_SHAPE[key]) return `未知配置项：${key}`;
  }
  for (const [section, fields] of Object.entries(CONFIG_SHAPE)) {
    if (raw[section] === undefined) continue;
    const obj = raw[section];
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return `${section} 必须是对象，不能是数组或其他类型`;
    }
    for (const key of Object.keys(obj)) {
      if (!fields.includes(key)) return `${section}.${key} 不是可配置字段`;
      const v = obj[key];
      if (Array.isArray(v)) return `${section}.${key} 不能是数组`;
      if (typeof v !== 'number' && typeof v !== 'string') return `${section}.${key} 必须是数字`;
      if (typeof v === 'string' && !/^\s*-?\d+(\.\d+)?\s*$/.test(v)) {
        return `${section}.${key} 必须是数字`;
      }
      if (!Number.isFinite(Number(v))) return `${section}.${key} 必须是有效数字`;
    }
  }
  return null;
}

// 深合并：以 base 为底，只覆盖 raw 中出现的字段（PATCH 语义，R21）
function mergeConfig(raw, base = DEFAULT_CONFIG) {
  const cfg = JSON.parse(JSON.stringify(base || DEFAULT_CONFIG));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return cfg;

  // G2：数组、对象、布尔等非数字值一律回退，Number([0.8]) 不再被当成 0.8
  const pickNumber = (obj, key, fallback) => {
    const v = obj && obj[key];
    if (Array.isArray(v)) return fallback;
    if (typeof v !== 'number' && typeof v !== 'string') return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  if (raw.weights && typeof raw.weights === 'object') {
    cfg.weights = {
      academic: pickNumber(raw.weights, 'academic', cfg.weights.academic),
      research: pickNumber(raw.weights, 'research', cfg.weights.research),
      practice: pickNumber(raw.weights, 'practice', cfg.weights.practice),
    };
  }
  if (raw.limits && typeof raw.limits === 'object') {
    cfg.limits = {
      academicScore: pickNumber(raw.limits, 'academicScore', cfg.limits.academicScore),
      researchScore: pickNumber(raw.limits, 'researchScore', cfg.limits.researchScore),
      practiceScore: pickNumber(raw.limits, 'practiceScore', cfg.limits.practiceScore),
    };
  }
  if (raw.academic && typeof raw.academic === 'object') {
    cfg.academic = { factor: pickNumber(raw.academic, 'factor', cfg.academic.factor) };
  }
  if (raw.research_points && typeof raw.research_points === 'object') {
    cfg.research_points = {
      国家级: pickNumber(raw.research_points, '国家级', cfg.research_points['国家级']),
      省级: pickNumber(raw.research_points, '省级', cfg.research_points['省级']),
      校级: pickNumber(raw.research_points, '校级', cfg.research_points['校级']),
    };
  }
  if (raw.practice && typeof raw.practice === 'object') {
    cfg.practice = { hours_per_point: pickNumber(raw.practice, 'hours_per_point', cfg.practice.hours_per_point) };
  }

  return cfg;
}

// 校验配置合法性，返回 null 表示通过，否则返回错误说明
function validateConfig(raw, base = DEFAULT_CONFIG) {
  const shapeError = shapeProblem(raw);
  if (shapeError) return shapeError;

  const cfg = mergeConfig(raw, base);

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

// 配置版本：用于识别画像是否按最新口径计算（R52）
function configVersion(config) {
  const json = JSON.stringify(config || DEFAULT_CONFIG);
  return crypto.createHash('md5').update(json).digest('hex').slice(0, 8);
}

// 读取配置：内存缓存（30 秒 TTL），表不存在或读取失败时回退默认值
async function getPortraitConfig({ force = false } = {}) {
  if (!force && cache && Date.now() - cacheAt < CACHE_TTL_MS) return cache;

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
      cacheAt = Date.now();
      return cache;
    }
  } catch (e) {
    // 迁移脚本还没执行时不影响主流程
  }

  cache = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  cacheAt = Date.now();
  return cache;
}

function clearConfigCache() {
  cache = null;
  cacheAt = 0;
}

module.exports = {
  DEFAULT_CONFIG,
  getPortraitConfig,
  clearConfigCache,
  validateConfig,
  mergeConfig,
  configVersion,
  CACHE_TTL_MS,
};
