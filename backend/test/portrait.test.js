// 画像计算模块单元测试
// 运行：npm test
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { computePortrait, computeCareerRecommendation, toRates } = require('../utils/portrait');

// 构造一个假的数据库连接，按表名返回预设数据，避免测试依赖真实数据库
function mockConn({ academic = [], research = [], practice = [] } = {}) {
  return {
    query: async (sql) => {
      if (sql.includes('academic_record')) return [academic];
      if (sql.includes('research_project')) return [research];
      if (sql.includes('practice_activity')) return [practice];
      return [[]];
    },
  };
}

describe('画像计算 - 学业维度', () => {
  test('无成绩数据时各项为 0', async () => {
    const r = await computePortrait('S1', mockConn());
    assert.strictEqual(r.gpa, 0);
    assert.strictEqual(r.academic_score, 0);
    assert.strictEqual(r.total_score, 0);
  });

  test('单科 90 分 4 学分：GPA 4.0，学业分 22.5', async () => {
    const r = await computePortrait('S1', mockConn({ academic: [{ credit: 4, score: 90 }] }));
    assert.strictEqual(r.gpa, 4.0);
    assert.strictEqual(r.academic_score, 22.5);
  });

  test('绩点换算边界：89 分 → 3.9，90 分 → 4.0', async () => {
    const r89 = await computePortrait('S1', mockConn({ academic: [{ credit: 2, score: 89 }] }));
    const r90 = await computePortrait('S1', mockConn({ academic: [{ credit: 2, score: 90 }] }));
    assert.strictEqual(r89.gpa, 3.9);
    assert.strictEqual(r90.gpa, 4.0);
  });

  test('绩点换算边界：59 分 → 0，60 分 → 1.0', async () => {
    const r59 = await computePortrait('S1', mockConn({ academic: [{ credit: 2, score: 59 }] }));
    const r60 = await computePortrait('S1', mockConn({ academic: [{ credit: 2, score: 60 }] }));
    assert.strictEqual(r59.gpa, 0);
    assert.strictEqual(r60.gpa, 1.0);
  });

  test('多科按学分加权平均（绩点按分数段线性插值）', async () => {
    // 95 → 4.0；75 → 2.0+(75-70)/10 = 2.5；(4.0*4 + 2.5*2) / 6 = 3.5
    const r = await computePortrait('S1', mockConn({
      academic: [{ credit: 4, score: 95 }, { credit: 2, score: 75 }],
    }));
    assert.strictEqual(r.gpa, 3.5);
    // (95*4 + 75*2) / 6 = 88.333 * 0.25 = 22.08
    assert.strictEqual(r.academic_score, 22.08);
  });

  test('DECIMAL 以字符串返回时不会出现 NaN', async () => {
    const r = await computePortrait('S1', mockConn({
      academic: [{ credit: '4.00', score: '90.00' }],
    }));
    assert.ok(Number.isFinite(r.gpa), 'GPA 应为有效数字');
    assert.ok(Number.isFinite(r.academic_score), '学业分应为有效数字');
    assert.strictEqual(r.gpa, 4);
    assert.strictEqual(r.academic_score, 22.5);
  });

  test('学分为 0 时不参与计算，避免除零', async () => {
    const r = await computePortrait('S1', mockConn({ academic: [{ credit: 0, score: 100 }] }));
    assert.strictEqual(r.gpa, 0);
    assert.strictEqual(r.academic_score, 0);
  });
});

describe('画像计算 - 科研维度', () => {
  test('国家级项目记 10 分', async () => {
    const r = await computePortrait('S1', mockConn({ research: [{ level: '国家级' }] }));
    assert.strictEqual(r.research_score, 10);
  });

  test('省级 6 分、校级 3 分，多个项目累加', async () => {
    const r = await computePortrait('S1', mockConn({
      research: [{ level: '省级' }, { level: '校级' }, { level: '校级' }],
    }));
    assert.strictEqual(r.research_score, 12); // 6 + 3 + 3
  });

  test('未知级别不计分', async () => {
    const r = await computePortrait('S1', mockConn({ research: [{ level: '院级' }] }));
    assert.strictEqual(r.research_score, 0);
  });

  test('科研分超过 100 时封顶为 100', async () => {
    const many = Array.from({ length: 12 }, () => ({ level: '国家级' })); // 120 分
    const r = await computePortrait('S1', mockConn({ research: many }));
    assert.strictEqual(r.research_score, 100);
  });
});

describe('画像计算 - 实践维度', () => {
  test('每 10 小时记 1 分', async () => {
    const r = await computePortrait('S1', mockConn({ practice: [{ hours: 40 }] }));
    assert.strictEqual(r.practice_score, 4);
  });

  test('实践分超过 100 时封顶为 100', async () => {
    const r = await computePortrait('S1', mockConn({ practice: [{ hours: 1500 }] }));
    assert.strictEqual(r.practice_score, 100);
  });

  test('hours 为 null 时不报错，按 0 处理', async () => {
    const r = await computePortrait('S1', mockConn({ practice: [{ hours: null }] }));
    assert.strictEqual(r.practice_score, 0);
  });
});

describe('画像计算 - 综合总分', () => {
  test('总分 = 学业率×0.8 + 科研率×0.1 + 实践率×0.1（先归一再加权）', async () => {
    const r = await computePortrait('S1', mockConn({
      academic: [{ credit: 4, score: 80 }], // 学业 20 → 得分率 80%
      research: [{ level: '国家级' }],       // 科研 10 → 得分率 10%
      practice: [{ hours: 100 }],            // 实践 10 → 得分率 10%
    }));
    // 80*0.8 + 10*0.1 + 10*0.1 = 64 + 1 + 1 = 66
    assert.strictEqual(r.academic_score, 20);
    assert.strictEqual(r.research_score, 10);
    assert.strictEqual(r.practice_score, 10);
    assert.strictEqual(r.total_score, 66);
  });

  test('结果统一保留两位小数', async () => {
    const r = await computePortrait('S1', mockConn({
      academic: [{ credit: 3, score: 87 }],
      research: [{ level: '校级' }],
      practice: [{ hours: 25 }],
    }));
    assert.strictEqual(r.gpa, 3.7); // 3.0 + (87-80)/10 = 3.7
    assert.strictEqual(r.academic_score, 21.75); // 87×0.25
    // 学业率 21.75/25=87%，科研率 3%，实践率 2.5%
    // 87×0.8 + 3×0.1 + 2.5×0.1 = 69.6 + 0.3 + 0.25 = 70.15
    assert.strictEqual(r.total_score, 70.15);
  });

  test('总分上限为 100（各维满分时）', async () => {
    const ports = await computePortrait('S1', mockConn({
      academic: [{ credit: 4, score: 100 }], // 25 → 100%
      research: Array.from({ length: 10 }, () => ({ level: '国家级' })), // 100 → 100%
      practice: [{ hours: 1000 }], // 100 → 100%
    }));
    assert.strictEqual(ports.total_score, 100);
  });
});

describe('职业推荐', () => {
  test('学业科研双强 → 推荐学术研究方向', () => {
    const recs = computeCareerRecommendation({
      academic_score: 25, research_score: 12, practice_score: 5, total_score: 20, gpa: 3.5,
    });
    assert.strictEqual(recs.length >= 1, true);
    assert.strictEqual(recs[0].direction, '学术研究方向');
  });

  test('实践分高 → 推荐工程实践方向', () => {
    const recs = computeCareerRecommendation({
      academic_score: 15, research_score: 3, practice_score: 30, total_score: 15, gpa: 2.5,
    });
    assert.strictEqual(recs[0].direction, '工程实践方向');
  });

  test('各维度都低 → 推荐综合发展方向', () => {
    const recs = computeCareerRecommendation({
      academic_score: 10, research_score: 0, practice_score: 5, total_score: 5, gpa: 1.5,
    });
    assert.strictEqual(recs.length, 1);
    assert.strictEqual(recs[0].direction, '综合发展方向');
  });

  test('每条推荐都包含方向、理由和推荐度', () => {
    const recs = computeCareerRecommendation({
      academic_score: 25, research_score: 12, practice_score: 30, total_score: 20, gpa: 3.5,
    });
    for (const r of recs) {
      assert.ok(r.direction, '缺少 direction');
      assert.ok(r.reason, '缺少 reason');
      assert.ok(Number.isFinite(r.score), 'score 应为数字');
    }
    // 按推荐度降序
    for (let i = 1; i < recs.length; i++) {
      assert.ok(recs[i - 1].score >= recs[i].score, '推荐度应降序排列');
    }
  });
});

describe('维度归一化（toRates）', () => {
  test('各维按自身标准分换算成 0-100 得分率', () => {
    const r = toRates({ academic_score: 21.33, research_score: 3, practice_score: 0 });
    assert.strictEqual(r.academic, 85.32); // 21.33 / 25 × 100
    assert.strictEqual(r.research, 3);     // 3 / 100 × 100
    assert.strictEqual(r.practice, 0);
  });

  test('缺字段时按 0 处理，不出现 NaN', () => {
    const r = toRates({});
    assert.strictEqual(r.academic, 0);
    assert.strictEqual(r.research, 0);
    assert.strictEqual(r.practice, 0);
  });

  test('满分时得分率为 100', () => {
    const r = toRates({ academic_score: 25, research_score: 100, practice_score: 100 });
    assert.strictEqual(r.academic, 100);
    assert.strictEqual(r.research, 100);
    assert.strictEqual(r.practice, 100);
  });
});
