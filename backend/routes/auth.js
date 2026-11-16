// 登录鉴权路由
const express = require('express');
const crypto = require('crypto');
const pool = require('../config/db');
const { ok, fail, asyncHandler } = require('../utils/response');
const { validate } = require('../utils/validate');
const { authRequired, signToken } = require('../utils/auth');

const router = express.Router();

// ---------- 密码哈希（scrypt，无需额外依赖） ----------
function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `${salt}:${key}`;
}

function verifyPassword(plain, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, key] = stored.split(':');
  const derived = crypto.scryptSync(plain, salt, 64).toString('hex');
  // 定长比较，避免时序攻击
  const a = Buffer.from(key, 'hex');
  const b = Buffer.from(derived, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- 密码强度策略（R37） ----------
const MIN_PASSWORD_LENGTH = 8;
// 常见弱口令，新密码不允许直接使用
const WEAK_PASSWORDS = new Set([
  '12345678', '123456789', '11111111', '00000000', '88888888',
  'password', 'passw0rd', 'admin123', 'qwerty123', 'abc12345',
  'iloveyou', 'woaini1314',
]);

function passwordProblem(plain) {
  const pwd = String(plain || '');
  if (pwd.length < MIN_PASSWORD_LENGTH) return `密码至少${MIN_PASSWORD_LENGTH}位`;
  if (WEAK_PASSWORDS.has(pwd.toLowerCase())) return '密码过于常见，请更换为更复杂的密码';
  if (/^(\d)\1+$/.test(pwd)) return '密码不能是重复的数字';
  return null;
}

// ---------- 登录失败锁定（R36，单实例内存实现） ----------
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 分钟
const LOGIN_MAX_FAILURES = 5;
const loginFailures = new Map(); // key -> { count, firstAt, lockedUntil }

function failureKey(req, username) {
  const ip = (req.ip || req.socket?.remoteAddress || '').replace('::ffff:', '');
  return `${ip}|${String(username || '').toLowerCase()}`;
}

function checkLoginLock(key) {
  const record = loginFailures.get(key);
  if (!record) return 0;
  if (record.lockedUntil && record.lockedUntil > Date.now()) {
    return Math.ceil((record.lockedUntil - Date.now()) / 60000);
  }
  return 0;
}

function recordLoginFailure(key) {
  const now = Date.now();
  let record = loginFailures.get(key);
  if (!record || now - record.firstAt > LOGIN_WINDOW_MS) {
    record = { count: 0, firstAt: now, lockedUntil: 0 };
  }
  record.count += 1;
  if (record.count >= LOGIN_MAX_FAILURES) {
    record.lockedUntil = now + LOGIN_WINDOW_MS;
    record.count = 0;
    record.firstAt = now;
  }
  loginFailures.set(key, record);
}

function clearLoginFailure(key) {
  loginFailures.delete(key);
}

// ---------- 注册限流：同一来源每小时最多 10 次注册尝试 ----------
const REGISTER_WINDOW_MS = 60 * 60 * 1000;
const REGISTER_MAX = 10;
const registerHits = new Map();

function registerRateLimited(req) {
  const ip = (req.ip || req.socket?.remoteAddress || '').replace('::ffff:', '');
  const now = Date.now();
  const list = (registerHits.get(ip) || []).filter((t) => now - t < REGISTER_WINDOW_MS);
  if (list.length >= REGISTER_MAX) return true;
  list.push(now);
  registerHits.set(ip, list);
  return false;
}

// ---------- 首次启动时创建默认管理员（R37） ----------
async function ensureDefaultUser() {
  const [rows] = await pool.query('SELECT COUNT(*) AS c FROM sys_user');
  if (rows[0].c === 0) {
    const initial = process.env.ADMIN_INIT_PASSWORD || 'admin123';
    await pool.query(
      'INSERT INTO sys_user (username, password_hash, role) VALUES (?, ?, ?)',
      ['admin', hashPassword(initial), 'admin']
    );
    console.log('已创建初始管理员账号 admin');
    if (!process.env.ADMIN_INIT_PASSWORD) {
      console.warn('警告：使用了内置初始密码，请立即登录修改密码，或在 .env 中配置 ADMIN_INIT_PASSWORD 后重新初始化');
    } else {
      console.log('初始密码来自环境变量 ADMIN_INIT_PASSWORD');
    }
  }
}

// ---------- 登录 ----------
router.post('/login', validate({
  username: { required: true, label: '用户名', type: 'string', maxLength: 50 },
  password: { required: true, label: '密码', type: 'string', maxLength: 100 },
}), asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  // R51：用户名统一按小写处理，避免 ADMIN 与 admin 被当成两个账号
  const account = String(username).trim().toLowerCase();
  const key = failureKey(req, account);

  const lockedMinutes = checkLoginLock(key);
  if (lockedMinutes > 0) {
    return fail(res, 429, 429, `登录失败次数过多，请 ${lockedMinutes} 分钟后再试`);
  }

  const [rows] = await pool.query('SELECT * FROM sys_user WHERE username = ?', [account]);
  // 用户不存在与密码错误返回同一提示，避免暴露账号是否存在
  if (rows.length === 0) {
    recordLoginFailure(key);
    return fail(res, 401, 401, '用户名或密码错误');
  }
  if (!verifyPassword(password, rows[0].password_hash)) {
    recordLoginFailure(key);
    return fail(res, 401, 401, '用户名或密码错误');
  }
  // 被管理员禁用的账号不允许登录
  if (Number(rows[0].status) === 0) {
    return fail(res, 403, 403, '账号已被禁用，请联系管理员');
  }

  clearLoginFailure(key);

  const tokenVersion = Number(rows[0].token_version || 0);
  const token = signToken({
    id: rows[0].id,
    username: rows[0].username,
    role: rows[0].role,
    student_id: rows[0].student_id || null,
    teacher_no: rows[0].teacher_no || null,
    tv: tokenVersion,
  });

  ok(res, {
    token,
    user: {
      id: rows[0].id,
      username: rows[0].username,
      role: rows[0].role,
      student_id: rows[0].student_id || null,
      teacher_no: rows[0].teacher_no || null,
    },
  }, '登录成功');
}));

// ---------- 注册 ----------
// R02：教师账号一律由管理员创建，不再开放自助注册；学生注册必须同时校验学号与姓名一致
router.post('/register', asyncHandler(async (req, res) => {
  if (registerRateLimited(req)) {
    return fail(res, 429, 429, '注册尝试过于频繁，请稍后再试');
  }

  const { username, password, identity, student_id, name } = req.body || {};

  // R45：identity 必填且只能是 student / teacher，缺失或未知值不再默认按学生处理
  if (identity === undefined || identity === null || identity === '') {
    return fail(res, 400, 400, '请选择注册身份');
  }
  if (!['student', 'teacher'].includes(identity)) {
    return fail(res, 400, 400, '注册身份只能是学生或教师');
  }
  // R02：教师账号一律由管理员创建，不开放自助注册
  if (identity === 'teacher') {
    return fail(res, 403, 403, '教师账号由管理员统一创建，不开放自助注册');
  }

  const account = String(username || '').trim().toLowerCase();
  if (!account || !password) return fail(res, 400, 400, '用户名和密码不能为空');
  if (account.length < 3) return fail(res, 400, 400, '用户名至少3个字符');
  if (account.length > 50) return fail(res, 400, 400, '用户名不能超过50个字符');

  const pwdError = passwordProblem(password);
  if (pwdError) return fail(res, 400, 400, pwdError);

  if (!student_id) return fail(res, 400, 400, '学生注册必须填写学号');
  if (!name || !String(name).trim()) return fail(res, 400, 400, '学生注册必须填写姓名用于学号认证');

  // 查重，避免用户名重复
  const [exists] = await pool.query('SELECT id FROM sys_user WHERE username = ?', [account]);
  if (exists.length > 0) return fail(res, 400, 400, '用户名已被注册');

  // 学生认证：学号必须存在，且姓名与学籍库一致
  const [students] = await pool.query('SELECT student_id, name FROM student WHERE student_id = ?', [student_id]);
  if (students.length === 0) return fail(res, 400, 400, '学号不存在，请核对后重试');
  if (String(students[0].name).trim() !== String(name).trim()) {
    return fail(res, 400, 400, '学号与姓名不匹配，请核对后重试');
  }

  const [bound] = await pool.query('SELECT id FROM sys_user WHERE student_id = ?', [student_id]);
  if (bound.length > 0) return fail(res, 400, 400, '该学号已被其他账号绑定');

  try {
    await pool.query(
      'INSERT INTO sys_user (username, password_hash, role, student_id) VALUES (?, ?, ?, ?)',
      [account, hashPassword(password), 'student', student_id]
    );
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      return fail(res, 409, 409, '该学号已被其他账号绑定或用户名已存在');
    }
    throw err;
  }

  ok(res, { username: account, role: 'student', student_id }, '注册成功');
}));

// ---------- 修改密码 ----------
router.post('/change-password', authRequired, validate({
  oldPassword: { required: true, label: '原密码', type: 'string', maxLength: 100 },
  newPassword: { required: true, label: '新密码', type: 'string', maxLength: 100 },
}), asyncHandler(async (req, res) => {
  const { oldPassword, newPassword } = req.body;

  const pwdError = passwordProblem(newPassword);
  if (pwdError) return fail(res, 400, 400, pwdError);

  const [rows] = await pool.query('SELECT * FROM sys_user WHERE id = ?', [req.user.id]);
  if (rows.length === 0) return fail(res, 404, 404, '用户不存在');

  if (!verifyPassword(oldPassword, rows[0].password_hash)) {
    return fail(res, 400, 400, '原密码不正确');
  }

  // R03：改密后递增 token_version，让此前签发的 token 全部失效
  await pool.query(
    'UPDATE sys_user SET password_hash = ?, token_version = token_version + 1 WHERE id = ?',
    [hashPassword(newPassword), req.user.id]
  );
  ok(res, {}, '密码修改成功，请重新登录');
}));

// ---------- 获取当前登录用户（R34：与登录响应字段保持一致） ----------
router.get('/me', authRequired, asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, username, role, status, student_id, teacher_no
     FROM sys_user WHERE id = ?`,
    [req.user.id]
  );
  if (rows.length === 0) return fail(res, 404, 404, '用户不存在');
  ok(res, {
    id: rows[0].id,
    username: rows[0].username,
    role: rows[0].role,
    status: Number(rows[0].status),
    student_id: rows[0].student_id || null,
    teacher_no: rows[0].teacher_no || null,
  });
}));

module.exports = router;
module.exports.ensureDefaultUser = ensureDefaultUser;
module.exports.hashPassword = hashPassword;
module.exports.verifyPassword = verifyPassword;
module.exports.passwordProblem = passwordProblem;
