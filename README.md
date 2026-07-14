# 📚 在线作业提交管理系统

> Vue 3 + Node.js (Express) + MySQL 全栈实现，支持学生、教师、管理员三种角色，含分片上传、在线预览、打包下载、Excel 导出、消息通知等完整功能。

---

## ✨ 功能特性

### 🎓 学生端
- 注册登录、选择班级课程
- 多份作业文件上传（**分片上传**，支持秒传/断点续传）
- 查看自己的提交记录与老师评语
- **逾期禁止提交**（前端禁用 + 后端拒绝）
- 接收作业截止提醒通知

### 👨‍🏫 教师端
- 创建作业任务（设置截止时间、文件格式限制、数量限制）
- 查看本班所有学生提交情况（已交/未交一目了然）
- **在线预览 PDF / 图片**作业
- 在线打分、写评语
- **打包下载全部作业**（zip）
- 标记/催交未交学生
- **导出 Excel 未交名单**

### 🔧 管理员端
- 管理班级（增删改查 + 学生分配）
- 新增教师/学生账号、重置用户密码、启用/禁用账号
- **清理过期文件**（按保留天数预览+执行）
- **数据统计**（未交人数、提交率、可视化图表）

---

## 🛠 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vue 3 + Vite + Pinia + Vue Router + Element Plus + ECharts |
| 后端 | Node.js + Express + Sequelize ORM + JWT |
| 数据库 | MySQL 8 |
| 关键库 | spark-md5（分片哈希）、archiver（打包）、exceljs（Excel）、node-cron（定时任务）|

---

## 🚀 快速开始

### 1. 启动 MySQL 数据库（Docker）

确保已安装 [Docker](https://www.docker.com/)，然后在项目根目录执行：

```bash
docker compose up -d
```

将启动 MySQL 8 容器（端口 3306，库名 `homework_db`，账号 `homework / homework123`）。

> 若未安装 Docker，也可本地安装 MySQL 8，并按 `server/.env` 配置创建数据库和账号。

### 2. 启动后端

```bash
cd server
npm install
npm run seed     # 初始化数据库表结构 + 创建默认账号
npm run dev      # 启动开发服务器 http://localhost:3000
```

`npm run seed` 会自动创建 3 个测试账号：

| 角色 | 账号 | 密码 |
|---|---|---|
| 管理员 | `admin` | `admin123` |
| 教师 | `teacher` | `teacher123` |
| 学生 | `student` | `student123` |

### 3. 启动前端

```bash
cd client
npm install
npm run dev      # 启动 http://localhost:5173 （自动打开浏览器）
```

### 4. 开始使用

1. 用管理员账号 `admin / admin123` 登录
2. 在「班级管理」创建班级 → 分配学生
3. 在「课程管理」创建课程 → 指定任课教师
4. 用教师账号登录 → 发布作业 → 批阅
5. 用学生账号登录 → 加入班级 → 提交作业

---

## 📁 项目结构

```
网站/
├── docker-compose.yml          # MySQL 容器
├── README.md
├── server/                     # 后端
│   ├── .env                    # 环境变量（数据库、JWT）
│   └── src/
│       ├── server.js           # 入口
│       ├── app.js              # Express 应用
│       ├── config/database.js  # Sequelize 配置
│       ├── models/             # 8 个数据模型
│       ├── middleware/auth.js  # JWT + 角色校验
│       ├── routes/             # 9 个路由模块
│       ├── controllers/        # 控制器
│       ├── utils/              # 工具（响应封装、文件清理、定时任务）
│       └── seeders/seed.js     # 初始数据
└── client/                     # 前端
    ├── vite.config.js          # Vite + 代理配置
    └── src/
        ├── main.js             # 入口
        ├── router/             # 路由 + 守卫
        ├── stores/             # Pinia（auth、notification）
        ├── api/                # axios 封装 + API
        ├── utils/upload.js     # 分片上传核心
        ├── components/         # FileUploader、FilePreview
        ├── layouts/            # MainLayout（侧边栏+顶栏）
        └── views/              # 登录注册 + 学生5页 + 教师5页 + 管理员5页
```

---

## 🔑 核心实现说明

### 大文件分片上传
- 前端 `spark-md5` 计算文件 hash → 切分 2MB/片 → 逐片上传 → 合并
- 后端 `/api/upload/check` 检查已传分片（**断点续传**）+ 已合并文件（**秒传**）
- `/api/upload/chunk` 接收单片，`/api/upload/merge` 合并

### 打包下载
- 教师点击「打包下载」→ 后端 `archiver` 按学生姓名建文件夹流式打包 zip

### 导出 Excel
- 使用 `exceljs` 生成带样式的未交名单 xlsx，流式下载

### 逾期禁止提交
- 后端提交接口比较 `deadline` 与当前时间，逾期直接返回 422

### 消息通知
- `node-cron` 每小时扫描 24h 内截止作业，自动向未交学生生成通知
- 学生提交 → 通知教师；教师批改 → 通知学生

### 文件清理
- 管理员按"保留天数"预览 → 执行清理物理文件，数据库记录保留

---

## 🎨 页面设计
- 校园清新配色：**薄荷绿 #52c4a0 + 天空蓝 #5ab3f0**
- 圆角卡片、响应式布局（适配手机/平板/桌面）
- Element Plus 组件 + 自定义主题

---

## ⚙️ 配置说明

后端配置在 `server/.env`：

```env
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_NAME=homework_db
DB_USER=homework
DB_PASSWORD=homework123
JWT_SECRET=homework_system_secret_key_2024
JWT_EXPIRES_IN=7d
UPLOAD_DIR=uploads
FILE_RETAIN_DAYS=30
```

---

## 📝 常见问题

**Q: 后端启动报数据库连接失败？**
A: 确认 MySQL 容器已运行（`docker ps`），且 `.env` 配置正确。

**Q: 上传文件后预览 404？**
A: 确认后端服务（3000端口）正常运行，前端 Vite 已配置 `/uploads` 代理到后端。

**Q: 分片上传中断后能否续传？**
A: 可以。再次选择同一文件上传时，系统会自动检测并跳过已传分片。

---

## 📄 许可
本项目为教学示例项目，可自由使用。
