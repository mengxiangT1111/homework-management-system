/**
 * AI 批改结果解析与校验
 * 职责：安全解析 LLM 输出 → 按模板对齐维度 → 钳制越界分数 →
 *      服务端计算总分（LLM 不算总分）→ 评估置信度（决定是否进人工复核）
 * 纯函数模块：不依赖数据库，可独立单测。
 */

// 安全解析：直接解析 → 剥 ```json 围栏 → 截取首尾大括号，三重兜底
function safeParseJSON(rawText) {
  const raw = String(rawText || '').replace(/^\uFEFF/, '').trim();
  try { return JSON.parse(raw); } catch (e) { /* 继续尝试 */ }
  try {
    const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) return JSON.parse(m[1].trim());
  } catch (e) { /* 继续尝试 */ }
  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start !== -1 && end > start) return JSON.parse(raw.substring(start, end + 1));
  } catch (e) { /* 全部失败 */ }
  throw new Error('AI 返回格式异常，无法解析为 JSON');
}

const r1 = x => Math.round(x * 10) / 10;

/**
 * 按模板对齐并校验 AI 输出。
 * 容错策略：维度缺失→score=null 并计入 missingCount（触发人工复核）；
 *          分数越界→钳制并计入 clampCount（降低置信度）。
 * @param {object} obj safeParseJSON 的结果
 * @param {object} templateJSON 模板规范JSON（见 template.service.buildTemplateJSON）
 */
function parseGradingOutput(obj, templateJSON) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('AI 输出不是 JSON 对象');
  }
  for (const field of ['dimensions', 'overall_feedback', 'improvement_advice', 'knowledge_errors']) {
    if (obj[field] === undefined || obj[field] === null) {
      throw new Error(`AI 输出缺少必要字段: ${field}`);
    }
  }
  if (!Array.isArray(obj.dimensions)) throw new Error('AI 输出的 dimensions 不是数组');

  const dimensions = [];
  let clampCount = 0;
  let missingCount = 0;

  for (const td of templateJSON.dimensions) {
    // 优先 code 精确匹配（忽略大小写），退化为名称匹配
    const hit = obj.dimensions.find(d =>
      String(d && d.code ? d.code : '').trim().toLowerCase() === td.code.toLowerCase()
    ) || obj.dimensions.find(d => String(d && d.name ? d.name : '').trim() === td.name);

    if (!hit) {
      missingCount++;
      dimensions.push({
        code: td.code, name: td.name, max_score: td.max_score,
        score: null, level: null, evidence: '', deductions: [],
        feedback: '（AI 未返回该维度评分，已标记人工复核）'
      });
      continue;
    }

    // score 缺失/非数字（含 null、undefined、空串、乱码）一律视为"AI 未评分"：
    // 计入 missingCount 触发人工复核，而不是被 Number(null)===0 静默判 0 分
    let score = (hit.score === null || hit.score === undefined || hit.score === '')
      ? NaN
      : Number(hit.score);
    if (!Number.isFinite(score)) {
      missingCount++;
      dimensions.push({
        code: td.code, name: td.name, max_score: td.max_score,
        score: null, level: null, evidence: '', deductions: [],
        feedback: '（AI 未返回该维度有效分数，已标记人工复核）'
      });
      continue;
    }
    if (score < 0) { score = 0; clampCount++; }
    if (score > td.max_score) { score = td.max_score; clampCount++; }

    const deductions = (Array.isArray(hit.deductions) ? hit.deductions : [])
      .map(d => ({
        description: String(d && d.description !== undefined ? d.description : '').slice(0, 200),
        penalty: Number.isFinite(Number(d && d.penalty)) ? Math.max(0, r1(Number(d.penalty))) : 0
      }))
      .filter(d => d.description);

    dimensions.push({
      code: td.code, name: td.name, max_score: td.max_score,
      score: r1(score),
      level: String(hit.level !== undefined && hit.level !== null ? hit.level : '').slice(0, 10),
      evidence: String(hit.evidence !== undefined && hit.evidence !== null ? hit.evidence : '').slice(0, 500),
      deductions,
      feedback: String(hit.feedback !== undefined && hit.feedback !== null ? hit.feedback : '').slice(0, 200)
    });
  }

  const knowledge_errors = Array.isArray(obj.knowledge_errors)
    ? obj.knowledge_errors.map(e => String(e).slice(0, 100)).slice(0, 20)
    : [];

  return {
    dimensions,
    clampCount,
    missingCount,
    overall_feedback: String(obj.overall_feedback).slice(0, 1000),
    improvement_advice: String(obj.improvement_advice).slice(0, 1000),
    knowledge_errors
  };
}

// 总分：服务端权威计算 = Σ维度分，封顶模板满分
function computeTotalScore(dimensions, templateJSON) {
  let total = 0;
  for (const d of dimensions) {
    if (typeof d.score === 'number' && Number.isFinite(d.score)) total += d.score;
  }
  return r1(Math.max(0, Math.min(total, templateJSON.full_score)));
}

/**
 * 置信度评估（启发式，0~1）。每条命中给出中文原因，供复核队列展示。
 */
function evaluateConfidence({ parseRetries = 0, clampCount = 0, missingCount = 0,
                              total = 0, fullScore = 100, answerLength = 0 }) {
  let confidence = 1.0;
  const reasons = [];

  if (parseRetries > 0) { confidence -= 0.15; reasons.push('AI输出格式异常后经重试修复'); }
  if (clampCount > 0) { confidence -= Math.min(0.3, clampCount * 0.10); reasons.push(`有 ${clampCount} 个维度分数越界已钳制`); }
  if (missingCount > 0) { confidence -= missingCount * 0.25; reasons.push(`有 ${missingCount} 个维度AI未评分`); }
  if (fullScore > 0 && (total === 0 || total >= fullScore)) {
    confidence -= 0.10; reasons.push('总分为满分或0分，属异常高发区间');
  }
  if (answerLength > 0 && answerLength < 30) {
    confidence -= 0.20; reasons.push('学生作答过短，批改可信度有限');
  }

  confidence = Math.max(0, Math.min(1, confidence));
  return { confidence: Math.round(confidence * 1000) / 1000, reasons };
}

module.exports = { safeParseJSON, parseGradingOutput, computeTotalScore, evaluateConfidence };
