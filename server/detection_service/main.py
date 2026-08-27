"""
Topology Plagiarism Detection Service
FastAPI 服务入口 - 提供HTTP API供Node.js后端调用
"""

from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import os
import uuid
import json
import time
import logging

from topology_detector import TopologyDetector, generate_visualization

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 创建FastAPI应用
app = FastAPI(
    title="Topology Plagiarism Detection Service",
    description="网络拓扑图查重检测微服务",
    version="1.0.0"
)

# CORS：本服务只供 Node 后端服务间调用，浏览器不应跨域访问，故不放开通配源
app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_credentials=False,
    allow_methods=["POST", "GET"],
    allow_headers=["X-API-Token", "Content-Type"],
)

# ===== 服务间鉴权 =====
# 与 Node 侧共享同一环境变量 DETECTION_API_TOKEN；未配置时使用默认值（仅限本机回环可达）
API_TOKEN = os.environ.get("DETECTION_API_TOKEN", "detection-dev-token")
if API_TOKEN == "detection-dev-token":
    logger.warning("DETECTION_API_TOKEN 未设置，使用默认开发 token，生产环境务必配置强随机值")


@app.middleware("http")
async def verify_token(request: Request, call_next):
    # 健康检查放行（不返回业务数据）
    if request.url.path == "/api/health":
        return await call_next(request)
    if request.headers.get("X-API-Token") != API_TOKEN:
        return JSONResponse(status_code=401, content={"detail": "unauthorized"})
    return await call_next(request)


# 上传目录配置
UPLOAD_DIR = os.environ.get("UPLOAD_DIR", os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "uploads")))
VISUALIZATION_DIR = os.path.join(os.path.dirname(__file__), "visualizations")
os.makedirs(VISUALIZATION_DIR, exist_ok=True)

# 初始化检测器（延迟加载）
_detector = None


def get_detector():
    """获取检测器实例（延迟加载）"""
    global _detector
    if _detector is None:
        # upload_dir 应该是 server 目录（uploads 的父目录）
        server_dir = os.path.dirname(UPLOAD_DIR)
        _detector = TopologyDetector(
            enable_ocr=True,
            upload_dir=server_dir
        )
    return _detector


# 存储检测任务状态（带上限的简单 LRU：全量结果很大，只写不删会内存单调增长直至 OOM）
MAX_TASKS = 200
detection_tasks: Dict[str, Dict[str, Any]] = {}
_tasks_order: List[str] = []


def _save_task(task_id: str, entry: Dict[str, Any]):
    detection_tasks[task_id] = entry
    _tasks_order.append(task_id)
    while len(_tasks_order) > MAX_TASKS:
        old = _tasks_order.pop(0)
        detection_tasks.pop(old, None)


# ========== 请求/响应模型 ==========

class DetectRequest(BaseModel):
    """检测请求"""
    source_path: str
    candidate_paths: List[str]
    assignment_id: Optional[int] = None
    submission_id: Optional[int] = None


class DetectResponse(BaseModel):
    """检测响应"""
    task_id: str
    source: str
    status: str
    top_similarity: float = 0
    total_compared: int = 0
    results: List[Dict[str, Any]] = []


class HealthResponse(BaseModel):
    """健康检查响应"""
    status: str
    version: str
    upload_dir: str
    ocr_enabled: bool
    fingerprint_cache: Dict[str, int] = {}


# ========== API端点 ==========

@app.get("/", response_class=JSONResponse)
async def root():
    """根路径"""
    return {
        "name": "Topology Plagiarism Detection Service",
        "version": "1.0.0",
        "docs": "/docs"
    }


@app.get("/api/health", response_model=HealthResponse)
async def health_check():
    """健康检查"""
    detector = get_detector()
    return HealthResponse(
        status="healthy",
        version="1.0.0",
        upload_dir=UPLOAD_DIR,
        ocr_enabled=detector.ocr is not None,
        fingerprint_cache=detector.fp_cache.stats()
    )


@app.post("/api/detect", response_model=DetectResponse)
def detect_plagiarism(request: DetectRequest):
    """
    执行查重检测（同步端点，FastAPI 自动放入线程池执行，
    避免长检测阻塞事件循环导致 /api/health 无响应）

    - **source_path**: 源文件路径（绝对路径或相对 upload_dir 路径）
    - **candidate_paths**: 候选文件路径列表
    """
    logger.info(f"收到检测请求: source={request.source_path}, candidates={len(request.candidate_paths)}")
    
    # 验证候选列表
    if not request.candidate_paths:
        raise HTTPException(status_code=400, detail="候选文件列表不能为空")
    
    # 生成任务ID
    task_id = str(uuid.uuid4())
    
    try:
        # 执行检测
        detector = get_detector()
        result = detector.detect(request.source_path, request.candidate_paths)

        # 存储结果
        _save_task(task_id, {
            'source': request.source_path,
            'result': result,
            'timestamp': time.time()
        })
        
        return DetectResponse(
            task_id=task_id,
            source=result['source'],
            status='completed',
            top_similarity=result['top_similarity'],
            total_compared=result['total_compared'],
            results=result['results']
        )
        
    except Exception as e:
        logger.error(f"检测失败: {e}")
        raise HTTPException(status_code=500, detail=f"检测失败: {str(e)}")


@app.get("/api/result/{task_id}", response_model=DetectResponse)
async def get_result(task_id: str):
    """获取检测结果"""
    if task_id not in detection_tasks:
        raise HTTPException(status_code=404, detail="任务不存在")

    task = detection_tasks[task_id]
    if task.get('result') is None:
        # pending/failed 的任务还没有结果，不能下标访问
        raise HTTPException(status_code=409, detail=f"任务{task.get('status', 'pending')}")
    result = task['result']
    
    return DetectResponse(
        task_id=task_id,
        source=result['source'],
        status='completed',
        top_similarity=result['top_similarity'],
        total_compared=result['total_compared'],
        results=result['results']
    )


@app.post("/api/batch-detect")
async def batch_detect(requests: List[DetectRequest], background_tasks: BackgroundTasks):
    """
    批量检测（异步）
    
    将检测任务放入后台执行，返回任务ID列表
    """
    task_ids = []
    
    for req in requests:
        task_id = str(uuid.uuid4())
        _save_task(task_id, {
            'source': req.source_path,
            'status': 'pending',
            'result': None,
            'timestamp': time.time()
        })
        background_tasks.add_task(run_detection, task_id, req)
        task_ids.append(task_id)
    
    return {"task_ids": task_ids, "total": len(task_ids)}


def run_detection(task_id: str, request: DetectRequest):
    """后台执行检测任务"""
    try:
        detector = get_detector()
        result = detector.detect(request.source_path, request.candidate_paths)
        
        detection_tasks[task_id]['status'] = 'completed'
        detection_tasks[task_id]['result'] = result
        logger.info(f"任务 {task_id} 完成")
        
    except Exception as e:
        logger.error(f"任务 {task_id} 失败: {e}")
        detection_tasks[task_id]['status'] = 'failed'
        detection_tasks[task_id]['error'] = str(e)


@app.get("/api/visualization/{source_file}/{candidate_file}")
async def get_visualization(source_file: str, candidate_file: str):
    """
    获取可视化对比图
    
    - **source_file**: 源文件名（不含路径）
    - **candidate_file**: 候选文件名（不含路径）
    """
    # 构建输出路径
    output_name = f"compare_{source_file}_vs_{candidate_file}.png"
    output_path = os.path.join(VISUALIZATION_DIR, output_name)
    
    # 如果已存在，直接返回
    if os.path.exists(output_path):
        return FileResponse(output_path, media_type="image/png")
    
    # 否则生成
    # 这里简化处理，实际应该传入提取结果
    raise HTTPException(status_code=404, detail="可视化图片未生成")


@app.post("/api/preview-extraction")
def preview_extraction(file_path: str):
    """
    预览图结构提取结果

    返回提取的节点和边
    """
    from image_preprocessor import load_image, preprocess, detect_edges

    # 路径围栏：解析后的绝对路径必须仍在 UPLOAD_DIR 内，防止 ../ 逃逸读取任意文件
    abs_path = os.path.normpath(os.path.join(UPLOAD_DIR, file_path))
    allowed_root = os.path.normpath(UPLOAD_DIR)
    try:
        common = os.path.commonpath([abs_path, allowed_root])
    except ValueError:
        raise HTTPException(status_code=403, detail="非法路径")
    if common != allowed_root:
        raise HTTPException(status_code=403, detail="非法路径")
    if not os.path.exists(abs_path):
        raise HTTPException(status_code=404, detail="文件不存在")
    
    try:
        img, gray = load_image(abs_path)
        processed = preprocess(gray)
        edges = detect_edges(processed)
        
        detector = get_detector()
        extraction = detector.graph_extractor.extract(gray, edges, [])
        
        return {
            "file": file_path,
            "nodes": [
                {"id": n.id, "type": n.type, "label": n.label, "center": n.center}
                for n in extraction['nodes']
            ],
            "edges": [
                {"source": e.source, "target": e.target}
                for e in extraction['edges']
            ],
            "node_count": len(extraction['nodes']),
            "edge_count": len(extraction['edges'])
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"提取失败: {str(e)}")


# ========== 启动配置 ==========

if __name__ == "__main__":
    import uvicorn
    # 默认只监听本机回环（Node 后端在本机调用）；跨容器部署时显式设置 DETECTION_HOST
    host = os.environ.get("DETECTION_HOST", "127.0.0.1")
    port = int(os.environ.get("DETECTION_PORT", "8000"))
    uvicorn.run(app, host=host, port=port, log_level="info")