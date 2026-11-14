// 生成演示用学生数据 CSV（100 名学生 + 成绩 + 科研 + 实践）
// 用法：node scripts/gen-seed.js
// 输出：项目根目录 data/demo/ 下 4 个 CSV（UTF-8 带 BOM，可被 Excel 和系统导入功能直接识别）
const fs = require('fs');
const path = require('path');

const rand = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rand(arr.length)];
const randInt = (min, max) => min + rand(max - min + 1);

const surnames = ['王', '李', '张', '刘', '陈', '杨', '赵', '黄', '周', '吴', '徐', '孙', '马', '朱', '胡', '郭', '何', '林', '高', '罗'];
const givenNames = ['伟', '芳', '娜', '敏', '静', '丽', '强', '磊', '洋', '艳', '勇', '军', '杰', '娟', '涛', '明', '超', '秀英', '霞', '平', '刚', '思远', '子涵', '雨轩', '欣然', '嘉怡', '浩然', '宇辰', '梦琪', '佳宁'];

const colleges = [
  { college: '计算机学院', majors: ['物联网工程', '软件工程', '计算机科学与技术', '人工智能', '数据科学与大数据技术'] },
  { college: '电子信息工程学院', majors: ['通信工程', '电子信息工程', '集成电路设计与集成系统'] },
  { college: '电气工程学院', majors: ['电气工程及其自动化', '自动化', '新能源科学与工程'] },
  { college: '机械工程学院', majors: ['机械设计制造及其自动化', '车辆工程', '工业设计'] },
  { college: '经济管理学院', majors: ['工商管理', '会计学', '金融学', '信息管理与信息系统'] },
  { college: '材料科学与工程学院', majors: ['材料科学与工程', '功能材料'] },
];

const courses = [
  ['高等数学', 4], ['线性代数', 3], ['大学物理', 4], ['程序设计基础', 3], ['数据结构', 4],
  ['计算机组成原理', 4], ['操作系统', 4], ['计算机网络', 3], ['数据库原理', 3], ['软件工程', 3],
  ['概率论与数理统计', 3], ['大学英语', 2], ['离散数学', 3], ['物联网导论', 2], ['嵌入式系统', 3],
  ['人工智能导论', 3], ['算法设计与分析', 3], ['马克思主义基本原理', 2],
];

const researchNames = [
  '基于物联网的智能温室监测系统', '大学生创新创业训练计划', '智能仓储管理系统', '校园二手交易平台',
  '基于深度学习的图像识别应用', '边缘计算数据采集网关', '智能交通流量预测模型', '高校学生画像数据分析',
  '低功耗无线传感网络设计', '移动端健康打卡小程序',
];
const researchRoles = ['负责人', '核心成员', '成员'];
const researchLevels = ['国家级', '省级', '校级'];
const researchResults = ['优秀', '良好', '合格', '待结题'];

const practiceNames = [
  '社区志愿服务', '暑期社会实践', '校园编程马拉松', '企业实习', '支教活动',
  '科技创新作品展', '实验室开放日讲解', '校园公益活动', '技术分享会', '志愿服务进社区',
];
const practiceTypes = ['志愿服务', '社会实践', '竞赛活动', '实习实践', '科技创新'];

// 按年级分段生成学号，避开已有的 2022001 / 2022002
const segments = [
  { year: 2020, from: 1, count: 30 },
  { year: 2021, from: 1, count: 30 },
  { year: 2022, from: 3, count: 28 },
  { year: 2023, from: 1, count: 12 },
];

const students = [];
const academicRows = [];
const researchRows = [];
const practiceRows = [];

for (const seg of segments) {
  for (let i = 0; i < seg.count; i++) {
    const seq = seg.from + i;
    const sid = `${seg.year}${String(seq).padStart(3, '0')}`;
    const name = pick(surnames) + pick(givenNames);
    const gender = Math.random() < 0.6 ? 'M' : 'F';
    const c = pick(colleges);
    const major = pick(c.majors);

    students.push({
      student_id: sid, name, gender,
      college: c.college, major,
      grade: seg.year, enrollment_year: seg.year,
    });

    // 成绩：每人 3-6 门，课程不重复
    const courseCount = randInt(3, 6);
    const pool = [...courses];
    for (let k = 0; k < courseCount; k++) {
      const [courseName, credit] = pool.splice(rand(pool.length), 1)[0];
      academicRows.push({
        student_id: sid,
        course_name: courseName,
        credit: credit.toFixed(1),
        score: randInt(52, 100).toFixed(1),
        semester: `${seg.year}-${randInt(1, 2)}`,
      });
    }

    // 科研：约 60% 有 1 项，20% 有 2 项
    const r = Math.random();
    const researchCount = r < 0.6 ? 1 : r < 0.8 ? 2 : 0;
    for (let k = 0; k < researchCount; k++) {
      const startYear = seg.year + randInt(1, 2);
      const startMonth = randInt(1, 12);
      researchRows.push({
        student_id: sid,
        project_name: pick(researchNames),
        role: pick(researchRoles),
        level: pick(researchLevels),
        start_date: `${startYear}-${String(startMonth).padStart(2, '0')}-01`,
        end_date: `${startYear}-${String(Math.min(startMonth + randInt(3, 9), 12)).padStart(2, '0')}-28`,
        result: pick(researchResults),
      });
    }

    // 实践：约 55% 有 1 项，20% 有 2 项
    const p = Math.random();
    const practiceCount = p < 0.55 ? 1 : p < 0.75 ? 2 : 0;
    for (let k = 0; k < practiceCount; k++) {
      const startYear = seg.year + randInt(0, 2);
      const startMonth = randInt(1, 12);
      practiceRows.push({
        student_id: sid,
        activity_name: pick(practiceNames),
        type: pick(practiceTypes),
        start_date: `${startYear}-${String(startMonth).padStart(2, '0')}-05`,
        end_date: `${startYear}-${String(Math.min(startMonth + randInt(1, 4), 12)).padStart(2, '0')}-20`,
        hours: String(randInt(8, 120)),
        description: '参与并完成相关工作',
      });
    }
  }
}

// CSV 单元格转义：含逗号/引号/换行时用双引号包裹，内部引号翻倍
function cell(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows, headers) {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => cell(row[h])).join(','));
  }
  // 带 BOM，Excel 直接双击打开不乱码
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

const outDir = path.join(__dirname, '..', '..', 'data', 'demo');
fs.mkdirSync(outDir, { recursive: true });

const files = [
  ['students.csv', students, ['student_id', 'name', 'gender', 'college', 'major', 'grade', 'enrollment_year']],
  ['academic.csv', academicRows, ['student_id', 'course_name', 'credit', 'score', 'semester']],
  ['research.csv', researchRows, ['student_id', 'project_name', 'role', 'level', 'start_date', 'end_date', 'result']],
  ['practice.csv', practiceRows, ['student_id', 'activity_name', 'type', 'start_date', 'end_date', 'hours', 'description']],
];

for (const [name, rows, headers] of files) {
  fs.writeFileSync(path.join(outDir, name), toCsv(rows, headers), 'utf8');
}

console.log(`输出目录：${outDir}`);
for (const [name, rows] of files) console.log(`  ${name}: ${rows.length} 行`);
console.log(`学生 ${students.length} 名 / 成绩 ${academicRows.length} 条 / 科研 ${researchRows.length} 条 / 实践 ${practiceRows.length} 条`);
