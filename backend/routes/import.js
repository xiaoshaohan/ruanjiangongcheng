// 批量导入路由：接收前端解析好的 JSON 数组，逐行入库并返回失败明细
const express = require('express');
const pool = require('../config/db');
const { ok, fail, asyncHandler } = require('../utils/response');

const router = express.Router();

const MAX_ROWS = 5000;

// 空字符串转 NULL，避免 DATE / DECIMAL 报错
const v = (x) => (x === undefined || x === null || String(x).trim() === '' ? null : String(x).trim());

/**
 * 生成一个批量导入处理器
 * @param {string} sql   单行插入语句
 * @param {Function} build 行对象 -> 参数数组
 */
function makeImporter(sql, build) {
  return asyncHandler(async (req, res) => {
    const rows = req.body && req.body.rows;
    if (!Array.isArray(rows) || rows.length === 0) {
      return fail(res, 400, 400, '导入数据为空');
    }
    if (rows.length > MAX_ROWS) {
      return fail(res, 400, 400, `单次最多导入 ${MAX_ROWS} 行`);
    }

    const conn = await pool.getConnection();
    let success = 0;
    const errors = [];
    try {
      await conn.beginTransaction();
      for (let i = 0; i < rows.length; i++) {
        try {
          await conn.query(sql, build(rows[i]));
          success++;
        } catch (e) {
          errors.push({ row: i + 2, message: e.message });
          if (errors.length >= 50) break; // 错误过多提前终止，避免全量跑完
        }
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    ok(res, {
      total: rows.length,
      success,
      failed: errors.length,
      errors: errors.slice(0, 10),
    }, `导入完成：成功 ${success} 条${errors.length ? `，失败 ${errors.length} 条` : ''}`);
  });
}

// 学生：学号重复时覆盖更新，便于重复导入同一份 CSV
router.post('/students', makeImporter(
  `INSERT INTO student (student_id, name, gender, college, major, grade, enrollment_year)
   VALUES (?, ?, ?, ?, ?, ?, ?)
   ON DUPLICATE KEY UPDATE name=VALUES(name), gender=VALUES(gender), college=VALUES(college),
   major=VALUES(major), grade=VALUES(grade), enrollment_year=VALUES(enrollment_year)`,
  (r) => [v(r.student_id), v(r.name), v(r.gender), v(r.college), v(r.major), v(r.grade), v(r.enrollment_year)]
));

// 成绩
router.post('/academic', makeImporter(
  `INSERT INTO academic_record (student_id, course_name, credit, score, semester) VALUES (?, ?, ?, ?, ?)`,
  (r) => [v(r.student_id), v(r.course_name), v(r.credit), v(r.score), v(r.semester)]
));

// 科研项目
router.post('/research', makeImporter(
  `INSERT INTO research_project (student_id, project_name, role, level, start_date, end_date, result) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  (r) => [v(r.student_id), v(r.project_name), v(r.role), v(r.level), v(r.start_date), v(r.end_date), v(r.result)]
));

// 实践活动
router.post('/practice', makeImporter(
  `INSERT INTO practice_activity (student_id, activity_name, type, start_date, end_date, hours, description) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  (r) => [v(r.student_id), v(r.activity_name), v(r.type), v(r.start_date), v(r.end_date), v(r.hours), v(r.description)]
));

module.exports = router;
