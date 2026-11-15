// 学生数据的写权限判定（管理员全权、教师按负责专业、学生只读）
const pool = require('../config/db');

// 教师负责的专业列表
async function teacherMajors(teacherNo) {
  if (!teacherNo) return [];
  const [rows] = await pool.query('SELECT major FROM teacher_major WHERE teacher_no = ?', [teacherNo]);
  return rows.map((r) => r.major);
}

// 某学生是否落在教师负责的专业范围内
async function teacherCoversStudent(teacherNo, studentId) {
  if (!teacherNo || !studentId) return false;
  const [rows] = await pool.query(
    `SELECT 1 FROM student s
     JOIN teacher_major tm ON tm.major = s.major
     WHERE s.student_id = ? AND tm.teacher_no = ? LIMIT 1`,
    [studentId, teacherNo]
  );
  return rows.length > 0;
}

// 全局开关：管理员是否允许教师修改成绩
async function isTeacherEditScoreAllowed() {
  const [rows] = await pool.query(
    "SELECT config_value FROM sys_config WHERE config_key = 'allow_teacher_edit_score'"
  );
  return rows.length > 0 && String(rows[0].config_value) === '1';
}

// 统一判定：能否对该学生执行写操作
// requireEditSwitch 为 true 时，教师还需要管理员已开放"修改成绩"开关
async function canWriteStudent(user, studentId, options = {}) {
  const { requireEditSwitch = false } = options;
  if (!user) return { allowed: false, reason: '未登录或登录已过期' };
  if (user.role === 'admin') return { allowed: true };
  if (user.role !== 'teacher') return { allowed: false, reason: '当前账号无权操作学生数据' };
  if (!user.teacher_no) return { allowed: false, reason: '教师账号未绑定工号，请联系管理员' };
  if (requireEditSwitch && !(await isTeacherEditScoreAllowed())) {
    return { allowed: false, reason: '管理员当前未开放教师修改成绩的权限' };
  }
  if (!(await teacherCoversStudent(user.teacher_no, studentId))) {
    return { allowed: false, reason: '该学生不在你负责的专业范围内' };
  }
  return { allowed: true };
}

module.exports = {
  teacherMajors,
  teacherCoversStudent,
  isTeacherEditScoreAllowed,
  canWriteStudent,
};
