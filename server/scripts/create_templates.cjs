/* create_templates.cjs — 批量创建并发布 4 个 AI 批改评分模板（幂等：同名跳过）
 * 运行：server 目录下 node create_templates.cjs */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { sequelize, User } = require('./src/models');
const { generateToken } = require('./src/utils/auth');

const BASE = 'http://localhost:3000/api';

// 按权重生成 A/B/C/D 四档分数区间（满分100时维度满分=权重），高分档在前
function rubrics(defs, w) {
  const r05 = x => Math.round(x * 2) / 2;
  const A = [r05(w * 0.85), w];
  const B = [r05(w * 0.7), A[0] - 0.5];
  const C = [r05(w * 0.4), B[0] - 0.5];
  const D = [0, C[0] - 0.5];
  const ranges = [A, B, C, D];
  return defs.map(([level, descriptor], i) => ({ level, score_range: ranges[i], descriptor }));
}

// 各维度扣分规则（维度编码 → 规则数组）
const DED = {
  conventions: [
    { description: '错别字（每个）', penalty: 0.5, max_penalty: 3 },
    { description: '卷面涂改（每处）', penalty: 0.5, max_penalty: 2 },
  ],
  language: [{ description: '病句（每处）', penalty: 1, max_penalty: 4 }],
  presentation: [
    { description: '未写“答”或结论句', penalty: 1, max_penalty: 2 },
    { description: '结果未化简或漏单位', penalty: 1, max_penalty: 2 },
  ],
  spelling: [{ description: '拼写错误（每个）', penalty: 0.5, max_penalty: 3 }],
};

const TEMPLATES = [
  {
    name: '语文作文批改模板（通用记叙/议论文）', subject: '语文', content_type: 'essay', full_score: 100,
    description: '适用于中学记叙文与议论文：内容立意 40 / 结构层次 20 / 语言表达 25 / 书写规范 15，含错别字与卷面扣分规则。',
    dimensions: [
      { code: 'content', name: '内容与立意', weight: 40, description: '立意深度、选材贴切度、内容充实程度与情感真实性',
        rubrics: rubrics([
          ['A', '立意深刻新颖，选材贴切典型，内容充实具体，情感真挚动人'],
          ['B', '中心明确，选材适当，内容较具体，有一定真情实感'],
          ['C', '中心基本明确，内容单薄或泛泛而谈，情感不够真实'],
          ['D', '偏题跑题或内容空洞，字数严重不足，无有效内容'],
        ], 40) },
      { code: 'structure', name: '结构层次', weight: 20, description: '谋篇布局、段落安排、过渡衔接与首尾照应',
        rubrics: rubrics([
          ['A', '结构严谨，层次分明，过渡自然，首尾呼应巧妙'],
          ['B', '结构完整，条理清楚，衔接较自然'],
          ['C', '结构基本完整但层次不清，过渡生硬'],
          ['D', '结构混乱或无段落意识，不成篇章'],
        ], 20) },
      { code: 'language', name: '语言表达', weight: 25, description: '用词准确性、句式变化、修辞运用与文风',
        rubrics: rubrics([
          ['A', '语言流畅有文采，用词精准，句式富于变化，善用修辞'],
          ['B', '语言通顺，表达清楚，偶有佳句'],
          ['C', '语言基本通顺但平淡，病句较多'],
          ['D', '语句不通，表达混乱，影响理解'],
        ], 25) },
      { code: 'conventions', name: '书写与规范', weight: 15, description: '卷面整洁度、标点规范、字数达标情况',
        rubrics: rubrics([
          ['A', '卷面整洁，书写工整，标点规范，字数达标'],
          ['B', '卷面较整洁，偶有涂改，字数达标'],
          ['C', '卷面不洁或字迹潦草，字数略不足'],
          ['D', '卷面脏乱难以辨认，字数严重不足'],
        ], 15) },
    ].map(d => ({ ...d, deduction_rules: DED[d.code] || [] })),
  },
  {
    name: '数学简答题批改模板（步骤给分制）', subject: '数学', content_type: 'short_answer', full_score: 100,
    description: '适用于数学解答题：按步骤给分思想设计，思路 40 / 过程 30 / 结果 20 / 表述 10，含未作答与未化简扣分。',
    dimensions: [
      { code: 'approach', name: '解题思路', weight: 40, description: '方法选择是否正确、建模与转化是否合理',
        rubrics: rubrics([
          ['A', '思路清晰正确，方法选择恰当，建模转化合理'],
          ['B', '思路基本正确，方法可行但欠优化'],
          ['C', '思路部分正确，方法选择有误但仍有可取步骤'],
          ['D', '思路错误或完全未作答'],
        ], 40) },
      { code: 'process', name: '计算过程', weight: 30, description: '推理与运算过程的正确性、完整性',
        rubrics: rubrics([
          ['A', '推理严密，运算准确，步骤完整规范'],
          ['B', '过程正确，个别运算笔误但不影响结论'],
          ['C', '过程有明显错误或关键步骤缺失'],
          ['D', '过程几乎不可用或无过程'],
        ], 30) },
      { code: 'answer', name: '结果正确性', weight: 20, description: '最终答案的准确性与完整性（含多解、舍解情况）',
        rubrics: rubrics([
          ['A', '结果正确且完整，考虑所有情况'],
          ['B', '结果正确但表达不够完整'],
          ['C', '结果错误，但由过程错误自然导出'],
          ['D', '结果错误且与过程无关，或未给出结果'],
        ], 20) },
      { code: 'presentation', name: '表述规范', weight: 10, description: '设元、作答、单位、逻辑符号使用规范',
        rubrics: rubrics([
          ['A', '设元清晰，作答完整，单位与符号规范'],
          ['B', '表述基本规范，个别地方不严谨'],
          ['C', '表述不规范，缺少必要说明'],
          ['D', '无规范表述意识'],
        ], 10) },
    ].map(d => ({ ...d, deduction_rules: DED[d.code] || [] })),
  },
  {
    name: '英语书面表达批改模板', subject: '英语', content_type: 'essay', full_score: 100,
    description: '适用于英语作文：内容要点 30 / 语言准确性 30 / 词汇句型 20 / 篇章结构 20，含拼写扣分。',
    dimensions: [
      { code: 'content', name: '内容要点', weight: 30, description: '是否覆盖题目要求的全部要点，内容切题充实',
        rubrics: rubrics([
          ['A', '覆盖全部要点，内容切题充实，有细节支撑'],
          ['B', '覆盖大部分要点，内容较切题'],
          ['C', '遗漏部分要点，内容单薄'],
          ['D', '严重偏题或要点大量缺失'],
        ], 30) },
      { code: 'language', name: '语言准确性', weight: 30, description: '语法、时态、主谓一致、拼写等语言错误密度',
        rubrics: rubrics([
          ['A', '语法准确，几乎无错误，用词得当'],
          ['B', '有少量语法错误，不影响理解'],
          ['C', '语法错误较多，部分句子影响理解'],
          ['D', '错误密集，句子难以理解'],
        ], 30), deduction_rules: DED.spelling },
      { code: 'vocabulary', name: '词汇与句型', weight: 20, description: '词汇丰富度、高级句式与连接词使用',
        rubrics: rubrics([
          ['A', '词汇丰富，句式多样，连接词使用自然'],
          ['B', '词汇句型有一定变化，使用了常见连接词'],
          ['C', '词汇句型单一，重复明显'],
          ['D', '词汇匮乏，句式破碎'],
        ], 20) },
      { code: 'organization', name: '篇章结构', weight: 20, description: '段落划分、逻辑连贯与格式规范（如书信格式）',
        rubrics: rubrics([
          ['A', '段落清晰，逻辑连贯，格式规范'],
          ['B', '有段落意识，连贯性尚可'],
          ['C', '段落不清，缺乏衔接'],
          ['D', '无篇章组织，词句堆砌'],
        ], 20) },
    ].map(d => ({ ...d, deduction_rules: DED[d.code] || [] })),
  },
  {
    name: '通用主观题批改模板（要点覆盖制）', subject: '通用', content_type: 'short_answer', full_score: 100,
    description: '适用于各科简答、论述类主观题：要点覆盖 40 / 理解深度 30 / 表述清晰 20 / 规范 10。',
    dimensions: [
      { code: 'coverage', name: '要点覆盖', weight: 40, description: '对参考答案中各要点的覆盖程度',
        rubrics: rubrics([
          ['A', '要点覆盖完整，无遗漏'],
          ['B', '覆盖大部分要点'],
          ['C', '仅覆盖少数要点'],
          ['D', '未覆盖任何有效要点或未作答'],
        ], 40) },
      { code: 'understanding', name: '理解深度', weight: 30, description: '对概念原理的理解准确性与深入程度',
        rubrics: rubrics([
          ['A', '理解准确深入，能联系拓展'],
          ['B', '理解正确，但停留在表层'],
          ['C', '理解有偏差或模糊'],
          ['D', '理解存在明显错误'],
        ], 30) },
      { code: 'clarity', name: '表述清晰', weight: 20, description: '条理性、逻辑性与学科语言准确性',
        rubrics: rubrics([
          ['A', '条理清晰，逻辑严密，术语准确'],
          ['B', '表述清楚，逻辑基本连贯'],
          ['C', '表述含糊，条理不清'],
          ['D', '表述混乱无法理解'],
        ], 20) },
      { code: 'format', name: '作答规范', weight: 10, description: '卷面、序号、格式等规范性',
        rubrics: rubrics([
          ['A', '作答规范，分点清晰'],
          ['B', '作答基本规范，个别欠妥'],
          ['C', '不规范，缺少分点'],
          ['D', '毫无规范意识，随意作答'],
        ], 10) },
    ].map(d => ({ ...d, deduction_rules: [] })),
  },
];

(async () => {
  await sequelize.authenticate();
  const teacher = await User.findOne({ where: { username: 'exp_teacher' } });
  if (!teacher) throw new Error('exp_teacher 不存在，先跑 automation_exp.cjs');
  const token = generateToken(teacher.id, teacher.password);
  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // 已有模板列表（幂等）
  const listRes = await fetch(BASE + '/grading/templates?page=1&pageSize=50', { headers: H });
  const listJson = await listRes.json();
  const existing = new Set(((listJson.data && listJson.data.list) || []).map(t => t.name));

  for (const tpl of TEMPLATES) {
    if (existing.has(tpl.name)) { console.log('跳过（已存在）:', tpl.name); continue; }
    // 先校验
    const v = await fetch(BASE + '/grading/templates/validate', {
      method: 'POST', headers: H, body: JSON.stringify(tpl),
    }).then(r => r.json());
    if (!v.data || v.data.valid !== true) {
      console.error('校验失败:', tpl.name, JSON.stringify(v.data && v.data.errors));
      continue;
    }
    // 创建（草稿）
    const c = await fetch(BASE + '/grading/templates', {
      method: 'POST', headers: H, body: JSON.stringify(tpl),
    }).then(r => r.json());
    if (!c.success) { console.error('创建失败:', tpl.name, c.message); continue; }
    // 发布
    const p = await fetch(`${BASE}/grading/templates/${c.data.id}/publish`, {
      method: 'POST', headers: H,
    }).then(r => r.json());
    console.log(p.success ? `✅ 已创建并发布 (id=${c.data.id})` : `⚠️ 已创建但发布失败 (id=${c.data.id}):`, tpl.name, p.message || '');
  }
  await sequelize.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
