# -*- coding: utf-8 -*-
"""
双拓扑可视化链路单测：
1. 用 OpenCV 生成两张相似的网络拓扑图（路由器+交换机+PC+连线+文字标签）
2. POST /api/detect 跑真实检测
3. 断言 results[0].details 包含 src_nodes/src_edges/cand_nodes/cand_edges
"""
import os
import json
import cv2
import numpy as np
import urllib.request

OUT = os.path.join(os.path.dirname(__file__), '..', 'uploads', '_topo_test')
os.makedirs(OUT, exist_ok=True)

BG = (245, 250, 248)
LINE = (60, 60, 60)


def draw_node(img, center, radius, color, label):
    cv2.circle(img, center, radius, color, -1)
    cv2.circle(img, center, radius, (40, 40, 40), 2)
    cv2.putText(img, label, (center[0] - radius, center[1] + radius + 18),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, (30, 30, 30), 1)


def make_topology(path, seed_shift=0, similar=True):
    img = np.full((480, 640, 3), BG, dtype=np.uint8)
    # 拓扑：云 —— 路由器 —— 交换机 —— 3 台 PC
    cloud = (100 + seed_shift, 90)
    router = (320, 140)
    switch = (320, 280)
    pcs = [(140 + i * 90 + seed_shift, 410) for i in range(3)]
    for pt in [cloud] + [router] + pcs:
        cv2.line(img, pt, switch if pt in pcs else router, LINE, 3)
    cv2.line(img, cloud, router, LINE, 3)
    for pc in pcs:
        cv2.line(img, pc, switch, LINE, 3)
    draw_node(img, cloud, 26, (186, 127, 179), 'Cloud')
    draw_node(img, router, 24, (60, 60, 245), 'Router-1')
    draw_node(img, switch, 22, (60, 163, 230), 'Switch-1')
    for i, pc in enumerate(pcs):
        draw_node(img, pc, 18, (80, 179, 90), f'PC-{i + 1}')
    if similar:
        cv2.putText(img, '192.168.1.0/24', (240, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (30, 30, 30), 1)
    cv2.imwrite(path, img)


def main():
    src = os.path.join(OUT, 'src.png')
    cand = os.path.join(OUT, 'cand.png')
    make_topology(src)
    make_topology(cand)
    # 两张都加轻微高斯噪声（不同种子）模拟"拍照/重导出"的近似副本：
    # 布局完全一致（phash 距离小，通过初筛进入图结构比对），像素级略有差异
    for path, seed in ((src, 3), (cand, 7)):
        img = cv2.imread(path)
        noise = np.random.default_rng(seed).normal(0, 6, img.shape).astype(np.int16)
        cv2.imwrite(path, np.clip(img.astype(np.int16) + noise, 0, 255).astype(np.uint8))

    token = os.environ.get('DETECTION_API_TOKEN', '')
    req = urllib.request.Request(
        'http://localhost:8000/api/detect',
        data=json.dumps({'source_path': os.path.abspath(src), 'candidate_paths': [os.path.abspath(cand)]}).encode(),
        headers={'Content-Type': 'application/json', 'X-API-Token': token}
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        body = json.load(r)
    item = (body.get('results') or [{}])[0]
    d = item.get('details') or {}
    checks = {
        'details 存在': bool(d),
        'src_nodes 非空': len(d.get('src_nodes') or []) > 0,
        'cand_nodes 非空': len(d.get('cand_nodes') or []) > 0,
        'src_edges 非空(新字段)': len(d.get('src_edges') or []) > 0,
        'cand_edges 非空(新字段)': len(d.get('cand_edges') or []) > 0,
        'common_nodes 有值': d.get('common_nodes') is not None,
        'node_type_similarities 有值': d.get('node_type_similarities') is not None,
    }
    print(f"综合相似度: {item.get('similarity_score')}, 图结构: {item.get('graph_similarity')}, "
          f"src节点: {len(d.get('src_nodes') or [])}, src边: {len(d.get('src_edges') or [])}, "
          f"cand节点: {len(d.get('cand_nodes') or [])}, cand边: {len(d.get('cand_edges') or [])}")
    ok = True
    for name, passed in checks.items():
        print(('  PASS  ' if passed else '  FAIL  ') + name)
        ok = ok and passed
    # 边格式断言
    if d.get('src_edges'):
        e0 = d['src_edges'][0]
        fmt_ok = isinstance(e0, dict) and 'source' in e0 and 'target' in e0
        print(('  PASS  ' if fmt_ok else '  FAIL  ') + '边格式为 {source,target}')
        ok = ok and fmt_ok
    print('RESULT:', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
