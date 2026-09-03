-- ============================================================
-- 安全加固升级脚本（2026-09）
-- 适用于已按旧版本建库的环境；新库由 sequelize.sync() 自动建表/建列
-- 执行方式（Docker 部署）：
--   docker exec -i hw_backend mysql -uhomework -p$DB_PASSWORD homework_db < sql/security_upgrade.sql
-- ============================================================

-- 1) assignments.created_by：作业实际创建者（教师本人 / 班委代发 / 课代表代发）。
--    班委/课代表的改/删作业接口据此限定"只能操作自己代发的作业"，
--    NULL 视为教师本人发布，仅教师/管理员可管理。
ALTER TABLE `assignments`
  ADD COLUMN `created_by` INT UNSIGNED NULL COMMENT '实际创建者用户ID（NULL=历史数据，视为教师本人发布）' AFTER `teacher_id`;

-- 2) upload_records：上传归属记录（谁上传的文件）。
--    提交作业绑定时校验 file_path 确属当前用户上传，防止"冒绑"他人文件。
CREATE TABLE IF NOT EXISTS `upload_records` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL COMMENT '上传者用户ID',
  `file_path` VARCHAR(255) NOT NULL COMMENT '存储相对路径（uploads/xxx 或 cos://homeworks/xxx）',
  `original_name` VARCHAR(255) NULL COMMENT '原始文件名',
  `file_size` BIGINT NULL COMMENT '文件字节数',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_file` (`user_id`, `file_path`),
  KEY `idx_file_path` (`file_path`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
