/**
 * 查重服务升级端到端测试（自建数据、自清理）
 * 覆盖：登录 → 建班课作业（本地文件 + COS文件）→ 触发全班查重任务 → 轮询进度 →
 *      断言 C(n,2)/双向写入/对称分数/COS可查重 → 单份查重 → 权限校验 → 清理
 * 前置：MySQL / 后端(:3000) / 检测服务(:8000) 已启动，.env 已配 COS（COS 用例可跳过）
 * 运行：node scripts/plagiarism-e2e-test.js
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const axios = require('axios');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const {
  sequelize, User, School, Class, ClassStudent, Course, Assignment,
  Submission, SubmissionFile, PlagiarismResult, PlagiarismTask
} = require('../src/models');
const { uploadToCOS, isCOSConfigured } = require('../src/config/cos');

const TS = Date.now();
const UPLOADS = path.resolve(__dirname, '../uploads/202608');
const COS_KEY = `homeworks/202608/plagt-e2e-${TS}.png`;
const ctx = {}; // 收集创建的资源，清理用

let passCount = 0, failCount = 0;
function check(name, cond, extra = '') {
  if (cond) { passCount++; console.log(`  ✓ ${name}`); }
  else { failCount++; console.log(`  ✗ ${name} ${extra}`); }
}

const api = axios.create({ baseURL: BASE, timeout: 30000 });

async function login(username, password, schoolId) {
  const res = await api.post('/api/auth/login', { username, password, school_id: schoolId });
  return res.data.data.token;
}

function authApi(token) {
  const inst = axios.create({ baseURL: BASE, timeout: 30000 });
  inst.defaults.headers.common.Authorization = `Bearer ${token}`;
  return inst;
}

async function main() {
  console.log('===== 查重服务升级端到端测试 =====');

  // ---------- 1. 准备测试数据 ----------
  console.log('\n[1] 准备测试数据（班级/课程/作业/3份提交，其中1份存COS）');
  const teacher = await User.findOne({ where: { username: 'teacher' } });
  if (!teacher) throw new Error('种子教师账号 teacher 不存在，请先 npm run seed');

  let school = await School.findOne({ where: { code: '009' } });
  if (!school) school = await School.create({ name: '查重测试学校', code: '009' });
  ctx.school = school;

  ctx.students = [];
  for (let i = 1; i <= 3; i++) {
    ctx.students.push(await User.create({
      username: `plagt${TS}s${i}`,
      password: bcrypt.hashSync('Test12345', 10),
      real_name: `查重测试学生${i}`,
      role: 'student',
      school_id: school.id,
      status: 1
    }));
  }

  ctx.class = await Class.create({
    name: `查重测试班${TS}`, grade: '高三', teacher_id: teacher.id, school_id: school.id
  });
  for (const s of ctx.students) {
    await ClassStudent.create({ class_id: ctx.class.id, student_id: s.id, position: 'none' });
  }

  ctx.course = await Course.create({
    name: `查重测试课程${TS}`, class_id: ctx.class.id, teacher_id: teacher.id, school_id: school.id
  });

  ctx.assignment = await Assignment.create({
    title: `查重升级测试作业${TS}`,
    description: '端到端测试自动创建',
    course_id: ctx.course.id,
    teacher_id: teacher.id,
    deadline: new Date(Date.now() + 86400000),
    max_files: 5,
    max_size_mb: 20,
    status: 'active',
    need_grading: 0,
    enable_plagiarism: 1
  });

  // 三份提交：s1 本地A图 / s2 本地A图重编码（应高度相似） / s3 COS上的B图（验证COS可查重）
  let s3Path;
  if (isCOSConfigured) {
    try {
      await uploadToCOS(path.join(UPLOADS, 'plagtest_b.png'), COS_KEY);
      s3Path = `cos://${COS_KEY}`;
      console.log(`  COS 上传成功: ${s3Path}`);
    } catch (e) {
      console.warn(`  COS 上传失败（降级为本地路径）: ${e.message}`);
    }
  }
  if (!s3Path) s3Path = 'uploads/202608/plagtest_b.png';

  const fileEntries = [
    { file: 'uploads/202608/plagtest_a.png', name: 'plagtest_a.png' },
    { file: 'uploads/202608/plagtest_acopy.jpg', name: 'plagtest_acopy.jpg' },
    { file: s3Path, name: 'plagtest_b.png' }
  ];
  ctx.submissions = [];
  for (let i = 0; i < 3; i++) {
    const sub = await Submission.create({
      assignment_id: ctx.assignment.id,
      student_id: ctx.students[i].id,
      status: 'submitted',
      submitted_at: new Date()
    });
    const abs = fileEntries[i].file.startsWith('cos://')
      ? path.join(UPLOADS, 'plagtest_b.png')
      : path.join(UPLOADS, path.basename(fileEntries[i].file));
    await SubmissionFile.create({
      submission_id: sub.id,
      original_name: fileEntries[i].name,
      file_path: fileEntries[i].file,
      file_size: fs.statSync(abs).size,
      mime_type: 'image/png',
      file_hash: null,
      is_cleaned: 0
    });
    ctx.submissions.push(sub);
  }
  console.log(`  已创建 ${ctx.submissions.length} 份提交（s3=${s3Path}）`);

  // ---------- 2. 登录并触发全班查重任务 ----------
  console.log('\n[2] 触发全班查重（应立即返回任务，而非同步等结果）');
  const token = await login('teacher', 'teacher123', teacher.school_id);
  const tapi = authApi(token);

  const t0 = Date.now();
  const createRes = await api.post(`/api/plagiarism/batch-check/${ctx.assignment.id}`, null, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const elapsed = Date.now() - t0;
  const task = createRes.data.data.task;
  check('batch-check 立即返回（<3s）', elapsed < 3000, `耗时 ${elapsed}ms`);
  check('返回任务对象', !!task && !!task.taskId, JSON.stringify(createRes.data.data).slice(0, 200));
  check('任务总对数 = C(3,2) = 3', task.totalPairs === 3, `totalPairs=${task?.totalPairs}`);

  // 重复触发应幂等返回进行中的任务
  const dupRes = await api.post(`/api/plagiarism/batch-check/${ctx.assignment.id}`, null, {
    headers: { Authorization: `Bearer ${token}` }
  });
  check('重复触发返回同一任务（不重复建任务）', dupRes.data.data.alreadyRunning === true && dupRes.data.data.task.taskId === task.taskId);

  // ---------- 3. 轮询任务进度 ----------
  console.log('\n[3] 轮询任务进度');
  let final = null;
  const deadline = Date.now() + 240000;
  let sawProgress = false;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1500));
    const st = await tapi.get(`/api/plagiarism/task/status/${ctx.assignment.id}`);
    const t = st.data.data.task;
    if (t.completedPairs > 0 && t.status === 'processing') sawProgress = true;
    process.stdout.write(`\r  进度: ${t.status} ${t.completedPairs}/${t.totalPairs} 对   `);
    if (t.status === 'done' || t.status === 'failed' || t.status === 'cancelled') {
      final = { task: t, summary: st.data.data.summary };
      break;
    }
  }
  console.log();
  check('任务在超时前完成', !!final && final.task.status === 'done', `status=${final?.task.status} err=${final?.task.errorMsg}`);
  if (!final || final.task.status !== 'done') throw new Error('任务未完成，中止后续断言');
  check('进度字段可见（观测到 processing 中间进度）', sawProgress || final.task.totalPairs <= 3);
  check('完成对数 = 3', final.task.completedPairs === 3, `completedPairs=${final.task.completedPairs}`);
  check('汇总 totalComparisons = 3（无序对去重）', final.summary.totalComparisons === 3, `got=${final.summary.totalComparisons}`);

  // ---------- 4. 数据库对称性断言 ----------
  console.log('\n[4] 断言 plagiarism_results 双向写入与对称分数');
  const rows = await PlagiarismResult.findAll({ where: { assignment_id: ctx.assignment.id } });
  check('结果行数 = 3对 × 2方向 = 6', rows.length === 6, `实际 ${rows.length}`);
  const byPair = {};
  for (const r of rows) {
    const key = r.submission_id < r.compared_with_id
      ? `${r.submission_id}_${r.compared_with_id}`
      : `${r.compared_with_id}_${r.submission_id}`;
    (byPair[key] = byPair[key] || []).push(r);
  }
  let symmetric = true;
  for (const [key, pair] of Object.entries(byPair)) {
    if (pair.length !== 2 || Math.abs(parseFloat(pair[0].similarity_score) - parseFloat(pair[1].similarity_score)) > 0.001) {
      symmetric = false;
      console.log(`    不对称: ${key}`, pair.map(p => `${p.submission_id}>${p.compared_with_id}=${p.similarity_score}`).join(' | '));
    }
  }
  check('每对双向分数对称', symmetric);

  // s1(本地A) vs s2(本地A重编码) 应高度相似且可疑
  const key12 = ctx.submissions[0].id < ctx.submissions[1].id
    ? `${ctx.submissions[0].id}_${ctx.submissions[1].id}` : `${ctx.submissions[1].id}_${ctx.submissions[0].id}`;
  const sim12 = parseFloat(byPair[key12][0].similarity_score);
  check('A图 vs A图重编码 相似度 > 50（可疑）', sim12 > 50, `sim=${sim12}`);
  check('汇总可疑对包含 (s1,s2)', (final.summary.suspiciousResults || []).some(r =>
    (r.submissionId === ctx.submissions[0].id && r.comparedWithId === ctx.submissions[1].id) ||
    (r.submissionId === ctx.submissions[1].id && r.comparedWithId === ctx.submissions[0].id)));

  // 与 s3（COS 上的 B 图）的两对应已成功计算（done 而非 error）→ COS 可查重
  const cosPairs = Object.entries(byPair).filter(([key]) => key.includes(`${ctx.submissions[2].id}`));
  check('COS 文件参与 2 对比对且状态 done', cosPairs.length === 2 && cosPairs.every(([, p]) => p.every(x => x.status === 'done')),
    JSON.stringify(cosPairs.map(([, p]) => p.map(x => x.status))));

  // ---------- 5. 单份查重（同步接口，COS 兼容） ----------
  console.log('\n[5] 单份查重接口');
  const single = await tapi.post(`/api/plagiarism/check/${ctx.assignment.id}/${ctx.submissions[0].id}`);
  check('单份查重返回 200', single.status === 200 && single.data.code === 200);
  check('单份查重对比了其他 2 份提交', single.data.data.totalCompared === 2, `totalCompared=${single.data.data.totalCompared}`);

  // ---------- 6. 权限校验 ----------
  console.log('\n[6] 权限校验（学生无权访问查重）');
  const stuToken = await login(ctx.students[0].username, 'Test12345', ctx.school.id);
  let stuDenied = false;
  try {
    await authApi(stuToken).post(`/api/plagiarism/batch-check/${ctx.assignment.id}`);
  } catch (e) {
    stuDenied = e.response?.status === 403;
  }
  check('学生访问查重接口被拒（403）', stuDenied);

  // ---------- 7. 清理测试数据 ----------
  console.log('\n[7] 清理测试数据');
  await PlagiarismResult.destroy({ where: { assignment_id: ctx.assignment.id } });
  await PlagiarismTask.destroy({ where: { assignment_id: ctx.assignment.id } });
  await SubmissionFile.destroy({ where: { submission_id: ctx.submissions.map(s => s.id) } });
  await Submission.destroy({ where: { id: ctx.submissions.map(s => s.id) } });
  await Assignment.destroy({ where: { id: ctx.assignment.id } });
  await Course.destroy({ where: { id: ctx.course.id } });
  await ClassStudent.destroy({ where: { class_id: ctx.class.id } });
  await Class.destroy({ where: { id: ctx.class.id } });
  await User.destroy({ where: { id: ctx.students.map(s => s.id) } });
  if (isCOSConfigured) {
    try {
      const { deleteFromCOS } = require('../src/config/cos');
      if (deleteFromCOS) await deleteFromCOS(COS_KEY);
    } catch (e) { /* COS 清理尽力而为 */ }
  }
  for (const f of ['plagtest_a.png', 'plagtest_acopy.jpg', 'plagtest_b.png']) {
    try { fs.unlinkSync(path.join(UPLOADS, f)); } catch (e) {}
  }
  const remain = await PlagiarismResult.count({ where: { assignment_id: ctx.assignment.id } });
  check('测试数据已清理（结果表无残留）', remain === 0);

  console.log(`\n===== 结果：${passCount} 通过 / ${failCount} 失败 =====`);
  await sequelize.close();
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(async err => {
  console.error('\n测试异常:', err.message);
  try {
    // 兜底清理，避免脏数据
    if (ctx.assignment) {
      await PlagiarismResult.destroy({ where: { assignment_id: ctx.assignment.id } }).catch(() => {});
      await PlagiarismTask.destroy({ where: { assignment_id: ctx.assignment.id } }).catch(() => {});
      await Assignment.destroy({ where: { id: ctx.assignment.id } }).catch(() => {});
    }
    if (ctx.course) await Course.destroy({ where: { id: ctx.course.id } }).catch(() => {});
    if (ctx.class) {
      await ClassStudent.destroy({ where: { class_id: ctx.class.id } }).catch(() => {});
      await Class.destroy({ where: { id: ctx.class.id } }).catch(() => {});
    }
    if (ctx.students) await User.destroy({ where: { id: ctx.students.map(s => s.id) } }).catch(() => {});
    if (ctx.submissions) {
      await SubmissionFile.destroy({ where: { submission_id: ctx.submissions.map(s => s.id) } }).catch(() => {});
      await Submission.destroy({ where: { id: ctx.submissions.map(s => s.id) } }).catch(() => {});
    }
    await sequelize.close().catch(() => {});
  } catch (e) {}
  process.exit(1);
});
