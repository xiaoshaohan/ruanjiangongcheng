// 教师基础数据与负责专业（管理员维护；教师可查自己负责的学生）
const express = require('express');
const pool = require('../config/db');
const { ok, fail, asyncHandler } = require('../utils/response');
const { authRequired, adminOnly, roleRequired } = require('../utils/auth');

const router = express.Router();

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
  ok(res, rows);
}));

// 新增单个教师（工号已存在则更新）
router.post('/', authRequired, adminOnly, asyncHandler(async (req, res) => {
  const { teacher_no, name, college, title, majors } = req.body;
  if (!teacher_no || !name) return fail(res, 400, 400, '工号和姓名不能为空');

  await pool.query(
    `INSERT INTO teacher (teacher_no, name, college, title) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), college = VALUES(college), title = VALUES(title)`,
    [teacher_no, name, college || null, title || null]
  );

  const majorList = parseMajors(majors);
  if (majorList.length > 0) {
    await pool.query('DELETE FROM teacher_major WHERE teacher_no = ?', [teacher_no]);
    for (const m of majorList) {
      await pool.query('INSERT IGNORE INTO teacher_major (teacher_no, major) VALUES (?, ?)', [teacher_no, m]);
    }
  }
  ok(res, { teacher_no, majors: majorList }, '教师信息已保存');
}));

// 批量导入教师：rows = [{ teacher_no, name, college, title, majors }]
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

    try {
      const [exists] = await pool.query('SELECT teacher_no FROM teacher WHERE teacher_no = ?', [teacherNo]);
      await pool.query(
        `INSERT INTO teacher (teacher_no, name, college, title) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), college = VALUES(college), title = VALUES(title)`,
        [teacherNo, name, row.college || null, row.title || null]
      );

      const majorList = parseMajors(row.majors);
      if (majorList.length > 0) {
        await pool.query('DELETE FROM teacher_major WHERE teacher_no = ?', [teacherNo]);
        for (const m of majorList) {
          await pool.query('INSERT IGNORE INTO teacher_major (teacher_no, major) VALUES (?, ?)', [teacherNo, m]);
        }
      }

      if (exists.length > 0) results.updated++; else results.created++;
    } catch (err) {
      results.failed.push({ row: label, reason: err.message });
    }
  }

  ok(res, results, `导入完成：新增 ${results.created} 条，更新 ${results.updated} 条，失败 ${results.failed.length} 条`);
}));

// 教师查看自己负责的专业与学生
router.get('/my-students', authRequired, roleRequired('teacher'), asyncHandler(async (req, res) => {
  const teacherNo = req.user.teacher_no;
  if (!teacherNo) return fail(res, 403, 403, '当前账号未绑定工号，请联系管理员');

  const [majors] = await pool.query('SELECT major FROM teacher_major WHERE teacher_no = ?', [teacherNo]);
  const majorList = majors.map((r) => r.major);
  if (majorList.length === 0) {
    return ok(res, { majors: [], students: [] }, '尚未设置负责专业');
  }

  const [students] = await pool.query(
    `SELECT student_id, name, gender, college, major, grade
     FROM student WHERE major IN (?) ORDER BY student_id`,
    [majorList]
  );
  ok(res, { majors: majorList, students });
}));

// 删除教师（有账号绑定或负责专业时先解绑）
router.delete('/:teacherNo', authRequired, adminOnly, asyncHandler(async (req, res) => {
  const teacherNo = req.params.teacherNo;
  const [exists] = await pool.query('SELECT teacher_no FROM teacher WHERE teacher_no = ?', [teacherNo]);
  if (exists.length === 0) return fail(res, 404, 404, '教师不存在');

  const [bound] = await pool.query('SELECT username FROM sys_user WHERE teacher_no = ?', [teacherNo]);
  if (bound.length > 0) return fail(res, 400, 400, `该工号已绑定账号 ${bound[0].username}，请先解绑`);

  await pool.query('DELETE FROM teacher_major WHERE teacher_no = ?', [teacherNo]);
  await pool.query('DELETE FROM teacher WHERE teacher_no = ?', [teacherNo]);
  ok(res, null, '教师已删除');
}));

// 解析"负责专业"：支持逗号/顿号/分号分隔
function parseMajors(input) {
  if (!input) return [];
  return String(input)
    .split(/[,，;；、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

module.exports = router;
