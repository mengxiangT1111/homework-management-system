/**
 * 任务待办控制器
 *
 * 权限模型（与既有业务范式对齐）：
 * - 发布：教师（限该班班主任/任课教师）或学委（本班 commissary），见 middleware/todoPublisher.js
 * - 管理（编辑/删除/进度/催办）：仅发布者本人（created_by 范式，同班委代发作业）
 * - 学生：只看/只完成本班待办，完成记录只能影响自己
 */
const { Op } = require('sequelize');
const {
  sequelize, Todo, TodoCompletion, Class, Course, User, ClassStudent, Notification
} = require('../models');
const { success, fail, paginate, normalizePage } = require('../utils/response');
const { formatCST } = require('../utils/formatCST');
const { isValidFutureDate } = require('./assignmentController');
const { resolvePublisherIdentity } = require('../middleware/todoPublisher');

const TITLE_MAX = 100;
const CONTENT_MAX = 2000;
const TODO_STATUS_LIST = ['active', 'closed'];
// 列表 status 筛选合法值：active/closed/all（非法值回退 active）
const STATUS_FILTER_LIST = ['active', 'closed', 'all'];

// 校验并清洗待办输入（发布与编辑共用）；返回 { ok, data }，data 仅含白名单字段
// partial=true 时只校验请求中出现的字段（编辑可只改状态/只改标题）。
// requireFuture 仅发布时要求截止晚于当前；编辑允许保留原(已过期的)截止时间
function sanitizeTodoInput({ title, content, due_date }, { partial = false, requireFuture = true } = {}) {
  const data = {};
  if (title !== undefined || !partial) {
    const t = title ? String(title).trim() : '';
    if (!t) return { ok: false, msg: '待办标题不能为空' };
    if (t.length > TITLE_MAX) return { ok: false, msg: `标题不能超过 ${TITLE_MAX} 字` };
    data.title = t;
  }
  if (content !== undefined || !partial) {
    data.content = content ? String(content).slice(0, CONTENT_MAX) : null;
  }
  if (due_date !== undefined || !partial) {
    if (due_date) {
      const d = new Date(due_date);
      if (isNaN(d.getTime())) return { ok: false, msg: '截止时间格式无效' };
      if (requireFuture && !isValidFutureDate(due_date)) {
        return { ok: false, msg: '截止时间必须晚于当前时间' };
      }
    }
    data.due_date = due_date || null;
  }
  return { ok: true, data };
}

// 查询某班全部在读学生（含 id，供群发通知/名单用）
function findClassStudentIds(classId) {
  return User.findAll({
    include: [{
      model: Class, as: 'classes',
      where: { id: classId },
      through: { attributes: [] }, required: true
    }],
    attributes: ['id']
  });
}

// 待办列表：学生=本班待办（含我的完成状态）；教师=我发布的待办（可选按班筛选）
exports.myTodos = async (req, res, next) => {
  try {
    const { page, pageSize } = normalizePage(req.query);
    const statusFilter = STATUS_FILTER_LIST.includes(req.query.status) ? req.query.status : 'active';
    const where = {};
    if (statusFilter !== 'all') where.status = statusFilter;

    if (req.user.role === 'student') {
      // 学生只属于一个班（uniq_student_one_class）
      const mine = await ClassStudent.findOne({ where: { student_id: req.user.id } });
      if (!mine) return paginate(res, [], 0, page, pageSize);
      where.class_id = mine.class_id;
    } else if (req.user.role === 'teacher') {
      where.created_by = req.user.id;
      if (req.query.class_id) where.class_id = Number(req.query.class_id);
    } else {
      return fail(res, '暂不支持该角色查看待办', 403);
    }

    const { rows, count } = await Todo.findAndCountAll({
      where,
      include: [
        { model: Class, as: 'class', attributes: ['id', 'name', 'grade'] },
        { model: User, as: 'creator', attributes: ['id', 'real_name', 'role'] }
      ],
      order: [['created_at', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
      distinct: true
    });

    // 聚合补充：完成数 / 班级人数 / 我的完成状态（一到两次查询替代逐行查询，避免 N+1）
    const rowIds = rows.map(t => t.id);
    let myMap = new Map();
    let cntMap = new Map();
    let sizeMap = new Map();
    if (rowIds.length > 0) {
      const completions = await TodoCompletion.findAll({
        where: { todo_id: { [Op.in]: rowIds } },
        attributes: ['todo_id', 'student_id', 'completed_at']
      });
      const cnt = {};
      for (const c of completions) {
        cnt[c.todo_id] = (cnt[c.todo_id] || 0) + 1;
        if (req.user.role === 'student' && c.student_id === req.user.id) {
          myMap.set(c.todo_id, c.completed_at);
        }
      }
      cntMap = new Map(Object.entries(cnt).map(([k, v]) => [Number(k), v]));
      const classIds = [...new Set(rows.map(t => t.class_id))];
      const sizeRows = await ClassStudent.findAll({
        where: { class_id: { [Op.in]: classIds } },
        attributes: ['class_id', [sequelize.fn('COUNT', sequelize.col('id')), 'cnt']],
        group: 'class_id'
      });
      sizeMap = new Map(sizeRows.map(r => [r.class_id, Number(r.get('cnt'))]));
    }

    const result = rows.map(t => {
      const item = t.toJSON();
      item.is_mine = t.created_by === req.user.id;
      item.completed_count = cntMap.get(t.id) || 0;
      item.class_size = sizeMap.get(t.class_id) || 0;
      item.is_overdue = !!(t.due_date && t.status === 'active' && new Date() > new Date(t.due_date));
      if (req.user.role === 'student') {
        item.my_completion = myMap.has(t.id) ? { completed_at: myMap.get(t.id) } : null;
      }
      return item;
    });
    return paginate(res, result, count, page, pageSize);
  } catch (err) {
    next(err);
  }
};

// 发布待办（权限已由 requireTodoPublisher 校验：教师=班主任/任课，学委=本班 commissary）
exports.create = async (req, res, next) => {
  try {
    const classId = req.todoPublisher.classId;
    const cleaned = sanitizeTodoInput(req.body, { partial: false });
    if (!cleaned.ok) return fail(res, cleaned.msg, 422);

    const todo = await Todo.create({
      class_id: classId,
      ...cleaned.data,
      status: 'active',
      created_by: req.user.id,
      creator_identity: req.todoPublisher.identity
    });

    // 群发通知给本班学生（不含发布者本人）。type 用 'system'：
    // 'deadline' 被定时任务按 type+related_id 去重占用，手动通知不可挪用
    try {
      const students = await findClassStudentIds(classId);
      const ids = students.map(s => s.id).filter(id => id !== req.user.id);
      if (ids.length > 0) {
        const identity = req.todoPublisher.identity;
        await Notification.bulkCreate(ids.map(uid => ({
          user_id: uid,
          title: `新任务待办：${todo.title}`,
          content: `${identity}${req.user.real_name}发布了新待办「${todo.title}」` +
            (todo.due_date ? `，请在 ${formatCST(todo.due_date)} 前完成` : '，请及时查看完成'),
          type: 'system',
          related_id: todo.id
        })));
      }
    } catch (e) {
      // 通知失败不影响发布主流程（待办已落库）
      console.error('待办发布通知发送失败:', e.message);
    }
    return success(res, todo, '待办发布成功', 201);
  } catch (err) {
    next(err);
  }
};

// 编辑待办（仅发布者本人，loadOwnedTodo 已校验）
exports.update = async (req, res, next) => {
  try {
    const todo = req.todo;
    if (req.body.status !== undefined && !TODO_STATUS_LIST.includes(req.body.status)) {
      return fail(res, '无效的待办状态', 422);
    }
    const cleaned = sanitizeTodoInput(req.body, { partial: true, requireFuture: false });
    if (!cleaned.ok) return fail(res, cleaned.msg, 422);
    Object.assign(todo, cleaned.data);
    if (req.body.status !== undefined) todo.status = req.body.status;
    await todo.save();
    return success(res, todo, '待办已更新');
  } catch (err) {
    next(err);
  }
};

// 删除待办（仅发布者本人；已有完成记录时引导改用"结束"，保留完成历史）
exports.remove = async (req, res, next) => {
  try {
    const todo = req.todo;
    const cnt = await TodoCompletion.count({ where: { todo_id: todo.id } });
    if (cnt > 0) {
      return fail(res, `该待办已有 ${cnt} 条完成记录，建议改为"结束"状态而非删除`, 422);
    }
    await todo.destroy();
    return success(res, null, '待办已删除');
  } catch (err) {
    next(err);
  }
};

// 完成进度（仅发布者本人；只统计当前在读的本班学生，退班学生不计）
exports.progress = async (req, res, next) => {
  try {
    const todo = req.todo;
    const members = await User.findAll({
      include: [{
        model: Class, as: 'classes',
        where: { id: todo.class_id },
        through: { attributes: [] }, required: true
      }],
      attributes: ['id', 'real_name', 'username'],
      order: [['real_name', 'ASC']]
    });
    const completions = await TodoCompletion.findAll({
      where: { todo_id: todo.id },
      attributes: ['student_id', 'completed_at']
    });
    const cMap = new Map(completions.map(c => [c.student_id, c.completed_at]));
    const completed = [];
    const uncompleted = [];
    for (const m of members) {
      if (cMap.has(m.id)) {
        completed.push({ id: m.id, real_name: m.real_name, username: m.username, completed_at: cMap.get(m.id) });
      } else {
        uncompleted.push({ id: m.id, real_name: m.real_name, username: m.username });
      }
    }
    return success(res, {
      todo_id: todo.id,
      title: todo.title,
      status: todo.status,
      total: members.length,
      completed_count: completed.length,
      uncompleted_count: uncompleted.length,
      complete_rate: members.length > 0 ? Math.round((completed.length / members.length) * 100) : 0,
      completed,
      uncompleted
    }, '获取成功');
  } catch (err) {
    next(err);
  }
};

// 催办未完成同学（仅发布者本人；1 小时内已收到该待办通知的不重复发送，防连点轰炸）
exports.remind = async (req, res, next) => {
  try {
    const todo = req.todo;
    if (todo.status !== 'active') return fail(res, '待办已结束，无需催办', 422);

    const members = await findClassStudentIds(todo.class_id);
    const completedSet = new Set(
      (await TodoCompletion.findAll({
        where: { todo_id: todo.id }, attributes: ['student_id']
      })).map(c => c.student_id)
    );
    const uncompleted = members.filter(m => !completedSet.has(m.id) && m.id !== req.user.id);
    if (uncompleted.length === 0) {
      return success(res, { reminded: 0, skipped: 0 }, '全员已完成，无需催办');
    }
    // 去重口径：type='system' + related_id=待办ID（发布通知与催办共用，
    // 即发布后 1 小时内不会立刻再轰炸一轮）
    const recent = await Notification.findAll({
      where: {
        type: 'system',
        related_id: todo.id,
        user_id: { [Op.in]: uncompleted.map(s => s.id) },
        created_at: { [Op.gt]: new Date(Date.now() - 60 * 60 * 1000) }
      },
      attributes: ['user_id']
    });
    const recentSet = new Set(recent.map(n => n.user_id));
    const toRemind = uncompleted.filter(s => !recentSet.has(s.id));
    if (toRemind.length === 0) {
      return success(res, { reminded: 0, skipped: uncompleted.length }, '1 小时内已通知过，未重复发送');
    }
    // 催办署名与发布同源（老师/班长/学委/课代表）；若发布后职务被撤销则退化为通用称呼
    const resolved = await resolvePublisherIdentity(req.user, todo.class_id);
    const identity = (resolved && resolved.identity) || (req.user.role === 'teacher' ? '老师' : '同学');
    await Notification.bulkCreate(toRemind.map(stu => ({
      user_id: stu.id,
      title: '待办提醒',
      content: `${identity}${req.user.real_name}提醒你：待办「${todo.title}」尚未完成` +
        (todo.due_date ? `，截止 ${formatCST(todo.due_date)}` : '') + '，请尽快处理！',
      type: 'system',
      related_id: todo.id
    })));
    const skipped = uncompleted.length - toRemind.length;
    return success(res, { reminded: toRemind.length, skipped },
      `已提醒 ${toRemind.length} 名同学${skipped > 0 ? `（${skipped} 人 1 小时内已通知过，跳过）` : ''}`);
  } catch (err) {
    next(err);
  }
};

// 学生：标记完成（只能完成本班、进行中的待办；幂等）
exports.complete = async (req, res, next) => {
  try {
    const todo = await Todo.findByPk(req.params.id);
    if (!todo) return fail(res, '待办不存在', 404);
    const inClass = await ClassStudent.findOne({
      where: { class_id: todo.class_id, student_id: req.user.id }
    });
    if (!inClass) return fail(res, '该待办不属于你所在的班级', 403);
    if (todo.status !== 'active') return fail(res, '待办已结束，无法标记完成', 422);
    const [row] = await TodoCompletion.findOrCreate({
      where: { todo_id: todo.id, student_id: req.user.id },
      defaults: { completed_at: new Date() }
    });
    return success(res, { todo_id: todo.id, completed_at: row.completed_at }, '已完成');
  } catch (err) {
    next(err);
  }
};

// 学生：取消完成（destroy 限定 todo_id + 本人，越权无从谈起）
exports.uncomplete = async (req, res, next) => {
  try {
    const n = await TodoCompletion.destroy({
      where: { todo_id: req.params.id, student_id: req.user.id }
    });
    return success(res, { removed: n }, n > 0 ? '已取消完成' : '当前未标记完成');
  } catch (err) {
    next(err);
  }
};

// 教师：我可发布待办的班级（班主任的班 + 任课的班）
exports.teacherClasses = async (req, res, next) => {
  try {
    const head = await Class.findAll({
      where: { teacher_id: req.user.id },
      attributes: ['id', 'name', 'grade']
    });
    const headIds = new Set(head.map(c => c.id));
    const teachingCourses = await Course.findAll({
      where: { teacher_id: req.user.id },
      attributes: ['class_id']
    });
    const teachingClassIds = [...new Set(teachingCourses.map(c => c.class_id))]
      .filter(id => !headIds.has(id));
    const teaching = teachingClassIds.length > 0
      ? await Class.findAll({ where: { id: { [Op.in]: teachingClassIds } }, attributes: ['id', 'name', 'grade'] })
      : [];
    const list = [...head, ...teaching];
    list.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-CN'));
    return success(res, list, '获取成功');
  } catch (err) {
    next(err);
  }
};
