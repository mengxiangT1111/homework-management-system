/**
 * 任务待办权限中间件
 *
 * 发布权限（requireTodoPublisher）——三类发布者：
 *   1. 教师 —— 必须是该班的班主任，或在该班任课（有课程归属关系，防任意教师向任意班级群发）
 *   2. 班级负责人 —— ClassStudent.position 为 monitor（班长）或 commissary（学委）
 *   3. 课代表 —— 该班任一课程的课代表（CourseAssistant 关联课程属于该班；
 *      课代表的课程归属即班级归属：设置课代表时强制学生属于课程所在班级，
 *      退班/移出班级会级联清理课代表身份，不存在"别班课代表向本班发布"）
 *
 * 管理权限（loadOwnedTodo）：仿照班委代发作业的 created_by 范式，
 * 编辑/删除/查看进度/催办仅限发布者本人。
 */
const { Class, Course, ClassStudent, CourseAssistant, Todo } = require('../models');

function denied(res, message) {
  return res.status(403).json({ code: 403, success: false, message, data: null });
}

/**
 * 解析用户对某班的待办发布身份（发布与催办共用）
 * 返回 '老师' | '班长' | '学委' | '课代表'；无权限返回 null
 * 班级负责人身份优先于课代表（一人多职时按班级职务署名）
 */
async function resolvePublisherIdentity(user, classId) {
  if (user.role === 'teacher') {
    const cls = await Class.findByPk(classId);
    if (!cls) return { err: 404 };
    const isHead = cls.teacher_id === user.id;
    const isTeaching = isHead || await Course.count({
      where: { class_id: classId, teacher_id: user.id }
    }) > 0;
    return isTeaching ? { identity: '老师' } : null;
  }

  if (user.role === 'student') {
    const record = await ClassStudent.findOne({
      where: { class_id: classId, student_id: user.id }
    });
    if (record && record.position === 'monitor') return { identity: '班长' };
    if (record && record.position === 'commissary') return { identity: '学委' };
    // 课代表：其负责的课程属于该班
    const isAssistant = await CourseAssistant.count({
      where: { student_id: user.id },
      include: [{ model: Course, as: 'course', where: { class_id: classId }, attributes: [] }]
    }) > 0;
    return isAssistant ? { identity: '课代表' } : null;
  }

  // 管理员无教学关系，不属于待办发布场景
  return null;
}

async function requireTodoPublisher(req, res, next) {
  try {
    const classId = Number(req.body.class_id || req.query.class_id);
    if (!classId) {
      return res.status(422).json({ code: 422, success: false, message: '请指定班级 class_id', data: null });
    }
    const result = await resolvePublisherIdentity(req.user, classId);
    if (result && result.err === 404) {
      return res.status(404).json({ code: 404, success: false, message: '班级不存在', data: null });
    }
    if (!result) {
      return denied(res, '仅该班教师、班级负责人（班长/学委）或课代表可发布待办');
    }
    req.todoPublisher = { classId, identity: result.identity };
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * 加载 :id 对应待办并校验为本人发布，挂到 req.todo
 * （不存在时已写响应返回 null，controller 需判空返回）
 */
async function loadOwnedTodo(req, res, next) {
  try {
    const todo = await Todo.findByPk(req.params.id);
    if (!todo) {
      res.status(404).json({ code: 404, success: false, message: '待办不存在', data: null });
      return null;
    }
    if (todo.created_by !== req.user.id) {
      res.status(403).json({ code: 403, success: false, message: '仅发布者本人可管理该待办', data: null });
      return null;
    }
    req.todo = todo;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireTodoPublisher, loadOwnedTodo, resolvePublisherIdentity };
