/**
 * 生产环境初始化脚本（在容器内执行）
 * 用法：docker compose -f docker-compose.prod.yml exec backend node seed.prod.js
 */
const bcrypt = require('bcryptjs');
const { sequelize, User } = require('./src/models');

async function seed() {
  try {
    await sequelize.authenticate();
    await sequelize.sync({ alter: true });

    const [admin] = await User.findOrCreate({
      where: { username: 'admin' },
      defaults: {
        username: 'admin',
        password: bcrypt.hashSync('admin123', 10),
        real_name: '系统管理员',
        role: 'admin',
        status: 1
      }
    });
    console.log('✓ 管理员账号已就绪: admin / admin123');
    process.exit(0);
  } catch (err) {
    console.error('✗ 初始化失败:', err.message);
    process.exit(1);
  }
}

seed();
