const express = require('express');
const router = express.Router();
const assignmentController = require('../controllers/assignmentController');
const { auth, requireRole } = require('../middleware/auth');

router.use(auth);

// 作业列表
router.get('/', assignmentController.listAssignments);
// 作业详情
router.get('/:id', assignmentController.getAssignment);
// 某作业的所有学生提交情况（教师批阅）
router.get('/:id/submissions', requireRole('teacher', 'admin'), assignmentController.listAssignmentSubmissions);
// 未交名单（导出Excel用）
router.get('/:id/unsubmitted', requireRole('teacher', 'admin'), assignmentController.getUnsubmittedList);

// 创建/更新/删除作业（教师/管理员）
router.post('/', requireRole('teacher', 'admin'), assignmentController.createAssignment);
router.put('/:id', requireRole('teacher', 'admin'), assignmentController.updateAssignment);
router.delete('/:id', requireRole('teacher', 'admin'), assignmentController.deleteAssignment);

module.exports = router;
