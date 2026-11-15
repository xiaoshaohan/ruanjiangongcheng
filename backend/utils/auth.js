// JWT 鉴权中间件
const jwt = require('jsonwebtoken');
const { fail } = require('./response');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

// 校验请求头 Authorization: Bearer <token>
function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  if (!token) {
    return fail(res, 401, 401, '未登录或登录已过期');
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return fail(res, 401, 401, '未登录或登录已过期');
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

// 签发 token（有效期 8 小时）
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
}

module.exports = { authRequired, roleRequired, adminOnly, staffOnly, signToken, JWT_SECRET };
