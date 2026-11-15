# 高校学生成长与职业发展数据中台

软件工程实验项目 - 选题3

围绕学生的学业成绩、科研项目、实践活动，计算能力画像并给出职业方向推荐。后端 Node.js + Express + MySQL，前端原生 HTML/CSS/JavaScript（ECharts 图表）。

## 功能清单（v1.7）

- 三角色登录与权限隔离：管理员 / 教师 / 学生，后端中间件 + 前端菜单双重控制
- 学生管理：列表、筛选（学院 / 专业 / 年级 / 关键字）、新增、编辑、删除（级联清理关联数据）
- 数据录入：学业成绩、科研项目、实践经历，支持单条增改删与 CSV 批量导入
- 能力画像：GPA、学业 / 科研 / 实践三维得分，统一换算为得分率（0–100）后加权
- 职业推荐：按画像给出方向与推荐度，**每次计算按批次落库**，保留最近 5 批可回溯
- 数据看板：总量、均值、五档分布、TOP5，支持按学院 / 专业 / 年级 / 学期筛选
- 学生对比：两名学生雷达图与逐项差值
- 学生个人视图：学生账号只看自己的画像与明细
- 用户管理：新建账号、改角色、禁用 / 启用、重置密码、删除（保留至少一个启用管理员）
- 系统设置：画像权重、标准分、换算系数、科研分值可配置，支持恢复默认与按当前配置重算全部
- CSV 导出：学生列表、画像报告（UTF-8 BOM，Excel 直接可读）

## 项目结构

```
ruanjiangongcheng2/
├── backend/                    # 后端服务（Node.js + Express）
│   ├── app.js                  # 主入口，按角色分组挂载路由
│   ├── package.json
│   ├── .env.example            # 环境变量模板（复制为 .env 使用）
│   ├── config/
│   │   └── db.js               # MySQL 连接池（dateStrings 关闭时区换算）
│   ├── routes/
│   │   ├── auth.js             # 登录、注册、改密、当前用户
│   │   ├── users.js            # 用户管理（adminOnly）
│   │   ├── me.js               # 学生个人视图（studentOnly）
│   │   ├── students.js         # 学生增删改查
│   │   ├── academic.js         # 学业成绩
│   │   ├── research.js         # 科研项目
│   │   ├── practice.js         # 实践经历
│   │   ├── portrait.js         # 画像计算、查询、职业推荐与历史
│   │   ├── stats.js            # 看板统计与筛选选项
│   │   ├── config.js           # 画像计分规则配置
│   │   ├── export.js           # CSV 导出
│   │   └── import.js           # CSV 批量导入
│   ├── utils/
│   │   ├── response.js         # 统一响应格式与错误翻译
│   │   ├── auth.js             # JWT 与角色中间件
│   │   ├── validate.js         # 声明式参数校验
│   │   ├── portrait.js         # 画像计算核心逻辑
│   │   ├── portraitConfig.js   # 计分规则读取（缓存 + 默认值兜底）
│   │   └── recommendationStore.js  # 推荐按批次落库与清理
│   ├── sql/
│   │   ├── init.sql            # 建库建表 + 示例数据
│   │   ├── auth.sql            # 系统用户表
│   │   ├── optimize.sql        # 索引与视图
│   │   └── migrate-v1.7-*.sql  # v1.7 三个迁移脚本
│   ├── test/
│   │   ├── portrait.test.js    # 画像算法单元测试
│   │   └── api.test.js         # 接口测试（内存替身，不连库）
│   └── scripts/                # 运维/演示辅助脚本
├── frontend/
│   ├── index.html              # 主界面（看板 / 学生 / 录入 / 画像 / 对比 / 用户 / 设置 / 我的画像）
│   ├── login.html
│   └── register.html
├── docs/
│   └── 测试记录.md
├── 设计规格说明书.md
├── 需求规格说明书.md
└── README.md
```

## 快速开始

1. 安装 Node.js 与 MySQL，启动 MySQL 服务。
2. 进入 `backend` 安装依赖：

   ```powershell
   cd backend
   npm ci
   ```

3. 初始化数据库（`student_portrait`），在 `backend` 目录执行：

   ```powershell
   mysql -u root -p
   ```

   ```sql
   source sql/init.sql;
   source sql/auth.sql;
   exit
   ```

   `init.sql` 含固定样例数据，**不要对已有数据的库重复导入**。找不到 `mysql` 时把 MySQL 的 `bin` 加入 PATH，或用完整路径。

4. 复制环境变量模板并按本机情况修改：

   ```powershell
   Copy-Item .env.example .env
   ```

5. 启动：

   ```powershell
   npm start
   ```

   看到“数据库连接成功”后打开 <http://localhost:3000>。首次启动且用户表为空时会创建实验账号 `admin / admin123`。

> 本原型仅用于课程实验，不要直接暴露到公网，也不要存真实学生数据。

## 角色与账号

| 角色 | 可见功能 |
| ---- | ---- |
| admin 管理员 | 全部功能，含用户管理、系统设置、批量导入、删除学生 |
| teacher 教师 | 数据看板、学生管理（只读+新增/修改）、数据录入、画像分析、学生对比、导出 |
| student 学生 | 只有“我的画像”，查看自己绑定学号对应的画像与明细 |

首次启动只创建 `admin / admin123`。要演示教师和学生视角，用管理员登录后在“用户管理”页新建账号（学生角色需填绑定学号），或让学生自己注册——注册固定为 student 角色，可选填学号绑定。

## 已有数据库升级到 v1.7

旧版脚本初始化的库，按顺序执行三个迁移脚本（可重复执行，不破坏已有数据）：

```sql
source sql/migrate-v1.7-permission.sql;   -- sys_user 加 status / student_id，历史 role=user 改为 student
source sql/migrate-v1.7-career.sql;       -- 新增 career_recommendation（推荐历史）
source sql/migrate-v1.7-config.sql;       -- 新增 portrait_config（计分规则）
```

升级后在“系统设置”页点一次“按当前配置重算全部”，让全部画像按新口径重算并写入推荐历史。

## 接口一览

统一返回 `{ code, message, data }`，除登录与注册外均需 `Authorization: Bearer <token>`。

| 方法 | 路径 | 说明 | 权限 |
| --- | --- | --- | --- |
| POST | /api/auth/login | 登录，返回 JWT（8 小时） | 公开 |
| POST | /api/auth/register | 自助注册，固定 student，可选绑定学号 | 公开 |
| POST | /api/auth/change-password | 修改当前用户密码 | 登录用户 |
| GET | /api/auth/me | 当前用户信息 | 登录用户 |
| GET/POST/PUT/DELETE | /api/users[...] | 用户列表、新建、改角色状态、删除 | admin |
| POST | /api/users/:id/reset-password | 重置指定用户密码 | admin |
| GET | /api/me/profile | 学生自己的画像与推荐 | student |
| GET | /api/me/records | 学生自己的三类明细 | student |
| GET/POST/PUT/DELETE | /api/students[...] | 学生增删改查（删除仅 admin） | staff / admin |
| POST/GET/PUT/DELETE | /api/academic[...] | 学业成绩 | staff |
| POST/GET/PUT/DELETE | /api/research[...] | 科研项目 | staff |
| POST/GET/PUT/DELETE | /api/practice[...] | 实践经历 | staff |
| POST | /api/portrait/calculate/:id | 计算画像并写入一批推荐 | staff |
| GET | /api/portrait/:id | 读取画像 | staff |
| GET | /api/portrait/career/:id | 最近一次推荐 | staff |
| GET | /api/portrait/career-history/:id | 推荐历史（最多 5 批） | staff |
| GET | /api/stats | 看板数据，支持 college / major / grade / semester | staff |
| GET | /api/stats/options | 筛选下拉选项 | staff |
| GET | /api/config/portrait | 读取计分规则 | staff |
| PUT | /api/config/portrait | 保存计分规则（校验权重和为 1） | admin |
| POST | /api/config/portrait/reset | 恢复默认 | admin |
| POST | /api/config/portrait/recalculate-all | 按当前配置重算全部 | admin |
| GET | /api/export/students | 导出学生 CSV | staff |
| GET | /api/export/portraits | 导出画像 CSV | staff |
| POST | /api/import/{students,academic,research,practice} | 批量导入 CSV | admin |

## 测试

```powershell
cd backend
npm test
```

画像算法测试与接口测试使用模拟数据库，不需要 MySQL，也不验证真实库的 SQL 与持久化。手工验证结果见 [测试记录](docs/测试记录.md)。

## 版本记录

| 版本 | 主要变化 |
| --- | --- |
| v1.3 | 初版：学生、成绩、科研、实践录入与画像计算 |
| v1.4 | 登录鉴权、数据看板、学生对比、CSV 导出 |
| v1.5 | 统一响应格式、参数校验中间件、索引与视图、批量导入 |
| v1.6 | 明细只增不删的评审修正、量纲归一化（得分率）、UI 调整 |
| v1.7 | 三角色权限隔离、用户管理、学生个人视图、看板筛选、推荐落库与历史、计分规则配置化；修复重复学号 500、不存在学号 500、存储型 XSS、日期少一天；权重定为学业 80%、科研 10%、实践 10%，绩点按分数段线性插值（90-100→4.0、80-89→3.0~3.9、70-79→2.0~2.9、60-69→1.0~1.9），看板总分分布改 20 分一档，职业推荐兜底改为按得分率区分“学业基础方向/基础积累方向”并指出短板，不再误称发展均衡 |
