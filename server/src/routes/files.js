const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const fileController = require('../controllers/fileController');

// 预览/下载需要 token 放 URL query（iframe/img/video 标签无法带 Authorization 头）
router.get('/download', (req, res, next) => {
  if (req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
}, auth, fileController.download);

// 批量获取文件访问URL（Header 鉴权）
router.use(auth);
router.post('/urls', fileController.resolveUrls);

module.exports = router;
