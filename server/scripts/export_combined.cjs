/* export_combined.cjs — 多作业合并导出 ai.csv（预实验专用：一次实验跨语文/数学/英语三个作业）
 * 与官方单作业导出 scripts/export_experiment.js 的分工：
 *   - export_experiment.js：正式实验标准链路（单作业，含 id_map / teacher_template / --model 多模型对齐）
 *   - 本脚本：把多个作业的批改结果合并成全局 1..N 编号的 ai.csv，与 docs/experiment_data/teacher.csv 对齐
 * 运行（server 目录）：
 *   node scripts/export_combined.cjs --assignments 12,13,14 --out ../docs/experiment_data/ai.csv
 * 说明：系统不记录批改时延（grading_results 的 created_at/updated_at 均为入库时间，差值无意义），
 *       故不输出 latency_s 列；耗时请用 grading-consistency.js 的直连计时。
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const fs = require('fs');
const { sequelize } = require('../src/models');

const argv = process.argv.slice(2);
function argOf(name, dflt) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : dflt;
}
const assignments = String(argOf('--assignments', '')).split(',').map(Number).filter(Boolean);
const OUT = path.resolve(argOf('--out', path.join(__dirname, '../../docs/experiment_data/ai.csv')));
if (assignments.length === 0) {
  console.error('用法: node scripts/export_combined.cjs --assignments 12,13,14 [--out <ai.csv路径>]');
  process.exit(1);
}

// 信号正则与 scripts/export_experiment.js 保持一致（含"AI 判定满分"回写文案，勿各自漂移）
function parseSignals(reasons) {
  const sig = { parse_retry: 0, clamp_count: 0, missing_count: 0, extreme_total: 0, short_answer: 0 };
  for (const r of reasons || []) {
    const s = String(r);
    if (/格式异常|重试/.test(s)) sig.parse_retry = 1;
    const clamp = s.match(/(\d+)\s*个维度分数越界/);
    if (clamp) sig.clamp_count = Number(clamp[1]);
    const miss = s.match(/(\d+)\s*个维度AI未评分/);
    if (miss) sig.missing_count = Number(miss[1]);
    if (/满分或0分|判定满分/.test(s)) sig.extreme_total = 1;
    if (/作答过短/.test(s)) sig.short_answer = 1;
  }
  return sig;
}

(async () => {
  await sequelize.authenticate();
  const [rows] = await sequelize.query(`
    SELECT s.assignment_id, s.id AS submission_id, sf.original_name,
           gr.id AS gr_id, gr.total_score, gr.confidence, gr.needs_review, gr.review_reasons
    FROM grading_results gr
    JOIN submissions s ON s.id = gr.submission_id
    LEFT JOIN submission_files sf ON sf.submission_id = s.id
    WHERE s.assignment_id IN (${assignments.join(',')})
    ORDER BY gr.id ASC`);

  // 每个提交只保留最新一次批改
  const latest = new Map();
  for (const r of rows) {
    const prev = latest.get(r.submission_id);
    if (!prev || r.gr_id > prev.gr_id) latest.set(r.submission_id, r);
  }

  const out = [['id', 'ai_score', 'confidence', 'review', 'parse_retry', 'clamp_count',
    'missing_count', 'extreme_total', 'short_answer'].join(',')];
  const problems = [];
  for (const r of latest.values()) {
    const m = String(r.original_name || '').match(/student_(\d+)/);
    if (!m) { problems.push(`提交 ${r.submission_id} 文件名无法映射编号: ${r.original_name}`); continue; }
    const reasons = typeof r.review_reasons === 'string' ? JSON.parse(r.review_reasons || '[]') : (r.review_reasons || []);
    const sig = parseSignals(reasons);
    out.push([Number(m[1]), Number(r.total_score).toFixed(1), Number(r.confidence).toFixed(3),
      r.needs_review ? 1 : 0, sig.parse_retry, sig.clamp_count, sig.missing_count,
      sig.extreme_total, sig.short_answer].join(','));
  }
  out.sort((a, b) => Number(a.split(',')[0]) - Number(b.split(',')[0]));

  fs.writeFileSync(OUT, out.join('\n') + '\n', 'utf-8');
  console.log(`✅ 导出 ${latest.size} 条批改结果 → ${OUT}`);
  if (problems.length) { console.log('⚠️ 未映射:'); problems.forEach(p => console.log('  -', p)); }
  await sequelize.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
