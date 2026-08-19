// AI 批改配置
const config = {
  apiUrl: process.env.AI_API_URL || 'https://your-new-api.com/v1/chat/completions',
  apiKey: process.env.AI_API_KEY || 'sk-your-api-key',
  model: process.env.AI_MODEL || 'gpt-4o',
  timeout: Number(process.env.AI_TIMEOUT) || 30000,
  maxRetries: Number(process.env.AI_MAX_RETRIES) || 2
};

module.exports = config;
