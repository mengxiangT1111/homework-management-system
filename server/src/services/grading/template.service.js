/**
 * 评分模板服务：模板装配（DB→规范JSON）、校验、Rubric 文本渲染、读写辅助
 */
const { Op } = require('sequelize');
const { GradingTemplate, GradingDimension, DimensionRubric } = require('../../models');

const CODE_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,49}$/;
const r1 = x => Math.round(x * 10) / 10;

/**
 * 校验模板规范JSON（三层：结构层/一致性层/边界层），
 * 中文报错可直接展示给教师；不引入 ajv，规则可控。
 */
function validateTemplateJSON(tpl) {
  const errors = [];
  if (!tpl || typeof tpl !== 'object') return { valid: false, errors: ['模板必须是 JSON 对象'] };

  if (!tpl.name || !String(tpl.name).trim()) errors.push('模板名称不能为空');
  const fullScore = Number(tpl.full_score);
  if (!Number.isFinite(fullScore) || fullScore < 1 || fullScore > 1000) {
    errors.push('满分必须是 1-1000 之间的数字');
  }

  const dims = Array.isArray(tpl.dimensions) ? tpl.dimensions : null;
  if (!dims || dims.length === 0) errors.push('至少需要一个评分维度');
  if (dims && dims.length > 20) errors.push('评分维度最多 20 个');

  if (dims && Number.isFinite(fullScore) && fullScore >= 1) {
    const codes = new Set();
    let weightSum = 0;
    let weightValid = true;

    dims.forEach((d, i) => {
      const label = (d && d.name) || (d && d.code) || `第 ${i + 1} 个维度`;
      if (!d || typeof d !== 'object') {
        errors.push(`第 ${i + 1} 个维度格式非法`);
        return;
      }
      if (!d.code || !CODE_RE.test(d.code)) errors.push(`维度[${label}]的编码非法（字母开头，可含数字/下划线/中划线）`);
      if (codes.has(String(d.code || '').toLowerCase())) errors.push(`维度编码 ${d.code} 重复`);
      codes.add(String(d.code || '').toLowerCase());
      if (!d.name || !String(d.name).trim()) errors.push(`维度[${d.code || label}]缺少名称`);

      const w = Number(d.weight);
      if (!Number.isFinite(w) || w <= 0 || w > 100) {
        errors.push(`维度[${label}]的权重必须是 (0,100] 之间的数字`);
        weightValid = false;
      } else {
        weightSum += w;
      }

      // 权重非法时跳过依赖它的边界校验，避免报错噪声
      if (!weightValid || !Number.isFinite(w)) return;
      const maxScore = r1(fullScore * w / 100);

      const rubrics = Array.isArray(d.rubrics) ? d.rubrics : null;
      if (!rubrics || rubrics.length < 2) {
        errors.push(`维度[${label}]至少需要 2 个 Rubric 档位`);
      } else if (rubrics.length > 6) {
        errors.push(`维度[${label}]的 Rubric 档位最多 6 个`);
      } else {
        // 校验每档区间 + 相邻区间不重叠（要求高分档在前）
        const sorted = rubrics
          .map(r => ({
            level: r && r.level,
            min: Number(r && r.score_range && r.score_range[0]),
            max: Number(r && r.score_range && r.score_range[1]),
            descriptor: r && r.descriptor
          }))
          .sort((a, b) => b.max - a.max);
        sorted.forEach((r, j) => {
          const lvl = r.level || `第 ${j + 1} 档`;
          if (!Number.isFinite(r.min) || !Number.isFinite(r.max) || r.min < 0 || r.max < r.min) {
            errors.push(`维度[${label}]档位 ${lvl} 的分数区间非法（需 0≤最低分≤最高分）`);
          }
          if (Number.isFinite(r.max) && r.max > maxScore + 0.001) {
            errors.push(`维度[${label}]档位 ${lvl} 的最高分 ${r.max} 超过维度满分 ${maxScore}`);
          }
          if (!r.descriptor || String(r.descriptor).trim().length < 5) {
            errors.push(`维度[${label}]档位 ${lvl} 缺少档位描述（至少 5 个字）`);
          }
          if (j > 0) {
            const higher = sorted[j - 1]; // 上一档（更高分档）
            if (Number.isFinite(higher.min) && Number.isFinite(r.max) && r.max > higher.min + 0.001) {
              errors.push(`维度[${label}]档位 ${higher.level} 与 ${lvl} 的分数区间重叠`);
            }
          }
        });
      }

      if (Array.isArray(d.deduction_rules)) {
        d.deduction_rules.forEach((rule, k) => {
          if (!rule || !rule.description || !String(rule.description).trim()) {
            errors.push(`维度[${label}]第 ${k + 1} 条扣分规则缺少说明`);
          }
          const p = Number(rule && rule.penalty);
          if (!Number.isFinite(p) || p < 0) errors.push(`维度[${label}]第 ${k + 1} 条扣分规则的扣分值必须 ≥ 0`);
          if (Number.isFinite(p) && p > maxScore) errors.push(`维度[${label}]第 ${k + 1} 条扣分规则的扣分值超过维度满分`);
        });
      }
    });

    // 权重之和=100（仅在所有维度权重本身合法时校验）
    if (weightValid && dims.length > 0 && Math.abs(weightSum - 100) > 0.01) {
      errors.push(`各维度权重之和为 ${r1(weightSum)}，必须等于 100`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 装配：DB 记录 → 规范JSON。
 * max_score 一律服务端重算（full_score×weight/100），不采信存储值，防止历史数据漂移。
 */
function buildTemplateJSON(template) {
  const dims = (template.dimensions || [])
    .slice()
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .map(d => ({
      code: d.code,
      name: d.name,
      weight: Number(d.weight),
      max_score: r1(Number(template.full_score) * Number(d.weight) / 100),
      sort_order: d.sort_order || 0,
      description: d.description || '',
      rubrics: (d.rubrics || [])
        .slice()
        .sort((a, b) => (b.score_max || 0) - (a.score_max || 0))
        .map(r => ({
          level: r.level,
          score_range: [Number(r.score_min), Number(r.score_max)],
          descriptor: r.descriptor,
          sort_order: r.sort_order || 0
        })),
      deduction_rules: d.deduction_rules || []
    }));
  return {
    id: template.id,
    name: template.name,
    subject: template.subject,
    content_type: template.content_type,
    full_score: Number(template.full_score),
    description: template.description || '',
    dimensions: dims
  };
}

/** 渲染：模板JSON → 注入提示词的中文文本块 */
function renderRubricBlock(tpl) {
  const lines = [];
  lines.push(`模板名称：${tpl.name}（满分 ${tpl.full_score} 分，适用：${tpl.subject}/${tpl.content_type}）`);
  tpl.dimensions.forEach((d, i) => {
    lines.push('');
    lines.push(`【维度 ${i + 1}】${d.name}（code: ${d.code}，满分 ${d.max_score} 分，权重 ${d.weight}%）`);
    if (d.description) lines.push(`维度说明：${d.description}`);
    lines.push('分档标准（先定档，再在档位区间内细化给分）：');
    d.rubrics.forEach(r => {
      lines.push(`  ${r.level} 档（${r.score_range[0]}~${r.score_range[1]} 分）：${r.descriptor}`);
    });
    if (Array.isArray(d.deduction_rules) && d.deduction_rules.length > 0) {
      lines.push('扣分规则：');
      d.deduction_rules.forEach(rule => {
        const cap = rule.max_penalty && rule.max_penalty !== rule.penalty ? `，累计上限 ${rule.max_penalty} 分` : '';
        lines.push(`  - ${rule.description}：扣 ${rule.penalty} 分${cap}`);
      });
    }
  });
  return lines.join('\n');
}

// ===== 读写辅助 =====

async function getDetail(templateId) {
  return GradingTemplate.findByPk(templateId, {
    include: [{
      model: GradingDimension,
      as: 'dimensions',
      include: [{ model: DimensionRubric, as: 'rubrics' }]
    }],
    order: [
      [{ model: GradingDimension, as: 'dimensions' }, 'sort_order', 'ASC']
    ]
  });
}

/**
 * 教师可用列表：本人全部 + 本校已发布 + 平台公共已发布。
 * status 过滤仅用于筛选"我的"模板（别人的模板只有 published 可见）。
 */
async function listForTeacher(user, { subject, status, page = 1, pageSize = 10 }) {
  const visible = {
    [Op.or]: [
      { teacher_id: user.id },
      ...(user.school_id
        ? [{ school_id: user.school_id, status: 'published' }]
        : []),
      { school_id: null, status: 'published' }
    ]
  };
  const where = { ...visible };
  if (subject) where.subject = subject;
  if (status && status !== 'all') {
    // 状态筛选叠加在可见范围上（如 status=draft 只会命中自己的草稿）
    where[Op.and] = [{ status }];
  }
  const { rows, count } = await GradingTemplate.findAndCountAll({
    where,
    offset: (page - 1) * pageSize,
    limit: pageSize,
    order: [['updated_at', 'DESC']]
  });
  return { rows, count };
}

/** 保存规范JSON到三张表（create/update 共用，需在事务内调用） */
async function saveTemplateData(transaction, templateId, tplJSON) {
  await GradingDimension.destroy({ where: { template_id: templateId }, transaction });
  for (let i = 0; i < tplJSON.dimensions.length; i++) {
    const d = tplJSON.dimensions[i];
    const dim = await GradingDimension.create({
      template_id: templateId,
      code: d.code,
      name: d.name,
      weight: d.weight,
      max_score: r1(Number(tplJSON.full_score) * d.weight / 100),
      sort_order: d.sort_order !== undefined ? d.sort_order : i,
      description: d.description || null,
      deduction_rules: d.deduction_rules && d.deduction_rules.length ? d.deduction_rules : null
    }, { transaction });
    for (let j = 0; j < d.rubrics.length; j++) {
      const r = d.rubrics[j];
      await DimensionRubric.create({
        dimension_id: dim.id,
        level: r.level,
        score_min: r.score_range[0],
        score_max: r.score_range[1],
        descriptor: r.descriptor,
        sort_order: j
      }, { transaction });
    }
  }
}

module.exports = {
  validateTemplateJSON,
  buildTemplateJSON,
  renderRubricBlock,
  getDetail,
  listForTeacher,
  saveTemplateData
};
