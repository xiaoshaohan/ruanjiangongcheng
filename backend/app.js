const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const { fail } = require('./utils/response');
const { authRequired } = require('./utils/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// 请求体上限：导入接口按 5000 行设计，默认 100KB 会让真实 CSV 直接 500（R07）
const BODY_LIMIT = process.env.BODY_LIMIT || '10mb';

// ---------- 安全响应头（R47） ----------
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // 前端已把 ECharts 本地化到 frontend/js，这里不再放行外部 CDN（M4）
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
    "style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'"
  );
  next();
});

// ---------- CORS：默认同源，额外来源用 CORS_ORIGINS 白名单显式放开 ----------
const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    // 同源请求、curl、服务端调用没有 Origin 头
    if (!origin) return callback(null, true);
    if (corsOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
}));

app.use(express.json({ limit: BODY_LIMIT }));

// 请求日志中间件
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const cost = Date.now() - start;
    console.log(`[${new Date().toLocaleString()}] ${req.method} ${req.path} - ${res.statusCode} (${cost}ms)`);
  });
  next();
});

// favicon 兜底，避免控制台 404（R48）
app.get('/favicon.ico', (req, res) => res.status(204).end());

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
app.use('/api/audit', adminOnly, require('./routes/audit'));
// 教师基础数据（列表/导入仅管理员，教师可查看自己负责的学生）
app.use('/api/teachers', require('./routes/teachers'));
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
  // 超过 body 上限要返回 413，而不是笼统的 500（R07）
  if (err.type === 'entity.too.large') {
    return fail(res, 413, 413, `导入数据过大，单次请求上限 ${BODY_LIMIT}，请拆分文件后重试`);
  }
  if (res.headersSent) return next(err);
  fail(res, 500, 500, '服务器内部错误');
});

// 启动服务：先完成默认账号初始化，失败直接退出，避免"服务在跑但没有可用管理员"（S1）
async function bootstrap() {
  await authRouter.ensureDefaultUser();
  app.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('启动失败:', err.message);
  process.exit(1);
});
