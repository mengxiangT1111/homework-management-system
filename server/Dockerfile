# 后端镜像
FROM node:18-alpine

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
