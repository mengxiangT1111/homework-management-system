const express = require('express');
const router = express.Router();
const courseController = require('../controllers/courseController');
const { auth, requireRole } = require('../middleware/auth');

router.use(auth);

// 教师：我的任课
router.get('/my/teaching', requireRole('teacher'), courseController.myTeachingCourses);
// 所有课程（下拉）
router.get('/all/list', courseController.allCourses);
// 课程列表
router.get('/', courseController.listCourses);
// 课程详情
router.get('/:id', courseController.getCourse);

// 创建/更新/删除（教师或管理员）
router.post('/', requireRole('teacher', 'admin'), courseController.createCourse);
router.put('/:id', requireRole('teacher', 'admin'), courseController.updateCourse);
router.delete('/:id', requireRole('teacher', 'admin'), courseController.deleteCourse);

module.exports = router;
