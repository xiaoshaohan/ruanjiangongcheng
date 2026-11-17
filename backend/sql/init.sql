-- 高校学生成长与职业发展数据中台 - 数据库初始化
-- 先手工建库再执行本文件：
--   CREATE DATABASE IF NOT EXISTS <你的库名> DEFAULT CHARACTER SET utf8mb4;
-- 然后用 mysql 的 -D 参数指定同一个库名执行本文件
-- 库名由 mysql -D 参数指定，例如：mysql -uroot -p -D student_portrait < 本文件.sql

-- 学生表
CREATE TABLE IF NOT EXISTS student (
    student_id   VARCHAR(20)  PRIMARY KEY COMMENT '学号',
    name         VARCHAR(50)  NOT NULL COMMENT '姓名',
    gender       CHAR(1)      COMMENT '性别 M/F',
    college      VARCHAR(100) COMMENT '学院',
    major        VARCHAR(100) COMMENT '专业',
    grade        INT          COMMENT '年级',
    enrollment_year INT       COMMENT '入学年份',
    phone        VARCHAR(20)  COMMENT '手机号',
    email        VARCHAR(100) COMMENT '邮箱'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='学生表';

-- 学业成绩表
CREATE TABLE IF NOT EXISTS academic_record (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    student_id   VARCHAR(20)  NOT NULL COMMENT '学号',
    course_name  VARCHAR(100) NOT NULL COMMENT '课程名',
    credit       DECIMAL(3,1) NOT NULL COMMENT '学分',
    score        DECIMAL(5,1) NOT NULL COMMENT '成绩',
    semester     VARCHAR(20)  COMMENT '学期',
    FOREIGN KEY (student_id) REFERENCES student(student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='学业成绩表';

-- 科研项目表
CREATE TABLE IF NOT EXISTS research_project (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    student_id   VARCHAR(20)  NOT NULL COMMENT '学号',
    project_name VARCHAR(200) NOT NULL COMMENT '项目名称',
    role         VARCHAR(50)  COMMENT '角色：负责人/参与人',
    level        VARCHAR(50)  COMMENT '级别：国家级/省级/校级',
    start_date   DATE         COMMENT '开始时间',
    end_date     DATE         COMMENT '结束时间',
    result       VARCHAR(200) COMMENT '成果',
    FOREIGN KEY (student_id) REFERENCES student(student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='科研项目表';

-- 实践经历表
CREATE TABLE IF NOT EXISTS practice_activity (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    student_id    VARCHAR(20)  NOT NULL COMMENT '学号',
    activity_name VARCHAR(200) NOT NULL COMMENT '实践名称',
    type          VARCHAR(50)  COMMENT '类型：实习/志愿服务/社团',
    start_date    DATE         COMMENT '开始时间',
    end_date      DATE         COMMENT '结束时间',
    hours         INT          COMMENT '时长(小时)',
    description   VARCHAR(500) COMMENT '描述',
    FOREIGN KEY (student_id) REFERENCES student(student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='实践经历表';

-- 学生画像表
CREATE TABLE IF NOT EXISTS ability_profile (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    student_id       VARCHAR(20) NOT NULL COMMENT '学号',
    gpa              DECIMAL(4,2) COMMENT '平均学分绩点',
    academic_score   DECIMAL(5,2) COMMENT '学业能力分',
    research_score   DECIMAL(5,2) COMMENT '科研能力分',
    practice_score   DECIMAL(5,2) COMMENT '实践能力分',
    total_score      DECIMAL(5,2) COMMENT '综合总分',
    update_time      DATETIME    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES student(student_id),
    UNIQUE KEY uk_student_profile (student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='学生画像表';

-- 插入测试学生数据
INSERT INTO student VALUES
('2022001', '张三', 'M', '计算机学院', '物联网工程', 2022, 2022, '13800000001', 'zhangsan@test.com'),
('2022002', '李四', 'F', '计算机学院', '软件工程', 2022, 2022, '13800000002', 'lisi@test.com');

-- 插入测试成绩
INSERT INTO academic_record (student_id, course_name, credit, score, semester) VALUES
('2022001', '高等数学A', 4.0, 85.0, '2022-2023-1'),
('2022001', '大学英语', 3.0, 90.0, '2022-2023-1'),
('2022001', 'C语言程序设计', 3.5, 88.0, '2022-2023-1'),
('2022001', '线性代数', 3.0, 78.0, '2022-2023-1'),
('2022002', '高等数学A', 4.0, 92.0, '2022-2023-1'),
('2022002', '大学英语', 3.0, 85.0, '2022-2023-1');

-- 插入测试科研项目
INSERT INTO research_project (student_id, project_name, role, level, start_date, end_date, result) VALUES
('2022001', '智能仓储管理系统', '负责人', '校级', '2023-03-01', '2023-12-31', '结题优秀'),
('2022002', '大学生创新创业项目', '参与人', '省级', '2023-04-01', '2024-04-01', '已结题');
