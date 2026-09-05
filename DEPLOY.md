# 🚀 服务器部署指南

本文档介绍如何将「在线作业提交管理系统」部署到 Linux 服务器，让外网用户通过 `http://你的服务器IP` 访问。

---

## 📋 部署前准备

### 你需要准备
1. **一台云服务器**（阿里云/腾讯云/华为云等均可）
   - 配置：至少 2核 CPU + 2G 内存 + 40G 硬盘
   - 系统：Ubuntu 20.04 / CentOS 7+ / Debian 10+（推荐 Ubuntu）
   - 安全组/防火墙：**开放 80 和 443 端口**（HTTP/HTTPS）
2. **SSH 连接工具**（如 Xshell、FinalShell、Termius，或直接用终端）

### 服务器需安装的软件
连接到服务器后，依次执行：

```bash
# ===== 1. 安装 Docker（Ubuntu 为例） =====
curl -fsSL https://get.docker.com | bash -s docker --mirror Aliyun

# 启动 Docker 并设置开机自启
sudo systemctl start docker
sudo systemctl enable docker

# ===== 2. 安装 Docker Compose =====
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# 验证安装
docker --version          # 应显示 Docker version xx.x
docker-compose --version  # 应显示 docker-compose version x.x.x
```

> 💡 如果国内下载慢，Docker 可换镜像源：
> ```bash
> sudo mkdir -p /etc/docker
> sudo tee /etc/docker/daemon.json <<-'EOF'
> { "registry-mirrors": ["https://docker.mirrors.ustc.edu.cn"] }
> EOF
> sudo systemctl daemon-reload
> sudo systemctl restart docker
> ```

---

## 📦 第一步：上传项目代码到服务器

### 方式 A：用 Git（推荐）
如果你的代码在 GitHub/Gitee：
```bash
# 在服务器上
cd /opt
git clone https://github.com/你的用户名/你的仓库.git homework
cd homework
```

### 方式 B：用 SCP / FTP 上传
在你的**本地电脑**（Windows）打开 Git Bash：
```bash
# 把整个项目文件夹上传到服务器
scp -r "C:\Users\13523\Desktop\网站" root@你的服务器IP:/opt/homework
```
> 排除 node_modules：上传前先删掉本地 `server/node_modules` 和 `client/node_modules`，服务器上会自动安装。

### 方式 C：打包后上传（最稳妥）
```bash
# 本地：先删依赖目录，打包
cd "C:\Users\13523\Desktop"
# 用 7z 或 WinSCP 上传"网站"文件夹到服务器 /opt/homework
```

---

## 🔧 第二步：修改生产环境配置

在服务器上进入项目目录，修改配置：

```bash
cd /opt/homework   # 或你上传的路径

# 复制生产环境配置模板（.env.example 是仓库里的模板，.env 不入库）
cp .env.example .env

# 编辑 .env，务必修改密码和密钥！
vi .env
```

`.env` 文件内容（**请修改为你的真实值**）：
```env
MYSQL_ROOT_PASSWORD=YourStrong_Root_Pwd_2024   # 改成强密码
DB_NAME=homework_db
DB_USER=homework
DB_PASSWORD=YourStrong_Db_Pwd_2024             # 改成强密码
JWT_SECRET=随机字符串_建议32位以上              # 改成随机字符串
```

> 生成随机 JWT 密钥：`openssl rand -hex 32`

---

## 🚀 第三步：一键启动（核心步骤）

```bash
cd /opt/homework

# 构建镜像并启动全部服务（首次约 5-10 分钟，需下载基础镜像+安装依赖）
docker-compose -f docker-compose.prod.yml --env-file .env up -d --build

# 查看启动状态
docker-compose -f docker-compose.prod.yml ps
```

预期输出（三个服务都是 `Up`）：
```
NAME            STATUS         PORTS
hw_mysql        Up (healthy)   3306/tcp
hw_backend      Up             3000/tcp
hw_frontend     Up             0.0.0.0:80->80/tcp
```

---

## 🌱 第四步：初始化管理员账号

首次部署后，创建默认管理员账号：

```bash
# 在后端容器内执行初始化脚本
docker exec hw_backend node src/seeders/seedProd.js
```

输出：
```
✓ 管理员账号已就绪: admin / <.env 中 ADMIN_PASSWORD>
```

> ⚠️ 首次登录后，请立即在「个人中心」修改 admin 密码！

---

## ✅ 第五步：访问验证

打开浏览器，访问：

```
http://你的服务器公网IP
```

例如 `http://123.45.67.89`

用 `admin` + `.env` 里的 `ADMIN_PASSWORD` 登录，看到管理后台即部署成功！

---

## 🔄 常用运维命令

```bash
# 查看服务状态
docker-compose -f docker-compose.prod.yml ps

# 查看日志（排查问题用）
docker-compose -f docker-compose.prod.yml logs -f          # 全部
docker logs hw_backend -f --tail 100                        # 只看后端
docker logs hw_frontend -f --tail 100                       # 只看前端
docker logs hw_mysql -f --tail 100                          # 只看数据库

# 重启某个服务
docker-compose -f docker-compose.prod.yml restart backend
docker-compose -f docker-compose.prod.yml restart frontend

# 停止全部服务
docker-compose -f docker-compose.prod.yml down

# 停止并删除数据（⚠️ 慎用，会清空数据库）
docker-compose -f docker-compose.prod.yml down -v

# 更新代码后重新部署
git pull                        # 拉取新代码
docker-compose -f docker-compose.prod.yml up -d --build    # 重新构建并启动
```

---

## 🌐 进阶：绑定域名 + HTTPS（项目已内置）

项目已内置 HTTPS：nginx 挂载证书监听 443，80 自动跳转到 HTTPS，无需额外的反代或 Caddy。

### 1. 域名解析
到域名服务商（阿里云/腾讯云域名控制台），添加 A 记录：
- 记录类型：A
- 主机记录：`@`（或 `www`）
- 记录值：你的服务器公网 IP（域名需已完成 ICP 备案）

### 2. 申请证书并放入 client/ssl/
以腾讯云免费证书为例：控制台申请签发后下载 **Nginx 格式**，得到 `xxx_bundle.crt` 和 `xxx.key`，在服务器上：
```bash
mkdir -p client/ssl
cp xxx_bundle.crt client/ssl/server.crt
cp xxx.key          client/ssl/server.key
```
> `client/ssl/` 已被 .gitignore 排除，证书只放在服务器上，不入库。

### 3. 配置域名并重建
- `client/nginx.conf` 中两处 `server_name` 改为你的域名
- 云控制台防火墙/安全组放行 **TCP 80 和 443**
- 重建前端：`docker compose -f docker-compose.prod.yml up -d --build frontend`

免费证书有效期约 3 个月，到期后重新申请、覆盖 `client/ssl/` 里的两个文件，然后 `docker compose -f docker-compose.prod.yml restart frontend` 即可。

---

## ❓ 常见部署问题

### Q1: 访问 IP 打不开 / 一直转圈
- **检查安全组**：云服务器控制台 → 安全组/防火墙 → 添加规则 → 放行 **TCP 80 端口**
- **检查服务状态**：`docker-compose -f docker-compose.prod.yml ps` 看是否都 Up
- **看日志**：`docker logs hw_frontend` 和 `docker logs hw_backend`

### Q2: 后端容器一直重启（unhealthy）
```bash
docker logs hw_backend
```
若提示数据库连接失败：MySQL 可能还没启动完，等 30 秒后 `docker-compose ... restart backend`。健康检查机制会自动等待。

### Q3: 上传文件失败 / 502
- Nginx 已配置 `client_max_body_size 200m`，若还报错检查：
- `docker logs hw_backend` 看具体错误
- 分片上传每片 2MB，理论上不会触发体积限制

### Q4: 数据库密码忘了 / 想重置
修改 `.env` 后**必须**删除旧数据卷重建：
```bash
docker-compose -f docker-compose.prod.yml down -v   # ⚠️ 会清空所有数据
docker-compose -f docker-compose.prod.yml --env-file .env up -d --build
docker exec hw_backend node src/seeders/seedProd.js    # 重新初始化
```

### Q5: 服务器重启后服务没了？
所有服务都配了 `restart: always`，服务器重启后会自动恢复。也可手动：`docker-compose -f docker-compose.prod.yml up -d`

### Q6: 如何备份数据库
```bash
# 导出数据库
docker exec hw_mysql mysqldump -uhomework -p你的密码 homework_db > backup_$(date +%Y%m%d).sql

# 恢复数据库
docker exec -i hw_mysql mysql -uhomework -p你的密码 homework_db < backup_xxx.sql
```
建议配合 `crontab` 定时备份：
```bash
crontab -e
# 添加：每天凌晨3点自动备份
0 3 * * * docker exec hw_mysql mysqldump -uhomework -phomework123 homework_db > /opt/backup/db_$(date +\%Y\%m\%d).sql
```

---

## 📐 架构图

```
              用户浏览器
                  │
          ┌───────┴───────┐
          │  http://IP    │  (80端口)
          └───────┬───────┘
                  │
         ┌────────┴────────┐
         │  hw_frontend    │  (Nginx 静态文件 + 反向代理)
         │  容器 :80       │
         └────────┬────────┘
                  │ /api/ 转发
         ┌────────┴────────┐
         │  hw_backend     │  (Node.js Express)
         │  容器 :3000     │
         └────────┬────────┘
                  │
         ┌────────┴────────┐
         │  hw_mysql       │  (MySQL 8)
         │  容器 :3306     │
         └─────────────────┘
```

---

## 🎯 最快部署总结（4 条命令）

假设你已上传代码到 `/opt/homework` 并配好 `.env`：

```bash
cd /opt/homework
cp .env.example .env && vi .env                        # 1. 改密码
docker-compose -f docker-compose.prod.yml up -d --build  # 2. 构建启动
docker exec hw_backend node src/seeders/seedProd.js   # 3. 建管理员
# 4. 浏览器访问 http://服务器IP  ✓
```

部署成功后，记得第一时间修改 admin 密码！🎉
