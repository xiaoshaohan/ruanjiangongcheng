-- v1.7 权限体系升级：用户角色扩展 + 禁用状态 + 学生账号绑定
USE student_portrait;

-- 新增字段（MySQL 不支持 ADD COLUMN IF NOT EXISTS，用存储过程判断后执行，可重复运行）
DROP PROCEDURE IF EXISTS add_column_if_absent;

DELIMITER $$
CREATE PROCEDURE add_column_if_absent()
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = 'student_portrait' AND TABLE_NAME = 'sys_user' AND COLUMN_NAME = 'status'
    ) THEN
        ALTER TABLE sys_user ADD COLUMN status TINYINT NOT NULL DEFAULT 1 COMMENT '1 启用 / 0 禁用';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = 'student_portrait' AND TABLE_NAME = 'sys_user' AND COLUMN_NAME = 'student_id'
    ) THEN
        ALTER TABLE sys_user ADD COLUMN student_id VARCHAR(20) DEFAULT NULL COMMENT '学生账号绑定的学号';
    END IF;
END$$
DELIMITER ;

CALL add_column_if_absent();
DROP PROCEDURE add_column_if_absent;

-- 角色统一为 admin / teacher / student，历史上注册的 user 一律视为学生
UPDATE sys_user SET role = 'student' WHERE role = 'user';

-- 打印结果，便于人工确认
SELECT id, username, role, status, student_id FROM sys_user;
