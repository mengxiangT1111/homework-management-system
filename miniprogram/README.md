# 信衡 XINHENG · 微信小程序端

基于 uni-app（Vue 3 + Vite）的微信小程序端，与现有 Web 端共用同一套后端 API、数据库与文件存储。
设计文档见仓库 `docs/小程序设计方案V3.md`，开发执行提示词见 `docs/小程序开发提示词V3.md`。

## 功能范围（P0，15 页）

- **学生**：登录、首页（统计 + 待交作业）、作业列表/详情、提交作业（拍照/聊天文件上传）、提交记录、AI 批改结果查看、我的班级
- **教师**：登录、工作台、作业列表（课程/状态筛选）、发布/编辑/关闭作业、作业详情（进度/名单/催交/AI 批改任务发起与进度）、批改打分（文件预览 + AI 结果）、AI 复核队列
- **公共**：消息中心（未读角标）、我的、修改密码
- 管理员不提供小程序端（请使用网页端）

## 本地运行

```bash
cd miniprogram
npm install
npm run dev:mp-weixin
```

然后用**微信开发者工具**导入目录：`miniprogram/dist/dev/mp-weixin`。

### 1. 配置 AppID

编辑 `src/manifest.json` → `mp-weixin.appid`（当前为占位值 `touristappid`），替换为你的小程序 AppID。

### 2. 配置后端地址

编辑 `src/utils/config.js` → `BASE_URL`：

- 开发者工具内：`http://127.0.0.1:3000`（默认，需后端在本机 3000 端口运行）
- **真机预览**：改为电脑局域网 IP，如 `http://192.168.1.100:3000`，手机与电脑须在同一 Wi-Fi
- 生产：改为已备案 HTTPS 域名，如 `https://api.example.com`

后端启动方式见仓库根 README（`cd server && npm run dev`）。

## 微信后台配置（上线前必做）

登录 [mp.weixin.qq.com](https://mp.weixin.qq.com) → 开发管理 → 开发设置 → 服务器域名：

| 域名类型 | 需要配置的域名 |
|---|---|
| request 合法域名 | `https://你的API域名` |
| uploadFile 合法域名 | `https://你的API域名` |
| downloadFile 合法域名 | `https://你的API域名` + `https://<COS桶>.cos.<地域>.myqcloud.com`（文件预览用，见 server/.env 的 COS_BUCKET / COS_REGION） |

> 开发阶段可在开发者工具「详情 → 本地设置」勾选**不校验合法域名**跳过校验。
> 所有域名必须 HTTPS 且已 ICP 备案。

## 用户隐私保护指引（提审前必做）

mp.weixin.qq.com → 设置 → 服务内容声明 → 用户隐私保护指引，需声明收集：

- **选中的文件**（作业上传，chooseMessageFile/chooseMedia）
- **相册（仅写入）与摄像头**（拍照上传）
- **学号、姓名**（账号登录与展示）

未配置隐私指引时，上述隐私 API 在正式版本中会被微信直接拦截（选文件功能不可用）。

## 真机调试注意

1. 手机与电脑同一 Wi-Fi，`BASE_URL` 用电脑局域网 IP
2. 后端必须可被局域网访问（Windows 防火墙放行 3000 端口或 Node 程序）
3. 首次真机预览若选文件/拍照失败，优先检查上面两项 + 隐私指引配置

## 目录结构

```
miniprogram/src/
├── main.js               # Pinia 注册
├── App.vue               # 启动 token 校验 + 全局样式
├── pages.json            # 15 页路由 + 4 个文字 tabBar
├── manifest.json         # AppID 等小程序配置
├── utils/
│   ├── config.js         # BASE_URL（环境切换）
│   ├── request.js        # 请求封装（token/统一错误/401 去重）+ 单文件上传
│   ├── format.js         # iOS 安全时间解析/格式化/剩余时间
│   ├── statusMaps.js     # 状态文案与颜色（与 Web 端对齐）
│   ├── preview.js        # 文件预览（签名 URL + openDocument/previewImage）
│   └── badge.js          # 消息角标
├── stores/auth.js        # 登录态（Pinia + storage）
├── components/empty-state.vue
└── pages/                # 15 个页面（见 pages.json）
```

## 关键实现约定

- 文件上传走后端 `POST /api/upload/single`（一次传完整文件，≤100MB），与 Web 端分片上传链路互不影响
- 文件预览统一走 `POST /api/files/urls`：COS 返回签名 URL（1 小时时效，即用即取不缓存）；本地文件返回相对路径，代码内自动拼接 BASE_URL
- 分页统一 `page/pageSize` 参数，下拉刷新 + 触底加载
- 401 统一清登录态跳登录页（并发请求去重）

## 已知限制（引导网页端完成）

- 单文件 >100MB 的作业上传
- zip 等无法在线预览的格式查看
- 样例文件可在小程序发布/编辑作业时直接上传维护（≤100MB/个，最多 5 个）
- 管理端全部功能、查重中心、AI 模板/提示词管理、打包下载与 Excel 导出
- 微信授权一键登录、订阅消息推送（规划二期）
