// 统一响应格式与错误处理

// 成功响应
const ok = (res, data, message) => res.json({ code: 200, message, data });

// 失败响应
const fail = (res, status, code, message) => res.status(status).json({ code, message });

// 异步路由统一错误处理
const asyncHandler = (fn) => (req, res) => {
  fn(req, res).catch((err) => {
    console.error('[API错误]', req.method, req.path, err.message);
    if (res.headersSent) return;
    fail(res, 500, 500, '服务器内部错误，请稍后重试');
  });
};

module.exports = { ok, fail, asyncHandler };