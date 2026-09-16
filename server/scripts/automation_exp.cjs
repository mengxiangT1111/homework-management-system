/* automation_exp.cjs — 实验自动化：建 40 名学生 → 建班级/课程/3 个作业 → 上传并提交 100 份模拟作业
 * 运行：server 目录下 node automation_exp.cjs
 * 说明：登录接口有 IP 限流（15 分钟 10 次），故除教师外一律用 JWT_SECRET 直接签发 token。
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const fs = require('fs');
const { sequelize, User } = require('./src/models');
const { generateToken } = require('./src/utils/auth');

const BASE = 'http://localhost:3000/api';
const SCHOOL_NAME = '信衡演示学校';
const CLASS_NAME = '实验一班';
const STU_COUNT = 40;
const STU_PASS = 'Exp@123456';
const DATA_DIR = path.resolve(__dirname, '../../docs/experiment_data');
const DEADLINE = '2026-12-31T23:59:59';

const ASSIGNMENTS = [
  { subject: '语文作文', course: '语文（实验）', title: '语文作文·模拟作业（预实验）' },
  { subject: '数学简答', course: '数学（实验）', title: '数学简答·模拟作业（预实验）' },
  { subject: '英语书面表达', course: '英语（实验）', title: '英语书面表达·模拟作业（预实验）' },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(method, url, token, body, isForm) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !isForm) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + url, {
    method,
    headers,
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function mintToken(username) {
  const u = await User.findOne({ where: { username } });
  if (!u) throw new Error(`用户不存在: ${username}`);
  return generateToken(u.id, u.password);
}

(async () => {
  await sequelize.authenticate();
  const summary = { students: 0, class: null, courses: [], assignments: [], uploaded: 0, submitted: 0, skipped: 0, errors: [] };

  // ===== 1. 管理员 token；创建/复用属于目标学校的实验教师 =====
  const adminToken = await mintToken('admin');
  const schools = (await api('GET', '/schools/all')).json.data || [];
  const school = schools.find(s => s.name === SCHOOL_NAME);
  if (!school) throw new Error('未找到信衡演示学校');

  let expTeacher = await User.findOne({ where: { username: 'exp_teacher' } });
  if (!expTeacher) {
    const r = await api('POST', '/users/teacher', adminToken, {
      username: 'exp_teacher', password: 'Exp@123456', real_name: '实验教师', school_id: school.id,
    });
    if (!r.json.success) throw new Error('建教师失败: ' + r.json.message);
    expTeacher = await User.findOne({ where: { username: 'exp_teacher' } });
  }
  const teacherToken = generateToken(expTeacher.id, expTeacher.password);
  console.log(`[1] token 就绪（admin=ok, 实验教师 id=${expTeacher.id} school=${expTeacher.school_id}）`);

  // ===== 2. 学校 =====
  console.log(`[2] 学校: ${school.name} (id=${school.id})`);

  // ===== 3. 创建 40 名学生（幂等：409 视为已存在） =====
  const studentIds = [];
  for (let i = 1; i <= STU_COUNT; i++) {
    const username = `exp${String(i).padStart(3, '0')}`;
    const real_name = `实验学生${String(i).padStart(2, '0')}`;
    const r = await api('POST', '/users/student', adminToken, {
      username, password: STU_PASS, real_name, school_id: school.id,
    });
    if (r.json.success) summary.students++;
    else if (r.status === 409) { /* 已存在 */ }
    else summary.errors.push(`建学生 ${username}: ${r.json.message}`);
  }
  console.log(`[3] 学生新建 ${summary.students} 名（其余已存在）`);
  const stuUsers = await User.findAll({ where: { username: Array.from({ length: STU_COUNT }, (_, i) => `exp${String(i + 1).padStart(3, '0')}`) }, order: [['username', 'ASC']] });
  const stuTokens = {};
  for (const u of stuUsers) stuTokens[u.username] = generateToken(u.id, u.password);
  if (stuUsers.length !== STU_COUNT) throw new Error(`学生数量不足: ${stuUsers.length}`);

  // ===== 4. 班级（幂等：按名字查） =====
  const clsList = (await api('GET', '/classes/all/list', adminToken)).json.data || [];
  let cls = clsList.find(c => c.name === CLASS_NAME);
  if (!cls) {
    const r = await api('POST', '/classes', adminToken, {
      name: CLASS_NAME, grade: '高二', school_id: school.id, teacher_id: expTeacher.id,
      description: 'AI 批改预实验班级',
    });
    if (!r.json.success) throw new Error('建班级失败: ' + r.json.message);
    cls = r.json.data;
  }
  summary.class = cls.id;
  console.log(`[4] 班级: ${cls.name} (id=${cls.id})`);

  // 学生加入班级
  const rAdd = await api('POST', `/classes/${cls.id}/students`, adminToken, { student_ids: stuUsers.map(u => u.id) });
  console.log(`    学生入班: ${rAdd.status === 200 || rAdd.status === 201 ? 'ok' : rAdd.json.message}`);

  // ===== 5. 课程 + 作业（幂等：同名跳过） =====
  const manifest = fs.readFileSync(path.join(DATA_DIR, 'manifest.csv'), 'utf-8').split(/\r?\n/).filter(Boolean).slice(1)
    .map(l => { const [id, subject, full, file] = l.split(','); return { id: Number(id), subject, file }; });

  const assignMap = {}; // subject -> {assignmentId, path}
  for (const cfg of ASSIGNMENTS) {
    // 课程
    const courses = (await api('GET', '/courses/all/list', teacherToken)).json.data || [];
    let course = courses.find(c => c.name === cfg.course && c.class_id === cls.id);
    if (!course) {
      const r = await api('POST', '/courses', teacherToken, { name: cfg.course, class_id: cls.id, semester: '2026秋' });
      if (!r.json.success) throw new Error('建课程失败: ' + r.json.message);
      course = r.json.data;
    }
    summary.courses.push(course.id);
    // 作业
    const asgList = (await api('GET', `/assignments?course_id=${course.id}`, teacherToken)).json.data;
    const list = asgList.list || asgList.rows || asgList || [];
    let asg = (Array.isArray(list) ? list : []).find(a => a.title === cfg.title);
    if (!asg) {
      const r = await api('POST', '/assignments', teacherToken, {
        title: cfg.title, description: '系统联调与预实验模拟作业，学生作答由脚本生成。',
        course_id: course.id, deadline: DEADLINE,
        allowed_formats: ['txt'], max_files: 1, max_size_mb: 10, need_grading: 1,
      });
      if (!r.json.success) throw new Error(`建作业失败(${cfg.title}): ` + r.json.message);
      asg = r.json.data;
    }
    assignMap[cfg.subject] = asg.id;
    summary.assignments.push(asg.id);
    console.log(`[5] ${cfg.subject}: 课程 ${course.id} → 作业 ${asg.id}`);
  }

  // ===== 6. 上传并提交 =====
  // 学生 i (1..40) 依次认领本学科的第 i 份文件
  const bySubject = {};
  for (const m of manifest) (bySubject[m.subject] = bySubject[m.subject] || []).push(m);

  for (const cfg of ASSIGNMENTS) {
    const items = bySubject[cfg.subject] || [];
    for (let k = 0; k < items.length; k++) {
      const stu = stuUsers[k];
      const token = stuTokens[stu.username];
      const item = items[k];
      const absPath = path.join(DATA_DIR, item.file.replace(/\//g, '\\'));
      const filename = `student_${String(item.id).padStart(3, '0')}.txt`;
      const buf = fs.readFileSync(absPath);

      // 6.1 上传（uploadLimiter 60/min → 间隔 1.1s）
      const fd = new FormData();
      fd.append('file', new Blob([buf], { type: 'text/plain' }), filename);
      let up = await api('POST', '/upload/simple', token, fd, true);
      if (!up.json.success) {
        summary.errors.push(`上传失败 ${filename}: ${up.json.message}`);
        continue;
      }
      summary.uploaded++;
      await sleep(1100);

      // 6.2 提交
      const f = up.json.data;
      const sub = await api('POST', `/submissions/assignment/${assignMap[cfg.subject]}`, token, {
        files: [{ original_name: f.original_name, file_path: f.file_path, file_size: f.file_size, mime_type: 'text/plain', file_hash: null }],
        remark: `预实验提交（编号 ${filename}）`,
      });
      if (sub.json.success) summary.submitted++;
      else {
        const msg = sub.json.message || '';
        if (/已经?提交|重复|已提交/.test(msg)) summary.skipped++;
        else summary.errors.push(`提交失败 ${filename}: ${msg}`);
      }
    }
    console.log(`    ${cfg.subject}: 完成（累计提交 ${summary.submitted}，跳过 ${summary.skipped}）`);
  }

  console.log('\n===== 汇总 =====');
  console.log(JSON.stringify(summary, null, 2));
  await sequelize.close();
  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
