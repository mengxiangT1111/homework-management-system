const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const CourseAssistant = sequelize.define('CourseAssistant', {
  id: {
    type: DataTypes.INTEGER.UNSIGNED,
    primaryKey: true,
    autoIncrement: true
  },
  course_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '课程ID'
  },
  student_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '学生ID（课代表）'
  }
}, {
  tableName: 'course_assistants'
});

module.exports = CourseAssistant;
