// 用户与权限管理（仅管理员可访问）
const express = require('express');
const pool = require('../config/db');
const { ok, fail, asyncHandler } = require('../utils/response');
const { authRequired, adminOnly } = require('../utils/auth');
const { hashPassword, passwordProblem } = require('./auth');
const { writeAudit } = require('../utils/audit');

const router = express.Router();

const ROLES = ['admin', 'teacher', 'student'];

// 用户列表
router.get('/', authRequired, adminOnly, asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT u.id, u.username, u.role, u.status, u.student_id, u.teacher_no, u.created_at,
            s.name AS student_name, t.name AS teacher_name
     FROM sys_user u
     LEFT JOIN student s ON u.student_id = s.student_id
     LEFT JOIN teacher t ON u.teacher_no = t.teacher_no
     ORDER BY u.role, u.id`
  );
  ok(res, rows.map((r) => ({ ...r, status: Number(r.status) })));
}));

// 新建用户（可由管理员直接指定角色）
router.post('/', authRequired, adminOnly, asyncHandler(async (req, res) => {
  const { password, role, student_id, teacher_no } = req.body;
  // R51：用户名统一小写存储，避免 ADMIN / admin 被当成两个账号
  const username = String(req.body.username || '').trim().toLowerCase();

  if (!username || !password) return fail(res, 400, 400, '用户名和密码不能为空');
  if (username.length < 3) return fail(res, 400, 400, '用户名至少3个字符');
  // R33：统一密码策略，管理员建号也不能使用 6 位弱口令
  const pwdError = passwordProblem(password);
  if (pwdError) return fail(res, 400, 400, pwdError);
  if (!ROLES.includes(role)) return fail(res, 400, 400, '角色只能是 admin / teacher / student');

  const [exists] = await pool.query('SELECT id FROM sys_user WHERE username = ?', [username]);
  if (exists.length > 0) return fail(res, 400, 400, '用户名已被占用');

  let boundStudentId = null;
  let boundTeacherNo = null;
  if (role === 'student' && student_id) {
    const [students] = await pool.query('SELECT student_id FROM student WHERE student_id = ?', [student_id]);
    if (students.length === 0) return fail(res, 400, 400, '学号不存在');

    const [bound] = await pool.query('SELECT id FROM sys_user WHERE student_id = ?', [student_id]);
    if (bound.length > 0) return fail(res, 400, 400, '该学号已被其他账号绑定');
    boundStudentId = student_id;
  }
  if (role === 'teacher') {
    if (!teacher_no) return fail(res, 400, 400, '教师账号必须绑定工号');
    const [teachers] = await pool.query('SELECT teacher_no FROM teacher WHERE teacher_no = ?', [teacher_no]);
    if (teachers.length === 0) return fail(res, 400, 400, '工号不存在');

    const [bound] = await pool.query('SELECT id FROM sys_user WHERE teacher_no = ?', [teacher_no]);
    if (bound.length > 0) return fail(res, 400, 400, '该工号已被其他账号绑定');
    boundTeacherNo = teacher_no;
  }

  const [result] = await pool.query(
    'INSERT INTO sys_user (username, password_hash, role, student_id, teacher_no) VALUES (?, ?, ?, ?, ?)',
    [username, hashPassword(password), role, boundStudentId, boundTeacherNo]
  );
  await writeAudit(req, {
    action: 'user.create',
    targetType: 'user',
    targetId: result.insertId,
    after: { username, role, student_id: boundStudentId, teacher_no: boundTeacherNo },
  });
  ok(res, { id: result.insertId, username, role, student_id: boundStudentId, teacher_no: boundTeacherNo }, '用户创建成功');
}));

// 修改角色 / 启停用 / 绑定学号或工号
router.put('/:id', authRequired, adminOnly, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return fail(res, 400, 400, '用户编号不合法');

  const [rows] = await pool.query('SELECT * FROM sys_user WHERE id = ?', [id]);
  if (rows.length === 0) return fail(res, 404, 404, '用户不存在');
  const current = rows[0];

  const role = req.body.role !== undefined ? req.body.role : current.role;
  const status = req.body.status !== undefined ? Number(req.body.status) : Number(current.status);
  const studentId = req.body.student_id !== undefined ? req.body.student_id : current.student_id;
  const teacherNo = req.body.teacher_no !== undefined ? req.body.teacher_no : current.teacher_no;

  if (!ROLES.includes(role)) return fail(res, 400, 400, '角色只能是 admin / teacher / student');
  if (![0, 1].includes(status)) return fail(res, 400, 400, '状态只能是 0 或 1');

  // 不允许把唯一的启用管理员降级或禁用，否则系统将无人可管
  const isChangingAdmin = req.user.id === id;
  if (isChangingAdmin && (role !== 'admin' || status === 0)) {
    const [[adminCount]] = await pool.query(
      "SELECT COUNT(*) AS c FROM sys_user WHERE role = 'admin' AND status = 1"
    );
    if (adminCount.c <= 1) {
      return fail(res, 400, 400, '系统至少保留一个启用的管理员账号');
    }
  }

  let boundStudentId = null;
  if (role === 'student' && studentId) {
    const [students] = await pool.query('SELECT student_id FROM student WHERE student_id = ?', [studentId]);
    if (students.length === 0) return fail(res, 400, 400, '学号不存在');

    const [bound] = await pool.query('SELECT id FROM sys_user WHERE student_id = ?', [studentId]);
    if (bound.length > 0 && bound[0].id !== id) return fail(res, 400, 400, '该学号已被其他账号绑定');
    boundStudentId = studentId;
  }

  let boundTeacherNo = null;
  if (role === 'teacher') {
    if (!teacherNo) return fail(res, 400, 400, '教师账号必须绑定工号');
    const [teachers] = await pool.query('SELECT teacher_no FROM teacher WHERE teacher_no = ?', [teacherNo]);
    if (teachers.length === 0) return fail(res, 400, 400, '工号不存在');

    const [bound] = await pool.query('SELECT id FROM sys_user WHERE teacher_no = ?', [teacherNo]);
    if (bound.length > 0 && bound[0].id !== id) return fail(res, 400, 400, '该工号已被其他账号绑定');
    boundTeacherNo = teacherNo;
  }

  // 角色、状态或绑定关系变更后递增 token_version，让该账号手上的旧 token 立即失效
  await pool.query(
    `UPDATE sys_user
     SET role = ?, status = ?, student_id = ?, teacher_no = ?, token_version = token_version + 1
     WHERE id = ?`,
    [role, status, boundStudentId, boundTeacherNo, id]
  );
  await writeAudit(req, {
    action: 'user.update',
    targetType: 'user',
    targetId: id,
    before: { role: current.role, status: Number(current.status), student_id: current.student_id, teacher_no: current.teacher_no },
    after: { role, status, student_id: boundStudentId, teacher_no: boundTeacherNo },
  });
  ok(res, { id, role, status, student_id: boundStudentId, teacher_no: boundTeacherNo }, '用户信息已更新');
}));

// 批量导入账号：学生按学号、教师按工号，逐行校验并返回失败原因
router.post('/bulk-import', authRequired, adminOnly, asyncHandler(async (req, res) => {
  const { role, rows } = req.body || {};
  if (!['student', 'teacher'].includes(role)) {
    return fail(res, 400, 400, '角色只能是 student 或 teacher');
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return fail(res, 400, 400, '没有可导入的数据');
  }
  if (rows.length > 500) {
    return fail(res, 400, 400, '单次最多导入 500 条，请分批处理');
  }

  const results = { total: rows.length, created: 0, failed: [] };
  const isStudent = role === 'student';
  const keyCol = isStudent ? 'student_id' : 'teacher_no';
  const baseTable = isStudent ? 'student' : 'teacher';

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || {};
    const username = String(row.username || '').trim().toLowerCase();
    const password = String(row.password || '').trim();
    const key = String(isStudent ? row.student_id : row.teacher_no).trim();
    const rowLabel = `第${i + 1}行`;

    if (!username || !password) { results.failed.push({ row: rowLabel, reason: '用户名或密码为空' }); continue; }
    if (username.length < 3) {
      results.failed.push({ row: rowLabel, reason: '用户名至少3位' }); continue;
    }
    // R33：批量导入的密码同样走统一策略
    const pwdError = passwordProblem(password);
    if (pwdError) {
      results.failed.push({ row: rowLabel, reason: pwdError }); continue;
    }
    if (!key || key === 'undefined' || key === 'null') {
      results.failed.push({ row: rowLabel, reason: isStudent ? '学号为空' : '工号为空' }); continue;
    }

    try {
      const [u] = await pool.query('SELECT id FROM sys_user WHERE username = ?', [username]);
      if (u.length > 0) { results.failed.push({ row: rowLabel, reason: '用户名已存在' }); continue; }

      const [base] = await pool.query(`SELECT ${keyCol} AS k FROM ${baseTable} WHERE ${keyCol} = ?`, [key]);
      if (base.length === 0) {
        results.failed.push({ row: rowLabel, reason: isStudent ? '学号不存在' : '工号不存在' }); continue;
      }

      const [bound] = await pool.query(`SELECT id FROM sys_user WHERE ${keyCol} = ?`, [key]);
      if (bound.length > 0) {
        results.failed.push({ row: rowLabel, reason: isStudent ? '该学号已被绑定' : '该工号已被绑定' }); continue;
      }

      await pool.query(
        'INSERT INTO sys_user (username, password_hash, role, student_id, teacher_no) VALUES (?, ?, ?, ?, ?)',
        [username, hashPassword(password), role, isStudent ? key : null, isStudent ? null : key]
      );
      results.created++;
    } catch (err) {
      // 不把数据库原始报错抛给前端
      if (err && err.code === 'ER_DUP_ENTRY') {
        results.failed.push({ row: rowLabel, reason: '用户名或绑定关系重复' });
      } else {
        console.error('[批量建号失败]', rowLabel, err.message);
        results.failed.push({ row: rowLabel, reason: '账号创建失败，请检查该行数据' });
      }
    }
  }

  await writeAudit(req, {
    action: 'user.bulk_import',
    targetType: 'sys_user',
    targetId: role,
    after: { total: results.total, created: results.created, failed: results.failed.length },
  });
  ok(res, results, `导入完成：成功 ${results.created} 条，失败 ${results.failed.length} 条`);
}));

// 重置密码（管理员操作，不需要原密码）
router.post('/:id/reset-password', authRequired, adminOnly, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return fail(res, 400, 400, '用户编号不合法');

  const { newPassword } = req.body;
  const pwdError = passwordProblem(newPassword);
  if (pwdError) return fail(res, 400, 400, pwdError);

  const [rows] = await pool.query('SELECT id FROM sys_user WHERE id = ?', [id]);
  if (rows.length === 0) return fail(res, 404, 404, '用户不存在');

  // 重置密码后撤销该账号已有的登录态
  await pool.query(
    'UPDATE sys_user SET password_hash = ?, token_version = token_version + 1 WHERE id = ?',
    [hashPassword(newPassword), id]
  );
  await writeAudit(req, { action: 'user.reset_password', targetType: 'user', targetId: id });
  ok(res, { id }, '密码已重置，该账号需重新登录');
}));

// 删除用户
router.delete('/:id', authRequired, adminOnly, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return fail(res, 400, 400, '用户编号不合法');
  if (id === req.user.id) return fail(res, 400, 400, '不能删除当前登录的账号');

  const [rows] = await pool.query('SELECT id, role, status FROM sys_user WHERE id = ?', [id]);
  if (rows.length === 0) return fail(res, 404, 404, '用户不存在');

  if (rows[0].role === 'admin' && Number(rows[0].status) === 1) {
    const [[adminCount]] = await pool.query(
      "SELECT COUNT(*) AS c FROM sys_user WHERE role = 'admin' AND status = 1"
    );
    if (adminCount.c <= 1) return fail(res, 400, 400, '系统至少保留一个启用的管理员账号');
  }

  await pool.query('DELETE FROM sys_user WHERE id = ?', [id]);
  await writeAudit(req, {
    action: 'user.delete',
    targetType: 'user',
    targetId: id,
    before: { role: rows[0].role, status: Number(rows[0].status) },
  });
  ok(res, null, '用户已删除');
}));

module.exports = router;
