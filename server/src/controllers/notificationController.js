const { Op } = require('sequelize');
const { Notification, Assignment, Course, ClassStudent } = require('../models');
const { success, fail, paginate } = require('../utils/response');

// 我的通知列表（分页）
exports.myNotifications = async (req, res, next) => {
  try {
    const { page = 1, pageSize = 10, is_read, type } = req.query;
    const where = { user_id: req.user.id };
    if (is_read !== undefined && is_read !== '') where.is_read = Number(is_read);
    if (type) where.type = type;

    const { rows, count } = await Notification.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit: Number(pageSize),
      offset: (Number(page) - 1) * Number(pageSize)
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

    let created = 0;
    for (const a of assignments) {
      const students = await ClassStudent.findAll({
        where: { class_id: a.course.class_id },
        attributes: ['student_id']
      });
      for (const cs of students) {
        // 检查是否已提交
        const { Submission } = require('../models');
        const submitted = await Submission.findOne({
          where: { assignment_id: a.id, student_id: cs.student_id }
        });
        if (submitted) continue;

        // 去重：同一作业同一学生只发一次 deadline 提醒
        const exists = await Notification.findOne({
          where: {
            user_id: cs.student_id,
            related_id: a.id,
            type: 'deadline'
          }
        });
        if (exists) continue;

        await Notification.create({
          user_id: cs.student_id,
          title: '作业即将截止',
          content: `作业「${a.title}」将于 ${new Date(a.deadline).toLocaleString('zh-CN')} 截止，请尽快提交！`,
          type: 'deadline',
          related_id: a.id
        });
        created++;
      }
    }
    if (created > 0) console.log(`[通知] 生成 ${created} 条截止提醒`);
    return created;
  } catch (err) {
    console.error('[通知] 生成截止提醒失败:', err.message);
    return 0;
  }
};
