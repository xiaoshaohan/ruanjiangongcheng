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

// ---------- 首次启动时创建默认管理员 ----------
async function ensureDefaultUser() {
  const [rows] = await pool.query('SELECT COUNT(*) AS c FROM sys_user');
  if (rows[0].c === 0) {
    await pool.query(
      'INSERT INTO sys_user (username, password_hash, role) VALUES (?, ?, ?)',
      ['admin', hashPassword('admin123'), 'admin']
    );
    console.log('已创建默认管理员账号：admin / admin123');
  }
}

// ---------- 登录 ----------
router.post('/login', validate({
  username: { required: true, label: '用户名', type: 'string', maxLength: 50 },
  password: { required: true, label: '密码', type: 'string', maxLength: 100 },
}), asyncHandler(async (req, res) => {
  const { username, password } = req.body;

  const [rows] = await pool.query('SELECT * FROM sys_user WHERE username = ?', [username]);
  // 用户不存在与密码错误返回同一提示，避免暴露账号是否存在
  if (rows.length === 0) {
    return fail(res, 401, 401, '用户名或密码错误');
  }
  if (!verifyPassword(password, rows[0].password_hash)) {
    return fail(res, 401, 401, '用户名或密码错误');
  }
  // 被管理员禁用的账号不允许登录
  if (Number(rows[0].status) === 0) {
    return fail(res, 403, 403, '账号已被禁用，请联系管理员');
  }

  const token = signToken({
    id: rows[0].id,
    username: rows[0].username,
    role: rows[0].role,
    student_id: rows[0].student_id || null,
  });

  ok(res, {
    token,
    user: {
      username: rows[0].username,
      role: rows[0].role,
      student_id: rows[0].student_id || null,
    },
  }, '登录成功');
}));

// ---------- 注册 ----------
// 自助注册一律为 student 角色；教师和管理员账号由管理员在"用户管理"里创建或调整
router.post('/register', validate({
  username: { required: true, label: '用户名', type: 'string', maxLength: 50 },
  password: { required: true, label: '密码', type: 'string', maxLength: 100 },
}), asyncHandler(async (req, res) => {
  const { username, password, student_id } = req.body;

  // 校验中间件不支持字符串最小长度，这里手动补充
  if (username.length < 3) return fail(res, 400, 400, '用户名至少3个字符');
  if (password.length < 6) return fail(res, 400, 400, '密码至少6位');

  // 查重，避免用户名重复
  const [exists] = await pool.query('SELECT id FROM sys_user WHERE username = ?', [username]);
  if (exists.length > 0) return fail(res, 400, 400, '用户名已被注册');

  // 填了学号则校验学生存在，并确认该学号没被别的账号绑定
  let boundStudentId = null;
  if (student_id) {
    const [students] = await pool.query('SELECT student_id FROM student WHERE student_id = ?', [student_id]);
    if (students.length === 0) return fail(res, 400, 400, '学号不存在，请核对后重试');

    const [bound] = await pool.query('SELECT id FROM sys_user WHERE student_id = ?', [student_id]);
    if (bound.length > 0) return fail(res, 400, 400, '该学号已被其他账号绑定');
    boundStudentId = student_id;
  }

  await pool.query(
    'INSERT INTO sys_user (username, password_hash, role, student_id) VALUES (?, ?, ?, ?)',
    [username, hashPassword(password), 'student', boundStudentId]
  );
  ok(res, { username, role: 'student', student_id: boundStudentId }, '注册成功');
}));

// ---------- 修改密码 ----------
router.post('/change-password', authRequired, validate({
  oldPassword: { required: true, label: '原密码', type: 'string', maxLength: 100 },
  newPassword: { required: true, label: '新密码', type: 'string', maxLength: 100 },
}), asyncHandler(async (req, res) => {
  const { oldPassword, newPassword } = req.body;

  if (newPassword.length < 6) return fail(res, 400, 400, '新密码至少6位');

  const [rows] = await pool.query('SELECT * FROM sys_user WHERE id = ?', [req.user.id]);
  if (rows.length === 0) return fail(res, 404, 404, '用户不存在');

  if (!verifyPassword(oldPassword, rows[0].password_hash)) {
    return fail(res, 400, 400, '原密码不正确');
  }

  await pool.query('UPDATE sys_user SET password_hash = ? WHERE id = ?', [hashPassword(newPassword), req.user.id]);
  ok(res, {}, '密码修改成功，请重新登录');
}));

// ---------- 获取当前登录用户 ----------
router.get('/me', authRequired, asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT username, role, status, student_id FROM sys_user WHERE id = ?',
    [req.user.id]
  );
  if (rows.length === 0) return fail(res, 404, 404, '用户不存在');
  ok(res, {
    username: rows[0].username,
    role: rows[0].role,
    status: Number(rows[0].status),
    student_id: rows[0].student_id || null,
  });
}));

module.exports = router;
module.exports.ensureDefaultUser = ensureDefaultUser;
module.exports.hashPassword = hashPassword;
