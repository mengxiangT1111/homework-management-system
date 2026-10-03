// AI 批改配置（全部环境变量，禁止硬编码）

// 兼容只配了 base URL 的写法：未带 chat/completions 路径时按 OpenAI 兼容约定自动补全
function normalizeEndpoint(url) {
  if (!url) return url;
  const clean = String(url).replace(/\/+$/, '');
  return /\/chat\/completions$/.test(clean) ? clean : `${clean}/v1/chat/completions`;
}

const config = {
  // 全部显式取环境变量；不再有占位 URL/key 兜底（占位值会掩盖漏配：AI 请求
  // 打向错误地址或带无效 key，报错晚且难排查）。未配置时由 llmClient 快速失败。
  apiUrl: normalizeEndpoint(process.env.AI_API_URL),
  apiKey: process.env.AI_API_KEY,
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
    autoApply: (process.env.GRADING_AUTO_APPLY || '1') === '1',
    // ===== A2 自一致性双评（默认关闭；启用后每份作答 LLM 调用翻倍） =====
    // 同题用更高温度二次批改，两次总分差超过 tau×满分 → 结果不稳定，转人工复核。
    // 标定实验（N=100，GLM4）：该信号在结构化题型上与批改误差分离度好
    // （数学：显著偏差组重复批改极差均值 10.7 vs 正常组 2.0），
    // 而表面启发式置信度近似失效（对显著偏差的 AUC 仅 0.56）
    dualGrade: (process.env.GRADING_DUAL_GRADE || '0') === '1',
    // 双评分差阈值（按满分归一化，0.05 = 满分的 5%）
    dualGradeTau: Number(process.env.GRADING_DUAL_TAU) || 0.05,
    // 双评第二次调用的采样温度（首次固定 0.1；双评需引入采样随机性才有意义）
    dualGradeTemperature: Number(process.env.GRADING_DUAL_TEMPERATURE) || 0.7,
    // ===== L1 查重×批改联动 =====
    // 批改回写前查该提交的查重最高相似度，≥ 此值（百分比）则强制转人工复核，
    // 让教师在复核 AI 分数的同时看到查重证据。设为 0 关闭联动。默认 50（查重可疑线）
    plagiarismReviewThreshold: process.env.GRADING_PLAGIARISM_REVIEW_THRESHOLD === undefined
      || process.env.GRADING_PLAGIARISM_REVIEW_THRESHOLD === ''
      ? 50 : Number(process.env.GRADING_PLAGIARISM_REVIEW_THRESHOLD)
  },
  // 主模型连续失败 N 次触发熔断，冷却期内优先走备用模型
  breaker: {
    threshold: Number(process.env.AI_BREAKER_THRESHOLD) || 3,
    cooldownMs: Number(process.env.AI_BREAKER_COOLDOWN_MS) || 60000
  }
};

module.exports = config;
