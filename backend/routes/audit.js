// 审计日志查询（仅管理员）
const express = require('express');
const pool = require('../config/db');
const { ok, fail, asyncHandler } = require('../utils/response');

const router = express.Router();

// 最近的操作记录，可按动作与操作人筛选
router.get('/', asyncHandler(async (req, res) => {
  const { action, actor, limit } = req.query;
  const conds = [];
  const params = [];

  if (action) { conds.push('action = ?'); params.push(String(action)); }
  if (actor) { conds.push('actor_username = ?'); params.push(String(actor)); }

  const take = Math.min(500, Math.max(1, Number(limit) || 100));
  if (!Number.isInteger(take)) return fail(res, 400, 400, 'limit 必须是整数');

  const [rows] = await pool.query(
    `SELECT id, actor_username, actor_role, action, target_type, target_id,
            before_value, after_value, ip, created_at
     FROM audit_log
     ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
     ORDER BY id DESC
     LIMIT ?`,
    [...params, take]
  );

  ok(res, rows);
}));

module.exports = router;
