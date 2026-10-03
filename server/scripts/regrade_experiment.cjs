/**
 * regrade_experiment.cjs — 换模型后重跑预实验批量批改
 * 从各作业最近一次批改任务复制参数（模板/参考答案/评分说明/模式），
 * 以 force=true 重建全部提交的批改任务，由后端队列 worker 用当前 .env 模型消费。
 * 用法（server 目录下）：node scripts/regrade_experiment.cjs [assignment_id ...]
 * 不传参数默认重批预实验三作业（12 语文 / 13 数学 / 14 英语）。
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { sequelize, Assignment, User, GradingTask } = require('../src/models');
const gradingService = require('../src/services/grading/grading.service');

async function main() {
  const args = process.argv.slice(2).map(Number).filter(Boolean);
  const assignmentIds = args.length ? args : [12, 13, 14];

  for (const aid of assignmentIds) {
    const asg = await Assignment.findByPk(aid);
    if (!asg) throw new Error(`作业 ${aid} 不存在`);
    const teacher = await User.findByPk(asg.teacher_id);
    if (!teacher) throw new Error(`作业 ${aid} 的教师不存在`);

    // 复制最近一次批改任务的参数快照
    const last = await GradingTask.findOne({ where: { assignment_id: aid }, order: [['id', 'DESC']] });
    if (!last) throw new Error(`作业 ${aid} 没有历史批改任务可复制参数`);

    const { count, task_ids } = await gradingService.createBatchTasks({
      teacher: { id: teacher.id, role: teacher.role, school_id: teacher.school_id },
      assignmentId: aid,
      templateId: last.template_id,
      referenceAnswer: last.reference_answer,
      gradingCriteria: last.grading_criteria,
      mode: last.prompt_mode,
      force: true
    });
    console.log(`作业 ${aid}（${asg.title}）：已创建 ${count} 个批改任务（模板 ${last.template_id}，参数复制自任务 ${last.id}）`);
  }
  await sequelize.close();
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL:', e.message); process.exit(1); });
