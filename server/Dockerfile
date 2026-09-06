# 后端镜像
FROM node:18-alpine

# 业务时区固定为北京时间：new Date()/日志/定时任务默认按进程时区解释，
# alpine 基础镜像默认 UTC，不设置会导致展示时间比北京时间早 8 小时
ENV TZ=Asia/Shanghai

WORKDIR /app

# 先拷贝依赖清单，利用缓存层
COPY package*.json ./
RUN npm install --production

# LibreOffice：doc/xls/ppt/pptx 在线预览的转换引擎（officeConverter.js 调用）；
# font-noto-cjk 中文字体必须安装，否则转出的 PDF 中文全是方框。
# 国内服务器构建先换腾讯云 Alpine 源加速（海外部署可删掉 sed 那行）
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.tencent.com/g' /etc/apk/repositories \
    && apk add --no-cache libreoffice-writer libreoffice-calc libreoffice-impress font-noto-cjk \
    && rm -rf /var/cache/apk/*

# 拷贝源码
COPY . .

# 创建上传目录
RUN mkdir -p uploads/chunks

EXPOSE 3000

CMD ["node", "src/server.js"]
