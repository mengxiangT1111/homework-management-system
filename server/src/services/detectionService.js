/**
 * Detection Service
 * Python 检测微服务调用封装
 */

const axios = require('axios');
const path = require('path');

// 检测服务URL配置
const DETECTION_SERVICE_URL = process.env.DETECTION_SERVICE_URL || 'http://localhost:8000';
const DETECTION_TIMEOUT = parseInt(process.env.DETECTION_TIMEOUT || '60000', 10); // 60秒超时
// 服务间鉴权 token，与 Python 侧 DETECTION_API_TOKEN 共享（未配置时双方使用相同默认值）
const DETECTION_API_TOKEN = process.env.DETECTION_API_TOKEN || 'detection-dev-token';

// 上传目录配置
const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';

// Axios实例
const apiClient = axios.create({
  baseURL: DETECTION_SERVICE_URL,
  timeout: DETECTION_TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
    'X-API-Token': DETECTION_API_TOKEN
  }
});

/**
 * 检测服务封装
 */
const detectionService = {
  /**
   * 执行查重检测
   * @param {Object} params - 检测参数
   * @param {string} params.sourcePath - 源文件路径（建议传 ensureLocalFile 物化后的本地绝对路径，COS 文件 Python 侧无法访问）
   * @param {string[]} params.candidatePaths - 候选文件路径列表
   * @param {number} [params.timeout] - 本次调用超时（毫秒），默认 DETECTION_TIMEOUT
   * @returns {Promise<Object>} 检测结果
   */
  async detect(params) {
    try {
      const response = await apiClient.post('/api/detect', {
        source_path: params.sourcePath,
        candidate_paths: params.candidatePaths,
        assignment_id: params.assignmentId,
        submission_id: params.submissionId
      }, { timeout: params.timeout });

      return response.data;
    } catch (error) {
      if (error.response) {
        // 服务返回错误
        throw new Error(`检测服务错误: ${error.response.data?.detail || error.response.status}`);
      } else if (error.code === 'ECONNREFUSED') {
        // 连接失败
        throw new Error('检测服务未启动，请确保Python服务正在运行');
      } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
        // 超时
        throw new Error('检测超时，请稍后重试');
      }
      throw error;
    }
  },
  
  /**
   * 批量检测（异步）
   * @param {Array} requests - 检测请求列表
   * @returns {Promise<Object>} 任务ID列表
   */
  async batchDetect(requests) {
    try {
      const response = await apiClient.post('/api/batch-detect', requests);
      return response.data;
    } catch (error) {
      throw new Error(`批量检测失败: ${error.message}`);
    }
  },
  
  /**
   * 获取检测结果
   * @param {string} taskId - 任务ID
   * @returns {Promise<Object>} 检测结果
   */
  async getResult(taskId) {
    try {
      const response = await apiClient.get(`/api/result/${taskId}`);
      return response.data;
    } catch (error) {
      throw new Error(`获取结果失败: ${error.message}`);
    }
  },
  
  /**
   * 获取可视化对比图
   * @param {string} sourceFile - 源文件名
   * @param {string} candidateFile - 候选文件名
   * @returns {Promise<Buffer>} 图片Buffer
   */
  async getVisualization(sourceFile, candidateFile) {
    try {
      const response = await apiClient.get(
        `/api/visualization/${encodeURIComponent(sourceFile)}/${encodeURIComponent(candidateFile)}`,
        { responseType: 'arraybuffer' }
      );
      return Buffer.from(response.data);
    } catch (error) {
      throw new Error(`获取可视化图片失败: ${error.message}`);
    }
  },
  
  /**
   * 预览图结构提取结果
   * @param {string} filePath - 文件路径
   * @returns {Promise<Object>} 提取结果
   */
  async previewExtraction(filePath) {
    try {
      const response = await apiClient.post('/api/preview-extraction', null, {
        params: { file_path: filePath }
      });
      return response.data;
    } catch (error) {
      throw new Error(`预览提取失败: ${error.message}`);
    }
  },
  
  /**
   * 健康检查
   * @returns {Promise<boolean>} 服务是否健康
   */
  async healthCheck() {
    try {
      const response = await apiClient.get('/api/health');
      return response.data.status === 'healthy';
    } catch (error) {
      return false;
    }
  },
  
  /**
   * 获取服务状态
   * @returns {Promise<Object|null>} 服务状态信息
   */
  async getServiceStatus() {
    try {
      const response = await apiClient.get('/api/health');
      return response.data;
    } catch (error) {
      return null;
    }
  },
  
  /**
   * 解析文件路径为绝对路径
   * @param {string} relativePath - 相对路径
   * @returns {string} 绝对路径
   */
  resolveFilePath(relativePath) {
    if (path.isAbsolute(relativePath)) {
      return relativePath;
    }
    return path.join(process.cwd(), UPLOAD_DIR, relativePath.replace(/^uploads[\/\\]/, ''));
  }
};

module.exports = detectionService;