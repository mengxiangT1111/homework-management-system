/**
 * AI 智能批改模块 - 数据模型
 * 表：grading_templates / grading_dimensions / dimension_rubrics /
 *     prompt_versions / prompt_routings / grading_tasks / grading_results / grading_reviews
 */
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// ===== 评分模板 =====
const GradingTemplate = sequelize.define('GradingTemplate', {
  id: {
    type: DataTypes.INTEGER.UNSIGNED,
    primaryKey: true,
    autoIncrement: true
  },
  school_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: true,
    comment: '所属学校ID（NULL=平台公共模板，仅管理员创建）'
  },
  teacher_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '创建教师ID'
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: '模板名称'
  },
  subject: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: '通用',
    comment: '适用科目：语文/数学/英语/物理/通用等'
  },
  content_type: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'essay',
    comment: '内容类型：essay议论文/subjective主观题/experiment实验报告等'
  },
  full_score: {
    type: DataTypes.DECIMAL(6, 1),
    allowNull: false,
    defaultValue: 100,
    comment: '模板满分'
  },
  description: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: '模板说明'
  },
  status: {
    type: DataTypes.ENUM('draft', 'published', 'disabled'),
    allowNull: false,
    defaultValue: 'draft',
    comment: '状态：草稿/已发布/已停用'
  },
  version: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    defaultValue: 1,
    comment: '修订号：每次发布+1，发布后锁定不可编辑'
  }
}, {
  tableName: 'grading_templates',
  indexes: [
    { fields: ['school_id', 'subject', 'status'] },
    { fields: ['teacher_id'] }
  ]
});

// ===== 模板评分维度 =====
const GradingDimension = sequelize.define('GradingDimension', {
  id: {
    type: DataTypes.INTEGER.UNSIGNED,
    primaryKey: true,
    autoIncrement: true
  },
  template_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '所属模板ID'
  },
  code: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: '维度编码（模板内唯一，AI输出按此对齐）'
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: '维度名称'
  },
  weight: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    comment: '权重百分比，同模板所有维度权重之和=100'
  },
  max_score: {
    type: DataTypes.DECIMAL(6, 1),
    allowNull: false,
    comment: '维度满分=full_score*weight/100（服务端计算）'
  },
  sort_order: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: '展示顺序'
  },
  description: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: '维度说明（评分关注点）'
  },
  deduction_rules: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: '扣分规则数组 [{id,description,penalty,max_penalty}]'
  }
}, {
  tableName: 'grading_dimensions',
  indexes: [
    { unique: true, fields: ['template_id', 'code'] },
    { fields: ['template_id'] }
  ]
});

// ===== 维度分档 Rubric =====
const DimensionRubric = sequelize.define('DimensionRubric', {
  id: {
    type: DataTypes.INTEGER.UNSIGNED,
    primaryKey: true,
    autoIncrement: true
  },
  dimension_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '所属维度ID'
  },
  level: {
    type: DataTypes.STRING(20),
    allowNull: false,
    comment: '档位标识：A/B/C/D 或 优秀/良好/及格/不及格'
  },
  score_min: {
    type: DataTypes.DECIMAL(6, 1),
    allowNull: false,
    comment: '该档最低分（含）'
  },
  score_max: {
    type: DataTypes.DECIMAL(6, 1),
    allowNull: false,
    comment: '该档最高分（含）'
  },
  descriptor: {
    type: DataTypes.TEXT,
    allowNull: false,
    comment: '档位描述（给AI看的判定标准）'
  },
  sort_order: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: '档位顺序，高分档在前'
  }
}, {
  tableName: 'dimension_rubrics',
  indexes: [
    { fields: ['dimension_id'] }
  ]
});

// ===== 提示词版本 =====
const PromptVersion = sequelize.define('PromptVersion', {
  id: {
    type: DataTypes.INTEGER.UNSIGNED,
    primaryKey: true,
    autoIncrement: true
  },
  prompt_key: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'grading.main',
    comment: '提示词标识（同一key多版本）'
  },
  version: {
    type: DataTypes.STRING(20),
    allowNull: false,
    comment: 'semver版本号，如 1.0.0 / 1.1.0'
  },
  status: {
    type: DataTypes.ENUM('draft', 'active', 'retired'),
    allowNull: false,
    defaultValue: 'draft',
    comment: '状态：草稿/可用/已退役'
  },
  system_prompt: {
    type: DataTypes.TEXT('long'),
    allowNull: false,
    comment: '完整System Prompt全文（支持 {{RUBRIC_BLOCK}} {{SUBJECT}} 占位符）'
  },
  modifiers: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: '场景修饰提示词 {strict,encouraging,balanced}'
  },
  change_log: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: '版本变更说明'
  },
  created_by: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: true,
    comment: '创建人ID（管理员）'
  }
}, {
  tableName: 'prompt_versions',
  indexes: [
    { unique: true, fields: ['prompt_key', 'version'] },
    { fields: ['prompt_key', 'status'] }
  ]
});

// ===== 提示词路由（稳定版/灰度版/灰度比例） =====
const PromptRouting = sequelize.define('PromptRouting', {
  id: {
    type: DataTypes.INTEGER.UNSIGNED,
    primaryKey: true,
    autoIncrement: true
  },
  prompt_key: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: '提示词标识，唯一'
  },
  stable_version_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '当前稳定版ID'
  },
  canary_version_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: true,
    comment: '灰度测试版ID（NULL=无灰度）'
  },
  canary_percent: {
    type: DataTypes.TINYINT.UNSIGNED,
    allowNull: false,
    defaultValue: 0,
    comment: '灰度百分比0-100，task_id%100<该值走灰度版'
  },
  updated_by: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: true,
    comment: '最后操作人'
  }
}, {
  tableName: 'prompt_routings',
  indexes: [
    { unique: true, fields: ['prompt_key'] }
  ]
});

// ===== 批改任务（异步队列载体） =====
const GradingTask = sequelize.define('GradingTask', {
  id: {
    type: DataTypes.INTEGER.UNSIGNED,
    primaryKey: true,
    autoIncrement: true
  },
  submission_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '待批改的提交ID'
  },
  assignment_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '所属作业ID（冗余，便于按作业查进度）'
  },
  template_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '使用的模板ID'
  },
  template_snapshot: {
    type: DataTypes.JSON,
    allowNull: false,
    comment: '模板完整快照（创建时固化，重试/审计用同一标准）'
  },
  prompt_key: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'grading.main',
    comment: '提示词标识'
  },
  prompt_mode: {
    type: DataTypes.ENUM('balanced', 'strict', 'encouraging'),
    allowNull: false,
    defaultValue: 'balanced',
    comment: '场景修饰模式'
  },
  reference_answer: {
    type: DataTypes.TEXT('medium'),
    allowNull: true,
    comment: '本次批改的参考答案'
  },
  grading_criteria: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: '教师补充的评分说明'
  },
  status: {
    type: DataTypes.ENUM('pending', 'processing', 'success', 'failed', 'cancelled'),
    allowNull: false,
    defaultValue: 'pending',
    comment: '状态：待处理/处理中/成功/失败/已取消'
  },
  attempt: {
    type: DataTypes.TINYINT.UNSIGNED,
    allowNull: false,
    defaultValue: 0,
    comment: '已尝试次数（入队抢占时+1）'
  },
  max_attempts: {
    type: DataTypes.TINYINT.UNSIGNED,
    allowNull: false,
    defaultValue: 3,
    comment: '最大尝试次数（含首次）'
  },
  priority: {
    type: DataTypes.TINYINT.UNSIGNED,
    allowNull: false,
    defaultValue: 5,
    comment: '优先级，数字越小越先执行'
  },
  next_run_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    comment: '下次可执行时间（退避重试靠它延迟）'
  },
  locked_by: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: '占用该任务的worker标识'
  },
  locked_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '占用时间（僵死任务回收依据）'
  },
  error_msg: {
    type: DataTypes.STRING(1000),
    allowNull: true,
    comment: '最近一次失败原因'
  },
  created_by: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '创建任务的教师ID'
  }
}, {
  tableName: 'grading_tasks',
  indexes: [
    { fields: ['status', 'priority', 'next_run_at'] },
    { fields: ['assignment_id', 'status'] },
    { fields: ['submission_id'] }
  ]
});

// ===== 批改结果 =====
const GradingResult = sequelize.define('GradingResult', {
  id: {
    type: DataTypes.INTEGER.UNSIGNED,
    primaryKey: true,
    autoIncrement: true
  },
  task_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '任务ID'
  },
  submission_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '提交ID（冗余，学生端直查）'
  },
  template_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '模板ID'
  },
  prompt_key: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: '提示词标识'
  },
  prompt_version: {
    type: DataTypes.STRING(20),
    allowNull: false,
    comment: '实际使用的提示词版本（审计）'
  },
  total_score: {
    type: DataTypes.DECIMAL(6, 1),
    allowNull: false,
    comment: '总分（服务端按维度求和，非LLM给出）'
  },
  full_score: {
    type: DataTypes.DECIMAL(6, 1),
    allowNull: false,
    comment: '满分'
  },
  dimension_scores: {
    type: DataTypes.JSON,
    allowNull: false,
    comment: '各维度得分详情 [{code,name,max_score,score,level,evidence,deductions,feedback}]'
  },
  overall_feedback: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: '总体评语'
  },
  improvement_advice: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: '改进建议'
  },
  deduction_summary: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: '扣分汇总 [{dimension,description,penalty}]'
  },
  knowledge_errors: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: '知识性错误列表'
  },
  confidence: {
    type: DataTypes.DECIMAL(4, 3),
    allowNull: false,
    defaultValue: 1,
    comment: '批改置信度0-1，低于阈值自动进人工复核'
  },
  needs_review: {
    type: DataTypes.TINYINT,
    allowNull: false,
    defaultValue: 0,
    comment: '是否需要人工复核'
  },
  review_reasons: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: '触发复核的原因列表'
  },
  raw_response: {
    type: DataTypes.TEXT('long'),
    allowNull: true,
    comment: 'LLM原始返回（审计/问题定位）'
  },
  llm_model: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: '实际使用的模型（含降级切换）'
  },
  tokens_used: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: 'token用量 {prompt_tokens,completion_tokens,total_tokens}'
  }
}, {
  tableName: 'grading_results',
  indexes: [
    { unique: true, fields: ['task_id'] },
    { fields: ['submission_id', 'created_at'] },
    { fields: ['needs_review'] }
  ]
});

// ===== 人工复核工单 =====
const GradingReview = sequelize.define('GradingReview', {
  id: {
    type: DataTypes.INTEGER.UNSIGNED,
    primaryKey: true,
    autoIncrement: true
  },
  result_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '批改结果ID'
  },
  task_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '任务ID（冗余）'
  },
  submission_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '提交ID（冗余）'
  },
  status: {
    type: DataTypes.ENUM('pending', 'approved', 'adjusted', 'rejected'),
    allowNull: false,
    defaultValue: 'pending',
    comment: '状态：待复核/通过/已调整/已否决'
  },
  assigned_to: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: true,
    comment: '指派复核教师ID（NULL=作业发布教师处理）'
  },
  reviewer_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: true,
    comment: '实际复核教师ID'
  },
  reviewed_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '复核完成时间'
  },
  original_score: {
    type: DataTypes.DECIMAL(6, 1),
    allowNull: false,
    comment: 'AI原始总分'
  },
  final_score: {
    type: DataTypes.DECIMAL(6, 1),
    allowNull: true,
    comment: '复核后最终总分'
  },
  dimension_adjustments: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: '维度调整明细 [{code,from,to,reason}]'
  },
  comment: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: '复核意见'
  }
}, {
  tableName: 'grading_reviews',
  indexes: [
    { unique: true, fields: ['result_id'] },
    { fields: ['status', 'created_at'] },
    { fields: ['submission_id'] }
  ]
});

// ===== 模块内关联 =====
GradingTemplate.hasMany(GradingDimension, { as: 'dimensions', foreignKey: 'template_id' });
GradingDimension.belongsTo(GradingTemplate, { as: 'template', foreignKey: 'template_id' });
GradingDimension.hasMany(DimensionRubric, { as: 'rubrics', foreignKey: 'dimension_id' });
DimensionRubric.belongsTo(GradingDimension, { as: 'dimension', foreignKey: 'dimension_id' });

GradingTask.hasOne(GradingResult, { as: 'result', foreignKey: 'task_id' });
GradingResult.belongsTo(GradingTask, { as: 'task', foreignKey: 'task_id' });
GradingResult.hasOne(GradingReview, { as: 'review', foreignKey: 'result_id' });
GradingReview.belongsTo(GradingResult, { as: 'result', foreignKey: 'result_id' });

module.exports = {
  GradingTemplate,
  GradingDimension,
  DimensionRubric,
  PromptVersion,
  PromptRouting,
  GradingTask,
  GradingResult,
  GradingReview
};
