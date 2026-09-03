const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const fileController = require('../controllers/fileController');
const { verifyTicket } = require('../utils/downloadTicket');

// 预览/下载支持两种鉴权：
// 1) Authorization 头（正常 API 调用）；
// 2) ?st=<短时效票据>（iframe/img/video 标签无法带 Authorization 头）。
//    票据由 POST /api/files/urls 在归属校验通过后签发，与 path 绑定、10 分钟过期，
//    即使进入日志/浏览器历史，泄露窗口与可冒用面都远小于原先放在 URL 里的 7 天 JWT。
// 旧的 ?token=（完整 JWT 走 URL）已移除。
router.get('/download', (req, res, next) => {
  const st = req.query.st;
  if (st && !req.headers.authorization) {
    const p = String(req.query.path || '');
    if (verifyTicket(p, String(st))) {
      req.ticketAuthorized = true; // 票据签发前已做归属校验，download 内不再重复查库
      return fileController.download(req, res, next);
    }
    return res.status(401).json({ code: 401, success: false, message: '下载凭证无效或已过期，请刷新页面重试', data: null });
  }
  next();
}, auth, fileController.download);

// 批量获取文件访问URL（Header 鉴权）
router.use(auth);
router.post('/urls', fileController.resolveUrls);

module.exports = router;
