const express = require('express');
const router = express.Router();
const operationLogController = require('../controllers/operationLogController');
const { auth, requireRole } = require('../middleware/auth');

// 操作审计日志仅管理员可见
router.use(auth, requireRole('admin'));

router.get('/', operationLogController.list);
router.get('/meta', operationLogController.meta);
router.post('/cleanup', operationLogController.cleanup);

module.exports = router;
