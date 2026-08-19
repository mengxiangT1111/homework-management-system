const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { resolveUrls } = require('../utils/fileStorage');

router.use(auth);
// 批量获取文件访问URL
router.post('/urls', resolveUrls);

module.exports = router;
