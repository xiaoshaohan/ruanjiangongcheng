-- v1.8：账号体系升级（教师工号、按专业匹配师生、全局成绩编辑开关）
USE student_portrait;

-- 1. 教师基础数据表：教师注册时校验工号是否存在
CREATE TABLE IF NOT EXISTS teacher (
  teacher_no  VARCHAR(20)  PRIMARY KEY COMMENT '工号',
  name        VARCHAR(50)  NOT NULL COMMENT '姓名',
  college     VARCHAR(100) DEFAULT NULL COMMENT '所属学院',
  title       VARCHAR(50)  DEFAULT NULL COMMENT '职称',
  status      TINYINT      NOT NULL DEFAULT 1 COMMENT '1 在职 / 0 停用',
  created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='教师基础数据';

-- 2. 教师负责专业：决定"老师教的学生"范围（按专业自动匹配）
CREATE TABLE IF NOT EXISTS teacher_major (
  teacher_no  VARCHAR(20)  NOT NULL COMMENT '工号',
  major       VARCHAR(100) NOT NULL COMMENT '负责专业',
  PRIMARY KEY (teacher_no, major),
  KEY idx_major (major)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='教师负责专业';

-- 3. sys_user 增加工号绑定（MySQL 不支持 ADD COLUMN IF NOT EXISTS，用动态 SQL 保证可重复执行）
SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = 'student_portrait' AND TABLE_NAME = 'sys_user' AND COLUMN_NAME = 'teacher_no');
SET @ddl := IF(@has = 0,
  'ALTER TABLE sys_user ADD COLUMN teacher_no VARCHAR(20) DEFAULT NULL COMMENT ''教师账号绑定的工号''',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4. 系统开关表（与画像计分配置分开存）
CREATE TABLE IF NOT EXISTS sys_config (
  config_key    VARCHAR(50)  PRIMARY KEY,
  config_value  VARCHAR(200) NOT NULL,
  description   VARCHAR(200) DEFAULT NULL,
  updated_at    DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='系统开关配置';

INSERT INTO sys_config (config_key, config_value, description)
VALUES ('allow_teacher_edit_score', '0', '是否允许教师修改成绩：1 允许 / 0 仅管理员')
ON DUPLICATE KEY UPDATE description = VALUES(description);

-- 5. 种子教师：T001 王老师（对应已有账号 t_wang），负责物联网工程
INSERT INTO teacher (teacher_no, name, college, title)
VALUES ('T001', '王老师', '计算机学院', '讲师')
ON DUPLICATE KEY UPDATE name = VALUES(name), college = VALUES(college);

INSERT IGNORE INTO teacher_major (teacher_no, major) VALUES ('T001', '物联网工程');

UPDATE sys_user SET teacher_no = 'T001' WHERE username = 't_wang';

SELECT u.id, u.username, u.role, u.student_id, u.teacher_no FROM sys_user u ORDER BY u.id;
SELECT teacher_no, name, college FROM teacher;
SELECT teacher_no, major FROM teacher_major;
SELECT config_key, config_value FROM sys_config;
