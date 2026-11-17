# 高校学生成长与职业发展数据中台

软件工程实验项目 - 选题3

围绕学生的学业成绩、科研项目、实践活动，计算能力画像并给出职业方向推荐。后端 Node.js + Express + MySQL，前端原生 HTML/CSS/JavaScript（ECharts 图表）。

## 功能清单（v1.9）

- 三角色登录与权限隔离：管理员 / 教师 / 学生，后端中间件 + 前端菜单双重控制
- **账号认证**：自助注册仅开放学生（工号认证由管理员开通账号），学生必须"学号 + 姓名"与名单完全一致，学号不存在或姓名不匹配直接拒绝；用户名统一小写，一个学号/工号只能绑定一个账号
- **登录防护**：连续失败 5 次锁定 15 分钟；密码至少 8 位、拒绝弱口令与纯重复数字。失败计数存在进程内存，**多实例部署时各实例独立计数**，需要在网关或反向代理层统一限流
- **Token 撤销**：改密码、改角色/状态、重置密码、删除学生解绑账号都会让旧 token 立即失效（`token_version`）
- **师生关系**：教师档案记录工号、姓名、学院、职称、状态与负责专业，学生专业命中即视为该教师的学生；教师负责专业可显式清空
- **权限分级**：管理员可改所有人与所有数据；学生只能改自己的姓名、性别；教师只能改自己负责专业学生的姓名、性别、电话、邮箱（学院/专业/年级由管理员维护）
- **成绩权限**：录入成绩限教师与管理员；学生只读；修改/删除成绩、科研、实践默认只有管理员，管理员在系统设置里打开“教师修改学生明细权限”开关后教师才可改（同样限负责专业）
- 学生管理：服务端分页（默认 50 条/页）+ 搜索 / 学院 / 专业 / 年级筛选、新增（仅管理员）、部分字段更新、删除前展示影响范围并要求输入学号确认（服务端强制校验 `confirm_student_id`，缺少或与目标学号不一致一律 400）
- 数据录入：学业成绩、科研项目、实践经历，支持单条增改删；成绩按"学生+课程+学期"查重，重复需显式覆盖
- CSV 导入：显式选择导入类型（学生 / 成绩 / 科研 / 实践），提供模板下载；逐行校验、失败行可下载、单次上限 5000 行；兼容 UTF-8 与 GBK
- CSV 导出：沿用当前筛选条件；使用当前计分规则并附带配置版本列；教师导出限本专业且电话/邮箱脱敏；单元格做公式注入转义
- 能力画像：GPA、学业 / 科研 / 实践三维得分，统一换算为得分率（0–100）后加权；返回 `limits`、`config_version`、`stale`
- 自动重算：成绩 / 科研 / 实践写入或导入后，自动重算涉及学生的画像；批量导入不再有 200 人上限，201 人及以上全部重算，返回 `recalculated` / `failed` / `skipped` 明细
- 职业推荐：按得分率阈值判断方向，理由写明"学业得分率 X%、科研得分率 Y%"，**每次计算按批次落库**，保留最近 5 批可回溯
- 数据看板：总量、均值、五档分布、TOP5，支持按学院 / 专业 / 年级 / 学期筛选（学期只过滤成绩记录条数，界面有口径提示）；平均得分率与 TOP5 得分率按画像快照换算，改配置未重算时看板与画像页保持同一口径（`rate_basis` 标注口径）
- 学生对比：两名学生雷达图与逐项差值
- 学生个人视图：学生账号只看自己的画像与明细，可修改自己的姓名和性别
- 用户管理：新建账号、改角色、禁用 / 启用、重置密码、删除（保留至少一个启用管理员），**支持批量导入学生 / 教师账号**
- 系统设置：画像权重、标准分、换算系数、科研分值可配置，支持恢复默认与按当前配置重算全部（逐学生事务，返回成功/失败明细）；另有**"教师修改学生明细权限"全局开关**
- 审计：关键写操作落 `audit_log`，管理员除 `GET /api/audit` 外，还可在侧边栏"审计日志"页按动作、操作人筛选并查看最近 500 条
- 安全基线：JWT 密钥强制校验、CORS 白名单、安全响应头 + CSP、请求体 10MB 上限、错误信息可读化（SQL 只进日志）

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
│   │   ├── portraitConfig.js   # 计分规则读取（PATCH 合并 + 5s 缓存 + 版本号，多实例 ≤5s 收敛）
│   │   ├── permission.js       # 师生关系与写权限判定
│   │   ├── fields.js           # 性别归一、日期区间校验、CSV 单元格转义、联系方式脱敏
│   │   ├── recalc.js           # 写入后按学生重算画像
│   │   ├── audit.js            # 审计日志写入（失败不阻断主流程）
│   │   └── recommendationStore.js  # 推荐按批次落库与清理
│   ├── sql/
│   │   ├── init.sql            # 建表 + 示例数据（不建库，库名用 mysql -D 指定）
│   │   ├── auth.sql            # 系统用户表
│   │   ├── optimize.sql        # 索引与视图
│   │   ├── migrate-v1.7-*.sql  # v1.7 三个迁移脚本
│   │   ├── migrate-v1.8-accounts.sql  # v1.8 账号体系（teacher / teacher_major / sys_config）
│   │   └── migrate-v1.9-hardening.sql # v1.9 唯一索引、token_version、audit_log、性别归一、画像配置快照
│   ├── test/
│   │   ├── portrait.test.js    # 画像算法单元测试
│   │   └── api.test.js         # 接口测试（内存替身，不连库）
│   ├── qa/
│   │   └── verify-v19fix.mjs   # v1.9 深度测试报告问题修复的真实库回归脚本
│   └── scripts/                # 运维/演示辅助脚本
├── frontend/
│   ├── index.html              # 主界面（看板 / 学生 / 录入 / 画像 / 对比 / 用户 / 设置 / 审计 / 我的画像）
│   ├── js/echarts.min.js       # ECharts 本地副本（不依赖外网 CDN）
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

3. 初始化数据库（脚本不再内置库名，先手工建库，再用 `-D` 指定同一个库执行脚本），在 `backend` 目录执行：

   ```powershell
   mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS student_portrait DEFAULT CHARACTER SET utf8mb4"
   mysql -u root -p -D student_portrait --default-character-set=utf8mb4 -e "source sql/init.sql"
   mysql -u root -p -D student_portrait --default-character-set=utf8mb4 -e "source sql/auth.sql"
   ```

   `init.sql` 含固定样例数据，**不要对已有数据的库重复导入**。找不到 `mysql` 时把 MySQL 的 `bin` 加入 PATH，或用完整路径。

4. 复制环境变量模板并按本机情况修改：

   ```powershell
   Copy-Item .env.example .env
   ```

   **`JWT_SECRET` 必须设置且不少于 32 个字符**，缺失或过短时服务会直接退出，不再使用内置默认密钥。生成方式：

   ```powershell
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

   其他常用项：`DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME`、`PORT`（默认 3000）、`BODY_LIMIT`（默认 10mb）、`CORS_ORIGINS`（跨域白名单，逗号分隔，默认仅同源）、`ADMIN_INIT_PASSWORD`（**首次初始化管理员口令**：`sys_user` 为空时必填，缺失直接拒绝启动；至少 8 位且不能是 `admin123`、`12345678` 等常见弱口令。账号建好后该变量不再参与启动）。

5. 启动：

   ```powershell
   npm start
   ```

   看到“数据库连接成功”后打开 <http://localhost:3000>。首次启动且用户表为空时，用 `.env` 里的 `ADMIN_INIT_PASSWORD` 创建 `admin` 账号；未设置或口令过弱则该次启动直接退出（不再有默认 `admin / admin123`），已有账号的库不受影响。

6. 在 VS Code 里调试（可选）：

   仓库已带 `.vscode/launch.json`，打开项目后按 `F5` 选"启动后端服务 (app.js)"即可，断点、重启（`restart: true`）都可用。

   - 运行输出在**调试控制台**（`console: internalConsole`）。若改回 `integratedTerminal` 而终端起不来、报"无法启动 conpty"，是 VS Code 1.109 移除 winpty 后的本机终端问题：在用户 `settings.json` 加 `"terminal.integrated.windowsUseConptyDll": true`，或继续用 `internalConsole`。
   - 用 `F5` 前先确认 3000 端口没被别的进程占用（`Get-NetTCPConnection -LocalPort 3000 -State Listen`），否则调试会秒退。
   - VS Code 若提示"未找到 Git"，在用户 `settings.json` 配 `"git.path": "你的 git.exe 路径"`。

> 本原型仅用于课程实验，不要直接暴露到公网，也不要存真实学生数据。

## 角色与账号

| 角色 | 可见功能 | 可写范围 |
| ---- | ---- | ---- |
| admin 管理员 | 全部功能，含用户管理、教师档案、批量导入、系统设置、删除学生 | 所有学生与所有数据 |
| teacher 教师 | 数据看板、学生管理、数据录入、画像分析、学生对比、导出 | 仅自己 + 自己负责专业的学生；成绩改删还需管理员打开开关 |
| student 学生 | 只有“我的画像”（自己的画像、明细、修改资料） | 仅自己的姓名、性别；成绩 / 科研 / 实践只读 |

首次启动只创建 `admin` 账号，口令取自 `.env` 的 `ADMIN_INIT_PASSWORD`（缺失或为常见弱口令时拒绝启动）。教师与学生账号有两种建法：

1. 管理员在“用户管理”页新建，或用“批量导入账号”粘贴 `用户名,密码,学号/工号` 逐行导入，返回逐行成败与原因；
2. 本人自助注册：注册页先选身份，学生填学号、教师填工号。学号或工号必须已在基础表中且未被其他账号绑定，否则注册失败。

教师能改哪些学生，取决于“教师档案”里登记的负责专业：学生 `major` 命中该教师的专业列表即视为他的学生。先在“用户管理 → 教师档案”里准备教师数据（`工号,姓名,学院,职称,负责专业`，多个专业用顿号分隔）。

## 已有数据库升级到 v1.9

旧版脚本初始化的库，按顺序执行迁移脚本（可重复执行，不破坏已有数据）。迁移脚本已去掉 `USE student_portrait`、表判断改用 `DATABASE()`，执行时用 `-D` 显式指定目标库：

```powershell
mysql -u root -p -D student_portrait --default-character-set=utf8mb4 -e "source sql/migrate-v1.7-permission.sql"
mysql -u root -p -D student_portrait --default-character-set=utf8mb4 -e "source sql/migrate-v1.7-career.sql"
mysql -u root -p -D student_portrait --default-character-set=utf8mb4 -e "source sql/migrate-v1.7-config.sql"
mysql -u root -p -D student_portrait --default-character-set=utf8mb4 -e "source sql/migrate-v1.8-accounts.sql"
mysql -u root -p -D student_portrait --default-character-set=utf8mb4 -e "source sql/migrate-v1.9-hardening.sql"
```

各脚本作用依次为：sys_user 加 status / student_id（历史 role=user 改 student）→ 推荐历史表 → 计分规则表 → teacher / teacher_major / sys_config 与 teacher_no → token_version、三个唯一索引、hours DECIMAL、画像版本列、audit_log、性别归一。

`migrate-v1.9-hardening.sql` 建唯一索引时会先清理重复数据，重复行直接跳过并输出核对查询结果。升级后在“系统设置”页点一次“按当前配置重算全部”，让全部画像按新口径重算并写入推荐历史。

多实例部署时，画像配置缓存 TTL 为 5 秒：任一台保存配置后，本实例立即生效，其余实例最迟 5 秒收敛（无需重启）。

## 多机共用同一个库

数据库连接参数都在 `backend/.env` 的 `DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME`。要让几台电脑共用同一份数据，把 MySQL 部署在一台彼此可连通的机器上，各机 `.env` 的 `DB_HOST` 统一填那台机器的地址，其余四项与建库时保持一致，再按上面的迁移脚本建表。这样管理员在哪台电脑登录，改的都是同一个库。

跨域访问时（例如前端与后端不在同一主机同一端口），把前端来源写进 `.env` 的 `CORS_ORIGINS`（逗号分隔），未列入的来源浏览器会被拦截。共享库的安全注意事项见 [共享库接入说明](docs/共享库接入说明.md)。

## 接口一览

统一返回 `{ code, message, data }`，除登录与注册外均需 `Authorization: Bearer <token>`。

| 方法 | 路径 | 说明 | 权限 |
| --- | --- | --- | --- |
| POST | /api/auth/login | 登录，返回 JWT（8 小时）；连续失败 5 次锁定 15 分钟 | 公开 |
| POST | /api/auth/register | 学生自助注册：用户名 + 密码 + 学号 + 姓名，姓名与学号不匹配即失败；教师身份返回 403 | 公开 |
| POST | /api/auth/change-password | 修改当前用户密码（≥8 位），成功后旧 token 失效 | 登录用户 |
| GET | /api/auth/me | 当前用户信息（含 role / status / student_id / teacher_no） | 登录用户 |
| GET/POST/PUT/DELETE | /api/users[...] | 用户列表、新建、改角色状态、删除（改角色/状态/重置密码会使旧 token 失效） | admin |
| POST | /api/users/bulk-import | 批量导入学生 / 教师账号（逐行校验，上限 500 条，密码 ≥8 位） | admin |
| POST | /api/users/:id/reset-password | 重置指定用户密码（≥8 位） | admin |
| GET/POST | /api/teachers | 教师档案列表、新增或更新（`majors: []` 表示清空负责专业，`status` 可置 0） | admin |
| POST | /api/teachers/bulk-import | 批量导入教师档案 | admin |
| DELETE | /api/teachers/:teacherNo | 删除教师（有账号绑定时拒绝） | admin |
| GET | /api/teachers/my-students | 教师查看自己负责的专业与学生 | teacher |
| GET | /api/me/profile | 学生自己的画像与推荐（含 limits / stale） | student |
| PUT | /api/me/profile | 学生修改自己的姓名、性别 | student |
| GET | /api/me/records | 学生自己的三类明细 | student |
| GET/POST/PUT/DELETE | /api/students[...] | 学生增删改查；列表支持 `page/pageSize/withMeta/search/college/major/grade`；新增仅 admin；PUT 为部分更新（只提交提交过的字段）；DELETE 必须带 `confirm_student_id` 且与目标学号一致，否则 400 | staff / admin |
| GET | /api/students/:id/impact | 删除前查询关联数据条数与绑定账号 | admin |
| POST/GET/PUT/DELETE | /api/academic[...] | 学业成绩；重复的“学生+课程+学期”需显式 `overwrite=true`；改删需管理员开放开关 | staff |
| POST/GET/PUT/DELETE | /api/research[...] | 科研项目（同上） | staff |
| POST/GET/PUT/DELETE | /api/practice[...] | 实践经历（hours 保留 1 位小数，同上） | staff |
| POST | /api/portrait/calculate/:id | 计算画像并写入一批推荐 | staff |
| GET | /api/portrait/:id | 读取画像（返回 limits / config_version / stale） | staff |
| GET | /api/portrait/career/:id | 最近一次推荐 | staff |
| GET | /api/portrait/career-history/:id | 推荐历史（最多 5 批） | staff |
| GET | /api/stats | 看板数据，支持 college / major / grade（整数）/ semester | staff |
| GET | /api/stats/options | 筛选下拉选项 | staff |
| GET | /api/config/portrait | 读取计分规则（含 config_version） | staff |
| PUT | /api/config/portrait | PATCH 语义保存计分规则（校验权重和为 1，未提交字段保持不变） | admin |
| POST | /api/config/portrait/reset | 恢复默认 | admin |
| POST | /api/config/portrait/recalculate-all | 按当前配置逐学生事务重算全部，返回 done / failed / config_version | admin |
| GET | /api/config/system | 读取系统开关（allow_teacher_edit_score） | staff |
| PUT | /api/config/system | 保存系统开关（只认 true/false/1/0） | admin |
| GET | /api/audit | 审计日志，支持 action / actor / limit | admin |
| GET | /api/export/students | 导出学生 CSV（沿用筛选参数；教师限本专业、联系方式脱敏） | staff |
| GET | /api/export/portraits | 导出画像 CSV（附带当前 limits 与配置版本） | staff |
| POST | /api/import/{students,academic,research,practice} | 批量导入 CSV，单次最多 5000 行，失败明细最多 200 条；导入后自动重算全部涉及学生（无 200 人上限），返回 `recalculated` / `recalc_failed` / `skipped` 与对应 ID 明细 | admin |

## 测试

```powershell
cd backend
npm test
```

当前 31 项单元测试全部通过（画像算法 10 项 + 接口与权限 21 项）。测试使用模拟数据库，不需要 MySQL，也不验证真实库的 SQL 与持久化。

真实库回归（服务启动后执行，脚本自签 token，覆盖 S1 启动守卫、S2–S4、G1–G9、M1–M4，并自动清理测试数据）：

```powershell
cd backend
node qa/verify-v19fix.mjs
```

2026-11-17 实测结果：接口 15 项全过；S1 三种启动路径（空库无口令拒绝、`admin123` 拒绝、强口令创建 admin 并返回 200）全过；G7 双实例 325ms 收敛；前端审计页、设置页文案、教师档案、看板图表均已在浏览器确认。

手工与浏览器验证结果见 [测试记录](docs/测试记录.md)，测试报告 54 项问题的逐条修复对照见 [v1.9 修复对照表](docs/v1.9修复对照表.md)。

## 版本记录

| 版本 | 主要变化 |
| --- | --- |
| v1.3 | 初版：学生、成绩、科研、实践录入与画像计算 |
| v1.4 | 登录鉴权、数据看板、学生对比、CSV 导出 |
| v1.5 | 统一响应格式、参数校验中间件、索引与视图、批量导入 |
| v1.6 | 明细只增不删的评审修正、量纲归一化（得分率）、UI 调整 |
| v1.7 | 三角色权限隔离、用户管理、学生个人视图、看板筛选、推荐落库与历史、计分规则配置化；修复重复学号 500、不存在学号 500、存储型 XSS、日期少一天；权重定为学业 80%、科研 10%、实践 10%，绩点按分数段线性插值（90-100→4.0、80-89→3.0~3.9、70-79→2.0~2.9、60-69→1.0~1.9），看板总分分布改 20 分一档，职业推荐兜底改为按得分率区分“学业基础方向/基础积累方向”并指出短板，不再误称发展均衡 |
| v1.8 | 账号体系升级：注册分学生 / 教师身份并强制学号、工号认证（不存在即注册失败），教师档案与负责专业（teacher / teacher_major），师生关系按专业匹配；权限分级——管理员改所有人，学生只能改自己姓名性别，教师只能改自己与负责专业的学生；成绩录入限教师与管理员、学生只读，改删成绩默认仅管理员，由“允许教师修改成绩”全局开关放开；用户管理与教师档案支持批量导入；`.env` 的 DB_HOST 支持多机指向同一共享库 |
| v1.9 | 按第三方测试报告的 54 项问题逐条修复：JWT 密钥强制校验与 token 撤销（token_version）、登录失败锁定、学生注册“学号+姓名”核验与教师自助注册关闭、教师编辑字段收窄、学生删除影响范围确认与账号解绑停用、student/teacher/成绩三个唯一索引与重复 409、导入逐行校验与失败行下载（5000 行上限、UTF-8/GBK 兼容）、写入后自动重算、导出按筛选与配置版本、CSV 公式注入转义、画像返回 limits 与 stale、配置 PATCH 语义与缓存（v1.9.1 收紧为 5 秒）、推荐阈值改按得分率并写明短板、统计参数校验与学期口径提示、CORS 白名单与安全响应头、审计日志、错误信息可读化、画像配置快照（config_snapshot）与按快照换算得分率、批量重算并行化（`recalculateMany`，102 人 152ms）；前端学生列表改服务端分页与筛选、导入类型显式选择与模板、画像分母取接口 limits、删除确认弹窗、学生下拉可搜索 |
| v1.9.1（优化版） | 按《v1.9 深度测试报告》修复 18 项当前问题与 9 项“部分”旧问题：S1 首次初始化强制 `ADMIN_INIT_PASSWORD`（缺失或弱口令拒绝启动，不再建 `admin/admin123`）、S2 教师编辑改差分提交且 my-students 返回 phone/email、S3 导入取消 200 人重算上限并返回 skipped 明细、S4 看板得分率与 TOP5 按画像快照换算（`rate_basis` 标注口径）、G1 学生资料改 PATCH 语义、G2 配置递归形状校验（数组/未知键 400）、G3 导出 grade 必须整数、G4 科研级别与实践类型白名单、G5 导入邮箱格式校验、G6 删除学生强制 `confirm_student_id`、G7 配置缓存 30s→5s（双实例 325ms 收敛）、G8 SQL 脚本去 USE 与硬编码库名（`TABLE_SCHEMA=DATABASE()`，库名由 `-D` 指定）、G9 权限查询只对表缺失回退、其余异常抛出；M1 权限开关文案统一为“教师修改学生明细”、M2 教师 majors 返回数组、M3 新增管理员“审计日志”页面、M4 ECharts 本地化（去 jsdelivr CDN 与 CSP 放行）、M5 注明登录限流为单实例内存实现（多实例需网关限流）；新增真实库回归脚本 `backend/qa/verify-v19fix.mjs` |
