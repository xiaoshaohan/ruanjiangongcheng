-- v1.9：安全与数据完整性加固（可重复执行）
-- 库名由 mysql -D 参数指定，例如：mysql -uroot -p -D student_portrait < 本文件.sql

-- 1. sys_user 增加 token 版本号：禁用、删除、改角色、改密码后递增，旧 token 立即失效
SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_user' AND COLUMN_NAME = 'token_version');
SET @ddl := IF(@has = 0,
  'ALTER TABLE sys_user ADD COLUMN token_version INT NOT NULL DEFAULT 0 COMMENT ''token 版本号，账号状态变化时递增''',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. 一个学号只能绑定一个账号（先检查历史重复，存在重复则跳过并在末尾提示人工清理）
SET @dup_student := (SELECT COUNT(*) FROM (
  SELECT student_id FROM sys_user WHERE student_id IS NOT NULL GROUP BY student_id HAVING COUNT(*) > 1
) d);
SET @idx_student := (SELECT COUNT(*) FROM information_schema.STATISTICS
                     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_user' AND INDEX_NAME = 'uk_sys_user_student');
SET @ddl := IF(@dup_student = 0 AND @idx_student = 0,
  'CREATE UNIQUE INDEX uk_sys_user_student ON sys_user (student_id)',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. 一个工号只能绑定一个账号
SET @dup_teacher := (SELECT COUNT(*) FROM (
  SELECT teacher_no FROM sys_user WHERE teacher_no IS NOT NULL GROUP BY teacher_no HAVING COUNT(*) > 1
) d);
SET @idx_teacher := (SELECT COUNT(*) FROM information_schema.STATISTICS
                     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_user' AND INDEX_NAME = 'uk_sys_user_teacher');
SET @ddl := IF(@dup_teacher = 0 AND @idx_teacher = 0,
  'CREATE UNIQUE INDEX uk_sys_user_teacher ON sys_user (teacher_no)',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4. 同一学生同一课程同一学期只允许一条成绩（存在历史重复时跳过，由接口层拦截重复提交）
SET @dup_academic := (SELECT COUNT(*) FROM (
  SELECT student_id, course_name, semester FROM academic_record
  GROUP BY student_id, course_name, semester HAVING COUNT(*) > 1
) d);
SET @idx_academic := (SELECT COUNT(*) FROM information_schema.STATISTICS
                      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'academic_record' AND INDEX_NAME = 'uk_academic_course');
SET @ddl := IF(@dup_academic = 0 AND @idx_academic = 0,
  'CREATE UNIQUE INDEX uk_academic_course ON academic_record (student_id, course_name, semester)',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 5. 实践时长改为支持小数，避免 1.5 小时被静默四舍五入成 2
SET @hours_type := (SELECT COLUMN_TYPE FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'practice_activity' AND COLUMN_NAME = 'hours');
SET @ddl := IF(@hours_type LIKE 'int%',
  'ALTER TABLE practice_activity MODIFY COLUMN hours DECIMAL(6,1) DEFAULT NULL COMMENT ''时长(小时)''',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 6. 画像表记录计算时的配置版本与时间，便于识别过期数据
SET @has_cv := (SELECT COUNT(*) FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ability_profile' AND COLUMN_NAME = 'config_version');
SET @ddl := IF(@has_cv = 0,
  'ALTER TABLE ability_profile ADD COLUMN config_version VARCHAR(32) DEFAULT NULL COMMENT ''计算时使用的画像配置版本''',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_ct := (SELECT COUNT(*) FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ability_profile' AND COLUMN_NAME = 'calculated_at');
SET @ddl := IF(@has_ct = 0,
  'ALTER TABLE ability_profile ADD COLUMN calculated_at DATETIME DEFAULT NULL COMMENT ''画像最近一次计算时间''',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 画像配置快照：查询与导出按快照里的标准分换算，避免旧分数套新分母（R52）
SET @has_cs := (SELECT COUNT(*) FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ability_profile' AND COLUMN_NAME = 'config_snapshot');
SET @ddl := IF(@has_cs = 0,
  'ALTER TABLE ability_profile ADD COLUMN config_snapshot JSON DEFAULT NULL COMMENT ''计算时的画像配置快照''',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 7. 管理操作审计日志（字段与 utils/audit.js 对齐）
CREATE TABLE IF NOT EXISTS audit_log (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  actor_id        INT          DEFAULT NULL COMMENT '操作人账号 id',
  actor_username  VARCHAR(50)  DEFAULT NULL COMMENT '操作人用户名',
  actor_role      VARCHAR(20)  DEFAULT NULL COMMENT '操作人角色',
  action          VARCHAR(100) NOT NULL COMMENT '动作代码，如 student.delete',
  target_type     VARCHAR(50)  DEFAULT NULL COMMENT '操作对象类型',
  target_id       VARCHAR(100) DEFAULT NULL COMMENT '操作对象标识',
  before_value    TEXT         COMMENT '变更前值（JSON 摘要）',
  after_value     TEXT         COMMENT '变更后值（JSON 摘要）',
  ip              VARCHAR(45)  DEFAULT NULL,
  user_agent      VARCHAR(255) DEFAULT NULL,
  created_at      DATETIME     DEFAULT CURRENT_TIMESTAMP,
  KEY idx_actor_username (actor_username),
  KEY idx_action (action),
  KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='管理操作审计日志';

-- 8. 性别统一为 M / F，历史中文值与非法值就地归一
UPDATE student SET gender = 'M' WHERE gender = '男';
UPDATE student SET gender = 'F' WHERE gender = '女';
UPDATE student SET gender = NULL WHERE gender IS NOT NULL AND gender NOT IN ('M', 'F');

-- 9. 执行结果核对（有重复数据时下面两行的计数会大于 0，需人工清理后重建索引）
SELECT 'sys_user 学号重复绑定' AS item, @dup_student AS cnt
UNION ALL SELECT 'sys_user 工号重复绑定', @dup_teacher
UNION ALL SELECT '成绩重复记录组', @dup_academic;

SELECT COUNT(*) AS students_with_gender FROM student WHERE gender IS NOT NULL;
SELECT COUNT(*) AS audit_log_rows FROM audit_log;
