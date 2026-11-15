// 接口测试：使用内存替身模拟数据库，运行时不会连接真实 MySQL。
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');

const salt = 'test-salt';
const passwordHash = `${salt}:${crypto.scryptSync('admin123', salt, 64).toString('hex')}`;
const records = [];
const student = { student_id: 'TEST001', name: '测试学生' };
let savedProfile;

// 只模拟本测试涉及的查询；遇到未覆盖的 SQL 时直接报错。
const connection = {
  async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
  async query(sql, args) {
    if (sql.includes('SELECT student_id FROM student')) return [args[0] === student.student_id ? [student] : []];
    if (sql.includes('FROM academic_record')) return [records];
    if (sql.includes('FROM research_project') || sql.includes('FROM practice_activity')) return [[]];
    // 画像计算后会把推荐写入历史表，这里只需要让写入与批次查询通过
    if (sql.includes('INSERT INTO career_recommendation')) return [{}];
    if (sql.includes('DISTINCT batch_at FROM career_recommendation')) return [[]];
    if (sql.includes('INSERT INTO ability_profile')) {
      savedProfile = { student_id: args[0], gpa: args[1], academic_score: args[2], research_score: args[3], practice_score: args[4], total_score: args[5], name: student.name };
      return [{}];
    }
    throw new Error(`未模拟的查询: ${sql}`);
  },
};
const pool = {
  async getConnection() { return connection; },
  async query(sql, args) {
    if (sql.includes('SELECT * FROM sys_user')) return [args[0] === 'admin' ? [{ id: 1, username: 'admin', role: 'admin', password_hash: passwordHash }] : []];
    // 录入前会校验学号是否存在
    if (sql.includes('SELECT student_id FROM student')) return [args[0] === student.student_id ? [student] : []];
    // 配置表返回空，走默认计分规则
    if (sql.includes('FROM portrait_config')) return [[]];
    if (sql.includes('INSERT INTO academic_record')) {
      records.push({ student_id: args[0], course_name: args[1], credit: args[2], score: args[3], semester: args[4] });
      return [{}];
    }
    if (sql.includes('FROM academic_record')) return [records.filter(row => row.student_id === args[0])];
    if (sql.includes('FROM ability_profile p')) return [savedProfile && savedProfile.student_id === args[0] ? [savedProfile] : []];
    throw new Error(`未模拟的查询: ${sql}`);
  },
};

// 在加载路由之前注入替身，不启动项目数据库连接池。
const dbPath = require.resolve('../config/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: pool };
const { authRequired } = require('../utils/auth');
const app = express();
app.use(express.json());
app.use('/api/auth', require('../routes/auth'));
app.use('/api', authRequired);
app.use('/api/academic', require('../routes/academic'));
app.use('/api/portrait', require('../routes/portrait'));

let server, base, token;
async function request(path, method = 'GET', body, authenticated = true) {
  const response = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(authenticated && token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}
before(async () => {
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve())); });

test('未登录不能查询，错误密码不能登录，正确密码可以登录', async () => {
  assert.equal((await request('/api/academic/TEST001')).status, 401);
  assert.equal((await request('/api/auth/login', 'POST', { username: 'admin', password: 'wrong' })).status, 401);
  const result = await request('/api/auth/login', 'POST', { username: 'admin', password: 'admin123' });
  assert.equal(result.status, 200);
  assert.ok(result.body.data.token);
  token = result.body.data.token;
});

test('成绩越界被拒绝，未写入记录', async () => {
  const result = await request('/api/academic', 'POST', { student_id: 'TEST001', course_name: '测试课程', credit: 4, score: 101 });
  assert.equal(result.status, 400);
  assert.equal(records.length, 0);
});

test('录入两门成绩后计算并查询画像', async () => {
  for (const [course_name, score] of [['测试课程', 80], ['软件工程', 100]]) {
    const result = await request('/api/academic', 'POST', { student_id: 'TEST001', course_name, credit: 4, score, semester: '2026-1' });
    assert.equal(result.status, 200);
  }
  const grades = await request('/api/academic/TEST001');
  assert.equal(grades.body.data.length, 2);
  const result = await request('/api/portrait/calculate/TEST001', 'POST');
  assert.equal(result.status, 200);
  assert.equal(result.body.data.gpa, 3.5);
  assert.equal(result.body.data.academic_score, 22.5);
  // 归一化口径：学业率 22.5/25 = 90%，科研/实践为 0 → 总分 = 90×0.4 = 36
  assert.equal(result.body.data.total_score, 36);
  const saved = await request('/api/portrait/TEST001');
  assert.equal(saved.status, 200);
  assert.equal(saved.body.data.academic_score, 22.5);
  // 查询接口附带得分率，供前端统一展示
  assert.equal(saved.body.data.rates.academic, 90);
});

test('不存在的学生不能计算画像', async () => {
  const result = await request('/api/portrait/calculate/NOT_FOUND', 'POST');
  assert.equal(result.status, 404);
});
