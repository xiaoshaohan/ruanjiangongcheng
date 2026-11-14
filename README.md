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

## 补充说明：当前版本的运行与测试

以下内容为现有说明的补充。当前仓库中有 `frontend/login.html` 和 `frontend/index.html`，页面使用 HTML、CSS 和 JavaScript；上面的 Vue.js 描述可在小组确认后统一更新。下面的步骤在 Windows、Node.js 24.22.0 和 MySQL 8.0.29 环境下测试过，其他环境的安装与启动命令可能不同。

### 首次配置数据库

1. 安装 Node.js 和 MySQL，启动 MySQL 服务，并准备实验用数据库环境。初始化脚本会创建和使用名为 `student_portrait` 的数据库，并插入示例数据。**如果已有同名数据库，请先备份并检查，避免影响已有数据。**
2. 在终端进入项目的 `backend` 文件夹，执行 `npm ci` 安装依赖。
3. 在 `backend` 文件夹启动 MySQL 客户端（账号按自己的环境调整）：

   ```powershell
   mysql -u root -p
   ```

   输入数据库密码后，在 MySQL 提示符下依次执行：

   ```sql
   source sql/init.sql;
   source sql/auth.sql;
   exit
   ```

   其中 `auth.sql` 创建登录用户表，是当前登录功能所需的补充步骤。`source` 使用的相对路径以启动客户端时所在目录为准；如果找不到 `mysql`，需要将 MySQL 的 `bin` 目录加入 PATH，或使用客户端的完整路径。`init.sql` 含固定样例数据，**不要对已有数据的库重复导入**；如初始化中途失败，请先检查实际状态。
4. 在 `backend` 目录中，确认没有已有的 `.env` 文件后，将 `.env.example` 复制为 `.env`：

   ```powershell
   Copy-Item .env.example .env
   ```

   根据自己的数据库环境修改 `.env` 中的连接信息。该文件包含本机数据库配置，不要提交或分享密码。
5. 在 `backend` 目录执行 `npm start`，看到“数据库连接成功”后，在浏览器打开 `http://localhost:3000`（如果在 `.env` 中修改了 `PORT`，请使用对应端口）。首次启动且用户表为空时，程序创建实验用账号 `admin / admin123`。该账号只供本地实验，本原型不应直接暴露到公网或用于保存真实学生数据。

### 运行测试

在 `backend` 目录执行：

```powershell
npm test
```

画像计算测试和接口测试使用模拟数据库，不需要运行 MySQL，也不能验证真实数据库的 SQL 和数据持久化。自动测试与人工检查的范围及结果见 [测试记录](docs/测试记录.md)。
