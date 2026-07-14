const express = require('express');
const router = express.Router();
const classController = require('../controllers/classController');
const classLeaderController = require('../controllers/classLeaderController');
const { auth, requireRole } = require('../middleware/auth');
const { requireClassLeader } = require('../middleware/classLeader');

router.use(auth);

// 学生：我的班级
router.get('/my/list', requireRole('student'), classController.myClasses);
// 学生：我的职务
router.get('/my/positions', requireRole('student'), classController.myPositions);
// 学生：加入班级
router.post('/:id/join', requireRole('student'), classController.joinClass);

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
// 设置/修改学生职务（管理员或教师）
router.put('/:id/students/:studentId/position', requireRole('admin', 'teacher'), classController.setStudentPosition);

// 班级负责人专属：作业收集功能（学生在自己负责的班级才能访问）
router.get('/leader/assignments', requireRole('student'), requireClassLeader, classLeaderController.classAssignmentsProgress);
router.get('/leader/assignment/:id/unsubmitted', requireRole('student'), requireClassLeader, classLeaderController.classUnsubmittedStudents);
router.post('/leader/assignment/:id/remind', requireRole('student'), requireClassLeader, classLeaderController.classRemindUnsubmitted);
// 班级负责人：发布作业
router.post('/leader/assignment', requireRole('student'), requireClassLeader, classLeaderController.createClassAssignment);

module.exports = router;

