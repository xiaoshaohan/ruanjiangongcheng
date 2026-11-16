// 教师基础数据与负责专业（管理员维护；教师可查自己负责的学生）
const express = require('express');
const pool = require('../config/db');
const { ok, fail, asyncHandler } = require('../utils/response');
const { authRequired, adminOnly, roleRequired } = require('../utils/auth');
const { writeAudit } = require('../utils/audit');

const router = express.Router();

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// 解析"负责专业"：支持逗号/顿号/分号分隔，也兼容直接传数组
function parseMajors(input) {
  if (input === undefined || input === null) return [];
  if (Array.isArray(input)) return input.map((s) => String(s).trim()).filter(Boolean);
  return String(input)
    .split(/[,，;；、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeStatus(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value === 1 || value === '1' || value === true || value === 'true') return 1;
  if (value === 0 || value === '0' || value === false || value === 'false') return 0;
  return 'INVALID';
}

function validateTeacherFields(data, { requireName = false } = {}) {
  const errors = [];
  const teacherNo = String(data.teacher_no || '').trim();
  if (!teacherNo) errors.push('工号不能为空');
  else if (teacherNo.length > 20) errors.push('工号不能超过20个字符');

  const name = String(data.name || '').trim();
  if (!name && requireName) errors.push('姓名不能为空');
  else if (name.length > 50) errors.push('姓名不能超过50个字符');

  if (data.college !== undefined && data.college !== null && String(data.college).length > 100) {
    errors.push('学院不能超过100个字符');
  }
  if (data.title !== undefined && data.title !== null && String(data.title).length > 50) {
    errors.push('职称不能超过50个字符');
  }
  return errors;
}

// 替换负责专业：majors 显式传空表示"清空"，未传表示"不改"（R32）
async function replaceMajors(teacherNo, majorsInput) {
  await pool.query('DELETE FROM teacher_major WHERE teacher_no = ?', [teacherNo]);
  const majors = parseMajors(majorsInput);
  for (const m of majors) {
    await pool.query('INSERT IGNORE INTO teacher_major (teacher_no, major) VALUES (?, ?)', [teacherNo, m]);
  }
  return majors;
}

// 教师列表（含负责专业、是否已有账号）
router.get('/', authRequired, adminOnly, asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT t.teacher_no, t.name, t.college, t.title, t.status,
            GROUP_CONCAT(DISTINCT tm.major ORDER BY tm.major SEPARATOR ',') AS majors,
            u.username AS account
     FROM teacher t
     LEFT JOIN teacher_major tm ON tm.teacher_no = t.teacher_no
     LEFT JOIN sys_user u ON u.teacher_no = t.teacher_no
     GROUP BY t.teacher_no, t.name, t.college, t.title, t.status, u.username
     ORDER BY t.teacher_no`
  );
  ok(res, rows.map((r) => ({ ...r, status: Number(r.status) })));
}));

// 新增 / 更新单个教师
router.post('/', authRequired, adminOnly, asyncHandler(async (req, res) => {
  const body = req.body || {};
  const errors = validateTeacherFields(body, { requireName: true });
  if (errors.length > 0) return fail(res, 400, 400, errors.slice(0, 3).join('；'));

  const teacherNo = String(body.teacher_no).trim();
  const name = String(body.name).trim();
  const status = normalizeStatus(body.status);
  if (status === 'INVALID') return fail(res, 400, 400, '状态只能是 0 或 1');

  const [exists] = await pool.query(
    'SELECT teacher_no, name, college, title, status FROM teacher WHERE teacher_no = ?',
    [teacherNo]
  );

  if (exists.length > 0) {
    // R33：status 未提交时保持原值，提交 0 才真正停用
    const nextStatus = status === null ? Number(exists[0].status) : status;
    await pool.query(
      'UPDATE teacher SET name = ?, college = ?, title = ?, status = ? WHERE teacher_no = ?',
      [name, body.college || null, body.title || null, nextStatus, teacherNo]
    );
  } else {
    await pool.query(
      'INSERT INTO teacher (teacher_no, name, college, title, status) VALUES (?, ?, ?, ?, ?)',
      [teacherNo, name, body.college || null, body.title || null, status === null ? 1 : status]
    );
  }

  // 只有显式提交了 majors 才改负责专业，避免"只改姓名把专业清空"
  let majors = null;
  if (has(body, 'majors')) majors = await replaceMajors(teacherNo, body.majors);

  await writeAudit(req, {
    action: exists.length > 0 ? 'teacher.update' : 'teacher.create',
    targetType: 'teacher',
    targetId: teacherNo,
    after: { name, college: body.college || null, title: body.title || null, status: status === null ? undefined : status, majors },
  });

  ok(res, {
    teacher_no: teacherNo,
    majors: majors === null ? undefined : majors,
  }, exists.length > 0 ? '教师信息已更新' : '教师信息已保存');
}));

// 批量导入教师：rows = [{ teacher_no, name, college, title, majors, status }]
router.post('/bulk-import', authRequired, adminOnly, asyncHandler(async (req, res) => {
  const { rows } = req.body || {};
  if (!Array.isArray(rows) || rows.length === 0) return fail(res, 400, 400, '没有可导入的数据');
  if (rows.length > 500) return fail(res, 400, 400, '单次最多导入 500 条，请分批处理');

  const results = { total: rows.length, created: 0, updated: 0, failed: [] };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || {};
    const teacherNo = String(row.teacher_no || '').trim();
    const name = String(row.name || '').trim();
    const label = `第${i + 1}行`;

    if (!teacherNo || !name) { results.failed.push({ row: label, reason: '工号或姓名为空' }); continue; }
    if (teacherNo.length > 20) { results.failed.push({ row: label, reason: '工号不能超过20个字符' }); continue; }
    if (name.length > 50) { results.failed.push({ row: label, reason: '姓名不能超过50个字符' }); continue; }

    try {
      const [exists] = await pool.query('SELECT teacher_no, status FROM teacher WHERE teacher_no = ?', [teacherNo]);
      const status = normalizeStatus(row.status);
      if (status === 'INVALID') { results.failed.push({ row: label, reason: '状态只能是 0 或 1' }); continue; }

      if (exists.length > 0) {
        const nextStatus = status === null ? Number(exists[0].status) : status;
        await pool.query(
          'UPDATE teacher SET name = ?, college = ?, title = ?, status = ? WHERE teacher_no = ?',
          [name, row.college || null, row.title || null, nextStatus, teacherNo]
        );
      } else {
        await pool.query(
          'INSERT INTO teacher (teacher_no, name, college, title, status) VALUES (?, ?, ?, ?, ?)',
          [teacherNo, name, row.college || null, row.title || null, status === null ? 1 : status]
        );
      }

      // majors 显式提交（含空值）才替换，未提交保持原有配置
      if (has(row, 'majors')) await replaceMajors(teacherNo, row.majors);

      if (exists.length > 0) results.updated++; else results.created++;
    } catch (err) {
      console.error('[教师导入失败]', label, err.message);
      results.failed.push({ row: label, reason: '教师信息写入失败，请检查该行数据' });
    }
  }

  await writeAudit(req, {
    action: 'teacher.bulk_import',
    targetType: 'teacher',
    targetId: 'bulk',
    after: { total: results.total, created: results.created, updated: results.updated, failed: results.failed.length },
  });

  ok(res, results, `导入完成：新增 ${results.created} 条，更新 ${results.updated} 条，失败 ${results.failed.length} 条`);
}));

// 教师查看自己负责的专业与学生
router.get('/my-students', authRequired, roleRequired('teacher', 'admin'), asyncHandler(async (req, res) => {
  const teacherNo = req.user.teacher_no;
  if (req.user.role === 'admin') {
    const [students] = await pool.query(
      'SELECT student_id, name, gender, college, major, grade FROM student ORDER BY student_id'
    );
    return ok(res, { majors: [], students, scope: 'all' }, '管理员视图：全部学生');
  }
  if (!teacherNo) return fail(res, 403, 403, '当前账号未绑定工号，请联系管理员');

  const [majors] = await pool.query('SELECT major FROM teacher_major WHERE teacher_no = ?', [teacherNo]);
  const majorList = majors.map((r) => r.major);
  if (majorList.length === 0) {
    return ok(res, { majors: [], students: [], scope: 'none' }, '尚未设置负责专业，请联系管理员配置');
  }

  const [students] = await pool.query(
    `SELECT student_id, name, gender, college, major, grade
     FROM student WHERE major IN (?) ORDER BY student_id`,
    [majorList]
  );
  ok(res, { majors: majorList, students, scope: 'major' });
}));

// 删除教师（有账号绑定或负责专业时先解绑）
router.delete('/:teacherNo', authRequired, adminOnly, asyncHandler(async (req, res) => {
  const teacherNo = req.params.teacherNo;
  const [exists] = await pool.query('SELECT teacher_no FROM teacher WHERE teacher_no = ?', [teacherNo]);
  if (exists.length === 0) return fail(res, 404, 404, '教师不存在');

  const [bound] = await pool.query('SELECT username FROM sys_user WHERE teacher_no = ?', [teacherNo]);
  if (bound.length > 0) return fail(res, 400, 400, `该工号已绑定账号 ${bound[0].username}，请先在用户管理里解绑`);

  await pool.query('DELETE FROM teacher_major WHERE teacher_no = ?', [teacherNo]);
  await pool.query('DELETE FROM teacher WHERE teacher_no = ?', [teacherNo]);
  await writeAudit(req, {
    action: 'teacher.delete',
    targetType: 'teacher',
    targetId: teacherNo,
  });
  ok(res, null, '教师已删除');
}));

module.exports = router;
