const express = require('express');
const router = express.Router();
const classController = require('../controllers/classController');
const classLeaderController = require('../controllers/classLeaderController');
const { auth, requireRole } = require('../middleware/auth');
const { requireClassLeader } = require('../middleware/classLeader');
const { downloadLimiter } = require('../middleware/rateLimit');

router.use(auth);

// 班级负责人专属路由（必须在 :id 动态路由之前，否则会被 /:id 拦截）
router.get('/leader/assignments', requireRole('student'), requireClassLeader, classLeaderController.classAssignmentsProgress);
router.get('/leader/assignment/:id/unsubmitted', requireRole('student'), requireClassLeader, classLeaderController.classUnsubmittedStudents);
router.post('/leader/assignment/:id/remind', requireRole('student'), requireClassLeader, classLeaderController.classRemindUnsubmitted);
router.post('/leader/assignment', requireRole('student'), requireClassLeader, classLeaderController.createClassAssignment);
router.put('/leader/assignment/:id', requireRole('student'), requireClassLeader, classLeaderController.classUpdateAssignment);
router.delete('/leader/assignment/:id', requireRole('student'), requireClassLeader, classLeaderController.classDeleteAssignment);
router.get('/leader/assignment/:id/download', requireRole('student'), requireClassLeader, downloadLimiter, classLeaderController.classDownloadAll);

// 学生：我的班级
router.get('/my/list', requireRole('student'), classController.myClasses);
// 学生：我的职务
router.get('/my/positions', requireRole('student'), classController.myPositions);
// 学生：加入班级
router.post('/:id/join', requireRole('student'), classController.joinClass);
router.post('/:id/leave', requireRole('student'), classController.leaveClass);

// 班级列表（分页）
router.get('/', classController.listClasses);
// 所有班级（下拉）
router.get('/all/list', classController.allClasses);
// 班级详情
router.get('/:id', classController.getClass);
// 班级学生列表
router.get('/:id/students', classController.getClassStudents);

// 管理员/教师：班级增删改 + 学生分配 + 职务设置
router.post('/', requireRole('admin'), classController.createClass);
router.put('/:id', requireRole('admin'), classController.updateClass);
router.delete('/:id', requireRole('admin'), classController.deleteClass);
router.post('/:id/students', requireRole('admin'), classController.addStudents);
router.delete('/:id/students/:studentId', requireRole('admin'), classController.removeStudent);
router.put('/:id/students/:studentId/position', requireRole('admin', 'teacher'), classController.setStudentPosition);

module.exports = router;

