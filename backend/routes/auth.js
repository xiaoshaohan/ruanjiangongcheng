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

  const token = signToken({
    id: rows[0].id,
    username: rows[0].username,
    role: rows[0].role,
  });

  ok(res, {
    token,
    user: { username: rows[0].username, role: rows[0].role },
  }, '登录成功');
}));

// ---------- 获取当前登录用户 ----------
router.get('/me', authRequired, (req, res) => {
  ok(res, { username: req.user.username, role: req.user.role });
});

module.exports = router;
module.exports.ensureDefaultUser = ensureDefaultUser;
