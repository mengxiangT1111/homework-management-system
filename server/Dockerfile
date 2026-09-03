# 后端镜像
FROM node:18-alpine

# 业务时区固定为北京时间：new Date()/日志/定时任务默认按进程时区解释，
# alpine 基础镜像默认 UTC，不设置会导致展示时间比北京时间早 8 小时
ENV TZ=Asia/Shanghai

WORKDIR /app

# 先拷贝依赖清单，利用缓存层
COPY package*.json ./
RUN npm install --production

# 拷贝源码
COPY . .

# 创建上传目录
RUN mkdir -p uploads/chunks

EXPOSE 3000

CMD ["node", "src/server.js"]
