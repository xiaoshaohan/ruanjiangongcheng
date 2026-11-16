// JWT 鉴权中间件
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { fail } = require('./response');

const MIN_SECRET_LENGTH = 32;
const RAW_SECRET = process.env.JWT_SECRET || '';
const IS_TEST = process.env.NODE_ENV === 'test';

// R01：密钥必须来自环境变量且足够长，不再接受硬编码回退值。
// 测试环境使用独立固定值，避免单元测试依赖本机 .env。
const JWT_SECRET = RAW_SECRET || (IS_TEST ? 'unit-test-secret-only-not-for-production' : '');

if (!IS_TEST) {
  if (!RAW_SECRET) {
    console.error('[启动失败] 未配置 JWT_SECRET：请在 backend/.env 中设置至少 32 位的随机字符串后重启。');
    process.exit(1);
  }
  if (RAW_SECRET.length < MIN_SECRET_LENGTH) {
    console.error(`[启动失败] JWT_SECRET 长度不足 ${MIN_SECRET_LENGTH} 位：请更换更长的随机密钥后重启。`);
    process.exit(1);
  }
}

const JWT_OPTIONS = { expiresIn: '8h', issuer: 'student-portrait', audience: 'student-portrait-web' };

// 校验请求头 Authorization: Bearer <token>
// R03：token 通过后回查数据库，账号被禁用、删除、改角色或改密码（token_version 递增）时旧 token 立即失效
async function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  if (!token) {
    return fail(res, 401, 401, '未登录或登录已过期');
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET, {
      issuer: JWT_OPTIONS.issuer,
      audience: JWT_OPTIONS.audience,
    });
  } catch (err) {
    return fail(res, 401, 401, '未登录或登录已过期');
  }

  try {
    // 延迟加载，便于单元测试注入数据库替身
    const pool = require('../config/db');
    const [rows] = await pool.query(
      `SELECT id, username, role, status, student_id, teacher_no, token_version
       FROM sys_user WHERE id = ?`,
      [payload.id]
    );

    if (rows.length === 0) {
      return fail(res, 401, 401, '账号不存在或已被删除，请重新登录');
    }

    const user = rows[0];
    if (Number(user.status) !== 1) {
      return fail(res, 401, 401, '账号已被禁用，请联系管理员');
    }
    if (Number(user.token_version || 0) !== Number(payload.tv || 0)) {
      return fail(res, 401, 401, '账号状态已变更，请重新登录');
    }

    // 角色与绑定关系以数据库为准，避免旧 token 固化过期权限
    req.user = {
      id: user.id,
      username: user.username,
      role: user.role,
      student_id: user.student_id || null,
      teacher_no: user.teacher_no || null,
      tv: Number(user.token_version || 0),
    };
    return next();
  } catch (err) {
    return next(err);
  }
}

// 角色限制：必须放在 authRequired 之后使用
// 用法：router.get('/', authRequired, roleRequired('admin', 'teacher'), handler)
function roleRequired(...roles) {
  return (req, res, next) => {
    const role = req.user && req.user.role;
    if (!role || !roles.includes(role)) {
      return fail(res, 403, 403, '当前账号无权访问该功能');
    }
    next();
  };
}

// 管理员专用
const adminOnly = roleRequired('admin');
// 管理员和教师（用于只读、录入、统计类接口）
const staffOnly = roleRequired('admin', 'teacher');

// 签发 token（有效期 8 小时；token_version 用于服务端撤销）
function signToken(payload) {
  const version = Number(payload && payload.tv) || 0;
  return jwt.sign(
    { ...payload, tv: version },
    JWT_SECRET,
    { ...JWT_OPTIONS, jwtid: crypto.randomBytes(8).toString('hex') }
  );
}

module.exports = {
  authRequired,
  roleRequired,
  adminOnly,
  staffOnly,
  signToken,
  JWT_SECRET,
  JWT_OPTIONS,
};
