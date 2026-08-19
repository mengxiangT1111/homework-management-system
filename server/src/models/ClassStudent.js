const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ClassStudent = sequelize.define('ClassStudent', {
  id: {
    type: DataTypes.INTEGER.UNSIGNED,
    primaryKey: true,
    autoIncrement: true
  },
  class_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '班级ID'
  },
  student_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '学生ID'
  },
  position: {
    type: DataTypes.ENUM('none', 'monitor', 'commissary'),
    allowNull: false,
    defaultValue: 'none',
    comment: '班级职务：none普通学生 / monitor班长 / commissary学委'
  }
}, {
  tableName: 'class_students',
  indexes: [
    { unique: true, fields: ['class_id', 'student_id'] },
    // 业务规则"一个学生只能加入一个班级"，数据库层兜底并发加入；
    // 注意：已存在的表需手动执行
    //   ALTER TABLE class_students ADD UNIQUE KEY uniq_student_one_class (student_id);
    { unique: true, name: 'uniq_student_one_class', fields: ['student_id'] }
  ]
});

module.exports = ClassStudent;
