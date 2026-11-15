const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const { fail } = require('./utils/response');
const { authRequired } = require('./utils/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- 中间件 ----------
app.use(cors());
app.use(express.json());

// 请求日志中间件
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const cost = Date.now() - start;
    console.log(`[${new Date().toLocaleString()}] ${req.method} ${req.path} - ${res.statusCode} (${cost}ms)`);
  });
  next();
});

// 静态资源：HTML 每次都向服务器确认，避免改了页面浏览器还显示旧版
app.use(express.static(__dirname + '/../frontend', {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  },
}));

// ---------- 登录（无需鉴权） ----------
const authRouter = require('./routes/auth');
app.use('/api/auth', authRouter);

// ---------- 以下所有 /api 接口需要登录 ----------
app.use('/api', authRequired);

// ---------- 路由（按角色分组） ----------
// 管理端功能：管理员和教师可用
const { adminOnly, staffOnly } = require('./utils/auth');
app.use('/api/students', staffOnly, require('./routes/students'));
app.use('/api/academic', staffOnly, require('./routes/academic'));
app.use('/api/research', staffOnly, require('./routes/research'));
app.use('/api/practice', staffOnly, require('./routes/practice'));
app.use('/api/portrait', staffOnly, require('./routes/portrait'));
app.use('/api/stats', staffOnly, require('./routes/stats'));
app.use('/api/export', staffOnly, require('./routes/export'));
// 仅管理员可用
app.use('/api/import', adminOnly, require('./routes/import'));
app.use('/api/users', adminOnly, require('./routes/users'));
// 系统配置（读接口教师可用，写接口内部仅管理员）
app.use('/api/config', require('./routes/config'));
// 学生个人视图（学生角色专用）
app.use('/api/me', require('./routes/me'));

// ---------- 404 兜底 ----------
app.use((req, res) => fail(res, 404, 404, '接口不存在'));

// ---------- 全局错误兜底 ----------
app.use((err, req, res, next) => {
  console.error('[全局错误]', req.method, req.path, err.message);
  // 请求体 JSON 解析失败
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return fail(res, 400, 400, '请求体不是合法的 JSON');
  }
  if (res.headersSent) return next(err);
  fail(res, 500, 500, '服务器内部错误');
});

// 启动服务
app.listen(PORT, async () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
  try {
    await authRouter.ensureDefaultUser();
  } catch (err) {
    console.error('初始化默认账号失败:', err.message);
  }
});