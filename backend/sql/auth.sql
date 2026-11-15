-- 系统用户表（登录鉴权 + 角色权限）
USE student_portrait;

CREATE TABLE IF NOT EXISTS sys_user (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    username      VARCHAR(50)  NOT NULL UNIQUE COMMENT '登录名',
    password_hash VARCHAR(200) NOT NULL COMMENT '密码哈希 salt:key',
    role          VARCHAR(20)  NOT NULL DEFAULT 'student' COMMENT '角色：admin 管理员 / teacher 教师 / student 学生',
    status        TINYINT      NOT NULL DEFAULT 1 COMMENT '1 启用 / 0 禁用',
    student_id    VARCHAR(20)  DEFAULT NULL COMMENT '学生账号绑定的学号，仅 student 角色使用',
    created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
    KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='系统用户表';
