const express = require('express');
const cors = require('cors');
const pool = require('./config/db');

const app = express();
const PORT = 3000;

// 中间件
app.use(cors());
app.use(express.json());

// ========== 学生接口 ==========

// 添加学生
app.post('/api/students', async (req, res) => {
  try {
    const { student_id, name, gender, college, major, grade } = req.body;
    await pool.query(
      'INSERT INTO student (student_id, name, gender, college, major, grade) VALUES (?, ?, ?, ?, ?, ?)',
      [student_id, name, gender, college, major, grade]
    );
    res.json({ code: 200, message: '学生添加成功' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 查询学生列表
app.get('/api/students', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM student');
    res.json({ code: 200, data: rows });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 查询单个学生
app.get('/api/students/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM student WHERE student_id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ code: 404, message: '学生不存在' });
    }
    res.json({ code: 200, data: rows[0] });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// ========== 学业成绩接口 ==========

// 录入成绩
app.post('/api/academic', async (req, res) => {
  try {
    const { student_id, course_name, credit, score, semester } = req.body;
    // 校验成绩范围
    if (score < 0 || score > 100) {
      return res.json({ code: 400, message: '成绩必须在0-100之间' });
    }
    await pool.query(
      'INSERT INTO academic_record (student_id, course_name, credit, score, semester) VALUES (?, ?, ?, ?, ?)',
      [student_id, course_name, credit, score, semester]
    );
    res.json({ code: 200, message: '成绩录入成功' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 查询某学生的成绩
app.get('/api/academic/:studentId', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM academic_record WHERE student_id = ?',
      [req.params.studentId]
    );
    res.json({ code: 200, data: rows });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// ========== 画像计算接口（核心） ==========

// 计算学生画像
app.post('/api/portrait/calculate/:studentId', async (req, res) => {
  const studentId = req.params.studentId;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // 1. 查询学业成绩，计算GPA和学业分
    const [academicRows] = await conn.query(
      'SELECT credit, score FROM academic_record WHERE student_id = ?',
      [studentId]
    );

    let gpa = 0;
    let academicScore = 0;
    if (academicRows.length > 0) {
      let totalWeightedScore = 0;
      let totalCredit = 0;
      for (const row of academicRows) {
        const score = Number(row.score);
        const credit = Number(row.credit);
        totalWeightedScore += score * credit;
        totalCredit += credit;
      }
      const avgScore = totalWeightedScore / totalCredit;
      // GPA换算：平均分/25
      gpa = parseFloat((avgScore / 25).toFixed(2));
      // 学业分：平均分×0.25，满分100
      academicScore = parseFloat((avgScore * 0.25).toFixed(2));
    }

    // 2. 查询科研项目，计算科研分
    const [researchRows] = await conn.query(
      'SELECT level, role FROM research_project WHERE student_id = ?',
      [studentId]
    );
    let researchScore = 0;
    for (const row of researchRows) {
      if (row.level === '国家级') researchScore += 10;
      else if (row.level === '省级') researchScore += 6;
      else if (row.level === '校级') researchScore += 3;
    }
    researchScore = Math.min(researchScore, 100); // 封顶100

    // 3. 查询实践经历，计算实践分
    const [practiceRows] = await conn.query(
      'SELECT hours, type FROM practice_activity WHERE student_id = ?',
      [studentId]
    );
    let practiceScore = 0;
    for (const row of practiceRows) {
      practiceScore += row.hours / 10; // 每10小时=1分
    }
    practiceScore = Math.min(practiceScore, 100); // 封顶100

    // 安全转换，防止NaN
    gpa = Number.isFinite(gpa) ? gpa : 0;
    academicScore = Number.isFinite(academicScore) ? academicScore : 0;
    researchScore = Number.isFinite(researchScore) ? researchScore : 0;
    practiceScore = Number.isFinite(practiceScore) ? practiceScore : 0;

    // 4. 计算综合总分：学业40% + 科研30% + 实践30%
    const totalScore = parseFloat(
      (academicScore * 0.4 + researchScore * 0.3 + practiceScore * 0.3).toFixed(2)
    );
    const finalTotal = Number.isFinite(totalScore) ? totalScore : 0;

    // 5. 写入画像表（存在则更新）
    await conn.query(
      `INSERT INTO ability_profile (student_id, gpa, academic_score, research_score, practice_score, total_score)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE gpa=?, academic_score=?, research_score=?, practice_score=?, total_score=?`,
      [studentId, gpa, academicScore, researchScore, practiceScore, finalTotal,
       gpa, academicScore, researchScore, practiceScore, finalTotal]
    );

    await conn.commit();

    res.json({
      code: 200,
      message: '画像计算完成',
      data: {
        student_id: studentId,
        gpa,
        academic_score: academicScore,
        research_score: researchScore,
        practice_score: practiceScore,
        total_score: finalTotal
      }
    });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ code: 500, message: err.message });
  } finally {
    conn.release();
  }
});

// 查询学生画像
app.get('/api/portrait/:studentId', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.*, s.name, s.college, s.major
       FROM ability_profile p
       JOIN student s ON p.student_id = s.student_id
       WHERE p.student_id = ?`,
      [req.params.studentId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ code: 404, message: '画像不存在，请先计算' });
    }
    res.json({ code: 200, data: rows[0] });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 启动服务
app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});
