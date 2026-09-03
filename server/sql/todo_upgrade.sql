-- ============================================================
-- 任务待办功能 - 建表 SQL（MySQL 8.0+）
-- 说明：todos / todo_completions 为新表，生产环境 sequelize.sync()
--      会自动创建；本文件供 DBA 手工迁移或审计表结构使用（权威版本）。
-- 不涉及已有表的加列/改列，无需 ALTER。
-- ============================================================

CREATE TABLE IF NOT EXISTS `todos` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '待办ID',
  `class_id`   INT UNSIGNED NOT NULL COMMENT '所属班级ID',
  `title`      VARCHAR(100) NOT NULL COMMENT '待办标题',
  `content`    TEXT NULL COMMENT '待办详细说明',
  `due_date`   DATETIME NULL COMMENT '截止时间（可选）',
  `status`     ENUM('active','closed') NOT NULL DEFAULT 'active' COMMENT '待办状态：active进行中 / closed已结束',
  `created_by` INT UNSIGNED NOT NULL COMMENT '发布者用户ID（教师或学委），删改仅限本人',
  `creator_identity` VARCHAR(20) NULL COMMENT '发布时身份（老师/班长/学委/课代表），冗余存储保证历史署名不随职务变动漂移；NULL=旧数据',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_todos_class_id` (`class_id`),
  KEY `idx_todos_created_by` (`created_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务待办';

-- 已按旧版本建过 todos 表的环境，需手动补列（sync 不做 ALTER）：
--   ALTER TABLE `todos` ADD COLUMN `creator_identity` VARCHAR(20) NULL COMMENT '发布时身份（老师/班长/学委/课代表），冗余存储保证历史署名不随职务变动漂移；NULL=旧数据' AFTER `created_by`;
--   UPDATE `todos` SET `creator_identity` = '老师' WHERE `creator_identity` IS NULL;  -- 按实际情况回填历史身份

CREATE TABLE IF NOT EXISTS `todo_completions` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '记录ID',
  `todo_id`      INT UNSIGNED NOT NULL COMMENT '待办ID',
  `student_id`   INT UNSIGNED NOT NULL COMMENT '完成学生ID',
  `completed_at` DATETIME NOT NULL COMMENT '完成时间',
  `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_todo_student` (`todo_id`,`student_id`),
  KEY `idx_completions_student_id` (`student_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='待办完成记录';
