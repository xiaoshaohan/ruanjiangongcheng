# 高校学生成长与职业发展数据中台

软件工程实验项目 - 选题3

## 项目结构

```
ruanjiangongcheng/
├── backend/              # 后端服务（Node.js + Express）
│   ├── app.js            # 主入口，挂载中间件与路由
│   ├── package.json       # 依赖配置
│   ├── config/
│   │   └── db.js         # 数据库连接配置
│   ├── routes/           # 路由模块
│   │   ├── students.js   # 学生接口
│   │   ├── academic.js   # 学业成绩接口
│   │   ├── research.js   # 科研项目接口
│   │   ├── practice.js   # 实践经历接口
│   │   └── portrait.js   # 画像计算/查询接口
│   ├── utils/            # 公共工具
│   │   ├── response.js   # 统一响应格式与错误处理
│   │   └── portrait.js   # 画像计算核心逻辑
│   ├── public/           # 前端静态页面
│   └── sql/
│       └── init.sql      # 数据库初始化脚本
└── README.md
```

## 技术栈

- 后端：Node.js + Express.js
- 数据库：MySQL 8.4
- 前端：Vue.js（待开发）

## 运行方式

```bash
cd backend
npm install
# 先执行 sql/init.sql 初始化数据库
npm start
```

服务运行在 http://localhost:3000

## 核心接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/students | 查询学生列表 |
| POST | /api/students | 添加学生 |
| GET | /api/students/:id | 查询单个学生 |
| POST | /api/academic | 录入学业成绩 |
| GET | /api/academic/:studentId | 查询某学生成绩 |
| POST | /api/research | 录入科研项目 |
| GET | /api/research/:studentId | 查询某学生科研项目 |
| POST | /api/practice | 录入实践经历 |
| GET | /api/practice/:studentId | 查询某学生实践经历 |
| POST | /api/portrait/calculate/:id | 计算学生画像 |
| GET | /api/portrait/:id | 查询学生画像 |
