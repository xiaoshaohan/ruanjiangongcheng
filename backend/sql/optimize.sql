-- 性能优化：索引与视图（可重复执行）
USE student_portrait;

-- 排行查询（ORDER BY total_score）走索引
CREATE INDEX idx_profile_total_score ON ability_profile (total_score);

-- 按学期+课程检索成绩
CREATE INDEX idx_academic_semester_course ON academic_record (semester, course_name);

-- 按级别统计科研项目
CREATE INDEX idx_research_level ON research_project (level);

-- 学生完整画像视图：一条 SQL 取到学生信息+画像，避免多表 JOIN 重复写
CREATE OR REPLACE VIEW v_student_profile AS
SELECT
    s.student_id,
    s.name,
    s.gender,
    s.college,
    s.major,
    s.grade,
    p.gpa,
    p.academic_score,
    p.research_score,
    p.practice_score,
    p.total_score,
    p.update_time
FROM student s
LEFT JOIN ability_profile p ON s.student_id = p.student_id;
