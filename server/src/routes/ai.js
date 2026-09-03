const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const aiGradingController = require('../controllers/aiGradingController');
const { auth } = require('../middleware/auth');
const { aiLimiter, uploadLimiter } = require('../middleware/rateLimit');

// Word 上传存储配置
const TMP_DIR = path.join(__dirname, '../../uploads/tmp');
// 确保临时目录存在（server.js 只创建 uploads/ 与 uploads/chunks，缺此目录时 multer 落盘直接 ENOENT）
fs.mkdirSync(TMP_DIR, { recursive: true });
const wordStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TMP_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `reference_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
  }
});
const uploadWord = multer({
  storage: wordStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.doc', '.docx'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 .doc / .docx 格式'));
    }
  }
});

// AI 权限校验中间件
function requireTeacher(req, res, next) {
  if (req.user.role !== 'teacher') {
    return res.status(403).json({ code: 403, success: false, message: '权限不足，仅教师可调用 AI 批改功能', data: null });
  }
  next();
}

router.use(auth);

// 上传 Word 参考答案并提取文本
router.post('/upload-reference', requireTeacher, uploadLimiter, uploadWord.single('file'), aiGradingController.uploadReference);

// 单题 AI 批改
router.post('/grade', requireTeacher, aiLimiter, aiGradingController.aiGrade);

// 旧版同步批量批改 /batch-grade 已下线：同步 for 循环逐个调 LLM，请求可挂数分钟，
// 前端超时断开后端仍在写库、易被误判失败而重复触发。批量批改统一走
// POST /api/grading/tasks/batch（模板化 + 异步队列 + 进度轮询 + 人工复核）

module.exports = router;