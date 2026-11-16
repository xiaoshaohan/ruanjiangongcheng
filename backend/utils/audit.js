// 敏感操作审计：记录操作人、动作、对象与变更前后值（R49）
const pool = require('../config/db');

async function writeAudit(req, { action, targetType, targetId, before, after }) {
  try {
    const actor = req.user || {};
    await pool.query(
      `INSERT INTO audit_log
         (actor_id, actor_username, actor_role, action, target_type, target_id, before_value, after_value, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        actor.id || null,
        actor.username || '',
        actor.role || '',
        action,
        targetType || null,
        targetId === undefined || targetId === null ? null : String(targetId),
        before ? JSON.stringify(before).slice(0, 2000) : null,
        after ? JSON.stringify(after).slice(0, 2000) : null,
        String(req.ip || '').replace('::ffff:', '').slice(0, 45),
        String(req.headers['user-agent'] || '').slice(0, 255),
      ]
    );
  } catch (err) {
    // 审计不可用时不能阻断业务，只记录服务端日志
    console.error('[审计写入失败]', action, err.message);
  }
}

module.exports = { writeAudit };
