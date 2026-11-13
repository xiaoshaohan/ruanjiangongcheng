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

// 签发 token（有效期 8 小时）
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
}

module.exports = { authRequired, signToken, JWT_SECRET };
