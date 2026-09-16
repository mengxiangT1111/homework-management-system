/**
 * export_experiment.js — 论文实验数据导出脚本
 *
 * 把某个作业的 AI 批改结果导出为 compute_metrics.py 需要的格式：
 *   ai.csv               实验编号 + AI分数/置信度/复核标记/五信号
 *   teacher_template.csv 教师双评填写模板（教师线下双评后在此填分）
 *   id_map.csv           实验编号 ↔ 提交ID ↔ 学生（含真实姓名，仅本地留存勿外传）
 *
 * 用法（在 server 目录下）：
 *   node scripts/export_experiment.js --assignment 12
 *   node scripts/export_experiment.js --assignment 12 --model qwen --out ../docs/paper_tools/run2
 *
 * 说明：
 *   - --model 按模型名模糊过滤（第二遍换底座模型重批后，用它与第一遍分开导出），
 *     同一提交取该模型下最新一条结果（created_at, id 双字段排序，避免时间相同漂移）
 *   - 五信号从 review_reasons 原因串反解（满分/0分异常、作答过短、钳制、格式重试、维度缺失）
 *   - 实验编号按"全部提交"固定 1..N：某遍个别失败缺结果时编号不平移，
 *     两个模型的导出与教师表天然按 id 对齐（compute_metrics 按 id 交集取共同样本）
 *   - 系统未记录批改时延，故 ai.csv 不含 latency_s 列（compute_metrics.py 允许缺失）
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const { sequelize, Assignment, Submission, GradingResult, GradingTask, User } = require('../src/models');

function parseArgs() {
  const args = { out: null, model: null, assignment: null };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--assignment') args.assignment = Number(argv[++i]);
    else if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--model') args.model = argv[++i];
  }
  if (!args.assignment || !Number.isFinite(args.assignment)) {
    console.error('用法: node scripts/export_experiment.js --assignment <作业ID> [--model <模型名关键字>] [--out <输出目录>]');
    process.exit(1);
  }
  return args;
}

// 从 review_reasons 原因串反解五信号（串的文案见 grading.service.js / gradingResultParser.js）
function extractSignals(reasons) {
  const s = { parse_retry: 0, clamp_count: 0, missing_count: 0, extreme_total: 0, short_answer: 0 };
  for (const r of reasons || []) {
    if (/格式异常/.test(r)) s.parse_retry = 1;
    const clamp = r.match(/(\d+)\s*个维度分数越界/);
    if (clamp) s.clamp_count = Number(clamp[1]);
    const miss = r.match(/(\d+)\s*个维度AI未评分/);
    if (miss) s.missing_count = Number(miss[1]);
    // 满分/0分异常有两条文案：置信度扣分的"总分为满分或0分"与自动回写的"AI 判定满分"
    if (/满分或0分|判定满分/.test(r)) s.extreme_total = 1;
    if (/作答过短/.test(r)) s.short_answer = 1;
  }
  return s;
}

function csvEscape(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function writeCsv(file, header, rows) {
  const lines = [header.join(','), ...rows.map(r => r.map(csvEscape).join(','))];
  fs.writeFileSync(file, '\ufeff' + lines.join('\r\n') + '\r\n', 'utf8'); // BOM 便于 Excel 打开
  console.log(`✓ 已写出 ${file}（${rows.length} 行）`);
}

async function main() {
  const args = parseArgs();
  const outDir = path.resolve(args.out || path.join(__dirname, '../../docs/paper_tools', `export_a${args.assignment}`));
  fs.mkdirSync(outDir, { recursive: true });

  await sequelize.authenticate();
  const assignment = await Assignment.findByPk(args.assignment);
  if (!assignment) throw new Error(`作业 ${args.assignment} 不存在`);
  console.log(`作业: ${assignment.title}（id=${assignment.id}）`);

  const submissions = await Submission.findAll({
    where: { assignment_id: args.assignment },
    include: [{ model: User, as: 'student', attributes: ['id', 'username', 'real_name'] }],
    order: [['id', 'ASC']]
  });
  if (submissions.length === 0) throw new Error('该作业暂无提交');
  const subIds = submissions.map(s => s.id);

  // 批量取结果（一次查询；N+1 会在几百份提交时明显变慢），
  // 每份提交取该模型下最新一条；未过滤模型时取全局最新
  const resultWhere = { submission_id: { [Op.in]: subIds } };
  if (args.model) resultWhere.llm_model = { [Op.like]: `%${args.model}%` };
  const results = await GradingResult.findAll({
    where: resultWhere,
    order: [['created_at', 'DESC'], ['id', 'DESC']],
    include: [{ model: GradingTask, as: 'task', attributes: ['template_snapshot'] }]
  });
  const latestBySub = new Map();
  for (const r of results) {
    if (!latestBySub.has(r.submission_id)) latestBySub.set(r.submission_id, r);
  }

  // 无结果提交的科目/满分兜底：取该提交任意批改任务的模板快照（含失败/取消的任务）
  const missing = submissions.filter(s => !latestBySub.has(s.id));
  let taskSnapBySub = new Map();
  if (missing.length > 0) {
    const tasks = await GradingTask.findAll({
      where: { submission_id: { [Op.in]: missing.map(s => s.id) } },
      order: [['id', 'DESC']],
      attributes: ['submission_id', 'template_snapshot']
    });
    for (const t of tasks) {
      if (!taskSnapBySub.has(t.submission_id)) taskSnapBySub.set(t.submission_id, t.template_snapshot || {});
    }
  }

  if (latestBySub.size === 0) {
    throw new Error(args.model
      ? `没有任何提交存在模型名含 "${args.model}" 的批改结果（检查 --model 过滤条件，或 grading_results.llm_model 实际取值）`
      : '没有任何提交存在批改结果（先在教师端发起 AI 批改）');
  }

  const aiRows = [], tplRows = [], mapRows = [];
  submissions.forEach((sub, idx) => {
    const id = idx + 1;
    const result = latestBySub.get(sub.id);
    const snap = result
      ? ((result.task && result.task.template_snapshot) || {})
      : (taskSnapBySub.get(sub.id) || {});
    const subject = snap.subject || 'unknown';
    const full = Number(snap.full_score || (result ? result.full_score : 0) || 100);
    tplRows.push([id, subject, full, '', '']);
    mapRows.push([id, sub.id, sub.student ? sub.student.username : '', sub.student ? sub.student.real_name : '']);
    if (!result) return;
    const sig = extractSignals(result.review_reasons);
    aiRows.push([
      id,
      Number(result.total_score),
      Number(result.confidence),
      result.needs_review ? 1 : 0,
      sig.parse_retry, sig.clamp_count, sig.missing_count, sig.extreme_total, sig.short_answer
    ]);
  });

  const coverage = (latestBySub.size / submissions.length) * 100;
  if (latestBySub.size < submissions.length) {
    console.log(`⚠ ${submissions.length - latestBySub.size} 份提交无匹配结果（ai.csv 缺位，compute_metrics 按 id 交集对齐）`);
  }
  if (coverage < 90) {
    console.log(`⚠⚠ 结果覆盖率仅 ${coverage.toFixed(1)}%：实验要求全量批改，建议先补批缺的提交再导出`);
  }

  writeCsv(path.join(outDir, 'ai.csv'),
    ['id', 'ai_score', 'confidence', 'review', 'parse_retry', 'clamp_count', 'missing_count', 'extreme_total', 'short_answer'],
    aiRows);
  writeCsv(path.join(outDir, 'teacher_template.csv'),
    ['id', 'subject', 'full_score', 'teacher1', 'teacher2'],
    tplRows);
  writeCsv(path.join(outDir, 'id_map.csv'),
    ['id', 'submission_id', 'username', 'real_name'],
    mapRows);

  const subjects = [...new Set(tplRows.map(r => r[1]))];
  console.log(`\n科目: ${subjects.join(' / ')}；满分: ${[...new Set(tplRows.map(r => r[2]))].join(' / ')}`);
  console.log('下一步:');
  console.log('  1. 把 teacher_template.csv 交给两位教师背靠背填写 teacher1/teacher2 → 另存为 teacher.csv');
  console.log('  2. python compute_metrics.py --teacher teacher.csv --ai ai.csv --theta 0.6');
  console.log('  ⚠ id_map.csv 含学生真实姓名，仅本地对照使用，勿上传/入库/写入论文');
  await sequelize.close();
}

main().catch(e => { console.error('✗ 导出失败:', e.message); process.exit(1); });
