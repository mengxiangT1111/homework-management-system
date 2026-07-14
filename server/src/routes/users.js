const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { auth, requireRole } = require('../middleware/auth');

// 所有接口都需登录
router.use(auth);

// 用户列表（管理员）
router.get('/', requireRole('admin'), userController.listUsers);
// 用户详情
router.get('/:id', requireRole('admin'), userController.getUser);
// 新增教师（管理员）
router.post('/teacher', requireRole('admin'), userController.createTeacher);
// 新增学生（管理员）
router.post('/student', requireRole('admin'), userController.createStudent);
// 重置密码（管理员）
router.put('/:id/password', requireRole('admin'), userController.resetPassword);
// 启用/禁用（管理员）
router.patch('/:id/status', requireRole('admin'), userController.toggleStatus);
// 删除用户（管理员）
router.delete('/:id', requireRole('admin'), userController.deleteUser);
// 教师列表（管理员/教师用）
router.get('/role/teachers', requireRole('admin', 'teacher'), userController.listTeachers);
// 学生列表（管理员用）
router.get('/role/students', requireRole('admin'), userController.listStudents);

module.exports = router;
