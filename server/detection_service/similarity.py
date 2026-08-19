"""
Similarity Module
相似度计算模块 - 提供图同构检测、图编辑距离、文本相似度等计算功能
"""

import cv2
import numpy as np
import networkx as nx
from typing import Dict, List, Tuple, Any, Optional
from concurrent.futures import TimeoutError
from functools import wraps
import time


def timeout_handler(seconds):
    """
    超时装饰器
    
    Args:
        seconds: 超时秒数
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            # 简单的超时处理（在单线程环境中）
            start_time = time.time()
            result = func(*args, **kwargs)
            elapsed = time.time() - start_time
            if elapsed > seconds:
                raise TimeoutError(f"函数 {func.__name__} 执行超时")
            return result
        return wrapper
    return decorator


def compute_graph_isomorphism(graph1: nx.Graph, graph2: nx.Graph) -> bool:
    """
    检测两个图是否同构
    
    Args:
        graph1: 第一个图
        graph2: 第二个图
        
    Returns:
        是否同构
    """
    # 使用节点类型进行匹配
    def node_match(n1, n2):
        return n1.get('type', 'unknown') == n2.get('type', 'unknown')
    
    GM = nx.isomorphism.GraphMatcher(graph1, graph2, node_match=node_match)
    return GM.is_isomorphic()


def compute_graph_edit_distance(graph1: nx.Graph, 
                                 graph2: nx.Graph,
                                 timeout: int = 30) -> Tuple[Optional[int], float]:
    """
    计算图编辑距离 (GED)
    
    注意：GED计算是NP-hard问题，对于大型图可能很慢
    
    Args:
        graph1: 第一个图
        graph2: 第二个图
        timeout: 超时秒数
        
    Returns:
        (编辑距离, 相似度分数)
    """
    try:
        # 使用networkx的图编辑距离计算
        # 由于原版太慢，使用优化版本
        ged = optimized_ged(graph1, graph2, timeout)
        
        # 计算归一化相似度
        max_nodes = max(len(graph1.nodes()), len(graph2.nodes()))
        max_edges = max(graph1.number_of_edges(), graph2.number_of_edges())
        max_distance = max_nodes + max_edges
        
        if max_distance == 0:
            similarity = 100.0
        else:
            similarity = max(0, (1 - ged / max_distance) * 100)
        
        return ged, similarity
        
    except Exception as e:
        print(f"计算图编辑距离时出错: {e}")
        return None, 50.0  # 返回中等相似度作为降级处理


def optimized_ged(graph1: nx.Graph, graph2: nx.Graph, timeout: int = 30) -> int:
    """
    优化的图编辑距离计算
    
    使用近似算法加速计算
    
    Args:
        graph1: 第一个图
        graph2: 第二个图  
        timeout: 超时秒数
        
    Returns:
        图编辑距离
    """
    n1 = len(graph1.nodes())
    n2 = len(graph2.nodes())
    e1 = graph1.number_of_edges()
    e2 = graph2.number_of_edges()
    
    # 基本统计差异作为近似
    node_diff = abs(n1 - n2)
    edge_diff = abs(e1 - e2)
    
    # 尝试精确计算（如果图较小）
    if n1 <= 10 and n2 <= 10:
        try:
            start = time.time()
            # 使用带超时的精确计算
            ged = nx.graph_edit_distance(graph1, graph2, 
                                         node_match=lambda n1, n2: n1.get('type') == n2.get('type'),
                                         timeout=timeout)
            return ged
        except:
            pass
    
    # 使用近似方法：基于结构差异
    # 节点差异 + 边差异 + 度序列差异
    deg1 = sorted([d for n, d in graph1.degree()])
    deg2 = sorted([d for n, d in graph2.degree()])
    
    # 度序列差异
    deg_diff = 0
    for i in range(max(len(deg1), len(deg2))):
        d1 = deg1[i] if i < len(deg1) else 0
        d2 = deg2[i] if i < len(deg2) else 0
        deg_diff += abs(d1 - d2)
    
    # 综合估计
    approx_ged = node_diff * 2 + edge_diff + deg_diff // 2
    
    return approx_ged


def compute_text_similarity(texts1: List[Dict], texts2: List[Dict]) -> float:
    """
    计算文本相似度（基于Jaccard系数）
    
    Args:
        texts1: 第一组文本 [{'text': str, 'bbox': [...]}, ...]
        texts2: 第二组文本
        
    Returns:
        相似度 (0-100)
    """
    if not texts1 or not texts2:
        return 0.0
    
    # 提取文本内容
    set1 = set(t.get('text', '').strip().lower() for t in texts1 if t.get('text'))
    set2 = set(t.get('text', '').strip().lower() for t in texts2 if t.get('text'))
    
    if not set1 or not set2:
        return 0.0
    
    # Jaccard相似度
    intersection = set1 & set2
    union = set1 | set2
    
    similarity = len(intersection) / len(union) * 100
    return similarity


def compute_orb_similarity(gray1: np.ndarray, gray2: np.ndarray) -> Tuple[int, float]:
    """
    计算ORB特征匹配相似度
    
    Args:
        gray1: 第一张灰度图
        gray2: 第二张灰度图
        
    Returns:
        (匹配点数, 相似度分数)
    """
    try:
        # 创建ORB检测器
        orb = cv2.ORB_create(nfeatures=500)
        
        # 检测特征点和描述子
        kp1, des1 = orb.detectAndCompute(gray1, None)
        kp2, des2 = orb.detectAndCompute(gray2, None)
        
        if des1 is None or des2 is None or len(des1) < 2 or len(des2) < 2:
            return 0, 0.0
        
        # 使用BF匹配器
        bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False)
        
        # KNN匹配
        matches = bf.knnMatch(des1, des2, k=2)
        
        # 应用比值测试过滤好的匹配
        good_matches = []
        for match in matches:
            if len(match) == 2:
                m, n = match
                if m.distance < 0.75 * n.distance:
                    good_matches.append(m)
        
        match_count = len(good_matches)
        
        # 计算相似度
        max_matches = max(len(kp1), len(kp2))
        similarity = (match_count / max_matches * 100) if max_matches > 0 else 0.0
        
        return match_count, similarity
        
    except Exception as e:
        print(f"ORB特征匹配出错: {e}")
        return 0, 0.0


def compute_structure_similarity(graph1: nx.Graph, graph2: nx.Graph) -> Dict[str, Any]:
    """
    计算结构相似度（综合多种指标）
    
    Args:
        graph1: 第一个图
        graph2: 第二个图
        
    Returns:
        相似度详情字典
    """
    result = {
        'node_count_diff': 0,
        'edge_count_diff': 0,
        'density_diff': 0.0,
        'avg_degree_diff': 0.0,
        'is_isomorphic': False,
        'ged': None,
        'ged_similarity': 0.0,
        'structure_similarity': 0.0
    }
    
    n1 = len(graph1.nodes())
    n2 = len(graph2.nodes())
    e1 = graph1.number_of_edges()
    e2 = graph2.number_of_edges()
    
    # 节点和边数量差异
    result['node_count_diff'] = abs(n1 - n2)
    result['edge_count_diff'] = abs(e1 - e2)
    
    # 密度差异
    d1 = nx.density(graph1) if n1 > 1 else 0
    d2 = nx.density(graph2) if n2 > 1 else 0
    result['density_diff'] = abs(d1 - d2)
    
    # 平均度差异
    avg_deg1 = sum(dict(graph1.degree()).values()) / n1 if n1 > 0 else 0
    avg_deg2 = sum(dict(graph2.degree()).values()) / n2 if n2 > 0 else 0
    result['avg_degree_diff'] = abs(avg_deg1 - avg_deg2)
    
    # 同构检测
    result['is_isomorphic'] = compute_graph_isomorphism(graph1, graph2)
    
    # 图编辑距离
    ged, ged_sim = compute_graph_edit_distance(graph1, graph2, timeout=30)
    result['ged'] = ged
    result['ged_similarity'] = ged_sim
    
    # 综合结构相似度
    if result['is_isomorphic']:
        result['structure_similarity'] = 100.0
    else:
        # 基于多项指标的加权平均
        node_sim = 1 - result['node_count_diff'] / max(n1, n2, 1)
        edge_sim = 1 - result['edge_count_diff'] / max(e1, e2, 1)
        density_sim = 1 - result['density_diff']
        avg_deg_sim = 1 - result['avg_degree_diff'] / max(avg_deg1, avg_deg2, 1)
        
        result['structure_similarity'] = (
            node_sim * 0.3 + 
            edge_sim * 0.3 + 
            density_sim * 0.2 + 
            avg_deg_sim * 0.1 + 
            ged_sim / 100 * 0.1
        ) * 100
    
    return result


def compare_node_types(graph1: nx.Graph, graph2: nx.Graph) -> Dict[str, float]:
    """
    比较两个图的节点类型分布
    
    Args:
        graph1: 第一个图
        graph2: 第二个图
        
    Returns:
        各类型节点的相似度
    """
    # 统计各类型节点数量
    def count_types(graph):
        types = {}
        for node, data in graph.nodes(data=True):
            t = data.get('type', 'unknown')
            types[t] = types.get(t, 0) + 1
        return types
    
    types1 = count_types(graph1)
    types2 = count_types(graph2)
    
    # 计算各类型的相似度
    all_types = set(types1.keys()) | set(types2.keys())
    type_similarities = {}
    
    for t in all_types:
        c1 = types1.get(t, 0)
        c2 = types2.get(t, 0)
        if c1 == 0 and c2 == 0:
            type_similarities[t] = 100.0
        else:
            type_similarities[t] = min(c1, c2) / max(c1, c2) * 100
    
    return type_similarities


def find_common_subgraph(graph1: nx.Graph, graph2: nx.Graph) -> nx.Graph:
    """
    查找两个图的公共子图
    
    Args:
        graph1: 第一个图
        graph2: 第二个图
        
    Returns:
        公共子图
    """
    # 使用节点和边的交集
    common_nodes = set(graph1.nodes()) & set(graph2.nodes())
    
    common = nx.Graph()
    
    for node in common_nodes:
        # 检查节点属性是否相同
        data1 = graph1.nodes.get(node, {})
        data2 = graph2.nodes.get(node, {})
        
        if data1.get('type') == data2.get('type'):
            common.add_node(node, **data1)
    
    # 添加公共边
    for node1 in common_nodes:
        for node2 in common_nodes:
            if graph1.has_edge(node1, node2) and graph2.has_edge(node1, node2):
                common.add_edge(node1, node2)
    
    return common


# 测试代码
if __name__ == "__main__":
    # 创建测试图
    G1 = nx.Graph()
    G1.add_node('n1', type='router', label='R1')
    G1.add_node('n2', type='switch', label='SW1')
    G1.add_node('n3', type='pc', label='PC1')
    G1.add_edge('n1', 'n2')
    G1.add_edge('n2', 'n3')
    
    G2 = nx.Graph()
    G2.add_node('n1', type='router', label='R1')
    G2.add_node('n2', type='switch', label='SW2')
    G2.add_node('n3', type='pc', label='PC1')
    G2.add_node('n4', type='pc', label='PC2')
    G2.add_edge('n1', 'n2')
    G2.add_edge('n2', 'n3')
    G2.add_edge('n2', 'n4')
    
    print("测试图同构检测...")
    is_iso = compute_graph_isomorphism(G1, G2)
    print(f"  是否同构: {is_iso}")
    
    print("\n测试图编辑距离...")
    ged, sim = compute_graph_edit_distance(G1, G2)
    print(f"  编辑距离: {ged}")
    print(f"  相似度: {sim:.2f}%")
    
    print("\n测试结构相似度...")
    result = compute_structure_similarity(G1, G2)
    for k, v in result.items():
        print(f"  {k}: {v}")
    
    print("\n测试节点类型比较...")
    type_sims = compare_node_types(G1, G2)
    for t, s in type_sims.items():
        print(f"  {t}: {s:.2f}%")