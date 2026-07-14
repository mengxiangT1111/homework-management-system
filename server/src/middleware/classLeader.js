const { ClassStudent } = require('../models');

/**
 * 校验当前用户是否是某个班级的负责人（班长或学委）
 * 通过 ?class_id= 参数指定班级
 * 将权限信息挂到 req.classLeader
 */
async function requireClassLeader(req, res, next) {
  try {
    const classId = Number(req.query.class_id || req.body.class_id);
    if (!classId) {
      return res.status(422).json({ code: 422, success: false, message: '请指定班级 class_id', data: null });
    }
    const record = await ClassStudent.findOne({
      where: { class_id: classId, student_id: req.user.id }
    });
    if (!record) {
      return res.status(403).json({ code: 403, success: false, message: '你不属于该班级', data: null });
    }
    if (record.position === 'none') {
      return res.status(403).json({ code: 403, success: false, message: '权限不足：仅班级负责人（班长/学委）可操作', data: null });
    }
    req.classLeader = { classId, position: record.position };
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * 查询某学生在某班级的职务（供其他控制器使用）
 */
async function getStudentPosition(studentId, classId) {
  const record = await ClassStudent.findOne({
    where: { student_id: studentId, class_id: classId }
  });
  return record ? record.position : null;
}

module.exports = { requireClassLeader, getStudentPosition };
