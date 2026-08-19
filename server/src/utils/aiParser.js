/**
 * AI 返回结果安全解析器
 */

// 安全解析 AI 返回的 JSON（兼容多余文字、Markdown 代码块等情况）
function safeParseAIResponse(rawText) {
  // 1. 直接解析
  try { return JSON.parse(rawText); } catch (e) { /* 继续 */ }

  // 2. 提取 ```json ... ``` 代码块
  try {
    const m = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) return JSON.parse(m[1].trim());
  } catch (e) { /* 继续 */ }

  // 3. 提取第一个 { ... } 结构
  try {
    const start = rawText.indexOf('{');
    const end = rawText.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      return JSON.parse(rawText.substring(start, end + 1));
    }
  } catch (e) { /* 继续 */ }

  throw new Error('AI 返回格式异常，无法解析');
}

// 校验 AI 输出完整性
function validateAIResult(parsed, fullScore) {
  const required = ['score', 'deduction_reason', 'comment', 'improvement_advice', 'knowledge_errors'];
  for (const field of required) {
    if (parsed[field] === undefined || parsed[field] === null) {
      throw new Error(`AI 输出缺少必要字段: ${field}`);
    }
  }
  if (typeof parsed.score !== 'number' || parsed.score < 0) {
    throw new Error('AI 输出分数格式异常');
  }
  // 分数不超过满分
  if (fullScore && parsed.score > fullScore) {
    parsed.score = fullScore;
  }
  if (!Array.isArray(parsed.knowledge_errors)) {
    parsed.knowledge_errors = [];
  }
  return parsed;
}

// AI System Prompt
function buildSystemPrompt() {
  return `你是一位严谨的作业批改助手，专门负责根据教师提供的评分标准对学生的主观题作答进行自动批改。

## 核心职责
- 严格依据评分标准和参考答案，对学生作答进行客观、公正的评分
- 支持同义表述、不完全匹配但意思正确的表达，不抠字眼
- 知识点错误、遗漏要点要合理扣分，并明确指出错误原因
- 分数区间为 0 到满分，支持 1 位小数

## 输出格式
你必须严格按照以下 JSON 结构输出，不要包含任何额外文字、Markdown 代码块标记、解释说明：

{
  "score": 0.0,
  "deduction_reason": "扣分理由说明，列出每项扣分点",
  "comment": "给学生的一段评语，语气积极、鼓励",
  "improvement_advice": "学习改进建议，指出薄弱环节和提升方向",
  "knowledge_errors": ["知识点错误1", "知识点错误2"]
}

## 评分规则
1. 同义表述算正确：学生用词与参考答案不同但意思一致，视为正确，不扣分
2. 知识点错误扣分：概念性错误、原理理解错误，按评分细则扣分
3. 遗漏要点扣分：评分标准中明确列出的采分点未答出，逐点扣分
4. 部分正确给部分分：答出部分要点，给相应比例分数
5. 分数精确到小数点后 1 位
6. 严禁输出 JSON 以外的任何内容，严禁使用 Markdown 代码块包裹`;
}

// 构建用户消息
function buildUserMessage(fullScore, gradingCriteria, referenceAnswer, studentAnswer) {
  const gradingSection = gradingCriteria
    ? `## 评分细则\n${gradingCriteria}`
    : `## 评分细则\n（未提供，请根据参考答案自动提取要点作为评分标准）`;

  return `请根据以下信息批改学生的主观题作答：

## 满分分值
${fullScore} 分

${gradingSection}

## 参考答案
${referenceAnswer}

## 学生作答
${studentAnswer}

请严格按照评分细则逐项打分，输出结构化 JSON 结果。`;
}

module.exports = { safeParseAIResponse, validateAIResult, buildSystemPrompt, buildUserMessage };
