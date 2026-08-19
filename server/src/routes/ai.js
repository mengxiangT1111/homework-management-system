const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const aiGradingController = require('../controllers/aiGradingController');
const { auth } = require('../middleware/auth');

// Word 上传存储配置
const wordStorage = multer.diskStorage({
  destination: path.join(__dirname, '../../uploads/tmp'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `reference_${Date.now()}${ext}`);
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
router.post('/upload-reference', requireTeacher, uploadWord.single('file'), aiGradingController.uploadReference);

// 单题 AI 批改
router.post('/grade', requireTeacher, aiGradingController.aiGrade);

// 批量 AI 批改（一键批改所有未评分学生）
router.post('/batch-grade', requireTeacher, aiGradingController.aiBatchGrade);

module.exports = router;