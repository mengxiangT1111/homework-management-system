const sequelize = require('../config/database');
const User = require('./User');
const Class = require('./Class');
const ClassStudent = require('./ClassStudent');
const Course = require('./Course');
const Assignment = require('./Assignment');
const Submission = require('./Submission');
const SubmissionFile = require('./SubmissionFile');
const Notification = require('./Notification');

// ===== 关联关系 =====
// 班级 - 班主任(教师)
Class.belongsTo(User, { as: 'headTeacher', foreignKey: 'teacher_id' });
User.hasMany(Class, { as: 'headClasses', foreignKey: 'teacher_id' });

// 班级 - 学生（多对多）
Class.belongsToMany(User, {
  through: ClassStudent,
  as: 'students',
  foreignKey: 'class_id',
  otherKey: 'student_id'
});
User.belongsToMany(Class, {
  through: ClassStudent,
  as: 'classes',
  foreignKey: 'student_id',
  otherKey: 'class_id'
});

// 课程 - 班级
Course.belongsTo(Class, { as: 'class', foreignKey: 'class_id' });
Class.hasMany(Course, { as: 'courses', foreignKey: 'class_id' });

// 课程 - 任课教师
Course.belongsTo(User, { as: 'teacher', foreignKey: 'teacher_id' });
User.hasMany(Course, { as: 'teachingCourses', foreignKey: 'teacher_id' });

// 作业 - 课程
Assignment.belongsTo(Course, { as: 'course', foreignKey: 'course_id' });
Course.hasMany(Assignment, { as: 'assignments', foreignKey: 'course_id' });

// 作业 - 教师
Assignment.belongsTo(User, { as: 'teacher', foreignKey: 'teacher_id' });
User.hasMany(Assignment, { as: 'assignments', foreignKey: 'teacher_id' });

// 提交 - 作业
Submission.belongsTo(Assignment, { as: 'assignment', foreignKey: 'assignment_id' });
Assignment.hasMany(Submission, { as: 'submissions', foreignKey: 'assignment_id' });

// 提交 - 学生
Submission.belongsTo(User, { as: 'student', foreignKey: 'student_id' });
User.hasMany(Submission, { as: 'submissions', foreignKey: 'student_id' });

// 提交文件 - 提交
SubmissionFile.belongsTo(Submission, { as: 'submission', foreignKey: 'submission_id' });
Submission.hasMany(SubmissionFile, { as: 'files', foreignKey: 'submission_id' });

// 通知 - 用户
Notification.belongsTo(User, { as: 'user', foreignKey: 'user_id' });
User.hasMany(Notification, { as: 'notifications', foreignKey: 'user_id' });

module.exports = {
  sequelize,
  User,
  Class,
  ClassStudent,
  Course,
  Assignment,
  Submission,
  SubmissionFile,
  Notification
};
