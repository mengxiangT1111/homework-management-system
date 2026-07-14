const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/uploadController');
const { auth } = require('../middleware/auth');

router.use(auth);

// 检查已上传分片（断点续传/秒传）
router.get('/check', uploadController.checkChunks);
// 上传单个分片
router.post('/chunk', uploadController.uploadChunk);
// 合并分片
router.post('/merge', uploadController.mergeChunks);
// 普通小文件直传
router.post('/simple', uploadController.simpleUpload);

module.exports = router;
