/**
 * 生产环境初始化脚本（在容器内执行）
 * 用法：docker compose -f docker-compose.prod.yml exec backend node seed.prod.js
 */
const bcrypt = require('bcryptjs');
const { sequelize, User } = require('./src/models');

const isProduction = process.env.NODE_ENV === 'production';

async function seed() {
  try {
    await sequelize.authenticate();

    // 生产环境：只同步模型，不自动修改表结构
    if (isProduction) {
      await sequelize.sync();
      console.log('✓ 数据库表结构已验证（生产模式）');
    } else {
      await sequelize.sync({ alter: true });
      console.log('✓ 数据库表结构已同步（开发模式）');
    }

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
    process.exit(0);
  } catch (err) {
    console.error('✗ 初始化失败:', err.message);
    process.exit(1);
  }
}

seed();
