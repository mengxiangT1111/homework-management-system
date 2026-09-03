const config = require('../config/ai');
const mammoth = require('mammoth');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { safeParseAIResponse, validateAIResult, buildSystemPrompt, buildUserMessage } = require('../utils/aiParser');
const { success, fail } = require('../utils/response');
const { Submission, SubmissionFile, Assignment } = require('../models');
const { isCOSPath, extractCOSKey } = require('../utils/fileStorage').helpers;
const { downloadFromCOS } = require('../config/cos');

// 调用 AI API（带超时和重试）
async function callAIAPI(requestBody) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeout);

  try {
    const response = await fetch(config.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`AI API 返回错误 (${response.status}): ${errBody}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('AI 批改请求超时，请稍后重试');
    }
    throw error;
  }
}

// 带重试的调用
async function callAIWithRetry(requestBody, maxRetries = config.maxRetries) {
  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`[AI 重试] 第 ${attempt + 1} 次重试`);
        requestBody.temperature = 0.1 + attempt * 0.05;
      }
      const raw = await callAIAPI(requestBody);
      return validateAIResult(safeParseAIResponse(raw), requestBody.fullScore);
    } catch (error) {
      lastError = error;
      console.warn(`[AI 错误] 尝试 ${attempt + 1}/${maxRetries + 1} 失败:`, error.message);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

/**
 * AI 智能批改
 * POST /api/ai/grade
 */
exports.aiGrade = async (req, res, next) => {
  try {
    const { grading_criteria, reference_answer, student_answer, submission_id } = req.body;
    const full_score = Number(req.body.full_score);

    if (!full_score || !reference_answer) {
      return fail(res, '缺少必要参数：满分分值、参考答案不能为空', 422);
    }
    if (!Number.isFinite(full_score) || full_score < 1 || full_score > 100) {
      return fail(res, '满分分值需为 1-100 之间的数字', 422);
    }

    // 学生作答：未手动填写时从提交文件自动提取（Word/Txt，兼容 COS 存储）
    let studentText = String(student_answer || '').trim();
    if (!studentText && submission_id) {
      const submission = await Submission.findByPk(Number(submission_id), {
        include: [
          { model: SubmissionFile, as: 'files' },
          { model: Assignment, as: 'assignment', attributes: ['id', 'teacher_id'] }
        ]
      });
      if (!submission) return fail(res, '提交记录不存在', 404);
      if (req.user.role === 'teacher' &&
          submission.assignment && submission.assignment.teacher_id !== req.user.id) {
        return fail(res, '只能批改自己作业的学生提交', 403);
      }
      studentText = await extractSubmissionText(submission);
      if (studentText.trim()) {
        console.log(`[AI 批改] 学生作答已从提交文件自动提取（${studentText.length} 字）`);
      }
    }
    if (!studentText) {
      return fail(res, '学生作答为空：提交文件中无可提取的文本（支持 Word/Txt，图片/PDF 请手动粘贴），或未关联提交记录', 422);
    }

    const requestBody = {
      model: config.model,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: buildUserMessage(full_score, grading_criteria, reference_answer, studentText) }
      ],
      temperature: 0.1,
      max_tokens: 2048,
      response_format: { type: 'json_object' },
      fullScore: full_score // 传递给 validateAIResult
    };

    console.log(`[AI 批改] 教师 ${req.user.real_name}（ID:${req.user.id}）触发 AI 批改`);

    const result = await callAIWithRetry(requestBody);

    // 调用统计（可选，存到日志）
    console.log(`[AI 批改] 完成，得分: ${result.score}/${full_score}`);

    // 满分结果提示教师核对（提示词注入为概率性攻击，单题结果不自动回写，
    // 由教师当场判断；满分是最需要人工确认的区间）
    const isFullScore = Number(result.score) >= full_score;
    return success(res, result, isFullScore
      ? 'AI 批改完成（AI 判定满分，请核对作答内容后再采用，警惕作答中的诱导性文字）'
      : 'AI 批改完成');
  } catch (err) {
    if (err.message && err.message.includes('超时')) {
      return fail(res, 'AI 批改请求超时，请稍后重试', 504);
    }
    if (err.message && err.message.includes('格式异常')) {
      return fail(res, 'AI 批改结果异常，请重试', 502);
    }
    console.error('[AI 批改错误]', err.message);
    next(err);
  }
};

// 读取单个提交文件的文本（本地与 COS 通吃；COS 先下载到临时文件，用后即删）
async function readSubmissionFileText(file) {
  const ext = path.extname(file.original_name || file.file_path).toLowerCase();
  let filePath = file.file_path;
  let tmp = null;
  try {
    if (isCOSPath(filePath)) {
      tmp = path.join(os.tmpdir(), `ai-extract-${Date.now()}-${Math.random().toString(36).slice(2)}${ext || ''}`);
      await downloadFromCOS(extractCOSKey(filePath), tmp);
      filePath = tmp;
    } else {
      filePath = path.join(__dirname, '../../', filePath);
      if (!fs.existsSync(filePath)) return '';
    }
    if (ext === '.txt') {
      return fs.readFileSync(filePath, 'utf-8');
    }
    if (ext === '.docx' || ext === '.doc') {
      try {
        const result = await mammoth.extractRawText({ path: filePath });
        return result.value || '';
      } catch (e) { return ''; }
    }
    // 其他类型（图片/PDF 等）暂不支持文本提取
    return '';
  } finally {
    if (tmp) fs.promises.unlink(tmp).catch(() => {});
  }
}

// 从提交文件中提取文本内容
async function extractSubmissionText(submission) {
  if (!submission || !submission.files || submission.files.length === 0) return '';
  for (const file of submission.files) {
    const text = await readSubmissionFileText(file);
    if (text.trim()) return text;
  }
  return '';
}

// 上传 Word 参考答案并提取文本
exports.uploadReference = async (req, res, next) => {
  try {
    if (!req.file) return fail(res, '请上传 Word 文件', 422);
    try {
      const text = await mammoth.extractRawText({ path: req.file.path });
      // 只回传文件名，不回传服务器绝对路径（路径信息泄露）
      return success(res, { text: text.value, fileName: path.basename(req.file.originalname || '参考答案') }, '解析成功');
    } finally {
      // 临时文件用后即删（内容已提取为文本，磁盘不需要保留）
      fs.promises.unlink(req.file.path).catch(() => {});
    }
  } catch (err) {
    return fail(res, 'Word 文件解析失败，请确认文件格式正确', 422);
  }
};
