/**
 * 初始数据填充
 * 创建默认管理员账号 admin / admin123
 * 用法：npm run seed
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const bcrypt = require('bcryptjs');
const { sequelize, User } = require('../models');

async function seed() {
  try {
    await sequelize.authenticate();
    await sequelize.sync({ alter: true });
    console.log('数据库连接成功，开始填充初始数据...\n');

    // 创建默认管理员
    const [admin, created] = await User.findOrCreate({
      where: { username: 'admin' },
      defaults: {
        username: 'admin',
        password: bcrypt.hashSync('admin123', 10),
        real_name: '系统管理员',
        role: 'admin',
        email: 'admin@school.edu.cn',
        status: 1
      }
    });
    console.log(`管理员账号：${created ? '已创建' : '已存在'}`);
    console.log(`  账号: admin`);
    console.log(`  密码: admin123`);

    // 创建示例教师账号（方便快速体验）
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
    console.log(`示例教师账号：${tCreated ? '已创建' : '已存在'} (teacher / teacher123)`);

    // 创建示例学生账号
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
    console.log(`示例学生账号：${sCreated ? '已创建' : '已存在'} (student / student123)`);

    console.log('\n✓ 初始数据填充完成');
    process.exit(0);
  } catch (err) {
    console.error('✗ 填充失败:', err.message);
    process.exit(1);
  }
}

seed();
