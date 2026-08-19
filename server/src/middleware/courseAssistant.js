const { CourseAssistant } = require('../models');

/**
 * 校验当前用户是否是某门课程的课代表
 * 通过 ?course_id= 参数或 body.course_id 指定课程
 * 将权限信息挂到 req.courseAssistant
 */
async function requireCourseAssistant(req, res, next) {
  try {
    const courseId = Number(req.query.course_id || req.body.course_id);
    if (!courseId) {
      return res.status(422).json({ code: 422, success: false, message: '请指定课程 course_id', data: null });
    }
    const record = await CourseAssistant.findOne({
      where: { course_id: courseId, student_id: req.user.id }
    });
    if (!record) {
      return res.status(403).json({ code: 403, success: false, message: '权限不足：仅本课程课代表可操作', data: null });
    }
    req.courseAssistant = { courseId };
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireCourseAssistant };
