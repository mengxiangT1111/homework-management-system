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

    // 生产初始化必须显式提供管理员密码：禁止弱口令兜底（此前忘记设置
    // ADMIN_PASSWORD 时会静默创建 admin/admin123，任何人可直接接管平台）
    const adminUser = process.env.ADMIN_USERNAME || 'admin';
    const adminPwd = process.env.ADMIN_PASSWORD;
    if (!adminPwd || adminPwd.length < 8) {
      console.error('✗ 必须通过环境变量 ADMIN_PASSWORD 提供至少 8 位的管理员初始密码，');
      console.error('  例如：ADMIN_PASSWORD=$(openssl rand -base64 18) docker compose ... ');
      process.exit(1);
    }

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
