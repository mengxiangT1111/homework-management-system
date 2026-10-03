/**
 * 学情分析与预警系统
 * 基于提交行为（提交率/逾期）、成绩（趋势/均分）与查重记录构建学情画像：
 * - 教师端：课程维度画像总览（KPI/成绩趋势/学生画像表/共性错误归纳/查重风险/未交催办数据）
 * - 学生端：个人学情自查（供仪表盘「我的学情」卡片）
 * - 学习风险预警：教师向风险学生发送预警通知（风险等级与原因由服务端统一计算）
 *
 * 口径说明：
 * - 应交人数只统计班级在读学生（退班学生的历史提交不计入，与班委/统计端口径一致）
 * - 成绩跨作业比较统一归一化为百分制：AI 批改作业取该作业 GradingResult.full_score，
 *   人工批改作业无满分字段，按满分 100 处理（本系统人工评分默认百分制）
 */
const { Op } = require('sequelize');
const {
  User, Class, ClassStudent, Course, Assignment, Submission,
  Notification, PlagiarismResult, GradingResult
} = require('../models');
const { success, fail } = require('../utils/response');

// ===== 风险阈值（集中定义，画像/预警/学生自查三处共用同一套标准） =====
const RISK_RULES = {
  SUBMIT_HIGH: 60,      // 提交率低于此值 → 高风险
  SUBMIT_MEDIUM: 85,    // 提交率低于此值 → 中风险
  SCORE_HIGH: 60,       // 平均分（百分制）低于此值 → 高风险
  SCORE_MEDIUM: 70,     // 平均分低于此值 → 中风险
  SCORE_MIN_SAMPLES: 2, // 成绩样本少于此值不参与均分判定
  DECLINE_LEN: 3,       // 成绩连续下滑次数达到此值 → 高风险
  PLAG_HIGH: 80,        // 查重最高相似度 ≥ 此值 → 高风险
  PLAG_MEDIUM: 60,      // 查重最高相似度 ≥ 此值 → 中风险
  LATE_MEDIUM: 3        // 逾期提交次数 ≥ 此值 → 中风险
};

const LEVEL_RANK = { low: 0, medium: 1, high: 2 };

/**
 * 风险判定：输入学生画像指标，输出 { level, reasons }
 * reasons 为可解释中文描述，直接用于画像表 tooltip 与预警通知正文
 */
function assessRisk(p) {
  const reasons = [];
  let level = 'low';
  const bump = (lv, reason) => {
    reasons.push(reason);
    if (LEVEL_RANK[lv] > LEVEL_RANK[level]) level = lv;
  };

  if (p.total > 0) {
    if (p.submit_rate < RISK_RULES.SUBMIT_HIGH) {
      bump('high', `提交率仅 ${p.submit_rate}%（漏交 ${p.missing_count} 次）`);
    } else if (p.submit_rate < RISK_RULES.SUBMIT_MEDIUM) {
      bump('medium', `提交率 ${p.submit_rate}%，存在漏交记录`);
    }
  }
  if (p.graded_count >= RISK_RULES.SCORE_MIN_SAMPLES && p.avg_score != null) {
    if (p.avg_score < RISK_RULES.SCORE_HIGH) {
      bump('high', `平均成绩 ${p.avg_score} 分，低于及格线`);
    } else if (p.avg_score < RISK_RULES.SCORE_MEDIUM) {
      bump('medium', `平均成绩 ${p.avg_score} 分，仍有提升空间`);
    }
  }
  if (p.decline_streak >= RISK_RULES.DECLINE_LEN) {
    bump('high', `成绩连续 ${p.decline_streak} 次下滑`);
  }
  if (p.plagiarism_max != null) {
    if (p.plagiarism_flagged || p.plagiarism_max >= RISK_RULES.PLAG_HIGH) {
      bump('high', `查重相似度过高（最高 ${Math.round(p.plagiarism_max)}%）`);
    } else if (p.plagiarism_max >= RISK_RULES.PLAG_MEDIUM) {
      bump('medium', `查重相似度偏高（最高 ${Math.round(p.plagiarism_max)}%）`);
    }
  }
  if (p.late_count >= RISK_RULES.LATE_MEDIUM) {
    bump('medium', `多次逾期提交（${p.late_count} 次）`);
  }
  return { level, reasons };
}

/**
 * 成绩序列（百分制）的最长连续下滑次数：
 * 相邻两次严格递减计一次，相等即中断（成绩持平不算下滑）
 */
function maxDeclineStreak(series) {
  let streak = 0, max = 0;
  for (let i = 1; i < series.length; i++) {
    if (series[i] < series[i - 1]) {
      streak++;
      if (streak > max) max = streak;
    } else {
      streak = 0;
    }
  }
  return max;
}

/**
 * 加载课程学情分析的全部基础数据（画像/预警共用，一次聚合查询避免 N+1）
 */
async function loadCourseData(course) {
  // 班级在读学生
  const students = await User.findAll({
    include: [{
      model: Class, as: 'classes',
      where: { id: course.class_id },
      through: { attributes: [] }, required: true
    }],
    attributes: ['id', 'username', 'real_name'],
    order: [['username', 'ASC']]
  });

  // 课程全部作业（按截止时间升序，趋势横轴）
  const assignments = await Assignment.findAll({
    where: { course_id: course.id },
    attributes: ['id', 'title', 'deadline', 'status'],
    order: [['deadline', 'ASC']]
  });
  const assignmentById = new Map(assignments.map(a => [a.id, a]));
  const assignmentIds = assignments.map(a => a.id);
  const studentIds = students.map(s => s.id);

  // 学生提交记录
  const submissions = (assignmentIds.length && studentIds.length)
    ? await Submission.findAll({
        where: { assignment_id: { [Op.in]: assignmentIds }, student_id: { [Op.in]: studentIds } },
        attributes: ['id', 'assignment_id', 'student_id', 'status', 'score', 'submitted_at']
      })
    : [];
  const submissionById = new Map(submissions.map(s => [s.id, s]));

  // AI 批改结果：提供各作业满分口径 + 共性错误原文
  const gradingResults = submissions.length
    ? await GradingResult.findAll({
        where: { submission_id: { [Op.in]: submissions.map(s => s.id) } },
        attributes: ['submission_id', 'full_score', 'knowledge_errors', 'deduction_summary']
      })
    : [];
  const fullScoreByAssignment = new Map(); // assignment_id -> 满分（人工批改缺省 100）
  for (const g of gradingResults) {
    const sub = submissionById.get(g.submission_id);
    if (!sub) continue;
    const full = Number(g.full_score);
    if (Number.isFinite(full) && full > 0) {
      const prev = fullScoreByAssignment.get(sub.assignment_id) || 0;
      if (full > prev) fullScoreByAssignment.set(sub.assignment_id, full);
    }
  }
  const fullScoreOf = (assignmentId) => fullScoreByAssignment.get(assignmentId) || 100;

  // 查重记录（按学生对聚合，双向都计入：比对双方共同承担相似度）
  const plagiarismRows = assignmentIds.length
    ? await PlagiarismResult.findAll({
        where: { assignment_id: { [Op.in]: assignmentIds }, status: 'done' },
        attributes: ['submission_id', 'compared_with_id', 'similarity_score',
          'image_hash_score', 'text_similarity', 'is_suspicious', 'checked_at', 'assignment_id']
      })
    : [];
  const ownerOf = (submissionId) => {
    const sub = submissionById.get(submissionId);
    return sub ? sub.student_id : null;
  };

  return {
    course, students, assignments, assignmentById, assignmentIds,
    submissions, submissionById, gradingResults,
    fullScoreOf, plagiarismRows, ownerOf
  };
}

/**
 * 构建单个学生的学情画像（指标计算 + 风险判定）
 */
function buildStudentProfile(student, data) {
  const mySubs = data.submissions.filter(s => s.student_id === student.id);
  const subByAssignment = new Map(mySubs.map(s => [s.assignment_id, s]));

  let lateCount = 0;
  const scorePoints = []; // 按作业截止时间顺序的百分制成绩点
  for (const a of data.assignments) {
    const sub = subByAssignment.get(a.id);
    if (!sub) continue;
    if (new Date(sub.submitted_at) > new Date(a.deadline)) lateCount++;
    if (sub.status === 'graded' && sub.score != null) {
      const pct = Number(sub.score) / data.fullScoreOf(a.id) * 100;
      if (Number.isFinite(pct)) {
        scorePoints.push({ t: a.title, v: Math.round(pct * 10) / 10 });
      }
    }
  }

  const missing = data.assignments.filter(a => !subByAssignment.has(a.id));
  const total = data.assignments.length;
  const submitted = mySubs.length;
  const submitRate = total > 0 ? Math.round(submitted / total * 100) : 100;

  const pctSeries = scorePoints.map(p => p.v);
  const avgScore = pctSeries.length
    ? Math.round(pctSeries.reduce((s, v) => s + v, 0) / pctSeries.length * 10) / 10
    : null;
  const declineStreak = maxDeclineStreak(pctSeries);
  const last2 = pctSeries.slice(-2);
  const trendDirection = last2.length < 2 ? 'none'
    : (last2[1] - last2[0] >= 2 ? 'up' : (last2[0] - last2[1] >= 2 ? 'down' : 'flat'));

  // 查重：该学生任一提交（无论比对哪一侧）的最高相似度与可疑标记
  let plagMax = null, plagFlagged = false;
  for (const row of data.plagiarismRows) {
    const sim = Number(row.similarity_score);
    const mine = data.ownerOf(row.submission_id) === student.id;
    const other = data.ownerOf(row.compared_with_id) === student.id;
    if (!mine && !other) continue;
    if (row.is_suspicious === 1) plagFlagged = true;
    if (Number.isFinite(sim) && (plagMax == null || sim > plagMax)) plagMax = sim;
  }

  const indicators = {
    total, submitted, missing_count: missing.length,
    submit_rate: submitRate, late_count: lateCount,
    avg_score: avgScore, graded_count: pctSeries.length,
    decline_streak: declineStreak,
    plagiarism_max: plagMax, plagiarism_flagged: plagFlagged
  };
  const { level, reasons } = assessRisk(indicators);

  return {
    student_id: student.id,
    username: student.username,
    real_name: student.real_name,
    submit_rate: submitRate,
    submitted, total,
    missing_count: missing.length,
    late_count: lateCount,
    avg_score: avgScore,
    // 最近 5 次已批改成绩（百分制），画像表迷你趋势线用
    score_trend: scorePoints.slice(-5),
    trend_direction: trendDirection,
    plagiarism_max: plagMax == null ? null : Math.round(plagMax * 10) / 10,
    plagiarism_flagged: plagFlagged,
    risk_level: level,
    risk_reasons: reasons
  };
}

/**
 * 归纳共性错误：聚合课程全部 AI 批改结果的知识盲区与扣分项，
 * 同一描述出现 ≥2 名学生才算「共性」，按人数降序
 */
function buildCommonErrors(data) {
  const nameByStudent = new Map(data.students.map(s => [s.id, s.real_name]));
  const counter = new Map(); // key -> { kind, text, students:Set }
  const push = (kind, text, studentId) => {
    const t = String(text || '').trim();
    if (!t) return;
    const key = `${kind}|${t}`;
    if (!counter.has(key)) counter.set(key, { kind, text: t, students: new Set() });
    counter.get(key).students.add(studentId);
  };

  for (const g of data.gradingResults) {
    const sub = data.submissionById.get(g.submission_id);
    if (!sub) continue;
    if (Array.isArray(g.knowledge_errors)) {
      for (const item of g.knowledge_errors) push('knowledge', item, sub.student_id);
    }
    if (Array.isArray(g.deduction_summary)) {
      for (const d of g.deduction_summary) push('deduction', d && d.description, sub.student_id);
    }
  }

  return [...counter.values()]
    .filter(c => c.students.size >= 2)
    .sort((a, b) => b.students.size - a.students.size)
    .slice(0, 10)
    .map(c => ({
      kind: c.kind,
      text: c.text,
      count: c.students.size,
      students: [...c.students].map(id => nameByStudent.get(id)).filter(Boolean).slice(0, 6)
    }));
}

/**
 * 查重风险对：按相似度降序 Top 20（无序对学生对去重，双向记录只保留更高的一条）
 */
function buildPlagiarismRisks(data) {
  const seen = new Map(); // "minId-maxId" -> row（保留相似度更高的一条）
  for (const row of data.plagiarismRows) {
    const sim = Number(row.similarity_score);
    const flag = row.is_suspicious === 1;
    // 只展示有风险信号的比对：可疑标记或相似度 ≥ 中风险阈值
    if (!flag && !(sim >= RISK_RULES.PLAG_MEDIUM)) continue;
    const key = `${Math.min(row.submission_id, row.compared_with_id)}-${Math.max(row.submission_id, row.compared_with_id)}`;
    const prev = seen.get(key);
    if (!prev || sim > Number(prev.similarity_score)) seen.set(key, row);
  }
  const nameOfSub = (submissionId) => {
    const sub = data.submissionById.get(submissionId);
    return sub ? (nameByStudentIn(data, sub.student_id) || '已退班学生') : '已删除提交';
  };
  return [...seen.values()]
    .sort((a, b) => Number(b.similarity_score) - Number(a.similarity_score))
    .slice(0, 20)
    .map(row => {
      const a = data.assignmentById.get(row.assignment_id);
      return {
        assignment_title: a ? a.title : '-',
        student_name: nameOfSub(row.submission_id),
        other_name: nameOfSub(row.compared_with_id),
        similarity: Math.round(Number(row.similarity_score) * 10) / 10,
        image_hash_score: Math.round(Number(row.image_hash_score) * 10) / 10,
        text_similarity: Math.round(Number(row.text_similarity) * 10) / 10,
        is_suspicious: row.is_suspicious === 1,
        checked_at: row.checked_at
      };
    });
}

function nameByStudentIn(data, studentId) {
  const stu = data.students.find(s => s.id === studentId);
  return stu ? stu.real_name : null;
}

/**
 * 课程权限校验：任课教师本人或管理员
 */
async function assertCourseAccess(req, res, courseId) {
  const course = await Course.findByPk(courseId, {
    include: [
      { model: Class, as: 'class', attributes: ['id', 'name'] },
      { model: User, as: 'teacher', attributes: ['id', 'real_name'] }
    ]
  });
  if (!course) {
    fail(res, '课程不存在', 404);
    return null;
  }
  if (req.user.role !== 'admin' && course.teacher_id !== req.user.id) {
    fail(res, '仅课程任课教师可使用学情分析', 403);
    return null;
  }
  return course;
}

// ===== 教师端：课程学情画像总览 =====
// GET /api/analytics/course/:courseId/profile
exports.courseProfile = async (req, res, next) => {
  try {
    const course = await assertCourseAccess(req, res, Number(req.params.courseId));
    if (!course) return;
    const data = await loadCourseData(course);

    const profiles = data.students.map(s => buildStudentProfile(s, data));

    // ---- KPI ----
    const totalShould = data.students.length * data.assignments.length;
    const totalSubmitted = data.submissions.length;
    const submitRate = totalShould > 0 ? Math.round(totalSubmitted / totalShould * 1000) / 10 : 100;
    const allPct = [];
    for (const sub of data.submissions) {
      if (sub.status === 'graded' && sub.score != null) {
        const pct = Number(sub.score) / data.fullScoreOf(sub.assignment_id) * 100;
        if (Number.isFinite(pct)) allPct.push(pct);
      }
    }
    const classAvg = allPct.length
      ? Math.round(allPct.reduce((s, v) => s + v, 0) / allPct.length * 10) / 10
      : null;
    const highRisk = profiles.filter(p => p.risk_level === 'high').length;
    const mediumRisk = profiles.filter(p => p.risk_level === 'medium').length;
    const ungraded = data.submissions.filter(s => s.status === 'submitted').length;

    // ---- 班级成绩趋势（按作业）：提交率 + 已批改均分 ----
    const trend = data.assignments.map(a => {
      const subs = data.submissions.filter(s => s.assignment_id === a.id);
      const gradedPct = [];
      for (const sub of subs) {
        if (sub.status === 'graded' && sub.score != null) {
          const pct = Number(sub.score) / data.fullScoreOf(a.id) * 100;
          if (Number.isFinite(pct)) gradedPct.push(pct);
        }
      }
      return {
        assignment_id: a.id,
        title: a.title,
        deadline: a.deadline,
        submit_rate: data.students.length > 0
          ? Math.round(subs.length / data.students.length * 100)
          : 0,
        avg_score: gradedPct.length
          ? Math.round(gradedPct.reduce((s, v) => s + v, 0) / gradedPct.length * 10) / 10
          : null
      };
    });

    // ---- 未交催办（进行中作业）----
    const now = new Date();
    const unsubmitted = data.assignments
      .filter(a => a.status === 'active')
      .map(a => {
        const submittedSet = new Set(
          data.submissions.filter(s => s.assignment_id === a.id).map(s => s.student_id)
        );
        const missing = data.students.filter(s => !submittedSet.has(s.id));
        return {
          assignment_id: a.id,
          title: a.title,
          deadline: a.deadline,
          overdue: new Date(a.deadline) < now,
          unsubmitted_count: missing.length,
          sample_names: missing.slice(0, 3).map(s => s.real_name)
        };
      })
      .filter(a => a.unsubmitted_count > 0);

    const commonErrors = buildCommonErrors(data);
    const plagiarismRisks = buildPlagiarismRisks(data);

    return success(res, {
      course: {
        id: course.id,
        name: course.name,
        semester: course.semester,
        class_name: course.class ? course.class.name : '-',
        teacher_name: course.teacher ? course.teacher.real_name : '-'
      },
      kpi: {
        student_count: data.students.length,
        assignment_count: data.assignments.length,
        submit_rate: submitRate,
        avg_score: classAvg,
        ungraded_count: ungraded,
        high_risk_count: highRisk,
        medium_risk_count: mediumRisk,
        plagiarism_risk_count: plagiarismRisks.length
      },
      trend,
      students: profiles,
      common_errors: commonErrors,
      plagiarism_risks: plagiarismRisks,
      unsubmitted
    }, '获取成功');
  } catch (err) {
    next(err);
  }
};

// ===== 教师端：向风险学生发送学习预警通知 =====
// POST /api/analytics/course/:courseId/warn  body: { student_id }
exports.sendWarning = async (req, res, next) => {
  try {
    const course = await assertCourseAccess(req, res, Number(req.params.courseId));
    if (!course) return;
    const studentId = Number(req.body.student_id);
    if (!Number.isInteger(studentId) || studentId <= 0) {
      return fail(res, '缺少 student_id 参数', 422);
    }

    const data = await loadCourseData(course);
    const student = data.students.find(s => s.id === studentId);
    if (!student) return fail(res, '该学生不在本课程班级中', 422);

    // 风险原因服务端实时计算，不信任前端传入
    const profile = buildStudentProfile(student, data);
    const reasonText = profile.risk_reasons.length
      ? profile.risk_reasons.map((r, i) => `${i + 1}. ${r}`).join('\n')
      : '当前暂无明显风险信号，老师希望你保持并稳步提升学习状态。';
    const levelText = { high: '较高', medium: '中等', low: '良好' }[profile.risk_level];

    // 1 小时内已发过同课程预警的不重复发送（防连点轰炸）
    const recent = await Notification.count({
      where: {
        user_id: studentId,
        title: '学习风险预警',
        related_id: course.id,
        created_at: { [Op.gt]: new Date(Date.now() - 60 * 60 * 1000) }
      }
    });
    if (recent > 0) {
      return success(res, { warned: false }, '1 小时内已向该学生发过本课程预警，未重复发送');
    }

    await Notification.create({
      user_id: studentId,
      title: '学习风险预警',
      content: `课程「${course.name}」学情分析提示：你当前学习风险等级为「${levelText}」，存在以下情况：\n${reasonText}\n建议尽快补交缺漏作业、复盘扣分点，如有困难可与任课教师沟通。`,
      type: 'system',
      related_id: course.id
    });
    return success(res, { warned: true, risk_level: profile.risk_level, reasons: profile.risk_reasons },
      `已向 ${student.real_name} 发送学习预警`);
  } catch (err) {
    next(err);
  }
};

// ===== 学生端：个人学情自查 =====
// GET /api/analytics/my/profile
exports.myProfile = async (req, res, next) => {
  try {
    const myClassRows = await ClassStudent.findAll({
      where: { student_id: req.user.id },
      attributes: ['class_id']
    });
    const classIds = myClassRows.map(c => c.class_id);
    const courses = classIds.length
      ? await Course.findAll({
          where: { class_id: { [Op.in]: classIds } },
          include: [{ model: Class, as: 'class', attributes: ['id', 'name'] }],
          order: [['created_at', 'ASC']]
        })
      : [];
    const courseIds = courses.map(c => c.id);

    const assignments = courseIds.length
      ? await Assignment.findAll({
          where: { course_id: { [Op.in]: courseIds } },
          attributes: ['id', 'title', 'deadline', 'status', 'course_id'],
          order: [['deadline', 'ASC']]
        })
      : [];
    const mySubs = assignments.length
      ? await Submission.findAll({
          where: { assignment_id: { [Op.in]: assignments.map(a => a.id) }, student_id: req.user.id },
          attributes: ['id', 'assignment_id', 'status', 'score', 'submitted_at']
        })
      : [];
    const subByAssignment = new Map(mySubs.map(s => [s.assignment_id, s]));

    // 满分口径：优先 AI 批改结果，人工批改按 100
    const fullScoreByAssignment = new Map();
    if (mySubs.length) {
      const grs = await GradingResult.findAll({
        where: { submission_id: { [Op.in]: mySubs.map(s => s.id) } },
        attributes: ['submission_id', 'full_score']
      });
      const subById = new Map(mySubs.map(s => [s.id, s]));
      for (const g of grs) {
        const sub = subById.get(g.submission_id);
        const full = Number(g.full_score);
        if (sub && Number.isFinite(full) && full > 0) {
          const prev = fullScoreByAssignment.get(sub.assignment_id) || 0;
          if (full > prev) fullScoreByAssignment.set(sub.assignment_id, full);
        }
      }
    }

    const courseById = new Map(courses.map(c => [c.id, c]));
    const now = new Date();
    let lateCount = 0;
    const scorePoints = [];
    const missingOverdue = [];
    for (const a of assignments) {
      const sub = subByAssignment.get(a.id);
      if (!sub) {
        if (new Date(a.deadline) < now) missingOverdue.push(a.title);
        continue;
      }
      if (new Date(sub.submitted_at) > new Date(a.deadline)) lateCount++;
      if (sub.status === 'graded' && sub.score != null) {
        const full = fullScoreByAssignment.get(a.id) || 100;
        const pct = Number(sub.score) / full * 100;
        if (Number.isFinite(pct)) {
          const course = courseById.get(a.course_id);
          scorePoints.push({
            t: a.title,
            course: course ? course.name : '',
            v: Math.round(pct * 10) / 10
          });
        }
      }
    }

    const total = assignments.length;
    const submitted = mySubs.length;
    const submitRate = total > 0 ? Math.round(submitted / total * 100) : 100;
    const pctSeries = scorePoints.map(p => p.v);
    const avgScore = pctSeries.length
      ? Math.round(pctSeries.reduce((s, v) => s + v, 0) / pctSeries.length * 10) / 10
      : null;

    // 我的查重风险（任一侧比对）
    let plagMax = null, plagFlagged = false;
    if (mySubs.length) {
      const rows = await PlagiarismResult.findAll({
        where: {
          status: 'done',
          [Op.or]: [
            { submission_id: { [Op.in]: mySubs.map(s => s.id) } },
            { compared_with_id: { [Op.in]: mySubs.map(s => s.id) } }
          ]
        },
        attributes: ['submission_id', 'compared_with_id', 'similarity_score', 'is_suspicious']
      });
      const mySubIds = new Set(mySubs.map(s => s.id));
      for (const row of rows) {
        if (!mySubIds.has(row.submission_id) && !mySubIds.has(row.compared_with_id)) continue;
        if (row.is_suspicious === 1) plagFlagged = true;
        const sim = Number(row.similarity_score);
        if (Number.isFinite(sim) && (plagMax == null || sim > plagMax)) plagMax = sim;
      }
    }

    const { level, reasons } = assessRisk({
      total, submitted,
      missing_count: total - submitted,
      submit_rate: submitRate,
      late_count: lateCount,
      avg_score: avgScore,
      graded_count: pctSeries.length,
      decline_streak: maxDeclineStreak(pctSeries),
      plagiarism_max: plagMax,
      plagiarism_flagged: plagFlagged
    });

    // 分课程明细
    const perCourse = courses.map(c => {
      const cAssignments = assignments.filter(a => a.course_id === c.id);
      const cSubmitted = cAssignments.filter(a => subByAssignment.has(a.id)).length;
      const cScores = scorePoints.filter(p => p.course === c.name).map(p => p.v);
      return {
        course_id: c.id,
        name: c.name,
        total: cAssignments.length,
        submitted: cSubmitted,
        submit_rate: cAssignments.length > 0 ? Math.round(cSubmitted / cAssignments.length * 100) : 100,
        avg_score: cScores.length
          ? Math.round(cScores.reduce((s, v) => s + v, 0) / cScores.length * 10) / 10
          : null
      };
    });

    return success(res, {
      overall: {
        course_count: courses.length,
        total, submitted, submit_rate: submitRate,
        missing_count: total - submitted,
        missing_overdue: missingOverdue,
        late_count: lateCount,
        avg_score: avgScore,
        score_trend: scorePoints.slice(-8),
        plagiarism_max: plagMax == null ? null : Math.round(plagMax * 10) / 10,
        plagiarism_flagged: plagFlagged,
        risk_level: level,
        risk_reasons: reasons
      },
      courses: perCourse
    }, '获取成功');
  } catch (err) {
    next(err);
  }
};

// 纯函数导出（单元测试/规则复算用，不参与路由）
exports._internals = { assessRisk, maxDeclineStreak, RISK_RULES };
