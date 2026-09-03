const express = require('express');
const router = express.Router();
const todoController = require('../controllers/todoController');
const { auth, requireRole } = require('../middleware/auth');
const { requireTodoPublisher, loadOwnedTodo } = require('../middleware/todoPublisher');

router.use(auth);

// 静态段路由先于 :id 注册（同 routes/classes.js 的顺序约定，防止被动态段吞掉）
// 教师：我可发布待办的班级（班主任的班 + 任课的班）
router.get('/teacher/classes', requireRole('teacher'), todoController.teacherClasses);

// 列表：学生=本班待办+我的完成状态；教师=我发布的待办
router.get('/', todoController.myTodos);

// 发布：教师（限班主任/任课）、班级负责人（班长/学委）或课代表，权限细节在中间件内
router.post('/', requireRole('teacher', 'student'), requireTodoPublisher, todoController.create);

// 管理操作（编辑/删除/进度/催办）：仅发布者本人（loadOwnedTodo 校验 created_by）
router.put('/:id', requireRole('teacher', 'student'), loadOwnedTodo, todoController.update);
router.delete('/:id', requireRole('teacher', 'student'), loadOwnedTodo, todoController.remove);
router.get('/:id/progress', requireRole('teacher', 'student'), loadOwnedTodo, todoController.progress);
router.post('/:id/remind', requireRole('teacher', 'student'), loadOwnedTodo, todoController.remind);

// 学生完成/取消完成（只能影响自己的完成记录；完成时校验待办属于本班）
router.post('/:id/complete', requireRole('student'), todoController.complete);
router.delete('/:id/complete', requireRole('student'), todoController.uncomplete);

module.exports = router;
