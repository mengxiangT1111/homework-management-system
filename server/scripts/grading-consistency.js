/**
 * 评分一致性验证脚本
 * 用法：
 *   node scripts/grading-consistency.js golden-set.jsonl --template=1 --runs=5
 *   node scripts/grading-consistency.js golden-set.jsonl --template=1 --channel=canary
 *
 * golden-set.jsonl 每行一个 JSON：
 *   {"student_answer":"...","reference_answer":"...","teacher_score":78}
 * teacher_score 为教师人工基准分（建议 2 名教师独立打分取均值）。
 *
 * 指标与达标线：
 *   MAE ≤ 5 分；|AI-教师| ≤ 5 的比例 ≥ 80%；Pearson r ≥ 0.85；重复批改极差 ≤ 10 分。
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { PromptVersion, PromptRouting } = require('../src/models');
const promptService = require('../src/services/prompt.service');
const templateService = require('../src/services/grading/template.service');
const llmClient = require('../src/services/grading/llmClient');
const {
  safeParseJSON, parseGradingOutput, computeTotalScore
} = require('../src/utils/gradingResultParser');

function pearson(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}

async function main() {
  const args = process.argv.slice(2);
  const file = args[0];
  if (!file || !fs.existsSync(file)) {
    console.error('用法: node scripts/grading-consistency.js <golden-set.jsonl> [--template=ID] [--runs=5] [--channel=stable|canary]');
    process.exit(1);
  }
  const runs = Number((args.find(a => a.startsWith('--runs=')) || '--runs=5').split('=')[1]);
  const channel = (args.find(a => a.startsWith('--channel=')) || '--channel=stable').split('=')[1];
  const templateId = Number((args.find(a => a.startsWith('--template=')) || '--template=1').split('=')[1]);
  const outArg = args.find(a => a.startsWith('--out='));
  const outFile = outArg ? outArg.replace('--out=', '') : null;

  const items = fs.readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean).map(JSON.parse);
  if (items.length < 5) {
    console.error('黄金集至少需要 5 份样本');
    process.exit(1);
  }
  console.log(`黄金集 ${items.length} 份 | 每份重复 ${runs} 次 | 通道 ${channel} | 模板ID ${templateId}\n`);

  const template = await templateService.getDetail(templateId);
  if (!template) {
    console.error(`模板 ${templateId} 不存在`);
    process.exit(1);
  }
  const templateJSON = templateService.buildTemplateJSON(template);

  // 取指定通道的提示词
  const routing = await PromptRouting.findOne({ where: { prompt_key: 'grading.main' } });
  if (!routing) {
    console.error('提示词路由未初始化（请先启动一次服务）');
    process.exit(1);
  }
  const versionId = channel === 'canary' ? routing.canary_version_id : routing.stable_version_id;
  if (!versionId) {
    console.error(`通道 ${channel} 未配置版本`);
    process.exit(1);
  }
  const version = await PromptVersion.findByPk(versionId);
  const prompt = { version: version.version, systemPrompt: version.system_prompt, modifiers: version.modifiers || {} };
  console.log(`提示词版本：${version.version}\n`);

  const report = [];
  let skipped = 0;
  let latencyTotal = 0, latencyCount = 0;
  let callFail = 0, callTotal = 0;   // JSON/网络失败事件数与总调用数（消融实验要求的解析失败率）
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const scores = [];
    for (let r = 0; r < runs; r++) {
      const system = promptService.renderSystemPrompt(prompt, templateJSON);
      const user = promptService.buildUserMessage(prompt, {
        fullScore: templateJSON.full_score,
        referenceAnswer: item.reference_answer,
        gradingCriteria: null,
        studentAnswer: item.student_answer,
        mode: 'balanced'
      });
      // 单次批改失败（网络/格式异常）自动重试 2 次，仍失败跳过该次而不中断整个实验
      callTotal++;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const t0 = Date.now();
          const resp = await llmClient.chatCompletion({
            messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
            temperature: 0.1,
            maxTokens: 4096,
            jsonMode: true
          });
          latencyTotal += Date.now() - t0; latencyCount++;
          const parsed = parseGradingOutput(safeParseJSON(resp.content), templateJSON);
          scores.push(computeTotalScore(parsed.dimensions, templateJSON));
          break;
        } catch (e) {
          callFail++;
          if (attempt === 3) {
            console.warn(`[${i + 1}/${items.length}] 第 ${r + 1} 次批改连续 3 次失败，跳过该次: ${e.message}`);
          } else {
            await new Promise(res => setTimeout(res, 2000 * attempt));
          }
        }
      }
    }
    if (scores.length === 0) {
      skipped++;
      console.warn(`[${i + 1}/${items.length}] 该样本全部尝试失败，已跳过`);
      continue;
    }
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    report.push({
      idx: i + 1,
      teacher: item.teacher_score,
      mean: Math.round(mean * 10) / 10,
      range: Math.round((max - min) * 10) / 10,
      absErr: Math.round(Math.abs(mean - item.teacher_score) * 10) / 10
    });
    console.log(`[${i + 1}/${items.length}] 教师基准 ${item.teacher_score} | AI均值 ${report[report.length - 1].mean} | 极差 ${report[report.length - 1].range}`);
  }

  // ===== 汇总指标 =====
  const errs = report.map(r => r.absErr);
  const mae = Math.round(errs.reduce((a, b) => a + b, 0) / errs.length * 10) / 10;
  const within5 = Math.round(report.filter(r => r.absErr <= 5).length / report.length * 100);
  const r = Math.round(pearson(report.map(x => x.mean), report.map(x => x.teacher)) * 100) / 100;
  const maxRange = Math.max(...report.map(x => x.range));

  console.log('\n========== 一致性报告 ==========');
  console.log(`有效样本: ${report.length}${skipped ? `（跳过 ${skipped} 份全失败样本）` : ''}`);
  console.log(`MAE（平均绝对误差）  : ${mae} 分   达标线 ≤ 5`);
  console.log(`±5 分一致率          : ${within5}%    达标线 ≥ 80%`);
  console.log(`Pearson 相关系数     : ${r}     达标线 ≥ 0.85`);
  console.log(`重复批改最大极差     : ${maxRange} 分   达标线 ≤ 10`);
  if (latencyCount) console.log(`单次调用平均耗时     : ${Math.round(latencyTotal / latencyCount / 100) / 10}s（${latencyCount} 次）`);
  if (callTotal) console.log(`调用失败率（含重试） : ${Math.round(callFail / callTotal * 1000) / 10}%（${callFail}/${callTotal}）`);
  console.log('================================');

  // 机器可读工件：逐样本分数与汇总，供消融实验留档与二次分析
  if (outFile) {
    fs.writeFileSync(outFile, JSON.stringify({
      meta: { goldenSet: file, templateId, channel, runs, promptVersion: version.version, model: process.env.AI_MODEL, generatedAt: new Date().toISOString() },
      summary: { n: report.length, skipped, mae, within5, pearson: r, maxRange,
        avgLatencySec: latencyCount ? Math.round(latencyTotal / latencyCount / 100) / 10 : null,
        callFailRate: callTotal ? Math.round(callFail / callTotal * 1000) / 10 : null },
      items: report
    }, null, 2), 'utf-8');
    console.log(`✓ 结果已写出: ${outFile}`);
  }
  process.exit(0);
}

main().catch(err => {
  console.error('脚本失败:', err.message);
  process.exit(1);
});
