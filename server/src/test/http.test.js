/**
 * HTTP 集成测试（supertest）：鉴权 / 权限 / 历史 bug 回归
 * ============================================================
 * 覆盖回归点（均为历史上真实出过故障的路径）：
 *   - 批改重复建单（双击并发建出两批任务、LLM 跑两遍）
 *   - 复核动作映射（动词→过去式映射错误曾致复核全链路瘫痪）
 *   - B2 竞态（教师手动批改后取消在途 AI 任务，防 AI 分覆盖教师成绩）
 *   - 千分制上限（AI 打出 >100 分后教师无法手动修正）
 *   - 查重重复触发幂等、教师越权、逾期拦截、班外学生、冒绑防护（UploadRecord）
 * 前置：dev MySQL 已启动；不依赖 LLM / 检测服务。
 * 运行：node --test src/test/http.test.js
 * 说明：app.js 不启动队列 worker，批改任务创建后停在 pending——正好用于竞态类断言。
 */
// 必须先于 dotenv/app 设置：app 与检测服务封装均在模块加载期读取这些环境变量。
// 测试进程内把检测服务指向自举的 8901 端口；token 两端共用（dotenv 不覆盖已设值）
process.env.DETECTION_SERVICE_URL = process.env.DETECTION_SERVICE_URL || 'http://127.0.0.1:8901';
if (!process.env.DETECTION_API_TOKEN) process.env.DETECTION_API_TOKEN = 'itest-token';
process.env.MAIL_CAPTURE = '1'; // 邮件捕获模式：不发真邮件，验证码记入 mailer._captured 供断言
require('dotenv').config();
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { app, sequelize } = require('../app');
const {
  User, School, Class, ClassStudent, Course, Assignment, Submission, SubmissionFile,
  UploadRecord, GradingTask, GradingResult, GradingReview, PlagiarismTask, PlagiarismResult
} = require('../models');

const TS = Date.now();
const PW = bcrypt.hashSync('It@12345', 10);
const ctx = {};
let tokens = {};

async function login(username) {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ username, password: 'It@12345', school_id: ctx.school.id });
  assert.equal(res.status, 200, `登录失败 ${username}: ${JSON.stringify(res.body).slice(0, 120)}`);
  return res.body.data.token;
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

before(async () => {
  // ===== 自举 Python 检测服务（查重建任务前会健康检查；worker 不启动，任务停在 pending）=====
  ctx.det = spawn('python', ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8901'], {
    cwd: path.join(__dirname, '../../detection_service'),
    env: { ...process.env, DETECTION_SERVICE_URL: 'http://127.0.0.1:8901', DETECTION_API_TOKEN: process.env.DETECTION_API_TOKEN },
    stdio: 'ignore',
    windowsHide: true
  });
  // 等检测服务就绪（最多 25s；未装依赖时报错由后续查重用例的 503 断言暴露）
  for (let i = 0; i < 25; i++) {
    try {
      const http = require('http');
      await new Promise((resolve, reject) => {
        const req = http.get('http://127.0.0.1:8901/api/health', r => r.statusCode === 200 ? resolve() : reject());
        req.on('error', reject);
        req.setTimeout(1000, () => { req.destroy(); reject(new Error('timeout')); });
      });
      break;
    } catch (e) { await new Promise(r => setTimeout(r, 1000)); }
  }

  // ===== 数据自举（全部带 TS 前缀，跑完在 after 清理）=====
  ctx.school = await School.create({ name: `集成测试学校${TS}`, code: 'i' + String(TS).slice(-6) });
  const mk = (username, role, real_name) => User.create({
    username, password: PW, real_name, role, school_id: ctx.school.id, status: 1
  });
  ctx.teacherA = await mk(`it${TS}ta`, 'teacher', '教师甲');
  ctx.teacherB = await mk(`it${TS}tb`, 'teacher', '教师乙');
  ctx.stu1 = await mk(`it${TS}s1`, 'student', '学生一');
  ctx.stu2 = await mk(`it${TS}s2`, 'student', '学生二');
  ctx.stu3 = await mk(`it${TS}s3`, 'student', '学生三'); // 不入班
  ctx.cls = await Class.create({ name: `集成测试班${TS}`, grade: '高二', teacher_id: ctx.teacherA.id, school_id: ctx.school.id });
  for (const s of [ctx.stu1, ctx.stu2]) {
    await ClassStudent.create({ class_id: ctx.cls.id, student_id: s.id, position: 'none' });
  }
  ctx.course = await Course.create({ name: `集成测试课${TS}`, class_id: ctx.cls.id, teacher_id: ctx.teacherA.id, school_id: ctx.school.id });
  ctx.asg = await Assignment.create({
    title: `集成测试作业${TS}`, description: 'x', course_id: ctx.course.id, teacher_id: ctx.teacherA.id,
    deadline: new Date(Date.now() + 86400000), max_files: 5, max_size_mb: 20,
    allowed_formats: ['txt'],
    status: 'active', need_grading: 1, enable_plagiarism: 1
  });
  ctx.asgOverdue = await Assignment.create({
    title: `逾期作业${TS}`, description: 'x', course_id: ctx.course.id, teacher_id: ctx.teacherA.id,
    deadline: new Date(Date.now() - 86400000), max_files: 5, max_size_mb: 20,
    status: 'active', need_grading: 0, enable_plagiarism: 0
  });
  // 真实文件 + UploadRecord（提交接口会校验文件真实存在与上传归属，防冒绑）
  ctx.filePath = `uploads/ittest/${TS}.txt`;
  const abs = path.join(__dirname, '../../', ctx.filePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, '集成测试作答内容：设这个数为 x，3x+5=20，解得 x=5。');
  for (const s of [ctx.stu1, ctx.stu2]) {
    await UploadRecord.create({ user_id: s.id, file_path: ctx.filePath });
  }
  ctx.fileMeta = { original_name: `答案${TS}.txt`, file_path: ctx.filePath, file_size: 100, mime_type: 'text/plain', file_hash: null };

  // 评分模板：走真实创建+发布接口（顺带回归模板链路）
  const taToken0 = await login(`it${TS}ta`);
  const tplRes = await request(app).post('/api/grading/templates').set(auth(taToken0)).send({
    name: `集成模板${TS}`, subject: '数学', content_type: '主观题', full_score: 1000, description: '集成测试用',
    dimensions: [
      { code: 'D1', name: '过程', weight: 60, description: '', rubrics: [{ level: 'A', score_range: [540, 600], descriptor: '过程完整且推理正确' }, { level: 'B', score_range: [300, 539], descriptor: '过程基本正确有瑕疵' }] },
      { code: 'D2', name: '结论', weight: 40, description: '', rubrics: [{ level: 'A', score_range: [360, 400], descriptor: '结论正确且表述规范' }, { level: 'B', score_range: [200, 359], descriptor: '结论部分正确或含糊' }] }
    ]
  });
  assert.equal(tplRes.status, 200, `模板创建失败: ${JSON.stringify(tplRes.body).slice(0, 200)}`);
  ctx.templateId = tplRes.body.data.id;
  const pubRes = await request(app).post(`/api/grading/templates/${ctx.templateId}/publish`).set(auth(taToken0));
  assert.equal(pubRes.status, 200, `模板发布失败: ${JSON.stringify(pubRes.body).slice(0, 200)}`);

  tokens = {
    ta: await login(`it${TS}ta`),
    tb: await login(`it${TS}tb`),
    s1: await login(`it${TS}s1`),
    s2: await login(`it${TS}s2`),
    s3: await login(`it${TS}s3`)
  };
});

test('鉴权：未登录 401 / 学生访问管理员接口 403 / 教师访问管理员接口 403', async () => {
  let r = await request(app).get('/api/stats/overview');
  assert.equal(r.status, 401);
  r = await request(app).get('/api/stats/overview').set(auth(tokens.s1));
  assert.equal(r.status, 403);
  r = await request(app).get('/api/grading/prompts').set(auth(tokens.ta));
  assert.equal(r.status, 403);
});

test('提交：正常提交成功（含文件归属校验）', async () => {
  const r = await request(app).post(`/api/submissions/assignment/${ctx.asg.id}`).set(auth(tokens.s1)).send({ files: [ctx.fileMeta] });
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 150));
  ctx.sub1 = r.body.data.id || r.body.data.submission?.id;
  assert.ok(ctx.sub1, '返回提交ID');
});

test('提交：冒绑他人上传记录被拒（UploadRecord 归属）', async () => {
  const stolen = { ...ctx.fileMeta, file_path: `uploads/ittest/${TS}_other.txt` };
  const r = await request(app).post(`/api/submissions/assignment/${ctx.asg.id}`).set(auth(tokens.s2)).send({ files: [stolen] });
  assert.ok(r.status === 403 || r.status === 422, `期望 403/422，实际 ${r.status}`);
});

test('提交：第二个学生正常提交（供后续批改/查重用例）', async () => {
  const r = await request(app).post(`/api/submissions/assignment/${ctx.asg.id}`).set(auth(tokens.s2)).send({ files: [ctx.fileMeta] });
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 150));
  ctx.sub2 = r.body.data.id || r.body.data.submission?.id;
});

test('提交：班外学生 403 / 逾期作业 422', async () => {
  let r = await request(app).post(`/api/submissions/assignment/${ctx.asg.id}`).set(auth(tokens.s3)).send({ files: [ctx.fileMeta] });
  assert.equal(r.status, 403);
  r = await request(app).post(`/api/submissions/assignment/${ctx.asgOverdue.id}`).set(auth(tokens.s1)).send({ files: [ctx.fileMeta] });
  assert.equal(r.status, 422);
});

test('批改任务：创建成功 + 重复建单被拒（历史双击 bug 回归）', async () => {
  const body = { assignment_id: ctx.asg.id, template_id: ctx.templateId, reference_answer: 'x=5' };
  const r1 = await request(app).post('/api/grading/tasks/batch').set(auth(tokens.ta)).send(body);
  assert.equal(r1.status, 200, JSON.stringify(r1.body).slice(0, 200));
  const r2 = await request(app).post('/api/grading/tasks/batch').set(auth(tokens.ta)).send(body);
  assert.ok(r2.status === 422 || r2.status === 429, `重复建单应被拒，实际 ${r2.status} ${JSON.stringify(r2.body).slice(0, 120)}`);
  const tasks = await GradingTask.findAll({ where: { assignment_id: ctx.asg.id } });
  assert.equal(tasks.length, 2, `应只有两份提交各一个任务，实际 ${tasks.length}`);
});

test('批改任务：其他教师越权建单 403', async () => {
  const r = await request(app).post('/api/grading/tasks/batch').set(auth(tokens.tb))
    .send({ assignment_id: ctx.asg.id, template_id: ctx.templateId, reference_answer: 'x=5' });
  assert.equal(r.status, 403);
});

test('B2 竞态回归：教师手动批改后，在途 AI 任务被取消且分数不被覆盖', async () => {
  const r = await request(app).put(`/api/submissions/${ctx.sub1}/grade`).set(auth(tokens.ta))
    .send({ score: 80, comment: '手动批改', status: 'graded' });
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 150));
  const sub = await Submission.findByPk(ctx.sub1);
  assert.equal(Number(sub.score), 80);
  const tasks = await GradingTask.findAll({ where: { submission_id: ctx.sub1 } });
  assert.ok(tasks.length > 0 && tasks.every(t => t.status === 'cancelled'), '该提交的全部任务应为 cancelled');
});

test('千分制上限回归：模板/AI 满分 1000 时 150 与 950 放行、1500 拒绝', async () => {
  // sub1 曾用千分制模板建过批改任务（B2 用例已取消），手动上限以模板满分 1000 为准：
  // 历史上被硬编码 100 上限卡死（AI 打出 >100 分后教师无法手动修正）——150 应放行
  let r = await request(app).put(`/api/submissions/${ctx.sub1}/grade`).set(auth(tokens.ta))
    .send({ score: 150, comment: 'x', status: 'graded' });
  assert.equal(r.status, 200, `模板满分 1000 时 150 应放行，实际 ${r.status}`);
  // 超过模板满分 1000 应拒绝
  r = await request(app).put(`/api/submissions/${ctx.sub1}/grade`).set(auth(tokens.ta))
    .send({ score: 1500, comment: 'x', status: 'graded' });
  assert.equal(r.status, 422, `超过模板满分应被拒，实际 ${r.status}`);

  // sub2 造一条千分制 AI 结果，手动打 950 应放行
  const task = await GradingTask.create({
    submission_id: ctx.sub2, assignment_id: ctx.asg.id, template_id: ctx.templateId,
    template_snapshot: { name: 't', full_score: 1000, dimensions: [] }, prompt_key: 'grading.main',
    prompt_mode: 'balanced', reference_answer: 'x=5', status: 'success', created_by: ctx.teacherA.id
  });
  ctx.task2 = task;
  const result = await GradingResult.create({
    task_id: task.id, submission_id: ctx.sub2, template_id: ctx.templateId,
    prompt_key: 'grading.main', prompt_version: '1.0.0',
    total_score: 900, full_score: 1000, dimension_scores: [], overall_feedback: '', improvement_advice: '',
    deduction_summary: [], knowledge_errors: [], confidence: 0.95, needs_review: 0, review_reasons: [],
    raw_response: '', llm_model: 'test', tokens_used: 0
  });
  ctx.result2 = result;
  r = await request(app).put(`/api/submissions/${ctx.sub2}/grade`).set(auth(tokens.ta))
    .send({ score: 950, comment: '千分制修正', status: 'graded' });
  assert.equal(r.status, 200, `千分制 950 应放行，实际 ${r.status} ${JSON.stringify(r.body).slice(0, 150)}`);
  const sub = await Submission.findByPk(ctx.sub2);
  assert.equal(Number(sub.score), 950);
});

test('复核动作映射回归：adjust 生效 / 重复处理被拒 / reject 不回写 / 非法动作 422', async () => {
  // adjust
  const rv1 = await GradingReview.create({
    result_id: ctx.result2.id, task_id: ctx.task2.id, submission_id: ctx.sub2,
    original_score: 900, status: 'pending'
  });
  ctx.review1 = rv1;
  let r = await request(app).post(`/api/grading/reviews/${rv1.id}`).set(auth(tokens.ta))
    .send({ action: 'adjust', final_score: 888, comment: '复核调整' });
  assert.equal(r.status, 200, `adjust 应成功（历史动词映射 bug），实际 ${r.status} ${JSON.stringify(r.body).slice(0, 150)}`);
  let sub = await Submission.findByPk(ctx.sub2);
  assert.equal(Number(sub.score), 888, 'adjust 后应回写 888');
  // 重复处理
  r = await request(app).post(`/api/grading/reviews/${rv1.id}`).set(auth(tokens.ta))
    .send({ action: 'approve' });
  assert.equal(r.status, 422);
  // reject：另造工单，否决后分数保持
  const task3 = await GradingTask.create({
    submission_id: ctx.sub2, assignment_id: ctx.asg.id, template_id: ctx.templateId,
    template_snapshot: { name: 't', full_score: 1000, dimensions: [] }, prompt_key: 'grading.main',
    prompt_mode: 'balanced', reference_answer: 'x=5', status: 'success', created_by: ctx.teacherA.id
  });
  const result3 = await GradingResult.create({
    task_id: task3.id, submission_id: ctx.sub2, template_id: ctx.templateId,
    prompt_key: 'grading.main', prompt_version: '1.0.0',
    total_score: 700, full_score: 1000, dimension_scores: [], overall_feedback: '', improvement_advice: '',
    deduction_summary: [], knowledge_errors: [], confidence: 0.9, needs_review: 1, review_reasons: ['测试'],
    raw_response: '', llm_model: 'test', tokens_used: 0
  });
  ctx.task3 = task3; ctx.result3 = result3;
  const rv2 = await GradingReview.create({
    result_id: result3.id, task_id: task3.id, submission_id: ctx.sub2,
    original_score: 700, status: 'pending'
  });
  ctx.review2 = rv2;
  r = await request(app).post(`/api/grading/reviews/${rv2.id}`).set(auth(tokens.ta))
    .send({ action: 'reject', comment: '结果不可信' });
  assert.equal(r.status, 200);
  sub = await Submission.findByPk(ctx.sub2);
  assert.equal(Number(sub.score), 888, 'reject 不应改动已回写分数');
  // 非法动作
  r = await request(app).post(`/api/grading/reviews/${rv2.id}`).set(auth(tokens.ta)).send({ action: 'approved' });
  assert.equal(r.status, 422);
});

test('B3 认领回归：认领成功/他师越权拒/只看我认领的筛选', async () => {
  // review2 已被处理（reject），另造 pending 工单用于认领
  const task4 = await GradingTask.create({
    submission_id: ctx.sub2, assignment_id: ctx.asg.id, template_id: ctx.templateId,
    template_snapshot: { name: 't', full_score: 1000, dimensions: [] }, prompt_key: 'grading.main',
    prompt_mode: 'balanced', reference_answer: 'x=5', status: 'success', created_by: ctx.teacherA.id
  });
  const result4 = await GradingResult.create({
    task_id: task4.id, submission_id: ctx.sub2, template_id: ctx.templateId,
    prompt_key: 'grading.main', prompt_version: '1.0.0',
    total_score: 600, full_score: 1000, dimension_scores: [], overall_feedback: '', improvement_advice: '',
    deduction_summary: [], knowledge_errors: [], confidence: 0.9, needs_review: 1, review_reasons: ['测试'],
    raw_response: '', llm_model: 'test', tokens_used: 0
  });
  ctx.task4 = task4; ctx.result4 = result4;
  const rv = await GradingReview.create({
    result_id: result4.id, task_id: task4.id, submission_id: ctx.sub2,
    original_score: 600, status: 'pending'
  });
  ctx.review3 = rv;
  // 他师越权（作业不属于 teacherB）
  let r = await request(app).post(`/api/grading/reviews/${rv.id}/claim`).set(auth(tokens.tb));
  assert.equal(r.status, 403);
  // 作业教师认领成功
  r = await request(app).post(`/api/grading/reviews/${rv.id}/claim`).set(auth(tokens.ta));
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 120));
  // mine 筛选包含该工单
  r = await request(app).get('/api/grading/reviews?status=pending&mine=1').set(auth(tokens.ta));
  assert.equal(r.status, 200);
  assert.ok((r.body.data.list || []).some(x => x.id === rv.id), 'mine 筛选应包含已认领工单');
  // 再认领幂等
  r = await request(app).post(`/api/grading/reviews/${rv.id}/claim`).set(auth(tokens.ta));
  assert.equal(r.status, 200);
});

test('密码找回全链路：验证码邮件 → 重置 → 新密码登录 → 旧 token 失效 → 重放被拒', async () => {
  const mailer = require('../services/mailer.service');
  assert.ok(mailer.isCapture(), '测试进程应处于邮件捕获模式');
  // 绑定邮箱
  await User.update({ email: `it${TS}s1@itest.local` }, { where: { id: ctx.stu1.id } });
  // 发送验证码（捕获模式记录到 _captured.last）
  let r = await request(app).post('/api/auth/forgot-password').send({ account: `it${TS}s1` });
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 120));
  const sent = mailer._captured.last;
  assert.ok(sent && sent.to === `it${TS}s1@itest.local`, '应捕获到发给绑定邮箱的验证码邮件');
  const m = /验证码：(\d{6})/.exec(sent.text || '');
  assert.ok(m, '邮件正文应含 6 位验证码');
  // 错误验证码 → 401（统一文案，不泄露账号）
  r = await request(app).post('/api/auth/reset-password').send({ account: `it${TS}s1`, code: '000000', new_password: 'NewIt@12345' });
  assert.equal(r.status, 401);
  // 正确验证码 → 重置成功
  r = await request(app).post('/api/auth/reset-password').send({ account: `it${TS}s1@itest.local`, code: m[1], new_password: 'NewIt@12345' });
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 120));
  // 旧登录态失效（密码版本指纹）
  r = await request(app).get('/api/submissions/my/list').set(auth(tokens.s1));
  assert.equal(r.status, 401, '改密后旧 token 应失效');
  // 新密码可登录
  r = await request(app).post('/api/auth/login').send({ username: `it${TS}s1`, password: 'NewIt@12345', school_id: ctx.school.id });
  assert.equal(r.status, 200, `新密码登录应成功: ${JSON.stringify(r.body).slice(0, 120)}`);
  // 同一验证码重放 → 拒绝（HMAC 掺密码哈希指纹，改密后旧码即失效）
  r = await request(app).post('/api/auth/reset-password').send({ account: `it${TS}s1`, code: m[1], new_password: 'Again@12345' });
  assert.equal(r.status, 401, '旧验证码重放应被拒');
  // 无邮箱账号：发送返回统一成功文案（不泄露绑定状态）
  r = await request(app).post('/api/auth/forgot-password').send({ account: `it${TS}s2` });
  assert.equal(r.status, 200);
});

test('查重：重复触发幂等（历史双击把全班比对算两遍 bug 回归）', async () => {
  const r1 = await request(app).post(`/api/plagiarism/batch-check/${ctx.asg.id}`).set(auth(tokens.ta));
  assert.equal(r1.status, 200, JSON.stringify(r1.body).slice(0, 150));
  const r2 = await request(app).post(`/api/plagiarism/batch-check/${ctx.asg.id}`).set(auth(tokens.ta));
  assert.equal(r2.status, 200);
  assert.equal(r2.body.data.alreadyRunning, true, '第二次触发应返回 alreadyRunning');
  assert.equal(r2.body.data.task.taskId, r1.body.data.task.taskId, '应复用同一任务');
  // 他师越权
  const r3 = await request(app).post(`/api/plagiarism/batch-check/${ctx.asg.id}`).set(auth(tokens.tb));
  assert.equal(r3.status, 403);
});

test('查重：取消进行中的任务后可重新建任务', async () => {
  await PlagiarismTask.update({ status: 'cancelled' }, { where: { assignment_id: ctx.asg.id } });
  const r = await request(app).post(`/api/plagiarism/batch-check/${ctx.asg.id}`).set(auth(tokens.ta));
  assert.equal(r.status, 200, '取消后应能重建任务');
  assert.ok(!r.body.data.alreadyRunning);
});

after(async () => {
  // ===== 清理（尽力而为，不阻断）=====
  if (ctx.det) {
    try { ctx.det.kill(); } catch (e) {}
    // Windows 下孙进程兜底：按端口杀残留（uvicorn 可能带 reload 子进程）
    try {
      const { execSync } = require('child_process');
      const out = execSync('netstat -ano').toString();
      for (const line of out.split('\n')) {
        if (line.includes(':8901') && line.includes('LISTENING')) {
          const pid = line.trim().split(/\s+/).pop();
          if (pid) execSync(`taskkill /PID ${pid} /F`);
        }
      }
    } catch (e) {}
  }
  const swallow = (p) => p.catch(() => {});
  await swallow(PlagiarismResult.destroy({ where: { assignment_id: ctx.asg?.id } }));
  await swallow(PlagiarismTask.destroy({ where: { assignment_id: ctx.asg?.id } }));
  if (ctx.review1) await swallow(GradingReview.destroy({ where: { id: [ctx.review1.id, ctx.review2?.id, ctx.review3?.id].filter(Boolean) } }));
  if (ctx.result2) await swallow(GradingResult.destroy({ where: { id: [ctx.result2.id, ctx.result3?.id, ctx.result4?.id].filter(Boolean) } }));
  if (ctx.task2) await swallow(GradingTask.destroy({ where: { id: [ctx.task2.id, ctx.task3?.id, ctx.task4?.id].filter(Boolean) } }));
  await swallow(GradingReview.destroy({ where: { submission_id: [ctx.sub1, ctx.sub2].filter(Boolean) } }));
  await swallow(GradingResult.destroy({ where: { submission_id: [ctx.sub1, ctx.sub2].filter(Boolean) } }));
  await swallow(GradingTask.destroy({ where: { assignment_id: ctx.asg?.id } }));
  if (ctx.sub1 || ctx.sub2) {
    await swallow(SubmissionFile.destroy({ where: { submission_id: [ctx.sub1, ctx.sub2].filter(Boolean) } }));
    await swallow(Submission.destroy({ where: { id: [ctx.sub1, ctx.sub2].filter(Boolean) } }));
  }
  await swallow(Assignment.destroy({ where: { id: [ctx.asg?.id, ctx.asgOverdue?.id].filter(Boolean) } }));
  await swallow(Course.destroy({ where: { id: ctx.course?.id } }));
  if (ctx.cls) await swallow(ClassStudent.destroy({ where: { class_id: ctx.cls.id } }));
  await swallow(Class.destroy({ where: { id: ctx.cls?.id } }));
  await swallow(UploadRecord.destroy({ where: { user_id: [ctx.stu1?.id, ctx.stu2?.id].filter(Boolean), file_path: ctx.filePath } }));
  await swallow(User.destroy({ where: { id: [ctx.teacherA?.id, ctx.teacherB?.id, ctx.stu1?.id, ctx.stu2?.id, ctx.stu3?.id].filter(Boolean) } }));
  await swallow(School.destroy({ where: { id: ctx.school?.id } }));
  if (ctx.filePath) { try { fs.unlinkSync(path.join(__dirname, '../../', ctx.filePath)); } catch (e) {} }
  await sequelize.close();
});
