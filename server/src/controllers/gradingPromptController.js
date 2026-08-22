/**
 * 提示词版本管理控制器（仅管理员）
 */
const promptService = require('../services/prompt.service');
const { success, fail } = require('../utils/response');

exports.listVersions = async (req, res, next) => {
  try {
    const rows = await promptService.listVersions(req.query.prompt_key);
    return success(res, rows.map(v => ({
      id: v.id,
      prompt_key: v.prompt_key,
      version: v.version,
      status: v.status,
      change_log: v.change_log,
      system_prompt: v.system_prompt,
      modifiers: v.modifiers,
      created_at: v.created_at
    })));
  } catch (err) { next(err); }
};

exports.createVersion = async (req, res, next) => {
  try {
    const v = await promptService.createVersion({
      promptKey: req.body.prompt_key || 'grading.main',
      version: req.body.version,
      systemPrompt: req.body.system_prompt,
      modifiers: req.body.modifiers,
      changeLog: req.body.change_log,
      createdBy: req.user.id
    });
    return success(res, { id: v.id, version: v.version }, `版本 ${v.version} 已创建（draft）`);
  } catch (err) {
    if (err.status && err.status < 500) return fail(res, err.message, err.status);
    next(err);
  }
};

/**
 * 切换稳定版 / 设置灰度 / 回滚，一个接口三种用法：
 *   { stable_version_id }                     → 切稳定版（对旧版本调用即回滚）
 *   { canary_version_id, canary_percent }     → 设置灰度（percent=0 关闭）
 */
exports.updateRouting = async (req, res, next) => {
  try {
    const promptKey = req.body.prompt_key || 'grading.main';
    if (req.body.stable_version_id) {
      await promptService.activateVersion(promptKey, Number(req.body.stable_version_id), req.user.id);
    }
    if (req.body.canary_version_id !== undefined || req.body.canary_percent !== undefined) {
      const percent = Number(req.body.canary_percent || 0);
      const versionId = req.body.canary_version_id ? Number(req.body.canary_version_id) : null;
      await promptService.setCanary(promptKey, versionId, percent, req.user.id);
    }
    return success(res, null, '路由已更新（约30秒缓存过期后全量生效）');
  } catch (err) {
    if (err.status && err.status < 500) return fail(res, err.message, err.status);
    next(err);
  }
};
