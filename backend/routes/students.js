const express = require('express');
const pool = require('../config/db');
const { ok, fail, asyncHandler } = require('../utils/response');
const { adminOnly } = require('../utils/auth');
const { canWriteStudent } = require('../utils/permission');
const { normalizeGender } = require('../utils/fields');
const { writeAudit } = require('../utils/audit');

const router = express.Router();

// 管理员可改全部字段；教师只能改非归属字段（R18）
const ADMIN_FIELDS = ['name', 'gender', 'college', 'major', 'grade', 'enrollment_year', 'phone', 'email'];
const TEACHER_FIELDS = ['name', 'gender', 'phone', 'email'];
const TEACHER_FORBIDDEN = ['major', 'college', 'grade', 'enrollment_year'];

// 字段级校验，返回错误数组（复用给新增与编辑）
function validateStudentFields(data, { requireName = false } = {}) {
  const errors = [];

  if (data.name !== undefined) {
    const name = String(data.name).trim();
    if (!name) errors.push('姓名不能为空');
    else if (name.length > 50) errors.push('姓名不能超过50个字符');
    data.name = name;
  } else if (requireName) {
    errors.push('姓名不能为空');
  }

  if (data.gender !== undefined) {
    const g = normalizeGender(data.gender);
    if (g === 'INVALID') errors.push('性别只能是 M / F（或 男 / 女）');
    else data.gender = g;
  }

  if (data.college !== undefined && data.college !== null) {
    data.college = String(data.college).trim();
    if (data.college.length > 100) errors.push('学院不能超过100个字符');
  }
  if (data.major !== undefined && data.major !== null) {
    data.major = String(data.major).trim();
    if (data.major.length > 100) errors.push('专业不能超过100个字符');
  }

  if (data.grade !== undefined && data.grade !== null && data.grade !== '') {
    const grade = Number(data.grade);
    if (!Number.isInteger(grade) || grade < 2000 || grade > 2100) {
      errors.push('年级必须是 2000-2100 之间的整数');
    } else {
      data.grade = grade;
    }
  }

  if (data.enrollment_year !== undefined && data.enrollment_year !== null && data.enrollment_year !== '') {
    const year = Number(data.enrollment_year);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      errors.push('入学年份必须是 2000-2100 之间的整数');
    } else {
      data.enrollment_year = year;
    }
  }

  if (data.phone !== undefined && data.phone !== null) {
    data.phone = String(data.phone).trim();
    if (data.phone.length > 20) errors.push('电话不能超过20个字符');
  }
  if (data.email !== undefined && data.email !== null) {
    data.email = String(data.email).trim();
    if (data.email.length > 100) errors.push('邮箱不能超过100个字符');
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.push('邮箱格式不正确');
  }

  return errors;
}

// 添加学生（R17：仅管理员；教师新增需走管理员审核）
router.post('/', adminOnly, asyncHandler(async (req, res) => {
  const body = { ...req.body };
  const studentId = String(body.student_id || '').trim();
  if (!studentId) return fail(res, 400, 400, '学号不能为空');
  if (studentId.length > 20) return fail(res, 400, 400, '学号不能超过20个字符');

  const errors = validateStudentFields(body, { requireName: true });
  if (errors.length > 0) return fail(res, 400, 400, errors.slice(0, 3).join('；'));

  // 先查重，给出"学号已存在"而不是让主键冲突冒成 500
  const [exists] = await pool.query('SELECT student_id FROM student WHERE student_id = ?', [studentId]);
  if (exists.length > 0) return fail(res, 400, 400, '学号已存在，请勿重复添加');

  await pool.query(
    'INSERT INTO student (student_id, name, gender, college, major, grade, enrollment_year, phone, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      studentId, body.name, body.gender || null, body.college || null, body.major || null,
      body.grade ?? null, body.enrollment_year ?? null, body.phone || null, body.email || null,
    ]
  );
  ok(res, { student_id: studentId }, '学生添加成功');
}));

// 查询学生列表：默认全量返回；传 page/pageSize/withMeta 时返回分页结构（R38）
router.get('/', asyncHandler(async (req, res) => {
  const { search, college, major, grade } = req.query;
  const conds = [];
  const params = [];

  if (search && String(search).trim()) {
    const kw = `%${String(search).trim()}%`;
    conds.push('(student_id LIKE ? OR name LIKE ?)');
    params.push(kw, kw);
  }
  if (college) { conds.push('college = ?'); params.push(college); }
  if (major) { conds.push('major = ?'); params.push(major); }
  if (grade !== undefined && grade !== '') {
    const g = Number(grade);
    if (!Number.isInteger(g)) return fail(res, 400, 400, '年级参数必须是整数');
    conds.push('grade = ?'); params.push(g);
  }

  const where = conds.length ? ' WHERE ' + conds.join(' AND ') : '';
  const wantPagination = req.query.page !== undefined || req.query.pageSize !== undefined || req.query.withMeta === '1';

  if (!wantPagination) {
    const [rows] = await pool.query('SELECT * FROM student' + where + ' ORDER BY student_id', params);
    return ok(res, rows);
  }

  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));

  const [[countRow]] = await pool.query('SELECT COUNT(*) AS total FROM student' + where, params);
  const [rows] = await pool.query(
    'SELECT * FROM student' + where + ' ORDER BY student_id LIMIT ? OFFSET ?',
    [...params, pageSize, (page - 1) * pageSize]
  );

  ok(res, { total: countRow.total, page, pageSize, items: rows });
}));

// 查询单个学生
router.get('/:id', asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM student WHERE student_id = ?', [req.params.id]);
  if (rows.length === 0) return fail(res, 404, 404, '学生不存在');
  ok(res, rows[0]);
}));

// 编辑学生：只更新请求中出现的字段（R04）；教师不能改归属字段（R18）
router.put('/:id', asyncHandler(async (req, res) => {
  const body = { ...(req.body || {}) };
  const [exists] = await pool.query('SELECT * FROM student WHERE student_id = ?', [req.params.id]);
  if (exists.length === 0) return fail(res, 404, 404, '学生不存在');

  const perm = await canWriteStudent(req.user, req.params.id);
  if (!perm.allowed) return fail(res, 403, 403, perm.reason);

  const isAdmin = req.user.role === 'admin';
  const allowedFields = isAdmin ? ADMIN_FIELDS : TEACHER_FIELDS;

  // 教师提交归属字段时明确拒绝，而不是静默忽略
  if (!isAdmin) {
    for (const field of TEACHER_FORBIDDEN) {
      if (body[field] !== undefined && body[field] !== exists[0][field]) {
        return fail(res, 403, 403, '教师无权修改学生的专业、学院、年级或入学年份，请联系管理员');
      }
    }
  }

  const updates = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) updates[field] = body[field];
  }

  const errors = validateStudentFields(updates, { requireName: false });
  if (errors.length > 0) return fail(res, 400, 400, errors.slice(0, 3).join('；'));

  const keys = Object.keys(updates);
  if (keys.length === 0) return fail(res, 400, 400, '没有需要更新的字段');

  // 空字符串统一存 NULL，避免覆盖成空值
  const values = keys.map((k) => (updates[k] === '' ? null : updates[k]));
  await pool.query(
    `UPDATE student SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE student_id = ?`,
    [...values, req.params.id]
  );

  ok(res, { student_id: req.params.id, updated: keys }, '学生信息更新成功');
}));

// 删除前的影响范围（R42：确认弹窗要列出将一并删除的记录数）
router.get('/:id/impact', adminOnly, asyncHandler(async (req, res) => {
  const sid = req.params.id;
  const [exists] = await pool.query('SELECT student_id FROM student WHERE student_id = ?', [sid]);
  if (exists.length === 0) return fail(res, 404, 404, '学生不存在');

  const [[academic]] = await pool.query('SELECT COUNT(*) AS c FROM academic_record WHERE student_id = ?', [sid]);
  const [[research]] = await pool.query('SELECT COUNT(*) AS c FROM research_project WHERE student_id = ?', [sid]);
  const [[practice]] = await pool.query('SELECT COUNT(*) AS c FROM practice_activity WHERE student_id = ?', [sid]);
  const [[profile]] = await pool.query('SELECT COUNT(*) AS c FROM ability_profile WHERE student_id = ?', [sid]);
  const [[recommendation]] = await pool.query('SELECT COUNT(*) AS c FROM career_recommendation WHERE student_id = ?', [sid]);
  const [accounts] = await pool.query('SELECT username FROM sys_user WHERE student_id = ?', [sid]);

  ok(res, {
    student_id: sid,
    academic_records: academic.c,
    research_projects: research.c,
    practice_activities: practice.c,
    profiles: profile.c,
    recommendations: recommendation.c,
    accounts: accounts.map((a) => a.username),
  });
}));

// 删除学生（R25：一并清理推荐历史，并解绑/禁用关联账号，避免孤儿数据与死账号）
router.delete('/:id', adminOnly, asyncHandler(async (req, res) => {
  const sid = req.params.id;

  const [exists] = await pool.query('SELECT student_id FROM student WHERE student_id = ?', [sid]);
  if (exists.length === 0) return fail(res, 404, 404, '学生不存在');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM academic_record WHERE student_id = ?', [sid]);
    await conn.query('DELETE FROM research_project WHERE student_id = ?', [sid]);
    await conn.query('DELETE FROM practice_activity WHERE student_id = ?', [sid]);
    await conn.query('DELETE FROM ability_profile WHERE student_id = ?', [sid]);
    await conn.query('DELETE FROM career_recommendation WHERE student_id = ?', [sid]);
    await conn.query('DELETE FROM student WHERE student_id = ?', [sid]);

    // 关联账号解绑并禁用，并让其当前 token 失效
    const [accounts] = await conn.query(
      'SELECT id, username FROM sys_user WHERE student_id = ?',
      [sid]
    );
    if (accounts.length > 0) {
      await conn.query(
        `UPDATE sys_user
         SET student_id = NULL, status = 0, token_version = token_version + 1
         WHERE student_id = ?`,
        [sid]
      );
    }

    await conn.commit();
    // 删除属于不可逆操作，提交后写审计（R49）
    await writeAudit(req, {
      action: 'student.delete',
      targetType: 'student',
      targetId: sid,
      before: { student_id: sid, accounts: accounts.map((a) => a.username) },
      after: null,
    });
    ok(res, {
      student_id: sid,
      unbound_accounts: accounts.map((a) => a.username),
    }, accounts.length > 0
      ? `学生及其关联数据已删除，账号 ${accounts.map((a) => a.username).join('、')} 已解绑并停用`
      : '学生及其关联数据删除成功');
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

module.exports = router;
