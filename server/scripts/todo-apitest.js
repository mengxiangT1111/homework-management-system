/**
 * 任务待办功能 - 端到端 API 测试
 * 用法：先启动测试实例（PORT=3100 node src/server.js），再 node scripts/todo-apitest.js
 * 夹具（测试用户/班级）通过数据库直插（复用 server 的 mysql2 连接配置），
 * 所有功能断言均走 HTTP API，覆盖权限矩阵与业务流程。
 *
 * 断言口径：本系统 success() 不设 HTTP 状态码，业务码在 body.code（fail 会同时设 HTTP），
 * 故统一断言 body.code。
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const BASE = process.env.TEST_BASE || 'http://localhost:3100/api';
let pass = 0, fail = 0;

function ck(desc, expected, actual) {
  if (String(expected) === String(actual)) { pass++; console.log(`  PASS  ${desc}`); }
  else { fail++; console.log(`  FAIL  ${desc}  (期望 ${expected} 实得 ${actual})`); }
}

async function api(method, path, token, body) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* ignore */ }
  return { http: res.status, code: data?.code, body: data };
}

async function main() {
  const ts = Date.now().toString().slice(-8);
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: +process.env.DB_PORT,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  // ===== 夹具：直插测试教师/学生/班级（school_id=1，不动现有数据）=====
  const pwd = await bcrypt.hash('pass123456', 10);
  const mk = async (username, realName, role) => {
    const [r] = await conn.execute(
      'INSERT INTO users (username, password, real_name, role, school_id, status, created_at, updated_at) VALUES (?,?,?,?,1,1,NOW(),NOW())',
      [username, pwd, realName, role]);
    return r.insertId;
  };
  const T = await mk(`tdt${ts}`, `测试教师${ts}`, 'teacher');
  const S1 = await mk(`tds1${ts}`, `测试学委${ts}`, 'student');
  const S2 = await mk(`tds2${ts}`, `测试学生${ts}`, 'student');
  const S3 = await mk(`tds3${ts}`, `无班学生${ts}`, 'student');
  const S4 = await mk(`tds4${ts}`, `普通学生${ts}`, 'student');
  const [cls] = await conn.execute(
    'INSERT INTO classes (name, grade, teacher_id, school_id, created_at, updated_at) VALUES (?,?,?,1,NOW(),NOW())',
    [`待办测试班${ts}`, '2026', T]);
  const C = cls.insertId;
  await conn.execute('INSERT INTO class_students (class_id, student_id, position, created_at, updated_at) VALUES (?,?,?,NOW(),NOW())', [C, S1, 'commissary']);
  await conn.execute('INSERT INTO class_students (class_id, student_id, position, created_at, updated_at) VALUES (?,?,?,NOW(),NOW())', [C, S2, 'none']);
  await conn.execute('INSERT INTO class_students (class_id, student_id, position, created_at, updated_at) VALUES (?,?,?,NOW(),NOW())', [C, S4, 'none']);
  // 课代表夹具：S2 是本班一门课的课代表
  const [course] = await conn.execute(
    'INSERT INTO courses (name, class_id, teacher_id, school_id, created_at, updated_at) VALUES (?,?,?,1,NOW(),NOW())',
    [`待办测试课${ts}`, C, T]);
  await conn.execute('INSERT INTO course_assistants (course_id, student_id, created_at, updated_at) VALUES (?,?,NOW(),NOW())', [course.insertId, S2]);
  console.log(`夹具: 教师${T} 学委${S1} 学生${S2}/${S3}/${S4} 班级${C}`);

  const login = async (id) => {
    const [rows] = await conn.execute('SELECT username FROM users WHERE id=?', [id]);
    const r = await api('POST', '/auth/login', null, { username: rows[0].username, password: 'pass123456', school_id: 1 });
    return r.body?.data?.token;
  };
  const tt = await login(T), s1t = await login(S1), s2t = await login(S2), s3t = await login(S3), s4t = await login(S4);
  ck('教师/学委/学生多方登录', '5', [tt, s1t, s2t, s3t, s4t].filter(Boolean).length);

  console.log('== 1. 未登录拦截 ==');
  ck('未登录访问列表 -> 401', 401, (await api('GET', '/todos')).code);
  ck('未登录发布 -> 401', 401, (await api('POST', '/todos', null, { class_id: C, title: 'x' })).code);

  console.log('== 2. 教师发布（限班主任/任课班级）==');
  let r = await api('GET', '/todos/teacher/classes', tt);
  ck('教师查可发布班级', 200, r.code);
  ck('可发布班级含测试班', true, (r.body?.data || []).some(c => c.id === C));
  r = await api('POST', '/todos', tt, { class_id: C, title: `教师发布的待办${ts}`, content: '明天带教材', due_date: '2099-01-01T00:00:00.000Z' });
  ck('班主任发布待办', 201, r.code);
  const T_TODO = r.body?.data?.id;
  ck('无关班级发布 -> 403', 403, (await api('POST', '/todos', tt, { class_id: 1, title: '越权' })).code);
  ck('空标题 -> 422', 422, (await api('POST', '/todos', tt, { class_id: C, title: '' })).code);
  ck('纯空格标题 -> 422', 422, (await api('POST', '/todos', tt, { class_id: C, title: '   ' })).code);
  ck('超长标题(101字) -> 422', 422, (await api('POST', '/todos', tt, { class_id: C, title: '长'.repeat(101) })).code);
  ck('过期截止时间 -> 422', 422, (await api('POST', '/todos', tt, { class_id: C, title: '过期', due_date: '2020-01-01T00:00:00.000Z' })).code);
  ck('缺 class_id -> 422', 422, (await api('POST', '/todos', tt, { title: '无班级' })).code);
  ck('不存在班级 -> 404', 404, (await api('POST', '/todos', tt, { class_id: 999999, title: '幽灵班' })).code);

  console.log('== 3. 班级负责人（班长/学委）与课代表发布 ==');
  r = await api('POST', '/todos', s1t, { class_id: C, title: `学委发布的待办${ts}`, content: '周五前交实验报告' });
  ck('学委发布待办', 201, r.code);
  const S1_TODO = r.body?.data?.id;
  ck('普通学生(无职务非课代表)发布 -> 403', 403, (await api('POST', '/todos', s4t, { class_id: C, title: '不许发' })).code);
  // 班长可发布
  await conn.execute('UPDATE class_students SET position="monitor" WHERE class_id=? AND student_id=?', [C, S2]);
  r = await api('POST', '/todos', s2t, { class_id: C, title: `班长发布的待办${ts}` });
  ck('班长发布待办', 201, r.code);
  const M_TODO = r.body?.data?.id;
  await conn.execute('UPDATE class_students SET position="none" WHERE class_id=? AND student_id=?', [C, S2]);
  // 课代表可发布（本班课程的课代表）
  r = await api('POST', '/todos', s2t, { class_id: C, title: `课代表发布的待办${ts}` });
  ck('课代表发布待办', 201, r.code);
  const A_TODO = r.body?.data?.id;
  ck('学委向别班发布 -> 403', 403, (await api('POST', '/todos', s1t, { class_id: 1, title: '别班' })).code);
  ck('课代表向别班发布 -> 403', 403, (await api('POST', '/todos', s2t, { class_id: 1, title: '别班' })).code);
  ck('学生访问教师班级接口 -> 403', 403, (await api('GET', '/todos/teacher/classes', s1t)).code);

  console.log('== 4. 学生查看与完成 ==');
  r = await api('GET', '/todos', s2t);
  ck('学生查本班待办列表', 200, r.code);
  ck('列表含 4 条进行中待办(教师/学委/班长/课代表各一)', 4, r.body?.data?.total);
  const rowOf = (list, id) => (list || []).find(t => t.id === id);
  ck('未完成时 my_completion=null', true, rowOf(r.body?.data?.list, T_TODO)?.my_completion === null);
  // 发布时身份冗余（老师/班长/学委/课代表），前端据此展示署名
  ck('creator_identity 署名(老师/学委/班长/课代表)', JSON.stringify(['老师', '学委', '班长', '课代表']),
    JSON.stringify([T_TODO, S1_TODO, M_TODO, A_TODO].map(id => rowOf(r.body?.data?.list, id)?.creator_identity)));
  ck('完成数字段就位', true, typeof rowOf(r.body?.data?.list, T_TODO)?.completed_count === 'number' && typeof rowOf(r.body?.data?.list, T_TODO)?.class_size === 'number');
  ck('is_mine 标记（非本人发布=false）', false, rowOf(r.body?.data?.list, T_TODO)?.is_mine);
  ck('学生标记完成', 200, (await api('POST', `/todos/${T_TODO}/complete`, s2t)).code);
  ck('重复完成幂等', 200, (await api('POST', `/todos/${T_TODO}/complete`, s2t)).code);
  r = await api('GET', '/todos', s2t);
  ck('完成后列表回显完成状态', true, !!rowOf(r.body?.data?.list, T_TODO)?.my_completion);
  ck('完成数=1', 1, rowOf(r.body?.data?.list, T_TODO)?.completed_count);
  ck('无班学生完成他人班级待办 -> 403', 403, (await api('POST', `/todos/${T_TODO}/complete`, s3t)).code);
  r = await api('GET', '/todos', s3t);
  ck('无班学生列表 -> 200 且空', JSON.stringify([200, 0]), JSON.stringify([r.code, r.body?.data?.total]));
  ck('取消完成', 200, (await api('DELETE', `/todos/${T_TODO}/complete`, s2t)).code);
  r = await api('GET', '/todos', s2t);
  ck('取消后 my_completion=null', true, rowOf(r.body?.data?.list, T_TODO)?.my_completion === null);
  await api('POST', `/todos/${T_TODO}/complete`, s2t); // 恢复完成状态供后续用例

  console.log('== 5. 管理操作仅限发布者本人 ==');
  ck('教师改学委的待办 -> 403', 403, (await api('PUT', `/todos/${S1_TODO}`, tt, { title: '越权改' })).code);
  ck('教师删学委的待办 -> 403', 403, (await api('DELETE', `/todos/${S1_TODO}`, tt)).code);
  ck('教师看学委待办进度 -> 403', 403, (await api('GET', `/todos/${S1_TODO}/progress`, tt)).code);
  ck('教师催办学委的待办 -> 403', 403, (await api('POST', `/todos/${S1_TODO}/remind`, tt)).code);
  ck('学委改教师的待办 -> 403', 403, (await api('PUT', `/todos/${T_TODO}`, s1t, { title: '越权改' })).code);
  ck('普通学生改他人待办 -> 403', 403, (await api('PUT', `/todos/${S1_TODO}`, s4t, { title: '越权改' })).code);
  ck('发布者编辑自己的待办', 200, (await api('PUT', `/todos/${S1_TODO}`, s1t, { title: `学委改过${ts}`, due_date: '2099-06-01T00:00:00.000Z' })).code);
  ck('编辑时允许设过去截止(保留原截止场景)', 200, (await api('PUT', `/todos/${S1_TODO}`, s1t, { due_date: '2020-01-01T00:00:00.000Z' })).code);
  ck('编辑时截止时间格式非法 -> 422', 422, (await api('PUT', `/todos/${S1_TODO}`, s1t, { due_date: '乱填' })).code);
  ck('非法状态值 -> 422', 422, (await api('PUT', `/todos/${S1_TODO}`, s1t, { status: 'hack' })).code);
  r = await api('GET', `/todos/${S1_TODO}/progress`, s1t);
  ck('发布者查进度', 200, r.code);
  ck('进度正确(全班3人/学委待办0人完成)', JSON.stringify([3, 0]), JSON.stringify([r.body?.data?.total, r.body?.data?.completed_count]));
  ck('不存在待办 -> 404', 404, (await api('GET', '/todos/999999/progress', s1t)).code);

  console.log('== 6. 催办与 1 小时去重 ==');
  // 学委待办：发布通知已发给 S2（1h 内），首次催办应跳过 S2 —— 验证防轰炸
  r = await api('POST', `/todos/${S1_TODO}/remind`, s1t);
  ck('发布后1h内催办被去重', 0, r.body?.data?.reminded);
  r = await api('GET', '/notifications?type=system', s2t);
  const gotNotice = (r.body?.data?.list || []).some(n => (n.title || '').includes('新任务待办') && (n.content || '').includes(`学委发布的待办${ts}`));
  ck('S2 收到发布通知（学委署名）', true, gotNotice);
  r = await api('GET', '/notifications?type=system', s1t);
  const s1List = r.body?.data?.list || [];
  ck('S1 收到班长署名通知', true, s1List.some(n => (n.content || '').includes(`班长测试学生${ts}发布了新待办`) && (n.content || '').includes(`班长发布的待办${ts}`)));
  ck('S1 收到课代表署名通知', true, s1List.some(n => (n.content || '').includes(`课代表测试学生${ts}发布了新待办`) && (n.content || '').includes(`课代表发布的待办${ts}`)));
  // 教师待办：S2 已完成，未完成者只剩 S1；发布通知 1h 内同样去重
  r = await api('POST', `/todos/${T_TODO}/remind`, tt);
  ck('教师催办 1h 内去重(发布通知占用)', 0, r.body?.data?.reminded);
  // 把该待办相关通知时间改老后催办生效：应提醒未完成的 S1 和 S4
  await conn.execute('UPDATE notifications SET created_at = DATE_SUB(NOW(), INTERVAL 2 HOUR) WHERE related_id=? AND type="system"', [T_TODO]);
  r = await api('POST', `/todos/${T_TODO}/remind`, tt);
  ck('过期通知后催办生效(提醒未完成的S1/S4)', 2, r.body?.data?.reminded);

  console.log('== 7. 结束/删除保护 ==');
  ck('有完成记录时删除 -> 422 引导结束', 422, (await api('DELETE', `/todos/${T_TODO}`, tt)).code);
  ck('发布者结束待办', 200, (await api('PUT', `/todos/${T_TODO}`, tt, { status: 'closed' })).code);
  ck('已结束后不能标记完成', 422, (await api('POST', `/todos/${T_TODO}/complete`, s1t)).code);
  ck('已结束后不能催办', 422, (await api('POST', `/todos/${T_TODO}/remind`, tt)).code);
  r = await api('GET', '/todos?status=closed', s2t);
  ck('已结束待办可在 closed 筛选查到', true, (r.body?.data?.list || []).some(t => t.id === T_TODO));
  r = await api('GET', '/todos?status=active', s2t);
  ck('默认列表不再显示已结束待办', false, (r.body?.data?.list || []).some(t => t.id === T_TODO));
  ck('无完成记录可删除', 200, (await api('POST', '/todos', s1t, { class_id: C, title: `待删${ts}` }).then(async x => {
    const id = x.body?.data?.id;
    return (await api('DELETE', `/todos/${id}`, s1t)).code;
  })));

  console.log('== 8. 教师视角列表与参数归一化 ==');
  r = await api('GET', '/todos?status=all', tt);
  ck('教师列表=我发布的待办(is_mine)', true, (r.body?.data?.list || []).every(t => t.is_mine) && r.body?.data?.total >= 1);
  ck('非法分页参数被归一化', 200, (await api('GET', '/todos?page=0&pageSize=999', s2t)).code);
  ck('非法 status 回退 active', 200, (await api('GET', '/todos?status=hack', s2t)).code);
  r = await api('GET', `/todos?class_id=${C}&status=all`, tt);
  ck('教师按班筛选', 200, r.code);

  // ===== 清理夹具（严格按夹具 ID 范围删除，逐条限定，绝不触碰业务数据）=====
  await conn.execute('DELETE FROM notifications WHERE user_id IN (?,?,?,?,?)', [T, S1, S2, S3, S4]);
  await conn.execute('DELETE FROM todo_completions WHERE student_id IN (?,?,?,?,?)', [T, S1, S2, S3, S4]);
  await conn.execute('DELETE FROM todos WHERE class_id=?', [C]);
  await conn.execute('DELETE FROM class_students WHERE class_id=?', [C]);
  await conn.execute('DELETE FROM course_assistants WHERE student_id IN (?,?,?,?,?)', [T, S1, S2, S3, S4]);
  await conn.execute('DELETE FROM courses WHERE class_id=?', [C]);
  await conn.execute('DELETE FROM classes WHERE id=?', [C]);
  await conn.execute('DELETE FROM users WHERE id IN (?,?,?,?,?)', [T, S1, S2, S3, S4]);
  await conn.end();

  console.log(`\n===== 结果: PASS=${pass} FAIL=${fail} =====`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('测试脚本异常:', e); process.exit(1); });
