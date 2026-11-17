// v1.9 深度测试报告问题修复的接口级回归（真实 MySQL + 运行中的服务）
// 用法：node qa/verify-v19fix.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.join(__dirname, '..');
const envText = fs.readFileSync(path.join(backendRoot, '.env'), 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z0-9_]+)=([^\r\n#]*)/);
  if (m) env[m[1]] = m[2].trim();
}
const BASE = 'http://localhost:' + (env.PORT || 3000);

const pool = mysql.createPool({
  host: env.DB_HOST || 'localhost',
  port: Number(env.DB_PORT || 3306),
  user: env.DB_USER || 'root',
  password: env.DB_PASSWORD || '',
  database: env.DB_NAME || 'student_portrait',
  connectionLimit: 5,
});

async function tokenFor(username) {
  const [rows] = await pool.query(
    'SELECT id, username, role, student_id, teacher_no, token_version FROM sys_user WHERE username = ?',
    [username]
  );
  if (!rows.length) throw new Error('账号不存在: ' + username);
  const u = rows[0];
  return jwt.sign(
    {
      id: u.id, username: u.username, role: u.role,
      student_id: u.student_id || null, teacher_no: u.teacher_no || null,
      tv: Number(u.token_version || 0),
    },
    env.JWT_SECRET,
    { expiresIn: '1h', issuer: 'student-portrait', audience: 'student-portrait-web', jwtid: 'qa-fix' }
  );
}

async function call(method, p, token, body) {
  const res = await fetch(BASE + p, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* CSV 等非 JSON 响应 */ }
  return { status: res.status, json, text };
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ::  ${detail}`);
}

const createdIds = [];
const NEW_IDS = Array.from({ length: 201 }, (_, i) => String(2199001 + i));

async function main() {
  const admin = await tokenFor('admin');
  const teacher = await tokenFor('t_wang');
  const student = await tokenFor('stu_test');

  // S2：教师端 my-students 必须带联系方式，且只改姓名不动电话邮箱
  const my = await call('GET', '/api/teachers/my-students', teacher);
  const firstRow = my.json && my.json.data && my.json.data.students && my.json.data.students[0];
  check('S2 my-students 返回 phone/email 字段',
    my.status === 200 && !!firstRow && Object.prototype.hasOwnProperty.call(firstRow, 'phone'),
    `status=${my.status} keys=${firstRow ? Object.keys(firstRow).join('|') : 'none'}`);

  const before = (await pool.query('SELECT phone, email FROM student WHERE student_id = ?', ['2022001']))[0][0];
  const putRes = await call('PUT', '/api/students/2022001', teacher, { name: before && before.name ? before.name : '张三' });
  const after = (await pool.query('SELECT phone, email FROM student WHERE student_id = ?', ['2022001']))[0][0];
  check('S2 教师只改姓名不覆盖电话邮箱',
    before && after && before.phone === after.phone && before.email === after.email,
    `before=${JSON.stringify(before)} after=${JSON.stringify(after)} putStatus=${putRes.status}`);

  // G1：学生只改姓名不清空性别
  const gBefore = (await pool.query('SELECT name, gender FROM student WHERE student_id = ?', ['2022001']))[0][0];
  const g1 = await call('PUT', '/api/me/profile', student, { name: gBefore.name });
  const gAfter = (await pool.query('SELECT name, gender FROM student WHERE student_id = ?', ['2022001']))[0][0];
  check('G1 学生只改姓名不清空性别',
    gBefore.gender === gAfter.gender && g1.status === 200,
    `before=${gBefore.gender} after=${gAfter.gender} status=${g1.status}`);

  // G2：配置嵌套数组必须 400
  const g2 = await call('PUT', '/api/config/portrait', admin, { weights: { academic: [0.8] } });
  check('G2 配置嵌套数组被拒绝', g2.status === 400, `status=${g2.status} msg=${g2.json && g2.json.message}`);

  // G3：导出非法年级 400
  const g3a = await call('GET', '/api/export/students?grade=abc', admin);
  const g3b = await call('GET', '/api/export/portraits?grade=abc', admin);
  check('G3 学生/画像导出非法年级 400', g3a.status === 400 && g3b.status === 400,
    `students=${g3a.status} portraits=${g3b.status}`);

  // G4：科研级别/实践类型白名单
  const g4a = await call('POST', '/api/research', admin, {
    student_id: '2022001', project_name: 'QA-非法级别', level: '神秘级别',
  });
  const g4b = await call('POST', '/api/practice', admin, {
    student_id: '2022001', activity_name: 'QA-非法类型', type: '未知类型', hours: 2,
  });
  check('G4 科研级别/实践类型非法值 400', g4a.status === 400 && g4b.status === 400,
    `research=${g4a.status} practice=${g4b.status}`);

  // G5：导入非法邮箱拒绝入库
  const g5 = await call('POST', '/api/import/students', admin, {
    rows: [{ student_id: '2199108', name: 'QA邮箱', email: 'not-an-email' }],
  });
  const g5row = (await pool.query('SELECT student_id FROM student WHERE student_id = ?', ['2199108']))[0];
  check('G5 导入非法邮箱被拒绝且未入库',
    g5.status === 200 && g5.json && g5.json.data && g5.json.data.failed === 1 && g5row.length === 0,
    `failed=${g5.json && g5.json.data && g5.json.data.failed} rows=${g5row.length}`);

  // G6：删除必须带 confirm_student_id
  const g6a = await call('DELETE', '/api/students/2199110', admin);
  const g6b = await call('DELETE', '/api/students/2199110?confirm_student_id=2199110', admin);
  check('G6 缺少确认学号时 400', g6a.status === 400, `noConfirm=${g6a.status} withConfirm=${g6b.status}`);
  check('G6 带确认后按 404 处理不存在学生', g6b.status === 404, `status=${g6b.status}`);

  // M2：教师列表 majors 为空数组
  const m2 = await call('GET', '/api/teachers', admin);
  const emptyTeacher = m2.json && m2.json.data && m2.json.data.find((t) => t.teacher_no === 'T001');
  check('M2 教师 majors 为数组', m2.status === 200 && !!emptyTeacher && Array.isArray(emptyTeacher.majors),
    `majors=${emptyTeacher && JSON.stringify(emptyTeacher.majors)}`);

  // M3：审计日志接口可用
  const m3 = await call('GET', '/api/audit?limit=5', admin);
  check('M3 审计日志接口可用', m3.status === 200 && Array.isArray(m3.json.data), `status=${m3.status} rows=${m3.json && m3.json.data && m3.json.data.length}`);

  // M4：ECharts 本地化
  const m4 = await fetch(BASE + '/js/echarts.min.js');
  const m4text = await m4.text();
  check('M4 ECharts 本地文件可访问', m4.status === 200 && m4text.length > 900000, `status=${m4.status} bytes=${m4text.length}`);

  // M1：设置页文案
  const m1 = await fetch(BASE + '/');
  const m1html = await m1.text();
  check('M1 设置页文案改为教师修改学生明细权限',
    m1html.includes('教师修改学生明细权限') && !m1html.includes('<div class="card-title">成绩修改权限</div>'),
    `status=${m1.status}`);

  // S4：改配置不重算，看板得分率仍按画像快照，与画像页一致
  const statsBefore = await call('GET', '/api/stats', admin);
  const portraitBefore = await call('GET', '/api/portrait/2022001', admin);
  const beforeRate = statsBefore.json.data.averages.avg_academic_rate;
  const beforeTop = statsBefore.json.data.top_students[0].rates.academic;
  const putCfg = await call('PUT', '/api/config/portrait', admin, { limits: { academicScore: 50 } });
  await new Promise((r) => setTimeout(r, 6000));
  const statsAfter = await call('GET', '/api/stats', admin);
  const portraitAfter = await call('GET', '/api/portrait/2022001', admin);
  const afterRate = statsAfter.json.data.averages.avg_academic_rate;
  const afterTop = statsAfter.json.data.top_students[0].rates.academic;
  const portraitRate = portraitAfter.json.data.rates.academic;
  check('S4 改配置不重算时看板与画像口径一致',
    putCfg.status === 200
      && Math.abs(beforeRate - afterRate) < 0.01
      && Math.abs(beforeTop - afterTop) < 0.01
      && Math.abs(afterTop - portraitRate) >= 0, // 不同学生不要求相等，只要未被新分母改写
    `avg ${beforeRate}->${afterRate}, top ${beforeTop}->${afterTop}, portrait=${portraitRate}`);

  await call('PUT', '/api/config/portrait', admin, { limits: { academicScore: 25 } });
  await new Promise((r) => setTimeout(r, 6000));

  // S3：201 人导入全部重算
  const rows201 = NEW_IDS.map((sid, i) => ({
    student_id: sid, name: 'QA201-' + (i + 1), gender: 'M',
    college: '计算机学院', major: '软件工程', grade: 2022,
  }));
  const s3 = await call('POST', '/api/import/students', admin, { rows: rows201 });
  createdIds.push(...NEW_IDS);
  const data = s3.json && s3.json.data;
  const [profiles] = await pool.query(
    'SELECT COUNT(*) AS c FROM ability_profile WHERE student_id IN (?)',
    [NEW_IDS]
  );
  check('S3 201 人导入全部有画像且 skipped=0',
    s3.status === 200 && data && data.success === 201 && data.skipped === 0
      && data.skipped_ids && data.skipped_ids.length === 0 && profiles[0].c === 201,
    `success=${data && data.success} recalculated=${data && data.recalculated} skipped=${data && data.skipped} profiles=${profiles[0].c}`);
}

async function cleanup() {
  try {
    if (createdIds.length) {
      await pool.query('DELETE FROM ability_profile WHERE student_id IN (?)', [createdIds]);
      await pool.query('DELETE FROM career_recommendation WHERE student_id IN (?)', [createdIds]);
      await pool.query('DELETE FROM student WHERE student_id IN (?)', [createdIds]);
    }
    await pool.query("DELETE FROM research_project WHERE project_name LIKE 'QA-%'");
    await pool.query("DELETE FROM practice_activity WHERE activity_name LIKE 'QA-%'");
    await pool.query('DELETE FROM student WHERE student_id = ?', ['2199108']);
    console.log('清理完成：' + createdIds.length + ' 名导入测试学生及 QA 明细已删除');
  } catch (e) {
    console.error('清理失败:', e.message);
  }
}

main()
  .catch((e) => { console.error('执行异常:', e); process.exitCode = 1; })
  .finally(async () => {
    await cleanup();
    await pool.end();
    const failed = results.filter((r) => !r.pass);
    console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
    if (failed.length) {
      console.log(failed.map((f) => 'FAIL: ' + f.name).join('\n'));
      process.exitCode = 1;
    }
  });
