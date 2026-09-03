/**
 * LLM 统一调用层（OpenAI 兼容接口）
 * - 超时：每次尝试独立 AbortController
 * - 重试：网络错误/超时/429/5xx 按指数退避重试
 * - 降级：主模型连续失败 N 次触发熔断，冷却期内自动切备用模型
 */
const config = require('../../config/ai');

// 熔断器状态（进程内）
const breaker = {
  failStreak: 0,
  openUntil: 0 // 主模型熔断截止时间戳（ms）
};

function makeError(message, { retryable = false, status = 0 } = {}) {
  const e = new Error(message);
  e.isRetryable = retryable;
  e.httpStatus = status;
  return e;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 单次 HTTP 调用（单模型、单次尝试）
async function callOnce(model, { messages, temperature, maxTokens, jsonMode }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeout);
  try {
    const response = await fetch(config.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      const retryable = response.status === 429 || response.status >= 500;
      throw makeError(`LLM API 返回错误 (${response.status}): ${errBody.slice(0, 300)}`, {
        retryable, status: response.status
      });
    }

    const data = await response.json();
    const content = data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content : null;
    if (typeof content !== 'string' || !content.trim()) {
      throw makeError('LLM 返回内容为空', { retryable: true });
    }
    return { content, usage: data.usage || null, model };
  } catch (error) {
    if (error.name === 'AbortError') {
      throw makeError('LLM 请求超时', { retryable: true });
    }
    if (error.isRetryable !== undefined) throw error; // 上面主动构造的
    // fetch 网络层错误（连接拒绝/DNS/断网）
    throw makeError(`LLM 网络错误: ${error.message}`, { retryable: true });
  } finally {
    clearTimeout(timer);
  }
}

// 对单个模型做带重试的调用（指数退避 1s/2s/4s...）
async function callWithRetry(model, params) {
  let lastError = null;
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const started = Date.now();
      const result = await callOnce(model, params);
      result.latencyMs = Date.now() - started;
      return result;
    } catch (error) {
      lastError = error;
      if (!error.isRetryable || attempt === config.maxRetries) throw error;
      const backoff = 1000 * Math.pow(2, attempt);
      console.warn(`[LLM] 模型 ${model} 第 ${attempt + 1} 次失败: ${error.message}，${backoff}ms 后重试`);
      await sleep(backoff);
    }
  }
  throw lastError;
}

/**
 * 主入口：聊天补全（自动主备切换 + 熔断）
 * @returns {{content:string, usage:object|null, model:string, latencyMs:number}}
 */
async function chatCompletion({ messages, temperature = 0.1, maxTokens = 4096, jsonMode = true }) {
  // 快速失败：AI 接口地址/密钥未配置时立刻报配置错误，
  // 而不是带占位值打无效请求后报出难排查的远端错误
  if (!config.apiUrl || !config.apiKey) {
    throw makeError('AI 批改未配置：请在 .env 中设置 AI_API_URL 与 AI_API_KEY', { retryable: false });
  }
  const primary = config.model;
  const fallback = config.fallbackModel || null;
  const primaryTripped = Date.now() < breaker.openUntil;
  // 熔断冷却期内直接先用备用模型；无备用则仍试主模型（半开探测）
  const order = primaryTripped && fallback
    ? [fallback, primary]
    : [primary, ...(fallback ? [fallback] : [])];

  let lastError = null;
  for (const model of order) {
    try {
      const result = await callWithRetry(model, { messages, temperature, maxTokens, jsonMode });
      if (model === primary) {
        breaker.failStreak = 0; // 主模型恢复，复位熔断器
      } else if (primaryTripped) {
        console.log('[LLM] 备用模型承接成功');
      }
      return result;
    } catch (error) {
      lastError = error;
      if (model === primary) {
        breaker.failStreak++;
        if (breaker.failStreak >= config.breaker.threshold) {
          breaker.openUntil = Date.now() + config.breaker.cooldownMs;
          breaker.failStreak = 0;
          console.warn(`[LLM] 主模型连续失败 ${config.breaker.threshold} 次，熔断 ${config.breaker.cooldownMs / 1000}s，期间优先使用备用模型`);
        }
      }
      console.error(`[LLM] 模型 ${model} 最终失败: ${error.message}`);
    }
  }
  throw makeError(`所有模型均调用失败：${lastError ? lastError.message : '未知错误'}`, { retryable: true });
}

module.exports = { chatCompletion };
