# 查重检测微服务（Python FastAPI + OpenCV + networkx）
# 默认不含 PaddleOCR（镜像约 600MB，查重的"OCR 文本相似度"维度自动降级跳过）；
# 需要启用 OCR 时：取消 requirements.txt 中 paddlepaddle/paddleocr 两行注释后重建
# （镜像约 2GB，构建时间明显变长）
FROM python:3.10-slim

# opencv/scikit-image 的运行时动态库（headless 版无需 libGL）
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# 仅容器内网访问（compose 未对外映射端口），Node 后端经 http://detection:8000 调用
EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
