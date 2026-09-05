# 安全说明

## ⚠️ 请勿提交的文件

以下文件包含敏感信息，已通过 `.gitignore` 排除：

| 文件 | 内容 | 风险 |
|---|---|---|
| `.env` | 数据库密码、JWT密钥、管理员密码 | **高危** - 会导致数据库被入侵 |
| `.env.production` | 真实生产配置（本地副本，仓库只提供 `.env.example` 模板） | **高危** - 同 `.env` |
| `server/uploads/` | 用户上传的作业文件 | 数据泄露 |
| `node_modules/` | 依赖包 | 体积大，无需提交 |

## ✅ 正确做法

### 1. 提交前检查
```bash
# 确认 .env 文件不在提交列表中
git status
# 如果 .env 出现，执行：
git restore --staged .env
```

### 2. 生产环境部署
```bash
# 在服务器上复制模板并修改
cp .env.example .env
vi .env  # 修改真实密码
```

### 3. 密钥安全
- JWT_SECRET：生产环境务必修改为随机字符串
  ```bash
  # 生成随机密钥
  openssl rand -hex 32
  ```
- 数据库密码：不要使用示例中的密码
- admin 密码：首次登录后立即修改

## 📋 已排除的敏感数据

```gitignore
.env
.env.local
.env.*.local
.env.production
server/uploads/*
```

## 🔐 部署检查清单

- [ ] 修改 `.env` 中的所有密码
- [ ] 确认 `.env` 不会被 git 提交
- [ ] 服务器数据库使用强密码
- [ ] JWT_SECRET 已更改为随机字符串
- [ ] admin 账号密码已修改