-- v1.7：画像权重与计分规则可配置
CREATE TABLE IF NOT EXISTS portrait_config (
  config_key VARCHAR(50) PRIMARY KEY,
  config_value TEXT NOT NULL,
  description VARCHAR(200) DEFAULT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='系统配置';

INSERT INTO portrait_config (config_key, config_value, description)
VALUES ('portrait', '{"weights":{"academic":0.4,"research":0.3,"practice":0.3},"limits":{"academicScore":25,"researchScore":100,"practiceScore":100},"academic":{"factor":0.25},"research_points":{"国家级":10,"省级":6,"校级":3},"practice":{"hours_per_point":10}}', '画像权重与计分规则')
ON DUPLICATE KEY UPDATE description = VALUES(description);
