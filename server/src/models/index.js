const Sequelize = require('sequelize');
const sequelize = require('../config/database');
const User = require('./User');
const School = require('./School');
const Class = require('./Class');
const ClassStudent = require('./ClassStudent');
const Course = require('./Course');
const CourseAssistant = require('./CourseAssistant');
const Assignment = require('./Assignment');
const Submission = require('./Submission');
const SubmissionFile = require('./SubmissionFile');
const Notification = require('./Notification');
const PlagiarismResult = require('./PlagiarismResult');
const PlagiarismTask = require('./PlagiarismTask');

// ===== 关联关系 =====
// 班级 - 班主任(教师)
Class.belongsTo(User, { as: 'headTeacher', foreignKey: 'teacher_id' });
User.hasMany(Class, { as: 'headClasses', foreignKey: 'teacher_id' });

// 用户 - 学校
User.belongsTo(School, { as: 'school', foreignKey: 'school_id' });
School.hasMany(User, { as: 'users', foreignKey: 'school_id' });

// 班级 - 学校
Class.belongsTo(School, { as: 'school', foreignKey: 'school_id' });
School.hasMany(Class, { as: 'classes', foreignKey: 'school_id' });

// 课程 - 学校
Course.belongsTo(School, { as: 'school', foreignKey: 'school_id' });
School.hasMany(Course, { as: 'schoolCourses', foreignKey: 'school_id' });

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

// 课程 - 课代表（多对多：一门课可多名课代表，一名学生可任多门课代表）
CourseAssistant.belongsTo(Course, { as: 'course', foreignKey: 'course_id' });
Course.hasMany(CourseAssistant, { as: 'assistants', foreignKey: 'course_id' });
CourseAssistant.belongsTo(User, { as: 'student', foreignKey: 'student_id' });
User.hasMany(CourseAssistant, { as: 'assistantships', foreignKey: 'student_id' });

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

// 查重结果 - 提交
PlagiarismResult.belongsTo(Submission, { as: 'submission', foreignKey: 'submission_id' });
Submission.hasMany(PlagiarismResult, { as: 'plagiarismResults', foreignKey: 'submission_id' });

PlagiarismResult.belongsTo(Submission, { as: 'comparedWith', foreignKey: 'compared_with_id' });

// 查重任务 - 作业/教师
PlagiarismTask.belongsTo(Assignment, { as: 'assignment', foreignKey: 'assignment_id' });
Assignment.hasMany(PlagiarismTask, { as: 'plagiarismTasks', foreignKey: 'assignment_id' });
PlagiarismTask.belongsTo(User, { as: 'creator', foreignKey: 'created_by' });

module.exports = {
  sequelize,
  User,
  School,
  Class,
  ClassStudent,
  Course,
  CourseAssistant,
  Assignment,
  Submission,
  SubmissionFile,
  Notification,
  PlagiarismResult,
  PlagiarismTask
};
