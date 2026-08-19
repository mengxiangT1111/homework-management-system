"""
Image Preprocessor Module
图像预处理模块 - 提供图像加载、预处理、边缘检测、感知哈希计算等功能
"""

import cv2
import numpy as np
from PIL import Image
import imagehash
from typing import Tuple, Optional


def load_image(path: str) -> Tuple[np.ndarray, np.ndarray]:
    """
    加载图像并返回BGR格式和灰度格式
    
    支持 RGBA PNG 等 OpenCV 无法直接读取的格式
    
    Args:
        path: 图像文件路径
        
    Returns:
        (bgr_image, gray_image): BGR图像和灰度图像
    """
    # 先用 PIL 读取（支持 RGBA 等格式）
    try:
        pil_img = Image.open(path).convert('RGB')
        img = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)
    except Exception as e:
        # 回退到 OpenCV 直接读取
        img = cv2.imread(path)
        if img is None:
            raise ValueError(f"无法加载图像: {path}")
    
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return img, gray


def preprocess(gray: np.ndarray, 
               blur_kernel: Tuple[int, int] = (5, 5),
               denoise: bool = True) -> np.ndarray:
    """
    图像预处理：去噪、直方图均衡化
    
    Args:
        gray: 灰度图像
        blur_kernel: 高斯模糊核大小
        denoise: 是否进行去噪
        
    Returns:
        预处理后的图像
    """
    processed = gray.copy()
    
    # 高斯去噪
    if denoise:
        processed = cv2.GaussianBlur(processed, blur_kernel, 0)
    
    # 直方图均衡化
    processed = cv2.equalizeHist(processed)
    
    return processed


def binarize(gray: np.ndarray, 
             method: str = 'adaptive',
             block_size: int = 11,
             c: int = 2) -> np.ndarray:
    """
    图像二值化
    
    Args:
        gray: 灰度图像
        method: 二值化方法 ('adaptive', 'otsu', 'simple')
        block_size: 自适应阈值块大小
        c: 自适应阈值常数
        
    Returns:
        二值化图像
    """
    if method == 'adaptive':
        # 自适应阈值二值化
        binary = cv2.adaptiveThreshold(
            gray, 255, 
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C, 
            cv2.THRESH_BINARY_INV,
            block_size, c
        )
    elif method == 'otsu':
        # Otsu阈值
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    else:
        # 简单阈值
        _, binary = cv2.threshold(gray, 127, 255, cv2.THRESH_BINARY_INV)
    
    return binary


def detect_edges(gray: np.ndarray,
                 low_threshold: int = 50,
                 high_threshold: int = 150,
                 use_canny: bool = True) -> np.ndarray:
    """
    边缘检测
    
    Args:
        gray: 灰度图像
        low_threshold: Canny低阈值
        high_threshold: Canny高阈值
        use_canny: 是否使用Canny边缘检测
        
    Returns:
        边缘图像
    """
    if use_canny:
        edges = cv2.Canny(gray, low_threshold, high_threshold)
    else:
        # 使用Sobel算子
        sobelx = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
        sobely = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
        edges = np.uint8(np.sqrt(sobelx**2 + sobely**2))
    
    return edges


def compute_phash(image_path: str, hash_size: int = 16) -> str:
    """
    计算图像的感知哈希(pHash)
    
    Args:
        image_path: 图像文件路径
        hash_size: 哈希大小
        
    Returns:
        哈希字符串
    """
    img = Image.open(image_path)
    h = imagehash.phash(img, hash_size=hash_size)
    return str(h)


def compute_dhash(image_path: str, hash_size: int = 8) -> str:
    """
    计算图像的差异哈希(dHash)
    
    Args:
        image_path: 图像文件路径
        hash_size: 哈希大小
        
    Returns:
        哈希字符串
    """
    img = Image.open(image_path)
    h = imagehash.dhash(img, hash_size=hash_size)
    return str(h)


def hamming_distance(hash1: str, hash2: str) -> int:
    """
    计算两个哈希之间的汉明距离
    
    Args:
        hash1: 第一个哈希字符串
        hash2: 第二个哈希字符串
        
    Returns:
        汉明距离
    """
    if len(hash1) != len(hash2):
        raise ValueError("哈希长度不一致")
    
    return sum(c1 != c2 for c1, c2 in zip(hash1, hash2))


def phash_similarity(image_path1: str, image_path2: str) -> float:
    """
    计算两张图像的pHash相似度
    
    Args:
        image_path1: 第一张图像路径
        image_path2: 第二张图像路径
        
    Returns:
        相似度 (0-100)
    """
    hash1 = compute_phash(image_path1)
    hash2 = compute_phash(image_path2)
    
    distance = hamming_distance(hash1, hash2)
    max_distance = len(hash1)  # 最大汉明距离等于哈希长度
    
    # 转换为相似度
    similarity = (1 - distance / max_distance) * 100
    return similarity


def enhance_contrast(gray: np.ndarray) -> np.ndarray:
    """
    增强图像对比度 (CLAHE)
    
    Args:
        gray: 灰度图像
        
    Returns:
        增强后的图像
    """
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)
    return enhanced


def morphological_cleanup(binary: np.ndarray,
                          operation: str = 'close',
                          kernel_size: int = 3) -> np.ndarray:
    """
    形态学清理
    
    Args:
        binary: 二值图像
        operation: 操作类型 ('open', 'close', 'dilate', 'erode')
        kernel_size: 核大小
        
    Returns:
        清理后的图像
    """
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (kernel_size, kernel_size))
    
    if operation == 'open':
        result = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)
    elif operation == 'close':
        result = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)
    elif operation == 'dilate':
        result = cv2.dilate(binary, kernel, iterations=1)
    elif operation == 'erode':
        result = cv2.erode(binary, kernel, iterations=1)
    else:
        result = binary
    
    return result


def resize_image(image: np.ndarray, 
                 max_width: int = 800,
                 max_height: int = 600,
                 keep_aspect: bool = True) -> np.ndarray:
    """
    调整图像大小
    
    Args:
        image: 输入图像
        max_width: 最大宽度
        max_height: 最大高度
        keep_aspect: 是否保持宽高比
        
    Returns:
        调整后的图像
    """
    h, w = image.shape[:2]
    
    if keep_aspect:
        scale = min(max_width / w, max_height / h)
        if scale < 1:
            new_w = int(w * scale)
            new_h = int(h * scale)
            image = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_AREA)
    else:
        image = cv2.resize(image, (max_width, max_height), interpolation=cv2.INTER_AREA)
    
    return image


def compute_phash_pil(img: Image.Image, hash_size: int = 16) -> str:
    """
    计算PIL图像的感知哈希(pHash)
    
    Args:
        img: PIL图像对象
        hash_size: 哈希大小
        
    Returns:
        哈希字符串
    """
    import imagehash
    h = imagehash.phash(img, hash_size=hash_size)
    return str(h)


# 用于测试的主函数
if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1:
        image_path = sys.argv[1]
        print(f"处理图像: {image_path}")
        
        # 加载图像
        img, gray = load_image(image_path)
        print(f"图像大小: {img.shape}")
        
        # 计算pHash
        phash = compute_phash(image_path)
        print(f"pHash: {phash}")
        
        # 预处理
        processed = preprocess(gray)
        
        # 边缘检测
        edges = detect_edges(processed)
        
        # 二值化
        binary = binarize(processed)
        
        print("预处理完成")
