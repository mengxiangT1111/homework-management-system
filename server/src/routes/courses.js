const express = require('express');
const router = express.Router();
const courseController = require('../controllers/courseController');
const courseAssistantController = require('../controllers/courseAssistantController');
const { auth, requireRole } = require('../middleware/auth');
const { requireCourseAssistant } = require('../middleware/courseAssistant');
const { downloadLimiter } = require('../middleware/rateLimit');

router.use(auth);

// 教师：我的任课
router.get('/my/teaching', requireRole('teacher'), courseController.myTeachingCourses);
// 学生：我的课代表职务
router.get('/my/assistantships', requireRole('student'), courseController.myAssistantships);

// 课代表专属路由（必须在 /:id 动态路由之前，否则会被 /:id 拦截）
router.get('/assistant/assignments', requireRole('student'), requireCourseAssistant, courseAssistantController.assistantAssignmentsProgress);
router.get('/assistant/assignment/:id/unsubmitted', requireRole('student'), requireCourseAssistant, courseAssistantController.assistantUnsubmittedStudents);
router.post('/assistant/assignment/:id/remind', requireRole('student'), requireCourseAssistant, courseAssistantController.assistantRemindUnsubmitted);
router.post('/assistant/assignment', requireRole('student'), requireCourseAssistant, courseAssistantController.assistantCreateAssignment);
router.put('/assistant/assignment/:id', requireRole('student'), requireCourseAssistant, courseAssistantController.assistantUpdateAssignment);
router.delete('/assistant/assignment/:id', requireRole('student'), requireCourseAssistant, courseAssistantController.assistantDeleteAssignment);
router.get('/assistant/assignment/:id/download', requireRole('student'), requireCourseAssistant, downloadLimiter, courseAssistantController.assistantDownloadAll);

// 所有课程（下拉）
router.get('/all/list', courseController.allCourses);
// 课程列表
router.get('/', courseController.listCourses);
// 课程详情
router.get('/:id', courseController.getCourse);

// 课代表管理（任课教师/管理员）
router.get('/:id/assistants', requireRole('teacher', 'admin'), courseController.listAssistants);
router.post('/:id/assistants', requireRole('teacher', 'admin'), courseController.addAssistant);
router.delete('/:id/assistants/:studentId', requireRole('teacher', 'admin'), courseController.removeAssistant);

// 创建/更新/删除（教师或管理员）
router.post('/', requireRole('teacher', 'admin'), courseController.createCourse);
router.put('/:id', requireRole('teacher', 'admin'), courseController.updateCourse);
router.delete('/:id', requireRole('teacher', 'admin'), courseController.deleteCourse);

module.exports = router;
