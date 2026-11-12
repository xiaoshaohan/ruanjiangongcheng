const mysql = require('mysql2/promise');

// 创建连接池
const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '123456',  // 改成你自己的MySQL密码
  database: 'student_portrait',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// 测试连接
pool.getConnection()
  .then(conn => {
    console.log('数据库连接成功');
    conn.release();
  })
  .catch(err => {
    console.error('数据库连接失败:', err.message);
  });

module.exports = pool;
