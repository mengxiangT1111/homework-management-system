const { Op } = require('sequelize');
const { formatCST } = require('../utils/formatCST');
const { Notification, Assignment, Course, ClassStudent, Submission } = require('../models');
const { success, fail, paginate, normalizePage } = require('../utils/response');

// 我的通知列表（分页）
exports.myNotifications = async (req, res, next) => {
  try {
    const { is_read, type } = req.query;
    const { page, pageSize } = normalizePage(req.query);
    const where = { user_id: req.user.id };
    // is_read 只接受 '0'/'1'：此前 Number('true') === NaN 直接进 where，
    // Sequelize 生成非法条件报 500
    if (is_read !== undefined && is_read !== '') {
      if (is_read === '0' || is_read === 0) where.is_read = 0;
      else if (is_read === '1' || is_read === 1) where.is_read = 1;
      else return fail(res, 'is_read 参数只接受 0 或 1', 422);
    }
    if (type) where.type = type;

    const { rows, count } = await Notification.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize
    });
    return paginate(res, rows, count, page, pageSize);
  } catch (err) {
    next(err);
  }
};

// 未读数量
exports.unreadCount = async (req, res, next) => {
  try {
    const count = await Notification.count({
      where: { user_id: req.user.id, is_read: 0 }
    });
    return success(res, { count }, '获取成功');
  } catch (err) {
    next(err);
  }
};

// 标记单条已读
exports.markRead = async (req, res, next) => {
  try {
    const n = await Notification.findOne({
      where: { id: req.params.id, user_id: req.user.id }
    });
    if (!n) return fail(res, '通知不存在', 404);
    await n.update({ is_read: 1 });
    return success(res, null, '已标记为已读');
  } catch (err) {
    next(err);
  }
};

// 标记全部已读
exports.markAllRead = async (req, res, next) => {
  try {
    await Notification.update(
      { is_read: 1 },
      { where: { user_id: req.user.id, is_read: 0 } }
    );
    return success(res, null, '全部已标记为已读');
  } catch (err) {
    next(err);
  }
};

// 删除通知
exports.deleteNotification = async (req, res, next) => {
  try {
    const n = await Notification.findOne({
      where: { id: req.params.id, user_id: req.user.id }
    });
    if (!n) return fail(res, '通知不存在', 404);
    // 系统截止提醒不可删：定时任务靠"该通知行是否存在"去重，
    // 删掉后下一轮扫描会重新生成，循环往复
    if (n.type === 'deadline') {
      return fail(res, '截止提醒为系统去重依据，不支持删除（可标记已读）', 422);
    }
    await n.destroy();
    return success(res, null, '已删除');
  } catch (err) {
    next(err);
  }
};

/**
 * 为所有学生扫描即将截止的作业并生成通知（由定时任务调用）
 * 已发送过的不再重复（靠 related_id + type 去重）
 */
exports.generateDeadlineReminders = async function () {
  try {
    const now = new Date();
    const within24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const assignments = await Assignment.findAll({
      where: {
        deadline: { [Op.gt]: now, [Op.lte]: within24h },
        status: 'active'
      },
      include: [{ model: Course, as: 'course' }]
    });
    const valid = assignments.filter(a => a.course);
    if (valid.length === 0) return 0;

    // 一次取齐班级学生、相关提交、已发送的 deadline 通知，内存判断，避免逐作业逐学生的 N+1
    const classIds = [...new Set(valid.map(a => a.course.class_id))];
    const assignmentIds = valid.map(a => a.id);
    const [classStudents, submissions, sentNotifications] = await Promise.all([
      ClassStudent.findAll({
        where: { class_id: { [Op.in]: classIds } },
        attributes: ['class_id', 'student_id']
      }),
      Submission.findAll({
        where: { assignment_id: { [Op.in]: assignmentIds } },
        attributes: ['assignment_id', 'student_id']
      }),
      Notification.findAll({
        where: { type: 'deadline', related_id: { [Op.in]: assignmentIds } },
        attributes: ['user_id', 'related_id']
      })
    ]);

    const studentsByClass = new Map();
    for (const cs of classStudents) {
      if (!studentsByClass.has(cs.class_id)) studentsByClass.set(cs.class_id, []);
      studentsByClass.get(cs.class_id).push(cs.student_id);
    }
    const submittedSet = new Set(submissions.map(s => `${s.assignment_id}_${s.student_id}`));
    const notifiedSet = new Set(sentNotifications.map(n => `${n.related_id}_${n.user_id}`));

    const toCreate = [];
    for (const a of valid) {
      const students = studentsByClass.get(a.course.class_id) || [];
      for (const studentId of students) {
        if (submittedSet.has(`${a.id}_${studentId}`)) continue;
        if (notifiedSet.has(`${a.id}_${studentId}`)) continue;
        toCreate.push({
          user_id: studentId,
          title: '作业即将截止',
          content: `作业「${a.title}」将于 ${formatCST(a.deadline)} 截止，请尽快提交！`,
          type: 'deadline',
          related_id: a.id
        });
      }
    }
    let created = 0;
    if (toCreate.length > 0) {
      await Notification.bulkCreate(toCreate);
      created = toCreate.length;
      console.log(`[通知] 生成 ${created} 条截止提醒`);
    }
    return created;
  } catch (err) {
    console.error('[通知] 生成截止提醒失败:', err.message);
    return 0;
  }
};
