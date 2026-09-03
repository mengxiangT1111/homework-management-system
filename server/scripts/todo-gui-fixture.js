/**
 * GUI 冒烟测试夹具：创建一组保留账号（测试完用 cleanup 模式删除）
 * 用法：node scripts/todo-gui-fixture.js create|cleanup
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const PREFIX = 'gui_todo';
async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: +process.env.DB_PORT,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });
  const mode = process.argv[2] || 'create';

  if (mode === 'create') {
    const pwd = await bcrypt.hash('gui123456', 10);
    const mk = async (username, realName, role) => {
      const [r] = await conn.execute(
        'INSERT INTO users (username, password, real_name, role, school_id, status, created_at, updated_at) VALUES (?,?,?,?,1,1,NOW(),NOW())',
        [username, pwd, realName, role]);
      return r.insertId;
    };
    const T = await mk(`${PREFIX}t`, '桂老师', 'teacher');
    const S1 = await mk(`${PREFIX}c`, '陈学委', 'student');
    const S2 = await mk(`${PREFIX}s`, '林同学', 'student');
    const [cls] = await conn.execute(
      'INSERT INTO classes (name, grade, teacher_id, school_id, created_at, updated_at) VALUES (?,?,?,1,NOW(),NOW())',
      ['GUI待办班', '2026', T]);
    const C = cls.insertId;
    await conn.execute('INSERT INTO class_students (class_id, student_id, position, created_at, updated_at) VALUES (?,?,?,NOW(),NOW())', [C, S1, 'commissary']);
    await conn.execute('INSERT INTO class_students (class_id, student_id, position, created_at, updated_at) VALUES (?,?,?,NOW(),NOW())', [C, S2, 'none']);
    console.log(JSON.stringify({ T, S1, S2, C, password: 'gui123456',
      accounts: { teacher: `${PREFIX}t`, commissary: `${PREFIX}c`, student: `${PREFIX}s` } }));
  } else {
    const [us] = await conn.execute('SELECT id FROM users WHERE username LIKE ?', [`${PREFIX}%`]);
    const ids = us.map(u => u.id);
    if (ids.length) {
      const ph = ids.map(() => '?').join(',');
      await conn.execute(`DELETE FROM notifications WHERE user_id IN (${ph})`, ids);
      await conn.execute(`DELETE FROM todo_completions WHERE student_id IN (${ph})`, ids);
      const [cls] = await conn.execute('SELECT id FROM classes WHERE teacher_id IN (' + ph + ')', ids);
      for (const c of cls) {
        await conn.execute('DELETE FROM todos WHERE class_id=?', [c.id]);
        await conn.execute('DELETE FROM class_students WHERE class_id=?', [c.id]);
        // 先删课程再删班级（courses.class_id 外键引用 classes，顺序反了会 1451）
        await conn.execute('DELETE FROM course_assistants WHERE course_id IN (SELECT id FROM courses WHERE class_id=?)', [c.id]);
        await conn.execute('DELETE FROM courses WHERE class_id=?', [c.id]);
        await conn.execute('DELETE FROM classes WHERE id=?', [c.id]);
      }
      await conn.execute(`DELETE FROM users WHERE id IN (${ph})`, ids);
    }
    console.log('cleaned', ids.length, 'users');
  }
  await conn.end();
}
main().catch(e => { console.error(e); process.exit(1); });
