// 批量导入路由：接收前端解析好的 JSON 数组，逐行校验入库并返回可读的失败明细
const express = require('express');
const pool = require('../config/db');
const { ok, fail, asyncHandler } = require('../utils/response');
const { normalizeGender, dateRangeProblem } = require('../utils/fields');
const { isRealDate } = require('../utils/validate');
const { recalculateMany } = require('../utils/recalc');
const { writeAudit } = require('../utils/audit');
const { RESEARCH_LEVELS, PRACTICE_TYPES } = require('../utils/enums');

const router = express.Router();

const MAX_ROWS = 5000;
const MAX_ERRORS = 200;      // 明细最多返回 200 条，避免响应体过大
// S3：不再用 200 人的上限截断重算，导入多少人就重算多少人；
// 分批发并发在 recalculateMany 内部处理，避免几千行一次性打满连接池。

// 空字符串转 NULL，避免 DATE / DECIMAL 报错
const v = (x) => (x === undefined || x === null || String(x).trim() === '' ? null : String(x).trim());

// 行级校验错误：带 rowMessage，直接展示给用户
function rowError(message) {
  const err = new Error(message);
  err.rowMessage = message;
  return err;
}

// 数据库错误转成用户能看懂的话，SQL 细节只留在服务端日志（R08）
function readableError(e) {
  const code = e && e.code;
  if (code === 'ER_DUP_ENTRY') return '记录重复，库中已存在相同数据';
  if (code === 'ER_NO_REFERENCED_ROW_2' || code === 'ER_NO_REFERENCED_ROW') return '学号不存在，请先导入该学生';
  if (code === 'ER_DATA_TOO_LONG' || code === 'WARN_DATA_TRUNCATED') return '内容超出字段长度或范围限制';
  if (code === 'ER_TRUNCATED_WRONG_VALUE' || code === 'ER_WRONG_VALUE') {
    return '数值或日期格式不正确';
  }
  if (code === 'ER_BAD_NULL_ERROR') return '必填字段为空';
  return '数据无法写入，请检查该行内容';
}

function emptyResult(total) {
  return { total, success: 0, failed: 0, errors: [], recalculated: 0 };
}

function pushError(result, label, message) {
  result.failed++;
  if (result.errors.length < MAX_ERRORS) result.errors.push({ row: label, message });
}

// 导入完成后批量重算受影响学生的画像（R15 / S3）
async function recalcStudents(studentIds) {
  return recalculateMany(studentIds);
}

// 把重算结果写进响应，未重算/重算失败的学生要明确告诉调用方
function applyRecalc(result, recalc) {
  result.recalculated = recalc.recalculated;
  result.recalc_failed = recalc.failed || 0;
  result.recalc_failed_ids = recalc.failed_ids || [];
  result.skipped = recalc.skipped || 0;
  result.skipped_ids = recalc.skipped_ids || [];
}

function recalcMessage(recalc) {
  const parts = [`已重算 ${recalc.recalculated} 名学生画像`];
  if (recalc.failed) parts.push(`重算失败 ${recalc.failed} 人`);
  if (recalc.skipped) parts.push(`未重算 ${recalc.skipped} 人`);
  return parts.join('，');
}

function readRows(req, res) {
  const rows = req.body && req.body.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    fail(res, 400, 400, '导入数据为空');
    return null;
  }
  if (rows.length > MAX_ROWS) {
    fail(res, 400, 400, `单次最多导入 ${MAX_ROWS} 行，请拆分文件`);
    return null;
  }
  return rows;
}

// ---------- 学生：只更新 CSV 中实际出现的列，空列不覆盖原值（R06） ----------
router.post('/students', asyncHandler(async (req, res) => {
  const rows = readRows(req, res);
  if (!rows) return;

  const result = emptyResult(rows.length);
  const touched = new Set();

  for (let i = 0; i < rows.length; i++) {
    const label = `第${i + 2}行`;
    const r = rows[i] || {};

    try {
      const sid = v(r.student_id);
      if (!sid) throw rowError('学号不能为空');
      if (sid.length > 20) throw rowError('学号不能超过20个字符');

      const name = v(r.name);
      if (name && name.length > 50) throw rowError('姓名不能超过50个字符');

      const updates = {};
      if (name) updates.name = name;

      if (r.gender !== undefined && r.gender !== null && String(r.gender).trim() !== '') {
        const gender = normalizeGender(r.gender);
        if (gender === 'INVALID') throw rowError('性别只能是 M / F（或 男 / 女）');
        updates.gender = gender;
      }
      if (v(r.college)) {
        if (String(v(r.college)).length > 100) throw rowError('学院不能超过100个字符');
        updates.college = v(r.college);
      }
      if (v(r.major)) {
        if (String(v(r.major)).length > 100) throw rowError('专业不能超过100个字符');
        updates.major = v(r.major);
      }
      if (v(r.grade)) {
        const grade = Number(v(r.grade));
        if (!Number.isInteger(grade) || grade < 2000 || grade > 2100) throw rowError('年级必须是 2000-2100 的整数');
        updates.grade = grade;
      }
      if (v(r.enrollment_year)) {
        const year = Number(v(r.enrollment_year));
        if (!Number.isInteger(year) || year < 2000 || year > 2100) throw rowError('入学年份必须是 2000-2100 的整数');
        updates.enrollment_year = year;
      }
      if (v(r.phone)) {
        if (String(v(r.phone)).length > 20) throw rowError('电话不能超过20个字符');
        updates.phone = v(r.phone);
      }
      if (v(r.email)) {
        // G5：导入路径复用与手工新增一致的邮箱格式校验，非法邮箱不入库
        const email = v(r.email);
        if (String(email).length > 100) throw rowError('邮箱不能超过100个字符');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw rowError('邮箱格式不正确');
        updates.email = email;
      }

      const [existing] = await pool.query('SELECT student_id FROM student WHERE student_id = ?', [sid]);

      if (existing.length === 0) {
        if (!name) throw rowError('新增学生必须填写姓名');
        const keys = ['student_id', ...Object.keys(updates)];
        const values = [sid, ...Object.values(updates)];
        await pool.query(
          `INSERT INTO student (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
          values
        );
      } else {
        const keys = Object.keys(updates);
        if (keys.length === 0) throw rowError('没有可更新的字段');
        await pool.query(
          `UPDATE student SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE student_id = ?`,
          [...Object.values(updates), sid]
        );
      }

      touched.add(sid);
      result.success++;
    } catch (e) {
      if (!e.rowMessage) console.error('[导入学生失败]', label, e.message);
      pushError(result, label, e.rowMessage || readableError(e));
    }
  }

  const recalc = await recalcStudents(touched);
  applyRecalc(result, recalc);

  await writeAudit(req, {
    action: 'import' + req.path,
    targetType: 'import',
    targetId: req.path.replace(/^\//, ''),
    after: { total: result.total, success: result.success, failed: result.failed, recalculated: result.recalculated },
  });

  ok(res, result, `导入完成：成功 ${result.success} 条，失败 ${result.failed} 条，${recalcMessage(recalc)}`);
}));

// ---------- 成绩 ----------
router.post('/academic', asyncHandler(async (req, res) => {
  const rows = readRows(req, res);
  if (!rows) return;

  const result = emptyResult(rows.length);
  const touched = new Set();

  for (let i = 0; i < rows.length; i++) {
    const label = `第${i + 2}行`;
    const r = rows[i] || {};

    try {
      const sid = v(r.student_id);
      const courseName = v(r.course_name);
      if (!sid) throw rowError('学号不能为空');
      if (!courseName) throw rowError('课程名称不能为空');
      if (courseName.length > 100) throw rowError('课程名称不能超过100个字符');

      const credit = Number(v(r.credit));
      if (!Number.isFinite(credit) || credit < 0.5 || credit > 20) throw rowError('学分必须在 0.5-20 之间');

      const score = Number(v(r.score));
      if (!Number.isFinite(score) || score < 0 || score > 100) throw rowError('成绩必须在 0-100 之间');

      const semester = v(r.semester);
      if (semester && semester.length > 20) throw rowError('学期不能超过20个字符');

      const [stu] = await pool.query('SELECT student_id FROM student WHERE student_id = ?', [sid]);
      if (stu.length === 0) throw rowError('学号不存在，请先导入该学生');

      const [dup] = await pool.query(
        'SELECT id FROM academic_record WHERE student_id = ? AND course_name = ? AND semester <=> ?',
        [sid, courseName, semester]
      );
      if (dup.length > 0) throw rowError('该学生在该学期已有同一课程成绩，请先删除或修改原记录');

      await pool.query(
        'INSERT INTO academic_record (student_id, course_name, credit, score, semester) VALUES (?, ?, ?, ?, ?)',
        [sid, courseName, credit, score, semester]
      );
      touched.add(sid);
      result.success++;
    } catch (e) {
      if (!e.rowMessage) console.error('[导入成绩失败]', label, e.message);
      pushError(result, label, e.rowMessage || readableError(e));
    }
  }

  const recalc = await recalcStudents(touched);
  applyRecalc(result, recalc);

  await writeAudit(req, {
    action: 'import' + req.path,
    targetType: 'import',
    targetId: req.path.replace(/^\//, ''),
    after: { total: result.total, success: result.success, failed: result.failed, recalculated: result.recalculated },
  });

  ok(res, result, `导入完成：成功 ${result.success} 条，失败 ${result.failed} 条，${recalcMessage(recalc)}`);
}));

// ---------- 科研 ----------
router.post('/research', asyncHandler(async (req, res) => {
  const rows = readRows(req, res);
  if (!rows) return;

  const result = emptyResult(rows.length);
  const touched = new Set();

  for (let i = 0; i < rows.length; i++) {
    const label = `第${i + 2}行`;
    const r = rows[i] || {};

    try {
      const sid = v(r.student_id);
      const projectName = v(r.project_name);
      if (!sid) throw rowError('学号不能为空');
      if (!projectName) throw rowError('项目名称不能为空');
      if (projectName.length > 200) throw rowError('项目名称不能超过200个字符');

      const startDate = v(r.start_date);
      const endDate = v(r.end_date);
      if (startDate && !isRealDate(startDate)) throw rowError('开始日期格式不正确（YYYY-MM-DD）');
      if (endDate && !isRealDate(endDate)) throw rowError('结束日期格式不正确（YYYY-MM-DD）');
      const rangeError = dateRangeProblem(startDate, endDate);
      if (rangeError) throw rowError(rangeError);

      // G4：科研级别必须命中白名单，未知级别不允许入库
      const level = v(r.level);
      if (level && !RESEARCH_LEVELS.includes(level)) {
        throw rowError(`科研级别只能是 ${RESEARCH_LEVELS.join(' / ')}`);
      }

      const [stu] = await pool.query('SELECT student_id FROM student WHERE student_id = ?', [sid]);
      if (stu.length === 0) throw rowError('学号不存在，请先导入该学生');

      await pool.query(
        'INSERT INTO research_project (student_id, project_name, role, level, start_date, end_date, result) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [sid, projectName, v(r.role), level, startDate, endDate, v(r.result)]
      );
      touched.add(sid);
      result.success++;
    } catch (e) {
      if (!e.rowMessage) console.error('[导入科研失败]', label, e.message);
      pushError(result, label, e.rowMessage || readableError(e));
    }
  }

  const recalc = await recalcStudents(touched);
  applyRecalc(result, recalc);

  await writeAudit(req, {
    action: 'import' + req.path,
    targetType: 'import',
    targetId: req.path.replace(/^\//, ''),
    after: { total: result.total, success: result.success, failed: result.failed, recalculated: result.recalculated },
  });

  ok(res, result, `导入完成：成功 ${result.success} 条，失败 ${result.failed} 条，${recalcMessage(recalc)}`);
}));

// ---------- 实践 ----------
router.post('/practice', asyncHandler(async (req, res) => {
  const rows = readRows(req, res);
  if (!rows) return;

  const result = emptyResult(rows.length);
  const touched = new Set();

  for (let i = 0; i < rows.length; i++) {
    const label = `第${i + 2}行`;
    const r = rows[i] || {};

    try {
      const sid = v(r.student_id);
      const activityName = v(r.activity_name);
      if (!sid) throw rowError('学号不能为空');
      if (!activityName) throw rowError('活动名称不能为空');
      if (activityName.length > 200) throw rowError('活动名称不能超过200个字符');

      const startDate = v(r.start_date);
      const endDate = v(r.end_date);
      if (startDate && !isRealDate(startDate)) throw rowError('开始日期格式不正确（YYYY-MM-DD）');
      if (endDate && !isRealDate(endDate)) throw rowError('结束日期格式不正确（YYYY-MM-DD）');
      const rangeError = dateRangeProblem(startDate, endDate);
      if (rangeError) throw rowError(rangeError);

      let hours = null;
      if (v(r.hours) !== null) {
        const num = Number(v(r.hours));
        if (!Number.isFinite(num) || num < 0) throw rowError('时长必须是非负数字');
        if (num > 1000) throw rowError('时长不能超过1000小时');
        hours = Math.round(num * 10) / 10;
      }

      // G4：实践类型必须命中白名单
      const practiceType = v(r.type);
      if (practiceType && !PRACTICE_TYPES.includes(practiceType)) {
        throw rowError(`实践类型只能是 ${PRACTICE_TYPES.join(' / ')}`);
      }

      const [stu] = await pool.query('SELECT student_id FROM student WHERE student_id = ?', [sid]);
      if (stu.length === 0) throw rowError('学号不存在，请先导入该学生');

      await pool.query(
        'INSERT INTO practice_activity (student_id, activity_name, type, start_date, end_date, hours, description) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [sid, activityName, practiceType, startDate, endDate, hours, v(r.description)]
      );
      touched.add(sid);
      result.success++;
    } catch (e) {
      if (!e.rowMessage) console.error('[导入实践失败]', label, e.message);
      pushError(result, label, e.rowMessage || readableError(e));
    }
  }

  const recalc = await recalcStudents(touched);
  applyRecalc(result, recalc);

  await writeAudit(req, {
    action: 'import' + req.path,
    targetType: 'import',
    targetId: req.path.replace(/^\//, ''),
    after: { total: result.total, success: result.success, failed: result.failed, recalculated: result.recalculated },
  });

  ok(res, result, `导入完成：成功 ${result.success} 条，失败 ${result.failed} 条，${recalcMessage(recalc)}`);
}));

module.exports = router;
module.exports.MAX_ROWS = MAX_ROWS;
