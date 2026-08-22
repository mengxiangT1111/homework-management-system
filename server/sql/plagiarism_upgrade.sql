-- ============================================================
-- 全班查重异步任务化 - 建表 SQL（MySQL 8.0+）
-- 说明：plagiarism_tasks 为新表，生产环境 sequelize.sync() 会自动创建；
--      本文件供 DBA 手工迁移或审计表结构使用（权威版本）。
-- 不涉及已有表的加列/改列，无需 ALTER。
-- ============================================================

CREATE TABLE IF NOT EXISTS `plagiarism_tasks` (
  `id`                INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '任务ID',
  `assignment_id`     INT UNSIGNED NOT NULL COMMENT '作业ID',
  `created_by`        INT UNSIGNED NOT NULL COMMENT '创建任务的教师ID',
  `status`            ENUM('pending','processing','done','failed','cancelled') NOT NULL DEFAULT 'pending' COMMENT '任务状态：待处理/处理中/完成/失败/已取消',
  `total_submissions` INT NOT NULL DEFAULT 0 COMMENT '参与查重的提交数',
  `total_pairs`       INT NOT NULL DEFAULT 0 COMMENT '需比对的组合对数 C(n,2)',
  `completed_pairs`   INT NOT NULL DEFAULT 0 COMMENT '已完成的对数（进度）',
  `failed_pairs`      INT NOT NULL DEFAULT 0 COMMENT '检测失败的对数',
  `suspicious_count`  INT NOT NULL DEFAULT 0 COMMENT '可疑对数（去重后）',
  `attempt`           TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '已尝试次数（入队抢占时+1）',
  `max_attempts`      TINYINT UNSIGNED NOT NULL DEFAULT 2 COMMENT '最大尝试次数（含首次）',
  `next_run_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '下次可执行时间（退避重试靠它延迟）',
  `locked_by`         VARCHAR(50) NULL COMMENT '占用该任务的worker标识',
  `locked_at`         DATETIME NULL COMMENT '占用时间（僵死任务回收依据）',
  `error_msg`         VARCHAR(1000) NULL COMMENT '最近一次失败原因',
  `started_at`        DATETIME NULL COMMENT '开始执行时间',
  `finished_at`       DATETIME NULL COMMENT '完成/终止时间',
  `result_summary`    JSON NULL COMMENT '完成时的摘要 { totalComparisons, note }',
  `created_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_status_next_run` (`status`,`next_run_at`),
  KEY `idx_assignment_status` (`assignment_id`,`status`),
  KEY `idx_created_by` (`created_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='全班查重-异步任务';
