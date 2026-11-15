-- v1.7：职业推荐落库，保留历史记录
CREATE TABLE IF NOT EXISTS career_recommendation (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id VARCHAR(20) NOT NULL,
  direction VARCHAR(50) NOT NULL COMMENT '推荐方向',
  score DECIMAL(5,2) NOT NULL COMMENT '推荐度',
  reason VARCHAR(500) DEFAULT NULL COMMENT '推荐理由',
  total_score DECIMAL(6,2) DEFAULT NULL COMMENT '生成时的综合总分快照',
  batch_at DATETIME(3) NOT NULL COMMENT '批次时间，同一批推荐相同',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_student_batch (student_id, batch_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='职业推荐历史';
