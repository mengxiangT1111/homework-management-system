// AI 批改配置（全部环境变量，禁止硬编码）
const config = {
  apiUrl: process.env.AI_API_URL || 'https://your-new-api.com/v1/chat/completions',
  apiKey: process.env.AI_API_KEY || 'sk-your-api-key',
  model: process.env.AI_MODEL || 'gpt-4o',
  // 备用模型（主模型熔断期间降级使用），留空=不降级
  fallbackModel: process.env.AI_MODEL_FALLBACK || '',
  timeout: Number(process.env.AI_TIMEOUT) || 60000,
  maxRetries: Number(process.env.AI_MAX_RETRIES) || 2,
  // ===== AI 批改升级：队列与复核策略 =====
  grading: {
    // 队列 worker 并发数
    concurrency: Number(process.env.GRADING_CONCURRENCY) || 3,
    // 空闲轮询间隔（ms）
    pollInterval: Number(process.env.GRADING_POLL_INTERVAL) || 2000,
    // 任务级最大尝试次数（含首次）
    maxAttempts: Number(process.env.GRADING_MAX_ATTEMPTS) || 3,
    // 置信度低于此值的结果自动进入人工复核
    reviewThreshold: Number(process.env.GRADING_REVIEW_THRESHOLD) || 0.6,
    // 高置信结果是否自动回写 submissions 分数
    autoApply: (process.env.GRADING_AUTO_APPLY || '1') === '1'
  },
  // 主模型连续失败 N 次触发熔断，冷却期内优先走备用模型
  breaker: {
    threshold: Number(process.env.AI_BREAKER_THRESHOLD) || 3,
    cooldownMs: Number(process.env.AI_BREAKER_COOLDOWN_MS) || 60000
  }
};

module.exports = config;
