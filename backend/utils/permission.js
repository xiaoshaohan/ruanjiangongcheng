// 写入权限判断：管理员全量、教师限本人负责专业、学生只读
const pool = require('../config/db');

const EDIT_SWITCH_KEY = 'allow_teacher_edit_score';

// 教师负责的专业列表；未配置时返回空数组，按"无权限"处理
async function teacherMajors(teacherNo) {
  if (!teacherNo) return [];
  try {
    const [rows] = await pool.query('SELECT major FROM teacher_major WHERE teacher_no = ?', [teacherNo]);
    return rows.map((r) => r.major).filter(Boolean);
  } catch (err) {
    return [];
  }
}

// 管理员是否已开放教师修改成绩的开关（R09：字符串 '1' / 布尔都要正确识别）
async function isTeacherEditScoreAllowed() {
  try {
    const [rows] = await pool.query(
      'SELECT config_value FROM sys_config WHERE config_key = ?',
      [EDIT_SWITCH_KEY]
    );
    if (rows.length === 0) return false;
    const v = rows[0].config_value;
    return v === '1' || v === 1 || v === true || v === 'true';
  } catch (err) {
    return false;
  }
}

/**
 * 判断当前登录账号能否对某个学生执行写操作
 * @param {Object} user req.user
 * @param {string} studentId 学生学号
 * @param {Object} options requireEditSwitch: 修改/删除已有明细时需要管理员开放开关
 * @returns {Promise<{allowed: boolean, reason?: string}>}
 */
async function canWriteStudent(user, studentId, { requireEditSwitch = false } = {}) {
  if (!user) return { allowed: false, reason: '未登录' };
  if (user.role === 'admin') return { allowed: true };
  if (user.role !== 'teacher') {
    return { allowed: false, reason: '学生账号只能查看自己的数据，无写入权限' };
  }

  const [students] = await pool.query('SELECT major FROM student WHERE student_id = ?', [studentId]);
  if (students.length === 0) return { allowed: false, reason: '学生不存在' };

  const majors = await teacherMajors(user.teacher_no);
  if (majors.length === 0) {
    return { allowed: false, reason: '当前教师账号未设置负责专业，请联系管理员配置后再操作' };
  }
  if (!students[0].major || !majors.includes(students[0].major)) {
    return { allowed: false, reason: '该学生不属于你负责的专业，无权操作' };
  }

  if (requireEditSwitch) {
    const allowed = await isTeacherEditScoreAllowed();
    if (!allowed) {
      return { allowed: false, reason: '管理员尚未开放教师修改权限，当前仅管理员可修改，请新增记录或联系管理员' };
    }
  }

  return { allowed: true };
}

module.exports = { teacherMajors, isTeacherEditScoreAllowed, canWriteStudent, EDIT_SWITCH_KEY };
