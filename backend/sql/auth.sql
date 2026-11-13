-- 系统用户表（登录鉴权）
USE student_portrait;

CREATE TABLE IF NOT EXISTS sys_user (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    username      VARCHAR(50)  NOT NULL UNIQUE COMMENT '登录名',
    password_hash VARCHAR(200) NOT NULL COMMENT '密码哈希 salt:key',
    role          VARCHAR(20)  NOT NULL DEFAULT 'admin' COMMENT '角色',
    created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='系统用户表';
