/**
 * 评分模板 CRUD 控制器
 * 权限：teacher 管理本人模板；admin 可创建平台公共模板（school_id=null）
 */
const { sequelize, GradingTemplate } = require('../models');
const templateService = require('../services/grading/template.service');
const { success, fail, paginate, normalizePage } = require('../utils/response');

// 从请求体提取模板JSON（编辑器直接提交规范JSON结构）
function pickTemplateJSON(body) {
  return {
    name: body.name,
    subject: body.subject || '通用',
    content_type: body.content_type || 'essay',
    full_score: Number(body.full_score),
    description: body.description || '',
    dimensions: Array.isArray(body.dimensions) ? body.dimensions : []
  };
}

// 模板列表（本人 + 本校已发布 + 平台公共）
exports.list = async (req, res, next) => {
  try {
    const { page, pageSize } = normalizePage(req.query);
    const { rows, count } = await templateService.listForTeacher(req.user, {
      subject: req.query.subject,
      status: req.query.status || 'all',
      page, pageSize
    });
    return paginate(res, rows.map(t => ({
      id: t.id, name: t.name, subject: t.subject, content_type: t.content_type,
      full_score: Number(t.full_score), description: t.description,
      status: t.status, version: t.version,
      school_id: t.school_id, teacher_id: t.teacher_id,
      is_mine: t.teacher_id === req.user.id,
      updated_at: t.updated_at
    })), count, page, pageSize);
  } catch (err) { next(err); }
};

// 模板详情（含 DB 记录 + 规范JSON）
exports.getDetail = async (req, res, next) => {
  try {
    const template = await templateService.getDetail(req.params.id);
    if (!template) return fail(res, '模板不存在', 404);
    if (template.teacher_id !== req.user.id && template.status !== 'published') {
      return fail(res, '无权查看未发布的模板', 403);
    }
    return success(res, {
      template,
      json: templateService.buildTemplateJSON(template)
    });
  } catch (err) { next(err); }
};

// 仅校验不入库（编辑器实时校验用）
exports.validate = async (req, res, next) => {
  try {
    const result = templateService.validateTemplateJSON(pickTemplateJSON(req.body));
    return success(res, result, result.valid ? '模板校验通过' : '模板校验未通过');
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
      return fail(res, '仅教师可创建模板', 403);
    }
    const tplJSON = pickTemplateJSON(req.body);
    const check = templateService.validateTemplateJSON(tplJSON);
    if (!check.valid) return fail(res, check.errors.join('；'), 422);

    const template = await sequelize.transaction(async (t) => {
      const tpl = await GradingTemplate.create({
        school_id: req.user.role === 'admin' ? (req.body.school_id || null) : req.user.school_id,
        teacher_id: req.user.id,
        name: tplJSON.name,
        subject: tplJSON.subject,
        content_type: tplJSON.content_type,
        full_score: tplJSON.full_score,
        description: tplJSON.description,
        status: 'draft',
        version: 1
      }, { transaction: t });
      await templateService.saveTemplateData(t, tpl.id, tplJSON);
      return tpl;
    });
    return success(res, { id: template.id }, '模板已创建（草稿）');
  } catch (err) { next(err); }
};

// 更新（仅本人 + 仅草稿；已发布模板克隆后修改，保证历史批改标准可追溯）
exports.update = async (req, res, next) => {
  try {
    const template = await GradingTemplate.findByPk(req.params.id);
    if (!template) return fail(res, '模板不存在', 404);
    if (template.teacher_id !== req.user.id) return fail(res, '只能编辑自己创建的模板', 403);
    if (template.status !== 'draft') {
      return fail(res, '模板已发布不可编辑，请克隆后修改（保证历史批改标准可追溯）', 422);
    }
    const tplJSON = pickTemplateJSON(req.body);
    const check = templateService.validateTemplateJSON(tplJSON);
    if (!check.valid) return fail(res, check.errors.join('；'), 422);

    await sequelize.transaction(async (t) => {
      await template.update({
        name: tplJSON.name,
        subject: tplJSON.subject,
        content_type: tplJSON.content_type,
        full_score: tplJSON.full_score,
        description: tplJSON.description
      }, { transaction: t });
      await templateService.saveTemplateData(t, template.id, tplJSON);
    });
    return success(res, null, '模板已保存');
  } catch (err) { next(err); }
};

// 发布：校验全绿 → version+1 → published（锁定）
exports.publish = async (req, res, next) => {
  try {
    const template = await templateService.getDetail(req.params.id);
    if (!template) return fail(res, '模板不存在', 404);
    if (template.teacher_id !== req.user.id) return fail(res, '只能发布自己创建的模板', 403);
    if (template.status === 'published') return fail(res, '模板已是发布状态', 422);

    const check = templateService.validateTemplateJSON(templateService.buildTemplateJSON(template));
    if (!check.valid) return fail(res, `发布前校验未通过：${check.errors.join('；')}`, 422);

    await template.update({ status: 'published', version: template.version + 1 });
    return success(res, null, `模板已发布（v${template.version + 1}），可用于批改`);
  } catch (err) { next(err); }
};

// 停用/启用
exports.toggleStatus = async (req, res, next) => {
  try {
    const template = await GradingTemplate.findByPk(req.params.id);
    if (!template) return fail(res, '模板不存在', 404);
    if (template.teacher_id !== req.user.id) return fail(res, '无权操作该模板', 403);
    if (template.status === 'draft') return fail(res, '草稿模板不能直接停用', 422);

    const nextStatus = template.status === 'published' ? 'disabled' : 'published';
    await template.update({ status: nextStatus });
    return success(res, null, nextStatus === 'published' ? '模板已重新启用' : '模板已停用（历史批改结果不受影响）');
  } catch (err) { next(err); }
};

// 克隆为自己的新草稿（基于已发布模板修改的标准姿势）
exports.clone = async (req, res, next) => {
  try {
    const source = await templateService.getDetail(req.params.id);
    if (!source) return fail(res, '模板不存在', 404);
    if (source.teacher_id !== req.user.id && source.status !== 'published') {
      return fail(res, '无权克隆未发布的模板', 403);
    }
    const tplJSON = templateService.buildTemplateJSON(source);
    const newTpl = await sequelize.transaction(async (t) => {
      const tpl = await GradingTemplate.create({
        school_id: req.user.school_id,
        teacher_id: req.user.id,
        name: `${tplJSON.name}（副本）`,
        subject: tplJSON.subject,
        content_type: tplJSON.content_type,
        full_score: tplJSON.full_score,
        description: tplJSON.description,
        status: 'draft',
        version: 1
      }, { transaction: t });
      await templateService.saveTemplateData(t, tpl.id, tplJSON);
      return tpl;
    });
    return success(res, { id: newTpl.id }, '已克隆为新草稿');
  } catch (err) { next(err); }
};
