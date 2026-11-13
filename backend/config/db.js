const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mysql = require('mysql2/promise');

// 创建连接池（配置来自 .env，未设置时回落到默认值）
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'student_portrait',
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// 测试连接
pool.getConnection()
  .then((conn) => {
    console.log('数据库连接成功');
    conn.release();
  })
  .catch((err) => {
    console.error('数据库连接失败:', err.message);
  });

module.exports = pool;
