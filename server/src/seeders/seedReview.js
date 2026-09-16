/**
 * 微信审核体验数据种子（生产可用，幂等）
 *
 * 用途：小程序提审时，微信审核员需要可登录的体验账号才能完整体验功能。
 * 创建一套隔离的演示数据：学校 + 教师/学生账号 + 班级 + 课程 + 两个作业。
 *
 * 用法（生产容器内执行）：
 *   docker exec hw_backend node src/seeders/seedReview.js
 * 本地：
 *   cd server && npm run seed:review
 *
 * 密码可用环境变量 REVIEW_PASSWORD 覆盖（默认 Xinheng@2026，重复执行会重置为该值）。
 * 审核通过后如需收回：管理员在网页端将两个演示账号禁用即可，数据不影响真实班级。
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const bcrypt = require('bcryptjs');
const { sequelize, User, School, Class, ClassStudent, Course, Assignment } = require('../models');

const REVIEW_PASSWORD = process.env.REVIEW_PASSWORD || 'Xinheng@2026';
const SCHOOL_NAME = '信衡演示学校';

async function upsertUser({ username, realName, role, schoolId }) {
  const [user, created] = await User.findOrCreate({
    where: { username, school_id: schoolId },
    defaults: {
      username,
      password: bcrypt.hashSync(REVIEW_PASSWORD, 10),
      real_name: realName,
      role,
      status: 1
    }
  });
  // 重复执行时重置密码并确保启用，保证提审页面填写的凭据始终有效
  if (!created) {
    user.password = bcrypt.hashSync(REVIEW_PASSWORD, 10);
    user.status = 1;
    await user.save();
  }
  return { user, created };
}

async function seedReview() {
  try {
    await sequelize.authenticate();

    const [school] = await School.findOrCreate({
      where: { code: 'XHDEMO' },
      defaults: { name: SCHOOL_NAME, code: 'XHDEMO' }
    });

    // 教师直接以启用状态创建（注册流程的教师需管理员审核，这里绕开）
    const teacher = await upsertUser({ username: 'review_teacher', realName: '演示教师', role: 'teacher', schoolId: school.id });
    const student = await upsertUser({ username: 'review_student', realName: '演示学生', role: 'student', schoolId: school.id });

    const [klass] = await Class.findOrCreate({
      where: { name: '演示1班', school_id: school.id },
      defaults: { name: '演示1班', school_id: school.id, grade: '2025级', teacher_id: teacher.user.id, description: '微信审核演示班级' }
    });

    await ClassStudent.findOrCreate({
      where: { class_id: klass.id, student_id: student.user.id },
      defaults: { class_id: klass.id, student_id: student.user.id, position: 'none' }
    });

    const [course] = await Course.findOrCreate({
      where: { name: '演示课程', class_id: klass.id },
      defaults: {
        name: '演示课程',
        school_id: school.id,
        class_id: klass.id,
        teacher_id: teacher.user.id,
        description: '微信审核演示课程',
        semester: '2025-2026-1'
      }
    });

    const now = Date.now();
    await Assignment.findOrCreate({
      where: { title: '演示作业：课程心得', course_id: course.id },
      defaults: {
        title: '演示作业：课程心得',
        description: '这是一条用于微信审核演示的作业，提交任意 PDF/图片文件即可体验完整流程。',
        course_id: course.id,
        teacher_id: teacher.user.id,
        deadline: new Date(now + 7 * 24 * 3600 * 1000),
        allowed_formats: ['pdf', 'doc', 'docx', 'jpg', 'png', 'zip'],
        max_files: 5,
        max_size_mb: 100,
        status: 'active',
        need_grading: 1
      }
    });
    await Assignment.findOrCreate({
      where: { title: '演示作业（已截止）', course_id: course.id },
      defaults: {
        title: '演示作业（已截止）',
        description: '已截止的历史作业，用于展示逾期状态。',
        course_id: course.id,
        teacher_id: teacher.user.id,
        deadline: new Date(now - 24 * 3600 * 1000),
        allowed_formats: ['pdf', 'doc', 'docx', 'jpg', 'png', 'zip'],
        max_files: 5,
        max_size_mb: 100,
        status: 'closed',
        need_grading: 0
      }
    });

    console.log('✓ 审核演示数据就绪（幂等，可重复执行）');
    console.log(`  学校：${SCHOOL_NAME}（登录页学校列表中选择它）`);
    console.log(`  教师：review_teacher / ${REVIEW_PASSWORD}`);
    console.log(`  学生：review_student / ${REVIEW_PASSWORD}`);
    console.log('  提审时在「体验账号」中填写以上任一账号；审核通过后可在网页端禁用。');
    process.exit(0);
  } catch (err) {
    console.error('✗ 审核演示数据创建失败:', err.message);
    process.exit(1);
  }
}

seedReview();
