/**
 * 操作审计中间件
 *
 * 挂载在 /api 下、所有路由之前，自动记录变更类请求（POST/PUT/PATCH/DELETE）：
 * 谁（用户快照）、何时、做了什么（动作中文名+路由）、对谁（目标ID）、
 * 结果（状态码成败）、从哪（IP/UA）、参数摘要（脱敏+截断）。
 *
 * 设计要点：
 * - 零侵入：不改任何控制器；登录等无 auth 中间件的接口也能记录
 *   （此时 req.user 为空，用请求体里的账号名兜底）
 * - 用户信息在响应完成时读取（auth 中间件此时已把 req.user 挂上）
 * - 写库失败只打日志，绝不影响业务响应
 * - 请求体中的口令/令牌类字段一律替换为 ***，且整体截断，防止敏感信息入库
 * - 高频低价值接口（通知已读、待办完成勾选、分片上传）进入跳过清单，
 *   避免日志噪音把存储堆满
 */
const { recordOperation } = require('../services/operationLog.service');

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MAX_DETAIL = 1000;

// 跳过清单：按 "方法 路由模板" 匹配。纯状态翻转/高频分块接口，审计价值低
const SKIP_ROUTES = new Set([
  'PUT /api/notifications/:id/read',
  'PUT /api/notifications/all/read',
  'POST /api/todos/:id/complete',
  'DELETE /api/todos/:id/complete',
  'POST /api/upload/chunk',
  'POST /api/upload/merge',
  'POST /api/upload/simple',
  'POST /api/upload/single'
]);

// 动作中文名映射：未命中的变更请求仍会记录，标签回退为 "数据变更"
const ACTION_LABELS = {
  'POST /api/auth/login': '登录',
  'POST /api/auth/register': '注册账号',
  'PUT /api/auth/profile': '修改个人信息',
  'PUT /api/auth/password': '修改密码',
  'POST /api/users/teacher': '新增教师账号',
  'POST /api/users/student': '新增学生账号',
  'PUT /api/users/:id/password': '重置用户密码',
  'PATCH /api/users/:id/status': '启用/禁用用户',
  'DELETE /api/users/:id': '删除用户',
  'POST /api/schools': '新增学校',
  'PUT /api/schools/:id': '修改学校',
  'DELETE /api/schools/:id': '删除学校',
  'POST /api/classes': '新增班级',
  'PUT /api/classes/:id': '修改班级',
  'DELETE /api/classes/:id': '删除班级',
  'POST /api/classes/:id/students': '班级添加学生',
  'DELETE /api/classes/:id/students/:studentId': '班级移除学生',
  'PUT /api/classes/:id/students/:studentId/position': '调整班级职务',
  'POST /api/classes/:id/join': '加入班级',
  'POST /api/classes/:id/leave': '退出班级',
  'POST /api/classes/leader/assignment': '班干部发布作业',
  'PUT /api/classes/leader/assignment/:id': '班干部修改作业',
  'DELETE /api/classes/leader/assignment/:id': '班干部删除作业',
  'POST /api/courses': '新增课程',
  'PUT /api/courses/:id': '修改课程',
  'DELETE /api/courses/:id': '删除课程',
  'POST /api/courses/:id/assistants': '设置课代表',
  'DELETE /api/courses/:id/assistants/:studentId': '移除课代表',
  'POST /api/courses/assistant/assignment': '课代表发布作业',
  'PUT /api/courses/assistant/assignment/:id': '课代表修改作业',
  'DELETE /api/courses/assistant/assignment/:id': '课代表删除作业',
  'POST /api/assignments': '发布作业',
  'PUT /api/assignments/:id': '修改作业',
  'DELETE /api/assignments/:id': '删除作业',
  'POST /api/submissions/assignment/:id': '提交作业',
  'PUT /api/submissions/:id/grade': '作业打分',
  'POST /api/submissions/assignment/:id/remind': '催交提醒',
  'POST /api/todos': '发布待办',
  'PUT /api/todos/:id': '修改待办',
  'DELETE /api/todos/:id': '删除待办',
  'POST /api/todos/:id/remind': '待办催办',
  'POST /api/grading/templates': '新增批改模板',
  'PUT /api/grading/templates/:id': '修改批改模板',
  'POST /api/grading/templates/:id/publish': '发布批改模板',
  'POST /api/grading/templates/:id/clone': '克隆批改模板',
  'PATCH /api/grading/templates/:id/status': '启用/停用批改模板',
  'POST /api/grading/tasks/batch': '发起 AI 批量批改',
  'POST /api/grading/tasks/:id/cancel': '取消批改任务',
  'POST /api/grading/reviews/:id': '提交人工复核',
  'POST /api/grading/prompts/versions': '新增提示词版本',
  'PUT /api/grading/prompts/routing': '修改提示词路由',
  'POST /api/ai/grade': 'AI 批改（旧版）',
  'POST /api/ai/upload-reference': '上传批改参考文件',
  'POST /api/plagiarism/check/:assignmentId/:submissionId': '单份查重',
  'POST /api/plagiarism/batch-check/:assignmentId': '发起全班查重',
  'POST /api/plagiarism/task/cancel/:assignmentId': '取消查重任务',
  'DELETE /api/plagiarism/results/:assignmentId/:submissionId': '删除查重结果',
  'POST /api/stats/cleanup/run': '执行文件清理'
};

// 口令/令牌类字段名（含子串即命中），脱敏为 ***
const SENSITIVE_KEY = /pass|token|secret|authorization|cookie|^key$|_key/i;

function sanitizeValue(value, depth) {
  if (value === null || value === undefined) return value;
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') return value;
  if (type !== 'object' || depth > 3) return type === 'object' ? '[Object]' : String(value);
  if (Array.isArray(value)) return value.slice(0, 20).map(v => sanitizeValue(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(k)) {
      out[k] = '***';
    } else {
      out[k] = sanitizeValue(v, depth + 1);
    }
  }
  return out;
}

function buildDetail(req) {
  // 请求体（JSON 已由 express.json 解析；multipart 的文件在 req.files，不记录二进制）
  const parts = [];
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
    parts.push({ body: sanitizeValue(req.body, 0) });
  }
  // query 中常带筛选参数（如 class_id），对还原操作上下文有用；同样脱敏
  if (req.query && Object.keys(req.query).length > 0) {
    parts.push({ query: sanitizeValue(req.query, 0) });
  }
  if (parts.length === 0) return null;
  try {
    const json = JSON.stringify(parts.length === 1 ? parts[0] : parts);
    return json.length > MAX_DETAIL ? json.slice(0, MAX_DETAIL) + '…' : json;
  } catch (e) {
    return null;
  }
}

function auditLog(req, res, next) {
  if (!MUTATING.has(req.method)) return next();

  // 在路由开始前捕获完整路径：Express 路由过程中会改写 req.url，
  // 认证失败等场景下响应完成时 req.path 已不可靠
  const originalPath = req.originalUrl.split('?')[0];

  // 响应结束时才能拿到：req.user（auth 中间件已挂）、req.route（路由已匹配）、状态码
  res.on('finish', () => {
    try {
      // 路由模板：req.baseUrl 为挂载前缀（如 /api/users），req.route.path 为模板段（如 /:id）。
      // 根路由（path='/'）拼接后会产生尾斜杠（/api/assignments/），去掉以保证与标签映射一致
      const pattern = req.route
        ? (`${req.baseUrl}${req.route.path}`.replace(/\/+/g, '/').replace(/\/+$/, '') || '/')
        : originalPath;
      const routeKey = `${req.method} ${pattern}`;

      if (SKIP_ROUTES.has(routeKey)) return;

      // 操作人快照：优先登录态；登录/注册接口无登录态，用请求体账号名兜底
      let user = null;
      if (req.user) {
        user = {
          id: req.user.id,
          username: req.user.username,
          real_name: req.user.real_name,
          role: req.user.role
        };
      } else if (req.body && req.body.username) {
        user = { id: null, username: String(req.body.username).slice(0, 50) };
      }

      // 目标对象：取第一个路由参数（通常是 :id）
      const params = req.params || {};
      const targetId = params.id || params.assignmentId || params.studentId ||
        params.submissionId || Object.values(params)[0] || null;

      const statusCode = res.statusCode;
      recordOperation({
        user_id: user && user.id ? user.id : null,
        username: user ? user.username : null,
        real_name: user ? user.real_name : null,
        role: user ? user.role : null,
        action: routeKey.slice(0, 120),
        action_label: ACTION_LABELS[routeKey] || '数据变更',
        method: req.method,
        path: originalPath.slice(0, 255),
        target_id: targetId !== undefined && targetId !== null ? String(targetId).slice(0, 50) : null,
        detail: buildDetail(req),
        result: statusCode < 400 ? 1 : 0,
        status_code: statusCode,
        ip: (req.ip || '').replace('::ffff:', '').slice(0, 45) || null,
        user_agent: (req.headers['user-agent'] || '').slice(0, 255) || null
      });
    } catch (e) {
      console.error('[操作日志] 记录异常:', e.message);
    }
  });

  next();
}

module.exports = auditLog;
