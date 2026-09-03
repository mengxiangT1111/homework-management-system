const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/uploadController');
const { auth } = require('../middleware/auth');
const { chunkLimiter, uploadLimiter } = require('../middleware/rateLimit');

router.use(auth);

// 检查已上传分片（断点续传/秒传）
router.get('/check', uploadController.checkChunks);
// 上传单个分片
router.post('/chunk', chunkLimiter, uploadController.uploadChunk);
// 合并分片
router.post('/merge', uploadLimiter, uploadController.mergeChunks);
// 普通小文件直传
router.post('/simple', uploadLimiter, uploadController.simpleUpload);
// 小程序端单文件直传（上限 100MB）
router.post('/single', uploadLimiter, uploadController.singleUpload);

module.exports = router;
