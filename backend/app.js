const express = require('express');
const cors = require('cors');
const { fail } = require('./utils/response');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- 中间件 ----------
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname + '/public'));

// ---------- 路由 ----------
app.use('/api/students', require('./routes/students'));
app.use('/api/academic', require('./routes/academic'));
app.use('/api/research', require('./routes/research'));
app.use('/api/practice', require('./routes/practice'));
app.use('/api/portrait', require('./routes/portrait'));

// ---------- 404 兜底 ----------
app.use((req, res) => fail(res, 404, 404, '接口不存在'));

// 启动服务
app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});