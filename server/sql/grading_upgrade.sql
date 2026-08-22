-- ============================================================
-- AI 智能批改模块 - 建表 SQL（MySQL 8.0+）
-- 说明：开发/生产环境由 Sequelize sync() 自动建同构表，
--      本文件供 DBA 手工迁移或审计表结构使用（权威版本）。
-- 执行顺序：按本文件从上到下。
-- ============================================================

-- 1. 评分模板表
CREATE TABLE IF NOT EXISTS `grading_templates` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '模板ID',
  `school_id`    INT UNSIGNED NULL COMMENT '所属学校ID（NULL=平台公共模板，仅管理员创建）',
  `teacher_id`   INT UNSIGNED NOT NULL COMMENT '创建教师ID',
  `name`         VARCHAR(100) NOT NULL COMMENT '模板名称，如：高中议论文批改',
  `subject`      VARCHAR(50)  NOT NULL DEFAULT '通用' COMMENT '适用科目：语文/数学/英语/物理/通用等',
  `content_type` VARCHAR(50)  NOT NULL DEFAULT 'essay' COMMENT '内容类型：essay议论文/subjective主观题/experiment实验报告等',
  `full_score`   DECIMAL(6,1) NOT NULL DEFAULT 100.0 COMMENT '模板满分（各维度权重换算的基数）',
  `description`  VARCHAR(500) NULL COMMENT '模板说明（何时使用、适用场景）',
  `status`       ENUM('draft','published','disabled') NOT NULL DEFAULT 'draft' COMMENT '状态：草稿/已发布（可批改）/已停用',
  `version`      INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '模板修订号：每次发布+1，已发布模板不可编辑，克隆后修改',
  `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_school_subject_status` (`school_id`,`subject`,`status`),
  KEY `idx_teacher` (`teacher_id`),
  CONSTRAINT `fk_tpl_school`  FOREIGN KEY (`school_id`)  REFERENCES `schools` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_tpl_teacher` FOREIGN KEY (`teacher_id`) REFERENCES `users`   (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI批改-评分模板';

-- 2. 模板维度表
CREATE TABLE IF NOT EXISTS `grading_dimensions` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '维度ID',
  `template_id`     INT UNSIGNED NOT NULL COMMENT '所属模板ID',
  `code`            VARCHAR(50)  NOT NULL COMMENT '维度编码（模板内唯一，AI输出按此对齐）',
  `name`            VARCHAR(100) NOT NULL COMMENT '维度名称',
  `weight`          DECIMAL(5,2) NOT NULL COMMENT '权重百分比，同模板所有维度权重之和=100',
  `max_score`       DECIMAL(6,1) NOT NULL COMMENT '维度满分=full_score*weight/100',
  `sort_order`      INT NOT NULL DEFAULT 0 COMMENT '展示顺序',
  `description`     VARCHAR(500) NULL COMMENT '维度说明',
  `deduction_rules` JSON NULL COMMENT '扣分规则数组 [{id,description,penalty,max_penalty}]',
  `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_tpl_code` (`template_id`,`code`),
  KEY `idx_template` (`template_id`),
  CONSTRAINT `fk_dim_template` FOREIGN KEY (`template_id`) REFERENCES `grading_templates` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI批改-模板评分维度';

-- 3. 维度Rubric表
CREATE TABLE IF NOT EXISTS `dimension_rubrics` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'RubricID',
  `dimension_id` INT UNSIGNED NOT NULL COMMENT '所属维度ID',
  `level`        VARCHAR(20)  NOT NULL COMMENT '档位标识：A/B/C/D 或 优秀/良好/及格/不及格',
  `score_min`    DECIMAL(6,1) NOT NULL COMMENT '该档最低分（含）',
  `score_max`    DECIMAL(6,1) NOT NULL COMMENT '该档最高分（含）',
  `descriptor`   TEXT NOT NULL COMMENT '档位描述（给AI看的判定标准）',
  `sort_order`   INT NOT NULL DEFAULT 0 COMMENT '档位顺序，高分档在前',
  `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_dimension` (`dimension_id`),
  CONSTRAINT `fk_rub_dim` FOREIGN KEY (`dimension_id`) REFERENCES `grading_dimensions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_rub_range` CHECK (`score_min` >= 0 AND `score_max` >= `score_min`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI批改-维度分档Rubric';

-- 4. 提示词版本表
CREATE TABLE IF NOT EXISTS `prompt_versions` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '版本ID',
  `prompt_key`    VARCHAR(50)  NOT NULL DEFAULT 'grading.main' COMMENT '提示词标识（同一key多版本）',
  `version`       VARCHAR(20)  NOT NULL COMMENT 'semver版本号，如 1.0.0 / 1.1.0',
  `status`        ENUM('draft','active','retired') NOT NULL DEFAULT 'draft' COMMENT '状态：草稿/可用/已退役',
  `system_prompt` LONGTEXT NOT NULL COMMENT '完整System Prompt全文（支持 {{RUBRIC_BLOCK}} {{SUBJECT}} 占位符）',
  `modifiers`     JSON NULL COMMENT '场景修饰提示词 {strict,encouraging,balanced}',
  `change_log`    VARCHAR(500) NULL COMMENT '版本变更说明',
  `created_by`    INT UNSIGNED NULL COMMENT '创建人ID（管理员）',
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_key_version` (`prompt_key`,`version`),
  KEY `idx_key_status` (`prompt_key`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI批改-提示词版本库';

-- 5. 提示词路由表（版本切换/灰度/回滚开关）
CREATE TABLE IF NOT EXISTS `prompt_routings` (
  `id`                INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '路由ID',
  `prompt_key`        VARCHAR(50) NOT NULL COMMENT '提示词标识，唯一',
  `stable_version_id` INT UNSIGNED NOT NULL COMMENT '当前稳定版（正式全量使用）',
  `canary_version_id` INT UNSIGNED NULL COMMENT '灰度测试版（NULL=无灰度）',
  `canary_percent`    TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '灰度百分比0-100，task_id%100<该值走灰度版',
  `updated_by`        INT UNSIGNED NULL COMMENT '最后操作人',
  `created_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_key` (`prompt_key`),
  CONSTRAINT `fk_route_stable` FOREIGN KEY (`stable_version_id`) REFERENCES `prompt_versions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_route_canary` FOREIGN KEY (`canary_version_id`)  REFERENCES `prompt_versions` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI批改-提示词版本路由';

-- 6. 批改任务表（异步队列载体）
CREATE TABLE IF NOT EXISTS `grading_tasks` (
  `id`                INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '任务ID',
  `submission_id`     INT UNSIGNED NOT NULL COMMENT '待批改的提交ID',
  `assignment_id`     INT UNSIGNED NOT NULL COMMENT '所属作业ID（冗余）',
  `template_id`       INT UNSIGNED NOT NULL COMMENT '使用的模板ID',
  `template_snapshot` JSON NOT NULL COMMENT '模板完整快照（创建时固化）',
  `prompt_key`        VARCHAR(50) NOT NULL DEFAULT 'grading.main' COMMENT '提示词标识',
  `prompt_mode`       ENUM('balanced','strict','encouraging') NOT NULL DEFAULT 'balanced' COMMENT '场景修饰模式',
  `reference_answer`  MEDIUMTEXT NULL COMMENT '本次批改的参考答案',
  `grading_criteria`  TEXT NULL COMMENT '教师补充的评分说明',
  `status`            ENUM('pending','processing','success','failed','cancelled') NOT NULL DEFAULT 'pending' COMMENT '状态',
  `attempt`           TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '已尝试次数（入队抢占时+1）',
  `max_attempts`      TINYINT UNSIGNED NOT NULL DEFAULT 3 COMMENT '最大尝试次数（含首次）',
  `priority`          TINYINT UNSIGNED NOT NULL DEFAULT 5 COMMENT '优先级，数字越小越先执行',
  `next_run_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '下次可执行时间（退避重试靠它延迟）',
  `locked_by`         VARCHAR(50) NULL COMMENT '占用该任务的worker标识',
  `locked_at`         DATETIME NULL COMMENT '占用时间（僵死任务回收依据）',
  `error_msg`         VARCHAR(1000) NULL COMMENT '最近一次失败原因',
  `created_by`        INT UNSIGNED NOT NULL COMMENT '创建任务的教师ID',
  `created_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_claim` (`status`,`priority`,`next_run_at`) COMMENT 'worker抢占扫描索引',
  KEY `idx_assignment` (`assignment_id`,`status`),
  KEY `idx_submission` (`submission_id`),
  CONSTRAINT `fk_task_submission` FOREIGN KEY (`submission_id`) REFERENCES `submissions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_task_assignment` FOREIGN KEY (`assignment_id`) REFERENCES `assignments` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_task_template`   FOREIGN KEY (`template_id`)   REFERENCES `grading_templates` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI批改-异步任务队列';

-- 7. 批改结果表
CREATE TABLE IF NOT EXISTS `grading_results` (
  `id`                 INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '结果ID',
  `task_id`            INT UNSIGNED NOT NULL COMMENT '任务ID',
  `submission_id`      INT UNSIGNED NOT NULL COMMENT '提交ID（冗余，学生端直查）',
  `template_id`        INT UNSIGNED NOT NULL COMMENT '模板ID',
  `prompt_key`         VARCHAR(50) NOT NULL COMMENT '提示词标识',
  `prompt_version`     VARCHAR(20) NOT NULL COMMENT '实际使用的提示词版本（审计）',
  `total_score`        DECIMAL(6,1) NOT NULL COMMENT '总分（服务端按维度求和，非LLM给出）',
  `full_score`         DECIMAL(6,1) NOT NULL COMMENT '满分',
  `dimension_scores`   JSON NOT NULL COMMENT '各维度得分详情',
  `overall_feedback`   TEXT NULL COMMENT '总体评语',
  `improvement_advice` TEXT NULL COMMENT '改进建议',
  `deduction_summary`  JSON NULL COMMENT '扣分汇总 [{dimension,description,penalty}]',
  `knowledge_errors`   JSON NULL COMMENT '知识性错误列表',
  `confidence`         DECIMAL(4,3) NOT NULL DEFAULT 1.000 COMMENT '批改置信度0-1，低于阈值自动进人工复核',
  `needs_review`       TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否需要人工复核',
  `review_reasons`     JSON NULL COMMENT '触发复核的原因列表',
  `raw_response`       LONGTEXT NULL COMMENT 'LLM原始返回（审计/问题定位）',
  `llm_model`          VARCHAR(100) NULL COMMENT '实际使用的模型（含降级切换）',
  `tokens_used`        JSON NULL COMMENT 'token用量',
  `created_at`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_task` (`task_id`),
  KEY `idx_submission` (`submission_id`,`created_at`),
  KEY `idx_review_flag` (`needs_review`),
  CONSTRAINT `fk_res_task`       FOREIGN KEY (`task_id`)       REFERENCES `grading_tasks` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_res_submission` FOREIGN KEY (`submission_id`) REFERENCES `submissions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_res_template`   FOREIGN KEY (`template_id`)   REFERENCES `grading_templates` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI批改-批改结果';

-- 8. 人工复核表
CREATE TABLE IF NOT EXISTS `grading_reviews` (
  `id`                    INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '复核工单ID',
  `result_id`             INT UNSIGNED NOT NULL COMMENT '批改结果ID',
  `task_id`               INT UNSIGNED NOT NULL COMMENT '任务ID（冗余）',
  `submission_id`         INT UNSIGNED NOT NULL COMMENT '提交ID（冗余）',
  `status`                ENUM('pending','approved','adjusted','rejected') NOT NULL DEFAULT 'pending' COMMENT '状态：待复核/通过/已调整/已否决',
  `assigned_to`           INT UNSIGNED NULL COMMENT '指派复核教师ID',
  `reviewer_id`           INT UNSIGNED NULL COMMENT '实际复核教师ID',
  `reviewed_at`           DATETIME NULL COMMENT '复核完成时间',
  `original_score`        DECIMAL(6,1) NOT NULL COMMENT 'AI原始总分',
  `final_score`           DECIMAL(6,1) NULL COMMENT '复核后最终总分',
  `dimension_adjustments` JSON NULL COMMENT '维度调整明细 [{code,from,to,reason}]',
  `comment`               TEXT NULL COMMENT '复核意见',
  `created_at`            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_result` (`result_id`),
  KEY `idx_status_created` (`status`,`created_at`),
  KEY `idx_submission` (`submission_id`),
  CONSTRAINT `fk_rev_result`     FOREIGN KEY (`result_id`)     REFERENCES `grading_results` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rev_submission` FOREIGN KEY (`submission_id`) REFERENCES `submissions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rev_reviewer`   FOREIGN KEY (`reviewer_id`)   REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI批改-人工复核工单';
