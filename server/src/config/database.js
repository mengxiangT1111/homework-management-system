const { Sequelize } = require('sequelize');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// 数据库口令必须显式配置：不再回退到弱默认口令（默认口令一旦写入部署文档
// 等于公开），缺失时启动即失败并给出明确指引
if (!process.env.DB_PASSWORD) {
  throw new Error('缺少 DB_PASSWORD：请在 server/.env 中配置数据库密码（与 docker-compose 中 MYSQL_PASSWORD 一致）');
}

const sequelize = new Sequelize(
  process.env.DB_NAME || 'homework_db',
  process.env.DB_USER || 'homework',
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    dialect: 'mysql',
    dialectOptions: {
      charset: 'utf8mb4'
    },
    logging: false,
    timezone: '+08:00',
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000
    },
    define: {
      timestamps: true,
      underscored: true,
      charset: 'utf8mb4',
      collate: 'utf8mb4_unicode_ci',
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    }
  }
);

module.exports = sequelize;
