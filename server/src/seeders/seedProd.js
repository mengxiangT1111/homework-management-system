/**
 * 生产环境初始化脚本
 * 仅创建管理员账号（不创建示例教师/学生），密码从环境变量读取或使用默认值
 * 用法：docker exec hw_backend node src/seeders/seedProd.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const bcrypt = require('bcryptjs');
const { sequelize, User } = require('../models');

async function seedProd() {
  try {
    await sequelize.authenticate();
    await sequelize.sync({ alter: true });
    console.log('数据库连接成功，开始初始化管理员账号...\n');

    const adminUser = process.env.ADMIN_USERNAME || 'admin';
    const adminPwd = process.env.ADMIN_PASSWORD || 'admin123';

    const [admin, created] = await User.findOrCreate({
      where: { username: adminUser },
      defaults: {
        username: adminUser,
        password: bcrypt.hashSync(adminPwd, 10),
        real_name: '系统管理员',
        role: 'admin',
        status: 1
      }
    });

    if (created) {
      console.log('✓ 管理员账号已创建');
      console.log(`  账号: ${adminUser}`);
      console.log(`  密码: ${adminPwd}`);
      console.log('  ⚠️  请登录后立即修改密码！');
    } else {
      console.log('✓ 管理员账号已存在，跳过');
    }

    console.log('\n✓ 生产环境初始化完成');
    process.exit(0);
  } catch (err) {
    console.error('✗ 初始化失败:', err.message);
    process.exit(1);
  }
}

seedProd();
