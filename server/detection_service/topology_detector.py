"""
Topology Detector Module
拓扑图查重核心检测引擎 - 多级渐进式检测流水线
"""

import cv2
import numpy as np
import networkx as nx
import os
import json
import hashlib
import threading
from collections import OrderedDict
from typing import Dict, List, Tuple, Any, Optional

from image_preprocessor import (
    load_image, preprocess, detect_edges, binarize,
    compute_phash, hamming_distance, phash_similarity,
    enhance_contrast, resize_image, morphological_cleanup,
    compute_phash_pil
)
from PIL import Image
import io
from graph_extractor import GraphExtractor, visualize_extraction
from similarity import (
    compute_orb_similarity, compute_text_similarity,
    compute_structure_similarity, compare_node_types,
    find_common_subgraph
)

# 尝试导入PaddleOCR（可选，没有OCR也能工作）
try:
    from paddleocr import PaddleOCR
    _ocr_available = True
except ImportError:
    _ocr_available = False
    print("警告: PaddleOCR未安装，文本相似度检测能力受限")


# 多级检测的阈值配置
DEFAULT_THRESHOLDS = {
    'phash_skip': 20,        # pHash汉明距离 > 20 直接跳过（不进入后续检测）
    'phash_suspect': 10,     # pHash汉明距离 < 10 标记为高度可疑
    'orb_min_matches': 15,   # ORB最小匹配数
    'orb_suspect': 30,       # ORB匹配数 > 30 标记为可疑
    'text_high': 80,         # 文本相似度 > 80% 标记为可疑
    'graph_suspect': 60,     # 图结构相似度 > 60% 标记为可疑
    'overall_suspect': 50,   # 综合得分 > 50 标记为可疑
    'overall_high_suspect': 75,  # 综合得分 > 75 标记为高度可疑
}


# 综合评分权重
DEFAULT_WEIGHTS = {
    'image_hash': 0.10,     # 感知哈希权重
    'orb': 0.10,            # ORB特征匹配权重
    'text': 0.20,           # 文本相似度权重
    'graph': 0.50,          # 图结构相似度权重
    'node_type': 0.10,      # 节点类型分布权重
}


# 支持的图像扩展名
IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp', '.tiff', '.tif']


class FingerprintLRUCache:
    """
    文件指纹 LRU 缓存（线程安全）

    同一文件在全班两两比对中会被反复用作源/候选，
    pHash/预处理图/OCR/图结构提取只需做一次。
    键可以是 (路径, mtime, size) 元信息键（命中免读文件），或 "md5:<内容哈希>" 内容键
    （COS 重新下载的临时文件路径变了也能按内容命中）。
    """

    def __init__(self, max_size: int = 300):
        self._max = max_size
        self._store = OrderedDict()
        self._lock = threading.Lock()
        self.hits = 0
        self.misses = 0

    def get(self, key):
        with self._lock:
            if key in self._store:
                self._store.move_to_end(key)
                self.hits += 1
                return self._store[key]
            self.misses += 1
            return None

    def put(self, key, value):
        with self._lock:
            self._store[key] = value
            self._store.move_to_end(key)
            while len(self._store) > self._max:
                self._store.popitem(last=False)

    def stats(self) -> Dict[str, int]:
        with self._lock:
            return {'size': len(self._store), 'max_size': self._max,
                    'hits': self.hits, 'misses': self.misses}


class TopologyDetector:
    """拓扑图查重检测器"""
    
    def __init__(self, 
                 thresholds: Dict[str, float] = None,
                 weights: Dict[str, float] = None,
                 enable_ocr: bool = True,
                 upload_dir: str = None):
        """
        初始化检测器
        
        Args:
            thresholds: 阈值配置
            weights: 权重配置
            enable_ocr: 是否启用OCR
            upload_dir: 上传文件目录根路径
        """
        self.thresholds = thresholds or DEFAULT_THRESHOLDS
        self.weights = weights or DEFAULT_WEIGHTS
        self.enable_ocr = enable_ocr and _ocr_available
        self.upload_dir = upload_dir or os.path.join(os.path.dirname(__file__), '..', 'uploads')
        
        # 初始化OCR
        self.ocr = None
        if self.enable_ocr:
            try:
                self.ocr = PaddleOCR(use_angle_cls=True, lang='ch', show_log=False)
                print("PaddleOCR初始化成功")
            except Exception as e:
                print(f"PaddleOCR初始化失败: {e}")
                self.ocr = None
        
        # 初始化图提取器
        self.graph_extractor = GraphExtractor()

        # 文件指纹缓存（按内容哈希键控，全班比对时同一文件只提取一次）
        self.fp_cache = FingerprintLRUCache(
            max_size=int(os.environ.get('FINGERPRINT_CACHE_SIZE', '300')))
    
    def detect(self,
               source_path: str,
               candidate_paths: List[str]) -> Dict[str, Any]:
        """
        执行多级渐进式查重检测

        Args:
            source_path: 源文件路径（绝对路径，或相对 upload_dir 的路径）
            candidate_paths: 候选文件路径列表

        Returns:
            检测结果
        """
        src_fp = self._get_fingerprint(self._resolve_path(source_path))
        if src_fp['load_error']:
            return {
                'source': source_path,
                'error': f"源文件不存在或加载失败: {src_fp['load_error']}",
                'top_similarity': 0,
                'total_compared': len(candidate_paths),
                'results': [{'candidate': cp, 'error': '源文件不存在或加载失败', 'similarity_score': 0} for cp in candidate_paths]
            }

        # 非图像源且候选全为非图像 → 按文件哈希/文本比对
        if not src_fp['is_image']:
            all_non_image = True
            for cp in candidate_paths:
                if os.path.splitext(cp)[1].lower() in IMAGE_EXTS:
                    all_non_image = False
                    break
            if all_non_image:
                return self._compare_by_file_hash(source_path, candidate_paths, src_fp)
            # 有图片候选，继续走图像检测流程（加载失败会降级）

        # 逐一对候选进行比对（候选指纹走缓存，同一文件多次参与比对只提取一次）
        results = []
        for cand_path in candidate_paths:
            try:
                cand_fp = self._get_fingerprint(self._resolve_path(cand_path))
                if cand_fp['load_error']:
                    results.append({
                        'candidate': cand_path,
                        'error': f"候选文件不存在或加载失败: {cand_fp['load_error']}",
                        'similarity_score': 0
                    })
                    continue
                results.append(self._compare_fingerprints(cand_path, src_fp, cand_fp))
            except Exception as e:
                print(f"与 {cand_path} 比对失败: {e}")
                results.append({
                    'candidate': cand_path,
                    'error': str(e),
                    'similarity_score': 0
                })

        # 按相似度降序排列
        results.sort(key=lambda x: x.get('similarity_score', 0), reverse=True)

        # 获取最高的相似度
        top_similarity = results[0]['similarity_score'] if results else 0

        return {
            'source': source_path,
            'top_similarity': top_similarity,
            'total_compared': len(results),
            'results': results
        }

    def _get_fingerprint(self, abs_path: str) -> Dict[str, Any]:
        """
        获取文件指纹（带 LRU 缓存）

        先用 (路径, mtime, size) 元信息键查询（命中免读文件）；
        未命中则计算内容 MD5 后按 "md5:<哈希>" 内容键再查一次
        （同一内容重新下载的临时文件也能命中），仍未命中才做完整提取。
        """
        if not os.path.exists(abs_path):
            return self._empty_fingerprint(abs_path, '文件不存在')
        stat = os.stat(abs_path)
        meta_key = (abs_path, stat.st_mtime_ns, stat.st_size)
        cached = self.fp_cache.get(meta_key)
        if cached is not None:
            return cached

        md5 = self._file_md5(abs_path)
        if md5:
            by_content = self.fp_cache.get('md5:' + md5)
            if by_content is not None:
                self.fp_cache.put(meta_key, by_content)
                return by_content

        fp = self._compute_fingerprint(abs_path, md5)
        self.fp_cache.put(meta_key, fp)
        if md5:
            self.fp_cache.put('md5:' + md5, fp)
        return fp

    @staticmethod
    def _empty_fingerprint(abs_path: str, error: str) -> Dict[str, Any]:
        return {
            'abs_path': abs_path, 'load_error': error, 'md5': None,
            'is_image': False, 'phash': None, 'processed': None, 'edges': None,
            'ocr_results': [], 'graph': nx.Graph(), 'nodes': [], 'edges_list': [],
            'doc_text': '', 'doc_images': []
        }

    @staticmethod
    def _file_md5(abs_path: str) -> Optional[str]:
        try:
            h = hashlib.md5()
            with open(abs_path, 'rb') as f:
                for chunk in iter(lambda: f.read(1 << 20), b''):
                    h.update(chunk)
            return h.hexdigest()
        except Exception:
            return None

    def _compute_fingerprint(self, abs_path: str, md5: Optional[str] = None) -> Dict[str, Any]:
        """提取文件指纹（pHash/预处理图/OCR/图结构，或 docx 文本与内嵌图）"""
        fp = self._empty_fingerprint(abs_path, None)
        if md5 is None:
            md5 = self._file_md5(abs_path)
        if not md5:
            fp['load_error'] = '文件读取失败'
            return fp
        fp['md5'] = md5

        ext = os.path.splitext(abs_path)[1].lower()
        fp['is_image'] = ext in IMAGE_EXTS

        if fp['is_image']:
            try:
                _, gray = load_image(abs_path)
            except Exception as e:
                fp['load_error'] = f'图像加载失败: {e}'
                return fp
            fp['processed'] = preprocess(gray)
            fp['edges'] = detect_edges(fp['processed'])
            try:
                fp['phash'] = compute_phash(abs_path)
            except Exception:
                fp['phash'] = None
            if self.ocr:
                try:
                    fp['ocr_results'] = self._parse_ocr_results(self.ocr.ocr(abs_path, cls=True))
                except Exception as e:
                    print(f"OCR失败 {abs_path}: {e}")
            try:
                extraction = self.graph_extractor.extract(gray, fp['edges'], fp['ocr_results'])
                fp['graph'] = extraction['graph']
                fp['nodes'] = extraction['nodes']
                fp['edges_list'] = extraction['edges']
            except Exception as e:
                print(f"图结构提取失败 {abs_path}: {e}")
        elif ext in ['.docx', '.doc']:
            fp['doc_text'] = self._extract_docx_text(abs_path)
            fp['doc_images'] = self._extract_docx_images(abs_path)
        return fp
    
    def _compare_by_file_hash(self, source_path: str, candidate_paths: List[str],
                              src_fp: Dict[str, Any] = None) -> Dict[str, Any]:
        """
        基于文件哈希和文本内容的比对（用于非图像文件，指纹走缓存）
        """
        if src_fp is None:
            src_fp = self._get_fingerprint(self._resolve_path(source_path))
        results = []

        for cand_path in candidate_paths:
            cand_fp = self._get_fingerprint(self._resolve_path(cand_path))
            if cand_fp['load_error']:
                results.append({
                    'candidate': cand_path,
                    'error': cand_fp['load_error'],
                    'similarity_score': 0
                })
                continue

            similarity_score = 0
            text_similarity = 0
            image_similarity = 0
            matched_imgs = 0

            if src_fp['md5'] and src_fp['md5'] == cand_fp['md5']:
                # 完全相同的文件
                similarity_score = 100
                text_similarity = 100
                image_similarity = 100
                matched_imgs = len(src_fp['doc_images'])
            else:
                # 不同文件，智能计算相似度
                cand_ext = os.path.splitext(cand_fp['abs_path'])[1].lower()
                if cand_ext in ['.docx', '.doc']:
                    src_text = src_fp['doc_text']
                    src_images = src_fp['doc_images']
                    cand_text = cand_fp['doc_text']
                    cand_images = cand_fp['doc_images']

                    # 计算文本相似度
                    if src_text and cand_text:
                        text_similarity = self._compute_text_similarity(src_text, cand_text)

                    # 计算图片相似度
                    if src_images and cand_images:
                        image_similarity, max_img_sim, matched_imgs = self._compare_docx_images(src_images, cand_images)

                    # 智能权重计算
                    has_text = bool(src_text and cand_text)
                    has_images = bool(src_images and cand_images)

                    if has_text and has_images:
                        # 图文混合：各占50%
                        similarity_score = text_similarity * 0.5 + image_similarity * 0.5
                    elif has_text:
                        # 纯文字：只计算文本相似度
                        similarity_score = text_similarity
                    elif has_images:
                        # 纯图片：只计算图片相似度
                        similarity_score = image_similarity
                    else:
                        # 都没有
                        similarity_score = 10
                else:
                    similarity_score = 10

            results.append({
                'candidate': cand_path,
                'similarity_score': similarity_score,
                'image_hash_score': image_similarity,
                'orb_match_count': matched_imgs,
                'text_similarity': text_similarity,
                'graph_similarity': 0,
                'is_isomorphic': similarity_score == 100,
                'is_suspicious': similarity_score > 50,
                'doc_type': 'text' if src_fp['doc_text'] and not src_fp['doc_images'] else ('image' if src_fp['doc_images'] and not src_fp['doc_text'] else 'mixed')
            })

        results.sort(key=lambda x: x.get('similarity_score', 0), reverse=True)
        top_similarity = results[0]['similarity_score'] if results else 0

        return {
            'source': source_path,
            'top_similarity': top_similarity,
            'total_compared': len(results),
            'results': results
        }
    
    def _compare_fingerprints(self,
                              cand_path: str,
                              src_fp: Dict[str, Any],
                              cand_fp: Dict[str, Any]) -> Dict[str, Any]:
        """
        单个候选对源图的比对（基于预提取的指纹，避免重复加载/提取）

        Args:
            cand_path: 候选文件原始路径标识（用于结果回传）
            src_fp: 源文件指纹
            cand_fp: 候选文件指纹

        Returns:
            比对结果
        """
        result = {
            'candidate': cand_path,
            'similarity_score': 0,
            'image_hash_score': 0,
            'orb_match_count': 0,
            'text_similarity': 0,
            'graph_similarity': 0,
            'is_isomorphic': False,
            'is_suspicious': False,
            'details': {}
        }

        # ========== 第一级：感知哈希初筛 ==========
        if src_fp['phash'] and cand_fp['phash']:
            hash_dist = hamming_distance(src_fp['phash'], cand_fp['phash'])
            hash_score = max(0, (1 - hash_dist / len(src_fp['phash'])) * 100)
            result['image_hash_score'] = hash_score

            # 如果哈希距离太大，直接跳过后续检测
            if hash_dist > self.thresholds['phash_skip']:
                result['similarity_score'] = hash_score * 0.3
                result['is_suspicious'] = result['similarity_score'] > self.thresholds['overall_suspect']
                return result

        # ========== 第二级：ORB特征匹配 ==========
        orb_count = 0
        orb_score = 0.0
        try:
            orb_count, orb_score = compute_orb_similarity(src_fp['processed'], cand_fp['processed'])
            result['orb_match_count'] = orb_count
        except Exception as e:
            print(f"ORB匹配失败: {e}")

        # ========== 第三级：OCR文本比对 ==========
        if self.ocr and src_fp['ocr_results'] and cand_fp['ocr_results']:
            try:
                result['text_similarity'] = compute_text_similarity(src_fp['ocr_results'], cand_fp['ocr_results'])
            except Exception as e:
                print(f"文本相似度计算失败: {e}")

        # ========== 第四级：图结构比对 ==========
        src_graph = src_fp['graph']
        cand_graph = cand_fp['graph']
        try:
            # 如果没有提取到节点，使用ORB结果作为图相似度
            if len(cand_graph.nodes()) == 0 or len(src_graph.nodes()) == 0:
                result['graph_similarity'] = orb_score
            else:
                # 结构相似度计算
                struct_result = compute_structure_similarity(src_graph, cand_graph)
                result['graph_similarity'] = struct_result.get('structure_similarity', 0)
                result['is_isomorphic'] = struct_result.get('is_isomorphic', False)
                result['details']['structure'] = {
                    'node_count_diff': struct_result.get('node_count_diff', 0),
                    'edge_count_diff': struct_result.get('edge_count_diff', 0),
                    'ged_similarity': struct_result.get('ged_similarity', 0),
                    'is_isomorphic': struct_result.get('is_isomorphic', False)
                }

                # 节点类型分布比对
                type_similarities = compare_node_types(src_graph, cand_graph)
                result['details']['node_type_similarities'] = type_similarities

                # 公共子图信息
                common = find_common_subgraph(src_graph, cand_graph)
                result['details']['common_nodes'] = len(common.nodes())
                result['details']['common_edges'] = common.number_of_edges()

                result['details']['src_nodes'] = [
                    {'id': n.id, 'type': n.type, 'label': n.label} for n in src_fp['nodes']
                ]
                result['details']['cand_nodes'] = [
                    {'id': n.id, 'type': n.type, 'label': n.label} for n in cand_fp['nodes']
                ]

        except Exception as e:
            print(f"图结构比对失败: {e}")
            result['graph_similarity'] = orb_score

        # ========== 综合评分 ==========
        result['similarity_score'] = self._compute_overall_score(result)

        # 如果所有指标都是0（OCR/图结构都失败），用pHash兜底
        if result['similarity_score'] == 0 and result['image_hash_score'] == 0 and result['orb_match_count'] == 0:
            try:
                hash_sim = phash_similarity(src_fp['abs_path'], cand_fp['abs_path'])
                result['similarity_score'] = hash_sim
                result['image_hash_score'] = hash_sim
            except Exception:
                pass

        # ========== 可疑判定 ==========
        result['is_suspicious'] = result['similarity_score'] > self.thresholds['overall_suspect']
        result['is_highly_suspicious'] = result['similarity_score'] > self.thresholds['overall_high_suspect']

        return result
    
    def _compute_overall_score(self, result: Dict[str, Any]) -> float:
        """
        计算综合评分
        
        Args:
            result: 各维度检测结果
            
        Returns:
            综合评分 (0-100)
        """
        w = self.weights
        
        score = (
            result['image_hash_score'] * w['image_hash'] +
            (result['orb_match_count'] / 100 * 100) * w['orb'] +
            result['text_similarity'] * w['text'] +
            result['graph_similarity'] * w['graph']
        )
        
        # 如果同构，额外加分
        if result.get('is_isomorphic'):
            score = score * 1.2  # 同构加分20%
        
        # 如果综合评分低但pHash很高（图结构提取失败的情况），用pHash顶替
        if score < 30 and result['image_hash_score'] > 60:
            score = result['image_hash_score'] * 0.7
        
        return min(score, 100.0)
    
    def _resolve_path(self, relative_path: str) -> str:
        """
        解析相对路径为绝对路径（带路径围栏）

        允许的根目录：upload_dir（本服务的数据目录）与系统临时目录
        （Node 侧会把 COS 文件物化到 tempfile 再传入）。解析结果逃出这两个
        目录的（如包含 ../ 的相对路径、任意绝对路径）一律拒绝。

        Args:
            relative_path: 相对路径（如 uploads/202607/xxx.png）或允许目录内的绝对路径

        Returns:
            绝对路径
        """
        import tempfile

        # 标准化路径分隔符
        relative_path = relative_path.replace('\\', '/')
        # 如果已经是绝对路径，校验其落在允许目录内
        if os.path.isabs(relative_path):
            full_path = os.path.normpath(relative_path)
        else:
            # 否则拼接到上传目录根路径
            full_path = os.path.normpath(os.path.join(self.upload_dir, relative_path))

        allowed_roots = [os.path.normpath(self.upload_dir), os.path.normpath(tempfile.gettempdir())]
        for root in allowed_roots:
            try:
                if os.path.commonpath([full_path, root]) == root:
                    return full_path
            except ValueError:
                # Windows 下不同盘符比较会抛 ValueError，继续尝试下一个根
                continue
        raise ValueError(f"非法路径: {relative_path} 不在允许的目录内")
    
    def _parse_ocr_results(self, ocr_raw: List) -> List[Dict]:
        """
        解析PaddleOCR结果
        
        Args:
            ocr_raw: PaddleOCR原始输出
            
        Returns:
            解析后的结果列表
        """
        results = []
        if not ocr_raw:
            return results
        
        for line in ocr_raw:
            if line is None:
                continue
            for item in line:
                if item is None:
                    continue
                bbox = item[0]  # 边界框坐标
                text = item[1][0]  # 文本内容
                confidence = item[1][1]  # 置信度
                
                if confidence > 0.5:  # 过滤低置信度结果
                    # 将四个点坐标转换为 (x, y, w, h)
                    xs = [p[0] for p in bbox]
                    ys = [p[1] for p in bbox]
                    x, y = min(xs), min(ys)
                    w, h = max(xs) - x, max(ys) - y
                    
                    results.append({
                        'text': text,
                        'bbox': [int(x), int(y), int(w), int(h)],
                        'confidence': float(confidence)
                    })
        
        return results
    
    def _extract_docx_text(self, file_path: str) -> str:
        """
        从docx文件中提取文本内容
        
        Args:
            file_path: docx文件路径
            
        Returns:
            提取的文本
        """
        import zipfile
        import re
        
        try:
            with zipfile.ZipFile(file_path) as z:
                if 'word/document.xml' not in z.namelist():
                    return ""
                xml_content = z.read('word/document.xml')
                # 提取XML中的文本内容
                text = xml_content.decode('utf-8', errors='ignore')
                # 移除非文本标签
                text = re.sub(r'<[^>]+>', ' ', text)
                text = re.sub(r'\s+', ' ', text).strip()
                return text
        except Exception as e:
            print(f"提取docx文本失败: {e}")
            return ""
    
    def _extract_docx_images(self, file_path: str) -> List[Dict]:
        """
        从docx文件中提取嵌入的图片
        
        Args:
            file_path: docx文件路径
            
        Returns:
            图片信息列表 [{'index': 0, 'data': bytes, 'format': 'png'}, ...]
        """
        import zipfile
        import tempfile
        import os
        
        images = []
        try:
            with zipfile.ZipFile(file_path) as z:
                # Word 文档中图片通常在 word/media/ 目录
                media_files = [n for n in z.namelist() if 'media' in n.lower()]
                
                for idx, media_file in enumerate(media_files):
                    try:
                        img_data = z.read(media_file)
                        # 确定图片格式
                        ext = os.path.splitext(media_file)[1].lower().replace('.', '')
                        if ext in ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tiff', 'emf', 'wmf']:
                            images.append({
                                'index': idx,
                                'data': img_data,
                                'format': ext,
                                'filename': media_file
                            })
                    except Exception as e:
                        print(f"提取图片 {media_file} 失败: {e}")
        except Exception as e:
            print(f"提取docx图片失败: {e}")
        
        return images
    
    def _compare_docx_images(self, src_images: List[Dict], cand_images: List[Dict]) -> Tuple[float, float, int]:
        """
        比较两个docx文档中的图片
        
        Args:
            src_images: 源文档图片列表
            cand_images: 候选文档图片列表
            
        Returns:
            (图片相似度, 最高图片相似度, 匹配图片数)
        """
        import tempfile
        import os
        import hashlib
        
        if not src_images or not cand_images:
            return 0.0, 0.0, 0
        
        # 计算图片哈希集合
        src_hashes = set()
        for img in src_images:
            h = hashlib.md5(img['data']).hexdigest()
            src_hashes.add(h)
        
        cand_hashes = set()
        for img in cand_images:
            h = hashlib.md5(img['data']).hexdigest()
            cand_hashes.add(h)
        
        # 完全相同的图片数
        matched = len(src_hashes & cand_hashes)
        max_matched = max(len(src_hashes), len(cand_hashes))
        
        if max_matched == 0:
            return 0.0, 0.0, 0
        
        # 基于 pHash 的相似度计算
        try:
            from image_preprocessor import compute_phash
            from PIL import Image
            import io
            
            src_phashes = []
            cand_phashes = []
            
            # 计算源图片pHash
            for img in src_images[:5]:  # 最多处理5张图片
                try:
                    pil_img = Image.open(io.BytesIO(img['data']))
                    pil_img = pil_img.convert('RGB')
                    phash = compute_phash_pil(pil_img)
                    src_phashes.append(phash)
                except:
                    pass
            
            # 计算候选图片pHash
            for img in cand_images[:5]:
                try:
                    pil_img = Image.open(io.BytesIO(img['data']))
                    pil_img = pil_img.convert('RGB')
                    phash = compute_phash_pil(pil_img)
                    cand_phashes.append(phash)
                except:
                    pass
            
            # 计算最高相似度
            max_sim = 0.0
            if src_phashes and cand_phashes:
                for sp in src_phashes:
                    for cp in cand_phashes:
                        try:
                            dist = sum(c1 != c2 for c1, c2 in zip(sp, cp))
                            sim = max(0, (1 - dist / max(len(sp), 1)) * 100)
                            max_sim = max(max_sim, sim)
                        except:
                            pass
            
            # 综合评分：MD5匹配占60%，pHash相似度占40%
            overall_sim = (matched / max_matched * 60) + (max_sim * 0.4)
            
            return overall_sim, max_sim, matched
            
        except Exception as e:
            print(f"图片pHash计算失败: {e}")
            return matched / max_matched * 100, 0.0, matched
    
    def _compute_text_similarity(self, text1: str, text2: str) -> float:
        """
        计算两段文本的相似度（基于TF特征 + Jaccard）
        
        Args:
            text1: 第一段文本
            text2: 第二段文本
            
        Returns:
            相似度 (0-100)
        """
        if not text1 or not text2:
            return 0.0
        
        # 1. 字符级Jaccard相似度
        chars1 = set(text1)
        chars2 = set(text2)
        char_jaccard = len(chars1 & chars2) / len(chars1 | chars2) if chars1 | chars2 else 0
        
        # 2. 分词（按中文词语和英文单词）
        import re
        tokens1 = set(re.findall(r'[\u4e00-\u9fff]{2,}|[a-zA-Z]+', text1))
        tokens2 = set(re.findall(r'[\u4e00-\u9fff]{2,}|[a-zA-Z]+', text2))
        word_jaccard = len(tokens1 & tokens2) / len(tokens1 | tokens2) if tokens1 | tokens2 else 0
        
        # 3. 编辑距离相似度（取前500字符加速）
        def levenshtein_similarity(s1, s2):
            s1 = s1[:500]
            s2 = s2[:500]
            if not s1 and not s2:
                return 1.0
            m, n = len(s1), len(s2)
            dp = [[0] * (n + 1) for _ in range(m + 1)]
            for i in range(m + 1):
                dp[i][0] = i
            for j in range(n + 1):
                dp[0][j] = j
            for i in range(1, m + 1):
                for j in range(1, n + 1):
                    cost = 0 if s1[i-1] == s2[j-1] else 1
                    dp[i][j] = min(dp[i-1][j] + 1, dp[i][j-1] + 1, dp[i-1][j-1] + cost)
            max_len = max(m, n)
            return 1 - dp[m][n] / max_len if max_len > 0 else 1.0
        
        edit_sim = levenshtein_similarity(text1, text2)
        
        # 加权融合
        similarity = (char_jaccard * 0.15 + word_jaccard * 0.45 + edit_sim * 0.40) * 100
        return min(similarity, 100.0)


def generate_visualization(source_path: str,
                           candidate_path: str,
                           src_extraction: Dict,
                           cand_extraction: Dict,
                           output_path: str) -> str:
    """
    生成可视化对比图
    
    Args:
        source_path: 源图像路径
        candidate_path: 候选图像路径
        src_extraction: 源图提取结果
        cand_extraction: 候选图提取结果
        output_path: 输出路径
        
    Returns:
        输出路径
    """
    # 加载原图
    src_img = cv2.imread(source_path)
    cand_img = cv2.imread(candidate_path)
    
    if src_img is None or cand_img is None:
        return None
    
    # 调整大小使两图高度一致
    h1, w1 = src_img.shape[:2]
    h2, w2 = cand_img.shape[:2]
    target_h = max(h1, h2)
    
    if h1 < target_h:
        scale = target_h / h1
        src_img = cv2.resize(src_img, None, fx=scale, fy=scale)
    if h2 < target_h:
        scale = target_h / h2
        cand_img = cv2.resize(cand_img, None, fx=scale, fy=scale)
    
    # 绘制提取结果
    src_viz = visualize_extraction(src_img, 
                                   src_extraction.get('nodes', []),
                                   src_extraction.get('edges', []))
    cand_viz = visualize_extraction(cand_img,
                                     cand_extraction.get('nodes', []),
                                     cand_extraction.get('edges', []))
    
    # 并排显示
    h1, w1 = src_viz.shape[:2]
    h2, w2 = cand_viz.shape[:2]
    
    canvas_h = max(h1, h2) + 60  # 60px用于标题
    canvas_w = w1 + w2 + 30
    
    canvas = np.ones((canvas_h, canvas_w, 3), dtype=np.uint8) * 255
    
    # 放置两图
    canvas[30:30+h1, 10:10+w1] = src_viz
    canvas[30:30+h2, 20+w1:20+w1+w2] = cand_viz
    
    # 添加标题
    cv2.putText(canvas, "源拓扑图", (10, 20), 
               cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)
    cv2.putText(canvas, "对比拓扑图", (20+w1, 20),
               cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)
    
    # 保存
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    cv2.imwrite(output_path, canvas)
    
    return output_path


# 测试代码
if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 2:
        source = sys.argv[1]
        candidates = sys.argv[2:]
        
        print(f"源文件: {source}")
        print(f"候选文件: {candidates}")
        
        detector = TopologyDetector(enable_ocr=False)
        result = detector.detect(source, candidates)
        
        print(f"\n检测完成!")
        print(f"总相似度: {result['top_similarity']:.2f}%")
        print(f"比对数量: {result['total_compared']}")
        
        for r in result['results']:
            print(f"\n  候选: {r['candidate']}")
            print(f"    综合相似度: {r.get('similarity_score', 0):.2f}%")
            print(f"    图像哈希: {r.get('image_hash_score', 0):.2f}%")
            print(f"    ORB匹配: {r.get('orb_match_count', 0)}点")
            print(f"    文本相似度: {r.get('text_similarity', 0):.2f}%")
            print(f"    图结构相似度: {r.get('graph_similarity', 0):.2f}%")
            print(f"    是否同构: {r.get('is_isomorphic', False)}")
            print(f"    是否可疑: {r.get('is_suspicious', False)}")