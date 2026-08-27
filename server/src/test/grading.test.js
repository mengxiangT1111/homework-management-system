/**
 * AI 批改模块单元测试（纯函数，不依赖数据库连接）
 * 运行：node --test src/test/grading.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const { validateTemplateJSON } = require('../services/grading/template.service');
const {
  safeParseJSON, parseGradingOutput, computeTotalScore, evaluateConfidence
} = require('../utils/gradingResultParser');
const { decideCanary } = require('../services/prompt.service');

// 测试夹具：合法的两维模板
const VALID_TPL = {
  name: '测试模板',
  subject: '语文',
  content_type: 'essay',
  full_score: 100,
  dimensions: [
    {
      code: 'content', name: '内容', weight: 60, max_score: 60,
      rubrics: [
        { level: 'A', score_range: [50, 60], descriptor: '论点鲜明深刻，内容充实完整' },
        { level: 'B', score_range: [30, 49.5], descriptor: '论点明确，内容基本完整' },
        { level: 'C', score_range: [0, 29.5], descriptor: '论点模糊或内容残缺不全' }
      ],
      deduction_rules: []
    },
    {
      code: 'lang', name: '语言', weight: 40, max_score: 40,
      rubrics: [
        { level: 'A', score_range: [34, 40], descriptor: '语言流畅有文采，表达准确' },
        { level: 'B', score_range: [24, 33.5], descriptor: '语言通顺，偶有语病' },
        { level: 'C', score_range: [0, 23.5], descriptor: '语病较多，影响理解' }
      ],
      deduction_rules: [{ description: '每处错别字', penalty: 0.5, max_penalty: 3 }]
    }
  ]
};

// ===== 模板校验 =====

test('模板校验：合法模板通过', () => {
  const r = validateTemplateJSON(VALID_TPL);
  assert.strictEqual(r.valid, true, JSON.stringify(r.errors));
});

test('模板校验：权重之和≠100 报错', () => {
  const bad = JSON.parse(JSON.stringify(VALID_TPL));
  bad.dimensions[0].weight = 50; // 50+40=90
  const r = validateTemplateJSON(bad);
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some(e => e.includes('权重之和')));
});

test('模板校验：维度编码重复报错', () => {
  const bad = JSON.parse(JSON.stringify(VALID_TPL));
  bad.dimensions[1].code = 'content';
  const r = validateTemplateJSON(bad);
  assert.ok(r.errors.some(e => e.includes('重复')));
});

test('模板校验：编码格式非法报错', () => {
  const bad = JSON.parse(JSON.stringify(VALID_TPL));
  bad.dimensions[0].code = '1bad-code$';
  const r = validateTemplateJSON(bad);
  assert.ok(r.errors.some(e => e.includes('编码非法')));
});

test('模板校验：Rubric 区间越界与重叠报错', () => {
  const bad = JSON.parse(JSON.stringify(VALID_TPL));
  bad.dimensions[0].rubrics[0].score_range = [55, 70];   // 超过维度满分60
  bad.dimensions[1].rubrics[0].score_range = [30, 36];   // 与B档(24~33.5)重叠
  const r = validateTemplateJSON(bad);
  assert.ok(r.errors.some(e => e.includes('超过维度满分')));
  assert.ok(r.errors.some(e => e.includes('重叠')));
});

test('模板校验：档位描述过短报错', () => {
  const bad = JSON.parse(JSON.stringify(VALID_TPL));
  bad.dimensions[0].rubrics[0].descriptor = '好';
  const r = validateTemplateJSON(bad);
  assert.ok(r.errors.some(e => e.includes('档位描述')));
});

test('模板校验：扣分规则负数报错', () => {
  const bad = JSON.parse(JSON.stringify(VALID_TPL));
  bad.dimensions[0].deduction_rules = [{ description: '测试', penalty: -1 }];
  const r = validateTemplateJSON(bad);
  assert.ok(r.errors.some(e => e.includes('扣分值必须')));
});

test('模板校验：缺少维度报错', () => {
  const r = validateTemplateJSON({ name: 'x', full_score: 100, dimensions: [] });
  assert.ok(r.errors.some(e => e.includes('至少需要一个评分维度')));
});

// ===== 结果解析 =====

test('结果解析：正常 JSON 输出', () => {
  const out = {
    dimensions: [
      { code: 'content', score: 52, level: 'A', evidence: '引用原文', deductions: [{ description: '论据单薄', penalty: 8 }], feedback: '良好' },
      { code: 'lang', score: 30.5, level: 'B', evidence: '', deductions: [], feedback: '通顺' }
    ],
    overall_feedback: '总体不错', improvement_advice: '加强论据', knowledge_errors: []
  };
  const r = parseGradingOutput(out, VALID_TPL);
  assert.strictEqual(r.missingCount, 0);
  assert.strictEqual(r.clampCount, 0);
  assert.strictEqual(r.dimensions[0].score, 52);
  assert.strictEqual(r.dimensions[0].deductions[0].penalty, 8);
});

test('结果解析：Markdown 代码块包裹也能解析', () => {
  const wrapped = '以下是结果：\n```json\n' + JSON.stringify({
    dimensions: [
      { code: 'content', score: 40, level: 'B', evidence: '', deductions: [], feedback: '' },
      { code: 'lang', score: 20, level: 'C', evidence: '', deductions: [], feedback: '' }
    ],
    overall_feedback: 'a', improvement_advice: 'b', knowledge_errors: []
  }) + '\n```';
  const obj = safeParseJSON(wrapped);
  const r = parseGradingOutput(obj, VALID_TPL);
  assert.strictEqual(r.missingCount, 0);
});

test('结果解析：分数越界被钳制并计数', () => {
  const out = {
    dimensions: [
      { code: 'content', score: 999, level: 'A', evidence: '', deductions: [], feedback: '' },
      { code: 'lang', score: -5, level: 'C', evidence: '', deductions: [], feedback: '' }
    ],
    overall_feedback: 'x', improvement_advice: 'y', knowledge_errors: []
  };
  const r = parseGradingOutput(out, VALID_TPL);
  assert.strictEqual(r.dimensions[0].score, 60); // 钳到维度满分
  assert.strictEqual(r.dimensions[1].score, 0);
  assert.strictEqual(r.clampCount, 2);
});

test('结果解析：缺少维度→missingCount，score=null', () => {
  const out = {
    dimensions: [
      { code: 'content', score: 40, level: 'B', evidence: '', deductions: [], feedback: '' }
      // 缺 lang
    ],
    overall_feedback: 'x', improvement_advice: 'y', knowledge_errors: []
  };
  const r = parseGradingOutput(out, VALID_TPL);
  assert.strictEqual(r.missingCount, 1);
  assert.strictEqual(r.dimensions[1].score, null);
});

test('结果解析：缺少必要字段抛错', () => {
  assert.throws(() => parseGradingOutput({ dimensions: [] }, VALID_TPL), /缺少必要字段/);
});

test('结果解析：非法 JSON 文本抛错', () => {
  assert.throws(() => safeParseJSON('这不是JSON'), /格式异常/);
});

test('结果解析：code大小写不敏感 + 名称兜底匹配', () => {
  const out = {
    dimensions: [
      { code: 'Content', score: 50, level: 'A', evidence: '', deductions: [], feedback: '' },
      { name: '语言', score: 30, level: 'B', evidence: '', deductions: [], feedback: '' }
    ],
    overall_feedback: 'x', improvement_advice: 'y', knowledge_errors: []
  };
  const r = parseGradingOutput(out, VALID_TPL);
  assert.strictEqual(r.missingCount, 0);
  assert.strictEqual(r.clampCount, 0);
});

// ===== 总分计算 =====

test('总分计算：求和且封顶满分', () => {
  assert.strictEqual(computeTotalScore([{ score: 52 }, { score: 30.5 }], VALID_TPL), 82.5);
  assert.strictEqual(computeTotalScore([{ score: 60 }, { score: 40.5 }], VALID_TPL), 100); // 封顶
  // 有维度缺失（null）时按 0 计
  assert.strictEqual(computeTotalScore([{ score: 60 }, { score: null }], VALID_TPL), 60);
});

// ===== 置信度 =====

test('置信度：正常情况高置信', () => {
  const r = evaluateConfidence({ parseRetries: 0, clampCount: 0, missingCount: 0, total: 82.5, fullScore: 100, answerLength: 800 });
  assert.ok(r.confidence >= 0.9);
});

test('置信度：多异常叠加显著降低置信度并给出原因', () => {
  const r = evaluateConfidence({ parseRetries: 1, clampCount: 2, missingCount: 1, total: 82.5, fullScore: 100, answerLength: 800 });
  assert.ok(r.confidence < 0.6);
  assert.ok(r.reasons.length >= 3);
});

test('置信度：作答过短降低置信度', () => {
  const r = evaluateConfidence({ parseRetries: 0, clampCount: 0, missingCount: 0, total: 70, fullScore: 100, answerLength: 10 });
  assert.ok(r.confidence <= 0.8);
  assert.ok(r.reasons.some(x => x.includes('过短')));
});

// ===== 灰度路由 =====

test('灰度路由：确定性（同seed结果恒定）', () => {
  assert.strictEqual(decideCanary(42, 10), decideCanary(42, 10));
});

test('灰度路由：0-99 命中比例精确等于百分比', () => {
  let hit = 0;
  for (let i = 0; i < 100; i++) if (decideCanary(i, 10)) hit++;
  assert.strictEqual(hit, 10);
});

test('灰度路由：边界值', () => {
  assert.strictEqual(decideCanary(99, 0), false);
  assert.strictEqual(decideCanary(1, 100), true);
  assert.strictEqual(decideCanary(5, 10), true);   // 5 < 10
  assert.strictEqual(decideCanary(10, 10), false); // 10 % 100 = 10，不小于 10
});

// ===== B1 回归：null/非数字分数不判 0 分，按未评分处理 =====

test('结果解析：score=null 视为未评分（missingCount），不再静默判 0 分', () => {
  const out = {
    dimensions: [
      { code: 'content', score: null, level: 'A', evidence: '', deductions: [], feedback: '' },
      { code: 'lang', score: 'abc', level: 'B', evidence: '', deductions: [], feedback: '' }
    ],
    overall_feedback: 'x', improvement_advice: 'y', knowledge_errors: []
  };
  const r = parseGradingOutput(out, VALID_TPL);
  assert.strictEqual(r.missingCount, 2);
  assert.strictEqual(r.dimensions[0].score, null);
  assert.strictEqual(r.dimensions[1].score, null);
  assert.strictEqual(r.clampCount, 0);
});
