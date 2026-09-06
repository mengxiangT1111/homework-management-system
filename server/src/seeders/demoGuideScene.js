/**
 * 学生版新手指引 - 演示数据搭建（仅本地开发库）
 * 为种子演示账号 student(张三)/teacher(王老师) 搭建一套"示范班"截图场景：
 * 示范班 + 示范课程 + 示范作业 + 已批改提交（含 AI 批改结果与教师复核）+ 任务待办 + 通知
 * 幂等：全部 findOrCreate，可重复执行。实体名称均带（示范）标记，便于识别与清理。
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { sequelize, User, School, Class, ClassStudent, Course, Assignment,
        Submission, SubmissionFile, Todo, Notification,
        GradingTemplate, GradingTask, GradingResult, GradingReview } = require('../models');

const DAY = 24 * 3600 * 1000;
const now = Date.now();

async function main() {
  const student = await User.findByPk(3);   // student / 张三
  const teacher = await User.findByPk(2);   // teacher / 王老师
  if (!student || !teacher) throw new Error('请先执行 npm run seed 创建演示账号');
  if (student.school_id == null) { student.school_id = 1; await student.save(); }

  const [cls] = await Class.findOrCreate({
    where: { name: '软件技术 2024 级 1 班（示范）', school_id: 1 },
    defaults: { name: '软件技术 2024 级 1 班（示范）', school_id: 1, grade: '2024 级', teacher_id: teacher.id }
  });
  await ClassStudent.findOrCreate({ where: { class_id: cls.id, student_id: student.id },
    defaults: { class_id: cls.id, student_id: student.id, position: 'none' } });

  const [course] = await Course.findOrCreate({
    where: { name: '电子技术（示范）', class_id: cls.id },
    defaults: { name: '电子技术（示范）', class_id: cls.id, teacher_id: teacher.id, semester: '2025-2026-1', school_id: 1 }
  });

  const [assignment] = await Assignment.findOrCreate({
    where: { title: '实验二：单管放大电路仿真（示范）', course_id: course.id },
    defaults: {
      title: '实验二：单管放大电路仿真（示范）',
      description: '按实验指导书完成单管放大电路的搭建与仿真，提交仿真工程文件与实验报告，报告中需包含静态工作点的计算过程与波形截图。',
      course_id: course.id, created_by: teacher.id, teacher_id: teacher.id,
      deadline: new Date(now + 5 * DAY),
      allowed_formats: ['docx', 'pdf', 'zip'], max_files: 5, max_size_mb: 100,
      status: 'active', need_grading: 1
    }
  });

  const [sub] = await Submission.findOrCreate({
    where: { assignment_id: assignment.id, student_id: student.id },
    defaults: {
      assignment_id: assignment.id, student_id: student.id,
      status: 'graded', score: 92,
      comment: '步骤完整，波形分析到位，注意单位书写。',
      graded_by: teacher.id, graded_at: new Date(now - 1 * DAY),
      submitted_at: new Date(now - 3 * DAY),
      remark: '含仿真工程文件与实验报告'
    }
  });

  const filePath = 'uploads/202609/demo_exp2_report.docx';
  const [sfile] = await SubmissionFile.findOrCreate({
    where: { submission_id: sub.id, original_name: '实验报告-张三.docx' },
    defaults: { submission_id: sub.id, original_name: '实验报告-张三.docx',
                file_path: filePath, file_size: 1338, mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
  });

  const [tpl] = await GradingTemplate.findOrCreate({
    where: { name: '电子技术实验报告模板（示范）', teacher_id: teacher.id },
    defaults: { school_id: 1, teacher_id: teacher.id, name: '电子技术实验报告模板（示范）',
                subject: '物理', content_type: 'experiment', full_score: 100,
                description: '示范模板', status: 'published', version: 1 }
  });

  const dims = [
    { code: 'correctness', name: '正确性', max_score: 40, score: 38, level: 'A',
      evidence: '静态工作点计算过程完整，Q 点估算准确', deductions: [{ description: '发射极电阻取值与理论推导存在小偏差', penalty: 2 }], feedback: '计算规范，结论正确' },
    { code: 'standard', name: '规范性', max_score: 25, score: 23, level: 'A',
      evidence: '报告结构完整，图表清晰', deductions: [{ description: '波形截图缺少坐标标注', penalty: 2 }], feedback: '注意图表规范标注' },
    { code: 'complete', name: '完整性', max_score: 35, score: 31, level: 'B',
      evidence: '各步骤齐全', deductions: [{ description: '缺少与理论值的误差对比分析', penalty: 4 }], feedback: '建议补充误差分析' }
  ];

  const [task] = await GradingTask.findOrCreate({
    where: { submission_id: sub.id },
    defaults: { submission_id: sub.id, assignment_id: assignment.id, template_id: tpl.id,
                template_snapshot: { full_score: 100, dimensions: dims.map(d => ({ code: d.code, name: d.name, weight: d.max_score })) },
                prompt_key: 'grading.main', reference_answer: '（示范）静态工作点 Q(2V, 4mA)，波形无失真',
                status: 'success', attempt: 1, created_by: teacher.id }
  });

  const [result] = await GradingResult.findOrCreate({
    where: { submission_id: sub.id },
    defaults: { task_id: task.id, submission_id: sub.id, template_id: tpl.id,
                prompt_key: 'grading.main', prompt_version: 'demo-1',
                total_score: 92, full_score: 100, dimension_scores: dims,
                overall_feedback: '解题步骤完整、逻辑清晰，实验报告格式规范，整体完成质量较高。',
                improvement_advice: '建议补充波形截图的坐标标注；结论部分可增加与理论值的误差对比分析。',
                deduction_summary: [{ dimension: '正确性', description: '发射极电阻取值与理论推导存在小偏差', penalty: 2 },
                                    { dimension: '规范性', description: '波形截图缺少坐标标注', penalty: 2 },
                                    { dimension: '完整性', description: '缺少与理论值的误差对比分析', penalty: 4 }],
                knowledge_errors: ['静态工作点估算', '波形相位关系'],
                confidence: 0.86, needs_review: 0,
                llm_model: 'GLM-4（示范数据）' }
  });

  await GradingReview.findOrCreate({
    where: { result_id: result.id },
    defaults: { result_id: result.id, task_id: task.id, submission_id: sub.id, status: 'approved', reviewer_id: teacher.id,
                original_score: 92, final_score: 92, reviewed_at: new Date(now - 12 * 3600 * 1000),
                comment: '复核确认，评分合理。' }
  });

  const [todo] = await Todo.findOrCreate({
    where: { class_id: cls.id, title: '周五前提交实验报告电子版（示范）' },
    defaults: { class_id: cls.id, title: '周五前提交实验报告电子版（示范）',
                description: '请将实验报告 PDF 上传到「实验二」作业，文件名注明学号姓名；完成后点击「标记完成」。',
                deadline: new Date(now + 3 * DAY), status: 'active', created_by: teacher.id }
  });

  await Notification.findOrCreate({
    where: { user_id: student.id, title: '作业批改完成：《实验二：单管放大电路仿真（示范）》' },
    defaults: { user_id: student.id, title: '作业批改完成：《实验二：单管放大电路仿真（示范）》',
                content: '你的作业已批改完成，得分 92 分，点击「我的提交」查看 AI 批改详情与老师评语。',
                type: 'grade', is_read: 0 }
  });
  await Notification.findOrCreate({
    where: { user_id: student.id, title: '截止提醒：《实验二》进行中（示范）' },
    defaults: { user_id: student.id, title: '截止提醒：《实验二》进行中（示范）',
                content: '本作业将于 5 天后截止，请尽快完成提交。', type: 'deadline', is_read: 0 }
  });

  console.log('演示场景就绪：');
  console.log(`  班级 #${cls.id} ${cls.name}`);
  console.log(`  课程 #${course.id} ${course.name}`);
  console.log(`  作业 #${assignment.id} ${assignment.title}`);
  console.log(`  提交 #${sub.id}（score=${sub.score}）文件 #${sfile.id} ${filePath}`);
  console.log(`  AI结果 #${result.id} 待办 #${todo.id}`);
  process.exit(0);
}

main().catch(e => { console.error('失败:', e.message); process.exit(1); });
