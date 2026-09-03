/**
 * 开发环境示例数据填充（仅限本地开发，生产环境禁止执行）
 * - admin：密码取 ADMIN_PASSWORD 环境变量，未设置则随机生成并打印（仅创建时打印一次）
 * - teacher/student：固定弱口令的演示账号，仅用于本地联调，生产环境一律不创建
 * 用法：npm run seed
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { sequelize, User } = require('../models');

async function seed() {
  if (process.env.NODE_ENV === 'production') {
    console.error('✗ 检测到 NODE_ENV=production：开发 seed 含固定弱口令演示账号，禁止在生产执行。');
    console.error('  生产初始化请使用 src/seeders/seedProd.js（需显式提供 ADMIN_PASSWORD）。');
    process.exit(1);
  }
  try {
    await sequelize.authenticate();
    await sequelize.sync({ alter: true });
    console.log('数据库连接成功，开始填充初始数据...\n');

    // 管理员：密码来自环境变量或随机生成，不再有 admin123 兜底
    const adminPwd = process.env.ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url');
    const [admin, adminCreated] = await User.findOrCreate({
      where: { username: 'admin' },
      defaults: {
        username: 'admin',
        password: bcrypt.hashSync(adminPwd, 10),
        real_name: '系统管理员',
        role: 'admin',
        email: 'admin@school.edu.cn',
        status: 1
      }
    });
    console.log(`管理员账号：${adminCreated ? '已创建' : '已存在'}`);
    console.log(`  账号: admin`);
    if (adminCreated) {
      console.log(`  密码: ${adminPwd}（仅此一次展示，请妥善保存；也可用 ADMIN_PASSWORD 预先指定）`);
    }

    // 示例教师账号（方便快速体验；仅限本地开发）
    const [teacher, tCreated] = await User.findOrCreate({
      where: { username: 'teacher' },
      defaults: {
        username: 'teacher',
        password: bcrypt.hashSync('teacher123', 10),
        real_name: '王老师',
        role: 'teacher',
        email: 'teacher@school.edu.cn',
        status: 1
      }
    });
    console.log(`示例教师账号：${tCreated ? '已创建' : '已存在'} (teacher / teacher123) — 仅限本地开发使用`);

    // 示例学生账号
    const [student, sCreated] = await User.findOrCreate({
      where: { username: 'student' },
      defaults: {
        username: 'student',
        password: bcrypt.hashSync('student123', 10),
        real_name: '张三',
        role: 'student',
        email: 'student@school.edu.cn',
        status: 1
      }
    });
    console.log(`示例学生账号：${sCreated ? '已创建' : '已存在'} (student / student123) — 仅限本地开发使用`);

    console.log('\n✓ 初始数据填充完成');
    process.exit(0);
  } catch (err) {
    console.error('✗ 填充失败:', err.message);
    process.exit(1);
  }
}

seed();
