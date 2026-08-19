"""
Graph Extractor Module
图结构提取模块 - 从网络拓扑图图像中提取节点和边
"""

import cv2
import numpy as np
import networkx as nx
from typing import List, Dict, Tuple, Optional, Any
from dataclasses import dataclass, field


@dataclass
class Node:
    """节点数据结构"""
    id: str
    type: str  # 'router', 'switch', 'pc', 'server', 'cloud', 'unknown'
    label: str = ""
    bbox: Tuple[int, int, int, int] = (0, 0, 0, 0)  # (x, y, w, h)
    center: Tuple[int, int] = (0, 0)
    area: int = 0
    confidence: float = 0.0


@dataclass
class Edge:
    """边数据结构"""
    source: str
    target: str
    line_segments: List[Tuple[Tuple[int, int], Tuple[int, int]]] = field(default_factory=list)
    length: float = 0.0


class GraphExtractor:
    """图结构提取器"""
    
    def __init__(self,
                 min_node_area: int = 200,
                 max_node_area: int = 50000,
                 min_edge_length: int = 20,
                 line_merge_distance: int = 30,
                 text_association_distance: int = 100):
        """
        初始化图结构提取器
        
        Args:
            min_node_area: 最小节点面积（像素）
            max_node_area: 最大节点面积（像素）
            min_edge_length: 最小边长度
            line_merge_distance: 线段合并距离
            text_association_distance: 文本关联距离
        """
        self.min_node_area = min_node_area
        self.max_node_area = max_node_area
        self.min_edge_length = min_edge_length
        self.line_merge_distance = line_merge_distance
        self.text_association_distance = text_association_distance
    
    def extract(self, 
                gray: np.ndarray,
                edges: np.ndarray,
                ocr_results: List[Dict] = None) -> Dict[str, Any]:
        """
        从图像中提取图结构
        
        Args:
            gray: 灰度图像
            edges: 边缘图像
            ocr_results: OCR识别结果列表 [{'text': str, 'bbox': [x,y,w,h]}, ...]
            
        Returns:
            提取结果 {'nodes': [...], 'edges': [...], 'graph': nx.Graph}
        """
        # 1. 检测节点
        nodes = self._detect_nodes(gray, edges)
        
        # 2. 关联文本标签
        if ocr_results:
            nodes = self._associate_labels(nodes, ocr_results)
        
        # 3. 检测连接线
        lines = self._detect_lines(edges)
        
        # 4. 合并相近线段
        merged_lines = self._merge_lines(lines)
        
        # 5. 构建边
        edge_list = self._build_edges(nodes, merged_lines)
        
        # 6. 构建NetworkX图
        graph = self._build_graph(nodes, edge_list)
        
        return {
            'nodes': nodes,
            'edges': edge_list,
            'graph': graph,
            'line_segments': merged_lines
        }
    
    def _detect_nodes(self, gray: np.ndarray, edges: np.ndarray) -> List[Node]:
        """
        检测节点（网络设备图标）
        
        通过轮廓检测和形状分析识别设备图标
        """
        # 使用边缘图像进行轮廓检测
        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        nodes = []
        node_id = 0
        
        for contour in contours:
            area = cv2.contourArea(contour)
            
            # 过滤面积范围
            if area < self.min_node_area or area > self.max_node_area:
                continue
            
            # 获取边界框
            x, y, w, h = cv2.boundingRect(contour)
            
            # 计算长宽比
            aspect_ratio = float(w) / h if h > 0 else 0
            
            # 过滤极端长宽比（可能是线段而非节点）
            if aspect_ratio < 0.2 or aspect_ratio > 5:
                continue
            
            # 计算凸包面积与轮廓面积比（用于判断形状复杂度）
            hull = cv2.convexHull(contour)
            hull_area = cv2.contourArea(hull)
            solidity = float(area) / hull_area if hull_area > 0 else 0
            
            # 计算圆形度
            perimeter = cv2.arcLength(contour, True)
            circularity = 4 * np.pi * area / (perimeter * perimeter) if perimeter > 0 else 0
            
            # 判断节点类型
            node_type = self._classify_node(aspect_ratio, circularity, solidity)
            
            # 计算中心点
            center_x = x + w // 2
            center_y = y + h // 2
            
            node = Node(
                id=f"n{node_id}",
                type=node_type,
                bbox=(x, y, w, h),
                center=(center_x, center_y),
                area=area,
                confidence=min(solidity, circularity)
            )
            nodes.append(node)
            node_id += 1
        
        return nodes
    
    def _classify_node(self, aspect_ratio: float, circularity: float, solidity: float) -> str:
        """
        根据形状特征分类节点类型
        
        Args:
            aspect_ratio: 长宽比
            circularity: 圆形度
            solidity: 实心度
            
        Returns:
            节点类型
        """
        # 圆形设备（如集线器）
        if circularity > 0.8:
            return 'hub'
        
        # 接近正方形（如交换机、路由器）
        if 0.6 < aspect_ratio < 1.7 and solidity > 0.85:
            return 'switch'
        
        # 长方形（如PC）
        if aspect_ratio > 1.5:
            return 'pc'
        
        # 瘦高形（如服务器）
        if aspect_ratio < 0.7:
            return 'server'
        
        # 菱形（如路由器，某些绘图风格）
        if 0.3 < circularity < 0.6:
            return 'router'
        
        # 云形状（复杂形状，低solidity）
        if solidity < 0.7:
            return 'cloud'
        
        return 'unknown'
    
    def _associate_labels(self, nodes: List[Node], ocr_results: List[Dict]) -> List[Node]:
        """
        将OCR识别的文本与节点关联
        
        Args:
            nodes: 节点列表
            ocr_results: OCR结果 [{'text': str, 'bbox': [x,y,w,h]}, ...]
            
        Returns:
            关联了标签的节点列表
        """
        for node in nodes:
            node_x, node_y, node_w, node_h = node.bbox
            node_center = node.center
            
            best_text = ""
            best_distance = float('inf')
            
            for ocr in ocr_results:
                text = ocr.get('text', '')
                bbox = ocr.get('bbox', [0, 0, 0, 0])
                
                if len(bbox) >= 4:
                    ocr_x, ocr_y, ocr_w, ocr_h = bbox[0], bbox[1], bbox[2], bbox[3]
                    ocr_center = (ocr_x + ocr_w // 2, ocr_y + ocr_h // 2)
                    
                    # 计算文本中心到节点中心的距离
                    distance = np.sqrt((node_center[0] - ocr_center[0])**2 + 
                                      (node_center[1] - ocr_center[1])**2)
                    
                    # 在关联距离内且是最小距离
                    if distance < self.text_association_distance and distance < best_distance:
                        best_distance = distance
                        best_text = text.strip()
            
            node.label = best_text
        
        return nodes
    
    def _detect_lines(self, edges: np.ndarray) -> List[Tuple[Tuple[int, int], Tuple[int, int]]]:
        """
        使用Hough变换检测直线
        
        Args:
            edges: 边缘图像
            
        Returns:
            线段列表 [((x1, y1), (x2, y2)), ...]
        """
        # 使用概率Hough变换检测线段
        lines = cv2.HoughLinesP(
            edges, 
            rho=1, 
            theta=np.pi/180, 
            threshold=50,
            minLineLength=self.min_edge_length,
            maxLineGap=10
        )
        
        if lines is None:
            return []
        
        # 转换为线段格式
        line_segments = []
        for line in lines:
            x1, y1, x2, y2 = line[0]
            line_segments.append(((x1, y1), (x2, y2)))
        
        return line_segments
    
    def _merge_lines(self, lines: List[Tuple[Tuple[int, int], Tuple[int, int]]]) -> List[Tuple[Tuple[int, int], Tuple[int, int]]]:
        """
        合并相近的线段
        
        Args:
            lines: 线段列表
            
        Returns:
            合并后的线段列表
        """
        if not lines:
            return []
        
        merged = []
        used = set()
        
        for i, line1 in enumerate(lines):
            if i in used:
                continue
            
            (x1, y1), (x2, y2) = line1
            current_line = [x1, y1, x2, y2]
            
            for j, line2 in enumerate(lines):
                if j <= i or j in used:
                    continue
                
                (x3, y3), (x4, y4) = line2
                
                # 检查线段是否接近
                if self._lines_are_close(current_line, (x3, y3, x4, y4)):
                    # 合并线段
                    current_line = self._extend_line(current_line, (x3, y3, x4, y4))
                    used.add(j)
            
            merged.append(((int(current_line[0]), int(current_line[1])), 
                          (int(current_line[2]), int(current_line[3]))))
        
        return merged
    
    def _lines_are_close(self, line1: List[int], line2: Tuple[int, int, int, int], threshold: float = None) -> bool:
        """
        判断两条线段是否接近
        """
        if threshold is None:
            threshold = self.line_merge_distance
        
        x1, y1, x2, y2 = line1
        x3, y3, x4, y4 = line2
        
        # 计算端点之间的最小距离
        dist1 = min(np.sqrt((x1-x3)**2 + (y1-y3)**2), 
                   np.sqrt((x1-x4)**2 + (y1-y4)**2),
                   np.sqrt((x2-x3)**2 + (y2-y3)**2),
                   np.sqrt((x2-x4)**2 + (y2-y4)**2))
        
        return dist1 < threshold
    
    def _extend_line(self, line1: List[int], line2: Tuple[int, int, int, int]) -> List[int]:
        """
        扩展线段以包含另一条线段
        """
        points = [
            (line1[0], line1[1]),
            (line1[2], line1[3]),
            (line2[0], line2[1]),
            (line2[2], line2[3])
        ]
        
        # 找到最远的两点作为新线段
        max_dist = 0
        best_pair = (0, 1)
        
        for i in range(len(points)):
            for j in range(i+1, len(points)):
                dist = np.sqrt((points[i][0]-points[j][0])**2 + 
                              (points[i][1]-points[j][1])**2)
                if dist > max_dist:
                    max_dist = dist
                    best_pair = (i, j)
        
        return [points[best_pair[0]][0], points[best_pair[0]][1],
                points[best_pair[1]][0], points[best_pair[1]][1]]
    
    def _build_edges(self, nodes: List[Node], lines: List[Tuple[Tuple[int, int], Tuple[int, int]]]) -> List[Edge]:
        """
        根据线段和节点构建边
        
        Args:
            nodes: 节点列表
            lines: 线段列表
            
        Returns:
            边列表
        """
        edges = []
        
        # 为每个节点创建扩展区域（用于判断线段端点是否在节点内）
        node_regions = []
        for node in nodes:
            x, y, w, h = node.bbox
            # 扩展边界框以容纳接近节点的端点
            padding = max(w, h) // 4
            node_regions.append({
                'node': node,
                'bounds': (x - padding, y - padding, x + w + padding, y + h + padding)
            })
        
        # 检查每条线段的端点是否在节点区域内
        for line in lines:
            (x1, y1), (x2, y2) = line
            
            source_node = None
            target_node = None
            
            for region in node_regions:
                bx1, by1, bx2, by2 = region['bounds']
                
                # 检查起点
                if source_node is None and bx1 <= x1 <= bx2 and by1 <= y1 <= by2:
                    source_node = region['node']
                
                # 检查终点
                if target_node is None and bx1 <= x2 <= bx2 and by1 <= y2 <= by2:
                    target_node = region['node']
            
            # 如果两端都在节点内，创建边
            if source_node and target_node and source_node.id != target_node.id:
                # 检查是否已存在相同边
                existing = [e for e in edges if 
                           (e.source == source_node.id and e.target == target_node.id) or
                           (e.source == target_node.id and e.target == source_node.id)]
                
                if not existing:
                    edge = Edge(
                        source=source_node.id,
                        target=target_node.id,
                        line_segments=[line],
                        length=np.sqrt((x2-x1)**2 + (y2-y1)**2)
                    )
                    edges.append(edge)
                else:
                    # 添加线段到现有边
                    existing[0].line_segments.append(line)
        
        return edges
    
    def _build_graph(self, nodes: List[Node], edges: List[Edge]) -> nx.Graph:
        """
        构建NetworkX图对象
        
        Args:
            nodes: 节点列表
            edges: 边列表
            
        Returns:
            NetworkX图对象
        """
        G = nx.Graph()
        
        # 添加节点
        for node in nodes:
            G.add_node(node.id, 
                      type=node.type, 
                      label=node.label,
                      bbox=node.bbox,
                      center=node.center)
        
        # 添加边
        for edge in edges:
            G.add_edge(edge.source, edge.target, weight=edge.length)
        
        return G


def visualize_extraction(image: np.ndarray, 
                        nodes: List[Node], 
                        edges: List[Edge],
                        output_path: str = None) -> np.ndarray:
    """
    可视化提取结果
    
    Args:
        image: 原始图像
        nodes: 节点列表
        edges: 边列表
        output_path: 输出路径（可选）
        
    Returns:
        可视化结果图像
    """
    result = image.copy()
    
    # 绘制节点
    colors = {
        'router': (0, 0, 255),      # 红色
        'switch': (0, 255, 0),       # 绿色
        'pc': (255, 0, 0),           # 蓝色
        'server': (255, 255, 0),     # 青色
        'hub': (255, 0, 255),        # 紫色
        'cloud': (0, 255, 255),      # 黄色
        'unknown': (128, 128, 128)   # 灰色
    }
    
    for node in nodes:
        x, y, w, h = node.bbox
        color = colors.get(node.type, (128, 128, 128))
        
        # 绘制边界框
        cv2.rectangle(result, (x, y), (x+w, y+h), color, 2)
        
        # 绘制中心点
        cv2.circle(result, node.center, 5, color, -1)
        
        # 绘制标签
        if node.label:
            cv2.putText(result, node.label, (x, y-5), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)
        
        # 绘制节点ID
        cv2.putText(result, node.id, (x+w+5, y+h//2), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 0), 1)
    
    # 绘制边
    for edge in edges:
        for segment in edge.line_segments:
            (x1, y1), (x2, y2) = segment
            cv2.line(result, (x1, y1), (x2, y2), (0, 255, 255), 2)
    
    # 保存结果
    if output_path:
        cv2.imwrite(output_path, result)
    
    return result


# 测试代码
if __name__ == "__main__":
    import sys
    from image_preprocessor import load_image, detect_edges, preprocess
    
    if len(sys.argv) > 1:
        image_path = sys.argv[1]
        print(f"处理图像: {image_path}")
        
        # 加载图像
        img, gray = load_image(image_path)
        
        # 预处理
        processed = preprocess(gray)
        
        # 边缘检测
        edges = detect_edges(processed)
        
        # 提取图结构
        extractor = GraphExtractor()
        result = extractor.extract(gray, edges)
        
        print(f"检测到 {len(result['nodes'])} 个节点")
        print(f"检测到 {len(result['edges'])} 条边")
        
        for node in result['nodes']:
            print(f"  节点: {node.id}, 类型: {node.type}, 标签: {node.label}")
        
        # 可视化
        output_path = image_path.replace('.', '_extracted.')
        visualize_extraction(img, result['nodes'], result['edges'], output_path)
        print(f"可视化结果已保存到: {output_path}")
