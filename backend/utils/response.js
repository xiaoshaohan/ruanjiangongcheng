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

    // 数据库约束错误是"用户填错"，不应该报成"服务器故障"
    if (err && err.code === 'ER_DUP_ENTRY') {
      return fail(res, 400, 400, '数据已存在，请检查学号或用户名是否重复');
    }
    if (err && (err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_NO_REFERENCED_ROW')) {
      return fail(res, 400, 400, '学号不存在，请先添加该学生');
    }
    if (err && (err.code === 'ER_DATA_TOO_LONG' || err.code === 'WARN_DATA_TRUNCATED')) {
      return fail(res, 400, 400, '输入内容超出字段长度限制');
    }
    fail(res, 500, 500, '服务器内部错误，请稍后重试');
  });
};

module.exports = { ok, fail, asyncHandler };