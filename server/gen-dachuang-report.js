// 大创项目申报与结题全景分析报告 —— docx 生成脚本（临时，生成后可删除）
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, PageNumber, NumberFormat, AlignmentType, HeadingLevel,
  WidthType, BorderStyle, ShadingType, TableOfContents, SectionType,
  TableLayoutType, PageBreak
} = require("docx");
const fs = require("fs");
const path = require("path");

// ===== 调色板（DM-1 深青：AI / 科技）=====
const P = {
  bg: "162235", accent: "37DCF2",
  cover: { titleColor: "FFFFFF", subtitleColor: "B0B8C0", metaColor: "90989F", footerColor: "687078" },
  heading: "0F2A3C",
  table: { headerBg: "1B6B7A", headerText: "FFFFFF", innerLine: "C8DDE2", surface: "EDF3F5" }
};

const NB = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: NB, bottom: NB, left: NB, right: NB };
const allNoBorders = { top: NB, bottom: NB, left: NB, right: NB, insideHorizontal: NB, insideVertical: NB };

// ===== 封面布局函数（design-system 标准实现）=====
function splitTitleLines(title, charsPerLine) {
  if (title.length <= charsPerLine) return [title];
  const breakAfter = new Set([..."，。、；：！？", ..."的与和及之在于为", ..."-_—–·/", ..." \t"]);
  const lines = [];
  let remaining = title;
  while (remaining.length > charsPerLine) {
    let breakAt = -1;
    for (let i = charsPerLine; i >= Math.floor(charsPerLine * 0.6); i--) {
      if (i < remaining.length && breakAfter.has(remaining[i - 1])) { breakAt = i; break; }
    }
    if (breakAt === -1) {
      const limit = Math.min(remaining.length, Math.ceil(charsPerLine * 1.3));
      for (let i = charsPerLine + 1; i < limit; i++) {
        if (breakAfter.has(remaining[i - 1])) { breakAt = i; break; }
      }
    }
    if (breakAt === -1) {
      breakAt = charsPerLine;
      const prevChar = remaining[breakAt - 1], nextChar = remaining[breakAt];
      if (prevChar && nextChar && !breakAfter.has(prevChar) && !breakAfter.has(nextChar) &&
        /[\u4e00-\u9fff]/.test(prevChar) && /[\u4e00-\u9fff]/.test(nextChar)) breakAt = breakAt - 1;
    }
    lines.push(remaining.slice(0, breakAt).trim());
    remaining = remaining.slice(breakAt).trim();
  }
  if (remaining) lines.push(remaining);
  if (lines.length > 1 && lines[lines.length - 1].length <= 2) {
    const last = lines.pop();
    lines[lines.length - 1] += last;
  }
  return lines;
}
function calcTitleLayout(title, maxWidthTwips, preferredPt = 40, minPt = 24) {
  const charsPerLine = (pt) => Math.floor(maxWidthTwips / (pt * 20));
  let titlePt = preferredPt, lines;
  while (titlePt >= minPt) {
    const cpl = charsPerLine(titlePt);
    if (cpl < 2) { titlePt -= 2; continue; }
    lines = splitTitleLines(title, cpl);
    if (lines.length <= 3) break;
    titlePt -= 2;
  }
  if (!lines || lines.length > 3) { lines = splitTitleLines(title, charsPerLine(minPt)); titlePt = minPt; }
  return { titlePt, titleLines: lines };
}
function calcCoverSpacing(params) {
  const { titleLineCount = 1, titlePt = 36, hasSubtitle = false, hasEnglishLabel = false,
    metaLineCount = 0, fixedHeight = 800, pageHeight = 16838, marginTop = 0, marginBottom = 0 } = params;
  const SAFETY = 1200;
  const usableHeight = pageHeight - marginTop - marginBottom - SAFETY;
  const titleHeight = titleLineCount * (titlePt * 23 + 200);
  const subtitleHeight = hasSubtitle ? (12 * 23 + 600) : 0;
  const englishLabelHeight = hasEnglishLabel ? (9 * 23 + 600) : 0;
  const metaHeight = metaLineCount * (10 * 23 + 100);
  const implicitParaHeight = 3 * 300;
  const contentHeight = titleHeight + subtitleHeight + englishLabelHeight + metaHeight + fixedHeight + implicitParaHeight;
  const safeRemaining = Math.max(usableHeight - contentHeight, 400);
  const FOOTER_MIN = 800;
  const rawTop = Math.floor(safeRemaining * 0.45), rawBottom = Math.floor(safeRemaining * 0.45);
  const bottomSpacing = Math.max(rawBottom, FOOTER_MIN);
  const topSpacing = Math.max(rawTop - Math.max(0, FOOTER_MIN - rawBottom), 400);
  const midSpacing = Math.max(safeRemaining - topSpacing - bottomSpacing, 0);
  return { topSpacing, midSpacing, bottomSpacing };
}

function buildCoverR1(config) {
  const C = config.palette;
  const padL = 1200, padR = 800;
  const availableWidth = 11906 - padL - padR - 300;
  const { titlePt, titleLines } = calcTitleLayout(config.title, availableWidth, 40, 24);
  const titleSize = titlePt * 2;
  const spacing = calcCoverSpacing({
    titleLineCount: titleLines.length, titlePt,
    hasSubtitle: !!config.subtitle, hasEnglishLabel: !!config.englishLabel,
    metaLineCount: (config.metaLines || []).length, fixedHeight: 400
  });
  const accentLeft = { style: BorderStyle.SINGLE, size: 8, color: C.accent, space: 12 };
  const children = [];
  children.push(new Paragraph({ spacing: { before: spacing.topSpacing } }));
  if (config.englishLabel) {
    children.push(new Paragraph({
      indent: { left: padL, right: padR }, spacing: { after: 500 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: C.accent, space: 8 } },
      children: [new TextRun({ text: config.englishLabel.split("").join("  "), size: 18, color: C.accent, font: { ascii: "Calibri", eastAsia: "SimHei" }, characterSpacing: 40 })]
    }));
  }
  for (let i = 0; i < titleLines.length; i++) {
    children.push(new Paragraph({
      indent: { left: padL },
      spacing: { after: i < titleLines.length - 1 ? 100 : 300, line: Math.ceil(titlePt * 23), lineRule: "atLeast" },
      children: [new TextRun({ text: titleLines[i], size: titleSize, bold: true, color: C.cover.titleColor, font: { eastAsia: "SimHei", ascii: "Arial" } })]
    }));
  }
  if (config.subtitle) {
    children.push(new Paragraph({
      indent: { left: padL }, spacing: { after: 800 },
      children: [new TextRun({ text: config.subtitle, size: 24, color: C.cover.subtitleColor, font: { eastAsia: "Microsoft YaHei", ascii: "Arial" } })]
    }));
  }
  for (const line of (config.metaLines || [])) {
    children.push(new Paragraph({
      indent: { left: padL + 200 }, spacing: { after: 80 },
      border: { left: accentLeft },
      children: [new TextRun({ text: line, size: 24, color: C.cover.metaColor, font: { eastAsia: "Microsoft YaHei", ascii: "Arial" } })]
    }));
  }
  children.push(new Paragraph({ spacing: { before: spacing.bottomSpacing } }));
  children.push(new Paragraph({
    indent: { left: padL, right: padR },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: C.accent, space: 8 } },
    spacing: { before: 200 },
    children: [
      new TextRun({ text: config.footerLeft || "", size: 16, color: C.cover.footerColor, font: { ascii: "Arial" } }),
      new TextRun({ text: "                                        " }),
      new TextRun({ text: config.footerRight || "", size: 16, color: C.cover.footerColor, font: { ascii: "Arial" } })
    ]
  }));
  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: 16838, rule: "exact" },
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: C.bg }, borders: noBorders,
        children
      })]
    })]
  })];
}

// ===== 正文构件 =====
const FONT_H = { ascii: "Calibri", eastAsia: "SimHei" };
const FONT_B = { ascii: "Calibri", eastAsia: "SimSun" };

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    keepNext: true,
    spacing: { before: 400, after: 200, line: 312 },
    children: [new TextRun({ text, bold: true, size: 32, color: P.heading, font: FONT_H })]
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    keepNext: true,
    spacing: { before: 280, after: 140, line: 312 },
    children: [new TextRun({ text, bold: true, size: 28, color: P.heading, font: FONT_H })]
  });
}
function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    keepNext: true,
    spacing: { before: 220, after: 100, line: 312 },
    children: [new TextRun({ text, bold: true, size: 24, color: P.heading, font: FONT_H })]
  });
}
function p(text) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    indent: { firstLine: 480 },
    spacing: { line: 312, after: 80 },
    children: [new TextRun({ text, size: 24, color: "000000", font: FONT_B })]
  });
}
function pRuns(runs) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    indent: { firstLine: 480 },
    spacing: { line: 312, after: 80 },
    children: runs
  });
}
function pb(boldText, rest) {
  return pRuns([
    new TextRun({ text: boldText, bold: true, size: 24, color: "000000", font: FONT_B }),
    new TextRun({ text: rest, size: 24, color: "000000", font: FONT_B })
  ]);
}
function tcap(text) {
  return new Paragraph({
    keepNext: true,
    spacing: { before: 200, after: 80, line: 312 },
    children: [new TextRun({ text, bold: true, size: 21, color: P.heading, font: FONT_H })]
  });
}
function tnote(text) {
  return new Paragraph({
    spacing: { before: 60, after: 160, line: 280 },
    children: [new TextRun({ text, italics: true, size: 18, color: "888888", font: FONT_B })]
  });
}
function cellP(text, opts = {}) {
  return new Paragraph({
    alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { line: 280 },
    children: [new TextRun({
      text, size: 21, bold: !!opts.bold,
      color: opts.color || "000000", font: FONT_B
    })]
  });
}
function tbl(headers, rows, widths) {
  const n = headers.length;
  const ws = widths || Array(n).fill(Math.floor(100 / n));
  const headerRow = new TableRow({
    tableHeader: true, cantSplit: true,
    children: headers.map((t, i) => new TableCell({
      children: [cellP(t, { bold: true, color: P.table.headerText, center: true })],
      shading: { type: ShadingType.CLEAR, fill: P.table.headerBg },
      margins: { top: 60, bottom: 60, left: 120, right: 120 },
      width: { size: ws[i], type: WidthType.PERCENTAGE }
    }))
  });
  const dataRows = rows.map((r, ri) => new TableRow({
    cantSplit: true,
    children: r.map((t, i) => new TableCell({
      children: [cellP(t)],
      shading: { type: ShadingType.CLEAR, fill: ri % 2 === 0 ? "FFFFFF" : P.table.surface },
      margins: { top: 60, bottom: 60, left: 120, right: 120 },
      width: { size: ws[i], type: WidthType.PERCENTAGE }
    }))
  }));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: P.table.headerBg },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: P.table.headerBg },
      left: NB, right: NB,
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: P.table.innerLine },
      insideVertical: NB
    },
    rows: [headerRow, ...dataRows]
  });
}
function pageNumFooter(roman) {
  // roman 页脚带斜体标记，便于后处理脚本区分两种数字格式
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, italics: roman, color: "666666", font: FONT_B })]
    })]
  });
}
function docHeader() {
  return new Header({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: P.table.innerLine, space: 4 } },
      children: [new TextRun({ text: "信衡 XINHENG · 大创项目申报与结题全景分析报告", size: 18, color: "888888", font: FONT_B })]
    })]
  });
}

// =====================================================================
// 内容
// =====================================================================

// ----- 前置：摘要 -----
const abstractChildren = [
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 240, after: 300, line: 400, lineRule: "atLeast" },
    children: [new TextRun({ text: "摘  要", bold: true, size: 32, font: FONT_H, color: "000000" })]
  }),
  p("本报告以大学生创新创业训练计划（以下简称大创）项目的申报、评奖与结题答辩为视角，对信衡 XINHENG·校园作业与 AI 批改平台（Vue3 网页端、微信小程序端、Node.js 后端、Python FastAPI 检测微服务）进行全景分析。报告基于对全部源码的逐模块盘点，回答七个问题：项目做大创是否可行、适合什么组别；现有系统有哪些可以写进申报书的亮点；当前存在哪些不足；应如何分级迭代；如何提炼创新点以摆脱普通课程作业系统的定位；申报书、结题报告与答辩 PPT 应重点写什么；以及可以产出哪些研究成果。"),
  p("核心结论如下：第一，本项目具备较高的大创申报价值，首选创新训练项目类别，核心叙事应聚焦图形类作业查重与可信 AI 批改两项差异化能力，而非作业管理流程本身。第二，系统的最大优势是已完成度高——三端一服务的完整实现、异步批改队列、提示词版本管理与灰度发布、置信度驱动的人工复核闭环、四层流水线的拓扑图查重算法，均显著超出一般项目的立项起点。第三，系统的最大短板不在代码而在证据：缺少真实教学试点数据、算法准确率与评分一致性的量化评估，以及软著、论文、演示视频等成果材料。"),
  p("为此，报告给出两级迭代方案：低成本快速迭代（R1 至 R8，约一到两个月）以打通手写作业 OCR 批改、查重报告导出、查重与批改联动、首个真实试点、软著申请等为主；深度拔高迭代（D1 至 D8，三至十二个月）以多模态查重框架、大模型评分一致性实证研究、知识追踪与错题本、批注定位等冲奖方向为主。报告最后给出申报书逐节写法、十二个月进度表、答辩 PPT 大纲、预答辩问题库与成果产出矩阵，供团队直接使用。"),
  new Paragraph({
    spacing: { before: 200, line: 312 },
    children: [
      new TextRun({ text: "关键词：", bold: true, size: 24, font: FONT_B, color: "000000" }),
      new TextRun({ text: "大学生创新创业训练计划；可信 AI 批改；评分量规；图结构查重；人机协同；教育数字化", size: 24, font: FONT_B, color: "000000" }),
      new PageBreak()
    ]
  }),
  // 目录
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 240, after: 300, line: 400, lineRule: "atLeast" },
    children: [new TextRun({ text: "目  录", bold: true, size: 32, font: FONT_H, color: "000000" })]
  }),
  new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-2" }),
  new Paragraph({
    spacing: { before: 200 },
    children: [new TextRun({ text: "注：本目录由域代码生成。如编辑文档后页码变动，请在目录上右键选择更新域以刷新页码。", italics: true, size: 18, color: "888888", font: FONT_B })]
  })
];

// ----- 第一章 -----
const ch1 = [
  h1("第一章  项目概况与技术资产盘点"),
  p("本章为全篇分析的事实基础。结论先行：信衡已远超课程设计或演示原型的完成度，是一套可部署、可试用、具备完整安全与工程考量的三端系统；申报大创时，它的角色是研究基础与实验平台，而不再是待开发的构想。"),
  h2("1.1  系统定位与总体架构"),
  p("信衡定位为面向高校及职业院校的校园作业收集、智能批改与学术诚信检测一体化平台，品牌主张为衡量每一次努力，信守每一分公正。系统由四部分组成：其一，Vue 3 网页端，覆盖学生、教师、管理员三角色共二十余个页面，含响应式移动适配与统一设计令牌体系；其二，微信小程序端（uni-app 实现，十三个页面），承担学生提交、教师移动批改与 AI 复核、班委课代表收集等高频场景；其三，Node.js 后端（Express + Sequelize + MySQL 8，二十二张数据表），承载全部业务、异步任务队列与定时任务；其四，Python FastAPI 检测微服务（OpenCV、NetworkX、imagehash、scikit-image，可选 PaddleOCR），负责作业抄袭检测算法。文件存储采用腾讯云 COS 优先、本地磁盘降级的双模式，部署提供 Docker Compose 与 Nginx（含 SSL 模板）三件套。"),
  h2("1.2  已实现功能全景"),
  p("下表按模块汇总系统已实现的能力及其代码落点，可作为申报书研究基础一节的素材来源，也可作为答辩演示的功能清单。"),
  tcap("表 1-1  信衡系统功能全景与代码落点"),
  tbl(["模块", "已实现能力", "关键实现落点"], [
    ["作业发布与提交", "多格式与数量限制、图片视频文档三类样例、逾期前后端双重拦截、事务化提交、一人一作业唯一约束", "assignmentController.js、submissionController.js"],
    ["大文件上传", "MD5 秒传、分片断点续传、合并后哈希校验、并发分片磁盘防护、小程序单文件直传（100MB）", "client/src/utils/upload.js、uploadController.js"],
    ["AI 批改", "评分量规模板（维度、权重、A 至 D 档描述、扣分规则）、批量异步任务、均衡严格鼓励三种评语模式、参考答案复用", "grading.service.js、gradingTaskController.js、teacher/Review.vue"],
    ["可信批改机制", "服务端权威算分（模型不算总分）、启发式置信度、低置信结果自动转人工复核（采纳、调整、驳回）", "gradingResultParser.js、GradingReviews.vue、小程序 teacher/review.vue"],
    ["查重检测", "全班 C(n,2) 两两比对、四层算法流水线、五维雷达图、双拓扑图并排可视化、任务进度轮询与恢复", "detection_service 目录、PlagiarismCenter.vue、TopologyComparison.vue"],
    ["组织模型", "多学校、班级职务（班长、学委）、课程课代表、班委课代表代发作业、进度追踪、智能催交、打包下载", "classLeaderController.js、courseAssistantController.js、student/Collect.vue"],
    ["通知提醒", "二十四小时截止扫描、催交一小时防轰炸去重、批改完成通知、三端消息中心与角标", "notificationScheduler.js、notificationController.js"],
    ["教师效率工具", "按学生姓名学号打包 zip、未交名单 Excel 导出、催交、AI 批改进度实时展示", "submissionController.js（archiver、exceljs）"],
    ["管理端", "学校班级课程用户管理、教师注册审核、文件按保留天数清理、全局统计与可视化图表", "admin 目录六页面、statsController.js、fileCleaner.js"],
    ["安全与部署", "JWT 加密码版本指纹、短时效下载票据、分级限流、路径围栏、双模存储、Compose 部署", "middleware/auth.js、downloadTicket.js、docker-compose.prod.yml"]
  ], [16, 46, 38]),
  h2("1.3  值得写入申报书的技术事实"),
  p("以下事实在答辩与申报书中均经得起追问，因为它们写在代码里而非写在宣传语里。AI 批改侧：批改任务通过 MySQL 8 的 SELECT FOR UPDATE SKIP LOCKED 实现多 worker 抢占式队列，并发三路，失败指数退避，超时半小时的任务由回收器判定僵死；提示词采用语义化版本管理并支持确定性灰度路由（以任务编号为种子，同一任务重试不漂移）；大模型接口为 OpenAI 兼容协议可插拔设计（当前配置 DeepSeek），带超时、重试、连续失败熔断与备用模型降级；总分由服务端按维度分聚合并按模板满分封顶，模型本身不决定总分；置信度按解析重试、越界钳制、维度缺失、极端满分、作答过短等因素扣减，低于阈值自动生成人工复核工单。"),
  p("查重侧：检测算法为四级渐进流水线——感知哈希初筛、ORB 局部特征匹配、OCR 文本 Jaccard 相似度、图结构比对（节点与边统计差异、图同构判定、图编辑距离精确计算及大图近似公式），综合加权以图结构权重为最高（0.50），判定阈值分为可疑与高度可疑两档；全班比对采用上三角去重、结果双向入库，检测服务与主服务间以令牌鉴权并只监听本机。工程侧：仓库内已包含评分一致性基准脚本（内置平均绝对误差不超过五分、差值不超五分比例不低于百分之八十、皮尔逊相关系数不低于 0.85、重复批改极差不超过十分等合格阈值，用于对照教师人工分）、查重端到端测试脚本与纯函数单元测试。上述内容构成第四章不足分析的对立面：本项目的问题不是做得不够多，而是做得好但没有被研究和证明。")
];

// ----- 第二章 -----
const ch2 = [
  h1("第二章  大创申报可行性分析"),
  h2("2.1  应用场景"),
  p("系统的直接应用场景是高校与职业院校的日常课程作业管理：文字类作业（报告、论文草稿、读后感）、文档与数据文件类作业、以及图片类作业。其中图片类作业是最具差异化的场景：计算机网络课程的拓扑图设计、机械与建筑类课程的制图、电路课程原理图、思维导图与流程图等。此类作业此前几乎无法查重——主流文本查重工具完全无能为力，而系统已实现的拓扑图结构比对恰好覆盖这一空白。可扩展场景包括继续教育学院的远程作业收集、中学的信息技术课程作业（结合作业管理政策要求），以及任何需要收取、评阅、归档学生文件的培训机构。"),
  h2("2.2  现实痛点"),
  pb("教师侧：主观作业批改负担重。", "一份文字作业人工详批平均耗时数分钟到十余分钟（建议在试点中实测并填入具体数据【待试点测量】），大班教学下批改周期长、反馈滞后；批改标准因人而异，公平性常受质疑。"),
  pb("学生侧：反馈滞后且不透明。", "作业交出后长期不知道分数与问题所在；错题散落各次作业中，缺乏系统性的薄弱知识点归纳。"),
  pb("诚信侧：图形图像类作业的查重盲区。", "现有学术诚信工具（知网、维普、Turnitin 等）只支持文本；绘图类作业互抄、改标签、换布局的抄袭行为无法自动发现，教师只能凭肉眼比对，全班两两比对在人力上不可行——这正是系统中 C(n,2) 全班自动比对与图同构检测的直接动机。"),
  pb("组织侧：作业收集环节失序。", "大量班级仍依赖微信群接龙、邮箱收件、网盘共享收作业，存在漏交难追踪、文件命名混乱、逾期补交无边界、班委手工统计负担重等问题。系统将班长、学委、课代表纳入组织模型，提供代发作业、提交进度、一键催交与打包归档工作台，是对真实校园运行方式的还原，这一点在学习通等大平台中均无对应功能。"),
  h2("2.3  政策与趋势支撑"),
  p("申报书的立项依据可引用三层政策语境：国家层面持续推进教育数字化战略行动，《教育强国建设规划纲要（2024—2035 年）》明确提出以人工智能赋能教育变革、促进因材施教；《新一代人工智能发展规划》将智能教育列为智能应用重点方向。行业层面，大语言模型教育应用是当前研究与产业热点，而其评分可信性、可解释性与人机协同机制恰是公认待解问题，与系统的置信度分流复核设计直接呼应。治理层面，教育部及相关部门持续强化学术诚信与考试评价规范，图形图像类作业的诚信检测属于工具供给空白。三层语境共同支撑同一个命题：让 AI 批改可信、让诚信检测无盲区，属于政策鼓励且尚未被解决好的问题。"),
  h2("2.4  组别选择：首选创新训练项目"),
  p("大创分为创新训练、创业训练与创业实践三类。逐类对照项目现状如下表。"),
  tcap("表 2-1  大创组别匹配度对照"),
  tbl(["组别", "匹配度", "依据", "建议"], [
    ["创新训练项目", "高", "项目核心是方法研究与技术实现：图结构查重算法、评分量规约束下的大模型批改、置信度驱动的人机协同；成果形态为平台、论文与软著，符合创新训练对研究项目设计、实施与报告撰写的定义", "首选申报"],
    ["创业训练项目", "中", "需要商业计划书、市场调研、财务模拟与模拟运营；系统暂无多租户自助开通、计费统计等商业化要件，真实付费意愿未验证", "备选；需先完成第八章 D8 项"],
    ["创业实践项目", "低", "要求注册公司并实际运营，超出当前团队阶段", "不建议"]
  ], [16, 10, 58, 16]),
  p("结论：以创新训练项目申报，把系统定位为人机协同可信作业评价的研究与实验平台；创新点集中在方法层（算法与机制）而非功能层。若所在学院创业类名额充裕且团队有意双线，可将 SaaS 化方向作为创业训练备选材料，但主线不建议分散。"),
  h2("2.5  可行性总结（SWOT）"),
  tcap("表 2-2  SWOT 分析"),
  tbl(["维度", "内容"], [
    ["优势 S", "系统已完成且可部署运行，立项起点远高于从零开始；拓扑图查重与可信 AI 批改两项差异化算法资产；三端齐全、安全与工程细节完善；一致性基准脚本等评测设施已就位"],
    ["劣势 W", "无真实教学试点数据；无软著、论文等成果材料；查重准确率与批改一致性未量化；创新叙事尚未提炼；通知推送、OCR 批改等链路存在断点"],
    ["机会 O", "教育数字化与人工智能赋能教育的政策窗口；图形类作业查重的市场与研究空白；评审对大模型落地项目关注度高；团队占据先发完成度"],
    ["威胁 T", "大平台以功能全挤压差异化空间；大模型接口成本与合规政策变化；部分评审对调接口项目的刻板印象，需以方法设计与实证数据回应"]
  ], [12, 88]),
  p("总体判断：项目可行且具备冲优秀结题的底子，前提是补齐实证与成果短板——这正是第五、八章迭代方案要解决的问题。")
];

// ----- 第三章 -----
const ch3 = [
  h1("第三章  现有亮点与申报书可用素材"),
  h2("3.1  四个可直接写入申报书的创新点"),
  p("以下四条按申报书创新点的标准写法组织（方法层面的表述加可验证的实现细节），可直接修改使用。"),
  pb("创新点一：面向图形类作业的多粒度学术诚信检测方法。", "针对绘图类作业无法文本查重的空白，提出感知层（感知哈希）、特征层（ORB 局部特征与比值测试）、语义层（OCR 设备名与标签文本相似度）、结构层（图同构判定与图编辑距离）四级渐进流水线，以图结构比对为核心权重，并给出全班规模的两两比对任务模型与可视化证据呈现（双拓扑图并排绘制、节点按类型着色、匹配节点与边统计）。该方法将抄袭判定依据从黑盒相似度分值升级为可解释的结构证据。"),
  pb("创新点二：评分量规约束下的大模型可信自动批改框架。", "针对大模型直接打分不可控、不可信的问题，设计三项机制：模型仅产出维度分与依据摘录，总分由服务端按量规权重聚合并按模板满分封顶；建立启发式置信度估计（解析失败、越界钳制、维度缺失、极端给分、作答过短等因素加权扣减），低置信结果自动转入人工复核工单，形成 AI 初评、置信度路由、教师复核（采纳、调整、驳回）、结果回写与学生通知的完整人机协同闭环；评分量规以模板、维度、档位三表结构化描述并随任务固化快照，保证批改口径一致且全程可审计（保留模型原文、模型版本、令牌用量）。"),
  pb("创新点三：提示词工程化治理与批改服务高可用设计。", "提示词以语义化版本管理、全文快照存储，通过确定性灰度路由（以任务编号为种子）进行 A/B 对照，可随时切换回滚而无需重启；模型调用层具备超时、指数退避重试、连续失败熔断与备用模型降级；批改任务运行于基于 MySQL SKIP LOCKED 的多工作进程安全队列，含心跳续租、僵死任务回收与优雅停机。该点回应教育场景对批改服务稳定性与可追溯性的要求。"),
  pb("创新点四：还原真实校园组织结构的作业收集闭环。", "提出包含学校、班级职务（班长、学委）、课程课代表的多级组织模型，为非任课教师的收集角色提供代发作业、提交进度、未交名单、智能催交（一小时防轰炸）与按人归档打包的完整工作台，并以创建者与归属教师双字段区分代发与本人发布，兼顾权限与责任归属。"),
  h2("3.2  工程亮点清单"),
  p("除创新点外，以下工程细节可作为申报书研究基础或答辩加分项：文件安全体系（密码修改即全端令牌失效的密码版本指纹机制、十分钟时效的 HMAC 短票据下载替代长期令牌暴露、上传归属校验防止冒绑他人文件、路径围栏防目录逃逸、危险扩展名黑名单）；大文件分片上传（秒传、断点续传、合并校验、并发分片磁盘防护）；双模存储与换桶迁移脚本；分级接口限流（AI、查重、下载、分片各自独立阈值）；定时任务（截止提醒、废弃分片清理）；测试资产（模板校验与结果解析的纯函数单元测试、查重端到端脚本、评分一致性基准脚本）。"),
  h2("3.3  与同类系统的差异化对比"),
  tcap("表 3-1  差异化能力对比"),
  tbl(["能力维度", "本项目（信衡）", "主流教学平台（学习通、雨课堂类）", "主流查重（知网、维普、Turnitin）", "普通课程设计作品"], [
    ["主观题 AI 批改", "量规约束、维度分、置信度、人工复核闭环", "以客观题自动判分为主，主观题能力弱", "不涉及", "无"],
    ["图形图像作业查重", "拓扑图结构比对流水线（自研）", "无", "纯文本，不支持", "无"],
    ["文本作业查重", "字符、分词、编辑距离基础比对", "通常接第三方", "核心能力（面向论文）", "无"],
    ["班委课代表收集流", "完整工作台（代发、进度、催交、打包）", "无此组织模型", "不涉及", "无"],
    ["移动端", "微信小程序，含 AI 复核操作条", "有（功能全集）", "弱", "多为响应式网页"],
    ["部署形态", "COS 或本地双模、Compose 一键、可私有化", "公有云服务", "公有云服务", "本地演示"]
  ], [16, 26, 24, 20, 14]),
  p("使用建议：对比的胜负手不在功能全（对大平台必败），而在深——主观作业的可信评价与图形作业诚信检测两处空白。申报书与答辩话术应始终把比较锚定在这两个维度上。"),
  h2("3.4  研究基础一节的写法"),
  p("研究基础是本项目相对其他申报团队最强的部分，建议以清单加数据的方式呈现：已完成三端一服务平台（列出页面数、接口数、数据表数、代码规模等可统计指标）；已上线部署方案（域名、HTTPS、生产环境配置——申报时附访问二维码与只读演示账号为佳）；已具备评测设施（一致性基准脚本与查重端到端脚本）；已形成的设计文档与迭代记录（小程序三版设计方案等，体现工程过程）。同时附四张截图：查重双拓扑对比可视化、AI 批改维度雷达图、教师复核工作台、小程序批改页。截图是评审对完成度最直观的证据。")
];

// ----- 第四章 -----
const ch4 = [
  h1("第四章  现存不足诊断"),
  p("本章按五个维度诊断短板，并明确每一项对大创评审的影响与处置级别（必须补指影响立项与结题基本盘，冲奖指影响评优与成果上限）。原则：敢于在团队内部直面问题，但在申报书中将短板转化为研究内容（例如置信度模型尚缺校准数据，恰好构成研究问题之一）。"),
  h2("4.1  功能层面"),
  p("（1）AI 批改的作答提取仅支持 txt 与 docx（经 mammoth），PDF 与手写拍照图片无法进入批改链路——而手写作业恰是最能打动评审的场景，此为功能断链的首要问题。（2）消息通知全靠轮询（网页端六十秒、批改进度五秒、查重进度两秒），无 WebSocket 或服务端推送，小程序未接入微信订阅消息，截止提醒的到达率受限。（3）查重与批改两个模块相互独立：查重高度可疑的提交不会影响 AI 批改结果的可信提示，可信评价的叙事被割裂。（4）学情数据已积累但未利用：批改结果中的知识性错误字段是结构化数据，却没有面向学生的错题本与薄弱知识点画像，也没有面向教师的班级共性错误分析。（5）文本作业查重仅为字符级度量，无语义向量能力，对同义改写不敏感。（6）作业模型中的查重开关字段存在但无自动触发逻辑，查重完全依赖教师手动发起。（7）小程序端不支持大于 100MB 文件、zip 预览与管理端功能（已明确引导至网页端，属可接受限制，但答辩需准备说辞）。"),
  h2("4.2  创新点层面"),
  p("（1）缺少统一的问题叙事：功能清单强大，但尚未把所有能力收敛为一个研究命题（第六章给出重构方案）。（2）缺少量化评估——这是最大短板：查重算法没有准确率、召回率、误报率数据，批改一致性没有真实作业样本的对照实验，置信度阈值 0.6 属经验设定而无校准实验支撑；脚本内置的合格阈值只是目标值而非已达成结果，申报书若不慎写成已达标即构成硬伤。（3）拓扑图提取的鲁棒性未经系统验证：手机拍照的旋转、透视畸变、低分辨率、笔迹深浅对轮廓检测与霍夫直线检测的影响没有实验数据，评审极可能就此发问。（4）置信度模型为静态启发式规则，未利用历史复核结果（采纳率、调整幅度）做迭代学习——这既是不足也是下一步研究空间。"),
  h2("4.3  工程完整度"),
  p("生产部署编排未包含 Python 检测服务（文档注明需跨容器以宿主机地址访问），一键部署存在断点；测试未接入 npm 脚本与持续集成流程，单元测试覆盖仅限纯函数；无集中式日志、监控与告警；无接口文档（建议 Swagger 渐进补齐）；数据库结构变更依赖手写 SQL 迁移脚本。上述各项不影响演示，但会被工程背景的评审注意到，且补齐成本低，属于性价比最高的整改区。"),
  h2("4.4  实际落地价值"),
  p("系统尚无真实班级的持续使用记录：没有提交率、批改耗时、教师采纳率、学生满意度等任何一手数据，落地价值停留在设计与演示层面。其次，隐私与合规未成文：学生作业属于个人信息，若扩展至中学场景还涉及未成年人信息保护，需要数据留存与删除策略、脱敏方案与知情同意设计（试点前应有最基本的合规声明与问卷知情同意）。最后，多学校开通依赖管理员手工建校建班，无自助流程，SaaS 化仅具雏形。"),
  h2("4.5  论文与结题材料"),
  p("目前软著、论文、竞赛、演示视频、试点报告、用户手册全部为零。大创立项不看成果，但结题评优几乎完全看成果；若立项后才着手，软著周期（约两至四个月）与论文周期（半年以上）将挤压进度。结论：软著与试点必须在立项当月启动。"),
  h2("4.6  不足汇总与处置级别"),
  tcap("表 4-1  短板汇总、影响与处置"),
  tbl(["维度", "核心问题", "对评审的影响", "处置"], [
    ["功能", "PDF 与手写图片进不了 AI 批改", "核心演示场景断链", "必须补（R2）"],
    ["功能", "通知轮询、无订阅消息", "体验短板，易被追问", "必须补（R5）"],
    ["功能", "查重与批改未联动", "可信评价叙事割裂", "必须补（R4）"],
    ["功能", "学情数据未利用（错题本缺失）", "价值拔高空间受限", "冲奖（R3、D3）"],
    ["创新", "查重与批改均无量化评估数据", "论文与结题核心短板", "必须补（D2、D5）"],
    ["创新", "拓扑提取鲁棒性未验证", "答辩高频质询点", "冲奖（D5）"],
    ["工程", "检测服务未编排、无 CI 与接口文档", "工程完整度扣分", "必须补（R7）"],
    ["落地", "零真实试点、隐私合规未成文", "结题实证与伦理风险", "必须补（R8）"],
    ["材料", "软著论文视频全无", "结题成果硬通货为零", "必须补（R6、第八章）"]
  ], [10, 34, 30, 26])
];

// ----- 第五章 -----
const ch5 = [
  h1("第五章  分级迭代改进方案"),
  p("迭代分两级：低成本快速迭代（R 级，一到两个月，支撑立项与结题基本盘，绝大多数为必须补）与深度拔高迭代（D 级，三至十二个月，支撑评奖与论文产出）。每项均给出编码落点与工作量估计（一人日按六小时有效开发计），确保方案可直接执行。"),
  h2("5.1  低成本快速迭代（R1 至 R8）"),
  tcap("表 5-1  低成本快速迭代清单"),
  tbl(["编号", "事项", "编码落点与做法", "工作量", "申报价值"], [
    ["R1", "查重报告导出", "plagiarismController.js 新增报告接口，用 pdfkit 汇总班级摘要与可疑明细，嵌入检测服务已有的可视化对比图端点", "1 至 2 天", "教师侧闭环，答辩演示点"],
    ["R2", "PDF 与手写 OCR 进入 AI 批改", "detection_service 新增文本提取端点（启用 PaddleOCR 或接腾讯云 OCR，与 COS 同厂）；grading.service.js 的作答提取分支扩展 pdf 与图片，PDF 文本层可用 pdf 解析库优先、无文本层再走 OCR", "3 至 5 天", "打通手写作业批改，演示故事核心"],
    ["R3", "知识点错误聚类看板", "批改结果的知识性错误字段已是结构化数组；statsController 新增按课程聚合接口，教师仪表盘加 ECharts 柱状图或词云", "2 天", "学情分析雏形，为 D3 铺路"],
    ["R4", "查重与批改联动", "批阅列表联表查询每人最高相似度，超阈值标红并提示对 AI 分数优先人工复核", "1 天", "可信评价整体叙事补全"],
    ["R5", "微信订阅消息", "小程序登录与提交时调用订阅消息授权接口；notificationScheduler.js 生成截止提醒时同步调微信下发接口（需正式小程序主体与类目）", "3 至 4 天", "移动体验补齐"],
    ["R6", "软著申请三件", "按第八章 8.2 节名称整理源码前后各三十页与说明书，立项即提交（周期约两至四个月）", "2 至 3 天", "结题硬通货，越早越好"],
    ["R7", "工程收尾", "检测服务纳入生产 Compose 编排；package.json 补测试脚本并接 CI；swagger 注解渐进补齐；README 与部署文档更新", "1 至 2 天", "工程完整度整改"],
    ["R8", "首个真实试点", "选一门图形作业课程与一门文字作业课程，一个班级起步；记录教师批改耗时基线与 AI 辅助后对比、提交率变化、学生问卷；试点前准备数据使用知情同意", "持续四至八周", "全部实证材料的来源，最优先"]
  ], [7, 16, 43, 10, 24]),
  p("R 级的实施顺序建议：R8 与 R6 立项当周启动（二者周期最长）；R2 紧随其后（它决定演示故事的上限）；R1、R3、R4、R7 按一周两件的节奏收尾；R5 依赖小程序正式资质，可与其他项并行推进。"),
  h2("5.2  深度拔高迭代（D1 至 D8）"),
  tcap("表 5-2  深度拔高迭代清单"),
  tbl(["编号", "方向", "内容与实验设计", "主要产出"], [
    ["D1", "统一图表示的多模态查重", "把检测对象统一抽象为图：拓扑图（已有）、代码作业（语法树转图：节点为语句与控制结构，边为依赖与调用）、流程图与思维导图（复用轮廓与线段提取内核）；共用图比对内核，扩展检测面", "算法论文与检测引擎软著"],
    ["D2", "批改一致性实证研究", "以仓库一致性基准脚本为起点，扩至一百至三百份真实作业；设对照组：有无量规约束、不同模型（DeepSeek、GLM、通义等）、三种评语模式；指标沿用脚本阈值（平均绝对误差、差值分布、相关系数、重复批改稳定性）并做显著性检验与误差归因（题型、作答长度、学科）", "核心论文（结题评优主力）"],
    ["D3", "知识追踪与错题本", "新增知识点表与批改错误关联表；掌握度用简化贝叶斯知识追踪或滑动窗口正确率建模；学生端错题本与薄弱画像、教师端班级共性弱点", "第二论文或平台特色功能"],
    ["D4", "批改批注定位", "依据摘录由纯文本升级为原文高亮：docx 经 mammoth 转为 HTML 后做子串匹配渲染高亮；PDF 走文本层匹配；前端在预览中划出扣分位置", "演示效果大幅增强"],
    ["D5", "检测算法增强与消融实验", "大图图编辑距离近似替换为图嵌入思路；对四级流水线各层权重做消融实验；构造扰动样本（旋转、透视、改标签、换布局、局部增删、无关对照）验证鲁棒性，与教师人工判定做一致性系数", "算法论文与答辩数据支撑"],
    ["D6", "服务端实时推送", "后端增加事件推送通道（SSE），批改与查重进度、消息中心改为推送；小程序保留轮询降级", "体验与架构亮点"],
    ["D7", "试点扩面", "三至五门课程、五百人规模；系统可用性量表问卷加访谈；形成试点应用报告", "结题实证章节"],
    ["D8", "创业备选线", "学校自助注册开通、用量统计看板、私有化交付包；仅当走创业训练或创新大赛赛道时实施", "创业赛道材料"]
  ], [7, 15, 50, 28]),
  p("D 级中优先做 D2 与 D4：D2 是论文与结题评优的主力，且数据收集必须在试点扩面之前开始，否则时间不可逆；D4 投入小、演示收益极大。D1 与 D5 是冲奖双翼：前者扩展检测疆域，后者把已有算法从能用到可信（有实验数据）升级。D3 依赖 R3 的数据积累，宜放在第二学期。"),
  h2("5.3  优先级总览"),
  p("按时间轴归纳：立项前（申报期）完成 R6、R7，启动 R8 与 R2；立项后第一学期完成 R1 至 R5 收尾与 D2 数据收集、D4；第一学期末（中期检查）拿出一致性初步数据与软著受理通知；第二学期集中 D1、D5、D3、D7，产出论文投稿与最终试点报告。该节奏保证了任何时间点被检查，都有可展示的最新进展。")
];

// ----- 第六章 -----
const ch6 = [
  h1("第六章  创新点挖掘与价值拔高"),
  h2("6.1  叙事重构：从作业系统到可信评价基础设施"),
  p("普通课程作业系统的定位会让评审迅速失去兴趣，因为收集提交批改归档是红海。正确的做法是把项目重构为三层价值金字塔并主推中间层：底层是效率工具（作业全流程数字化，作为基础交代即可）；中层是可信评价——量规约束的大模型批改加置信度人工复核闭环，加图形类作业学术诚信检测，回应 AI 时代教育评价公平可信的时代命题（这是申报主线）；顶层是学情洞察——结构化知识错误数据驱动的错题本与因材施教（作为展望）。系统内置的品牌语衡量每一次努力，信守每一分公正，恰好就是中层价值的表述，可直接用于申报书摘要与答辩开场。"),
  h2("6.2  创新点提炼的四个维度"),
  p("结合本项目素材，创新点可从四个维度提炼：技术维度（做了别人没有的技术组合，如图同构与编辑距离用于课程作业查重、感知哈希与图结构融合加权）；方法维度（提出了机制或流程，如服务端权威算分、置信度分流、确定性灰度）；应用维度（覆盖了被忽视的真实场景，如班委课代表收集工作台、手写与图形作业）；治理维度（回应了可信与安全命题，如提示词版本审计、复核权责保留给教师、短票据与路径围栏）。申报书创新点三到四条为宜，建议采用第三章 3.1 节的四条表述；每条创新点都应能在系统里指出对应的可演示功能，避免空中楼阁。"),
  h2("6.3  项目名称候选"),
  p("名称决定第一印象，候选三个：（1）信衡：基于大模型与图结构比对的可信作业批改与学术诚信检测平台（推荐，两项核心技术齐备，关键词利于检索）；（2）面向图形类作业的多模态学术诚信检测关键技术研究与平台研发（研究型，适合算法味重的学院）；（3）人机协同的可信课程作业评价与学情洞察平台（评价型，适合教育技术方向）。"),
  h2("6.4  避坑清单"),
  p("（1）不要把功能列表当创新点——功能是基础，方法才是创新。（2）不要回避大模型的风险，而要展示治理机制：误判如何被置信度分流拦下、权责如何保留在教师端，这是加分项而非减分项。（3）不要写没有证据的数字——一致性阈值应表述为目标与评测标准，真实数据待试点与实验填充，申报书里以实验方案的形式呈现。（4）不要与大平台比功能全，差异叙事始终锚定主观作业可信评价与图形查重两处空白。（5）不要让评审觉得这只是调用大模型接口——用提示词治理、队列、权威算分、复核闭环四件工程事实证明系统性与研究性。（6）不要只讲技术不讲人——班委减负、教师减负、学生反馈提速三个角色的获得感要具体化，配合试点数据。")
];

// ----- 第七章 -----
const ch7 = [
  h1("第七章  申报书、结题报告与答辩材料写作要点"),
  h2("7.1  申报书逐节要点"),
  pb("立项依据。", "三段式：政策与趋势（引第二章 2.3）；现实痛点（引 2.2，四个角色侧）；国内外现状与不足——现状综述建议覆盖三条线：大模型自动评分研究近两年活跃但一致性与人机协同的实证不足、文本查重技术成熟但图形图像类作业检测空白、主流教学平台以客观题自动判分为主。每条线以两至三篇代表性文献收尾，末段顺势引出本项目的切入点。"),
  pb("创新点与特色。", "直接采用第三章 3.1 节四条，可压缩为三条（第四条并入特色）。"),
  pb("研究内容与目标。", "建议拆为四个子课题，与迭代方案一一对应：子课题一，多粒度图形作业查重方法研究与鲁棒性评估（D1、D5）；子课题二，量规约束下的大模型可信批改框架与一致性实证（D2）；子课题三，基于批改结果的知识错误聚类与个性化反馈（R3、D3）；子课题四，平台工程化完善与真实教学场景试点验证（R 级与 R8、D7）。每项研究内容都写清研究问题、拟采用方法与验收形式。"),
  pb("研究基础。", "第三章 3.4 节的写法：已完成系统清单加数据加截图加访问方式。此节是与其他申报项目拉开差距的关键，篇幅可以放宽。"),
  pb("进度安排。", "见 7.2 节表格，按十二个月两学期制编排；里程碑必须可检查（如软著受理号、实验数据集冻结、论文投稿）。"),
  pb("预期成果。", "见 7.3 节原则；研究总结报告（结题报告）为必备项。"),
  pb("经费预算。", "按学校额度编制：云服务器与对象存储、大模型接口测试费、软著申请费、专利或论文版面费、调研差旅与打印、试点问卷物料。每项写清测算依据。"),
  h2("7.2  十二个月进度安排"),
  tcap("表 7-1  进度安排（以立项当月为第 1 月）"),
  tbl(["月份", "阶段任务", "里程碑与材料"], [
    ["第 1 至 2 月", "R6 软著三件提交；R7 工程收尾；R8 试点班级与课程对接、知情同意与基线测量启动；R2 OCR 链路开发", "软著受理通知；试点方案文档；部署验收"],
    ["第 3 至 4 月", "R1、R3、R4、R5 陆续上线；D2 实验设计定稿并开始收集批改样本；D4 批注定位开发", "平台 V2 版本发布；实验数据集 v1"],
    ["第 5 至 6 月", "D2 对照实验执行（多模型多条件）；中期检查材料撰写；试点第一阶段小结", "中期检查表；一致性初步数据；试点报告一"],
    ["第 7 至 8 月", "D5 消融与鲁棒性实验；D1 代码查重模块开发；论文一（一致性实证）初稿", "实验报告；论文初稿"],
    ["第 9 至 10 月", "D3 错题本与知识画像上线；试点扩面至多门课程；论文二（查重方法）撰写", "平台 V3；论文二初稿；试点报告二"],
    ["第 11 至 12 月", "成果整理（软著证书、论文录用或投稿凭证、竞赛获奖）；演示视频录制；结题报告与答辩", "结题全套材料"]
  ], [14, 52, 34]),
  h2("7.3  预期成果承诺原则"),
  p("承诺宁低勿高、交付宁高勿低。建议申报书写：软件著作权二至三项（保底两件：平台整体与查重引擎）、学术论文一至二篇（投稿教育技术或计算机应用类期刊）、竞赛获奖一至二项、真实教学试点一至二个班级、演示视频一套。实际执行按三软著两论文两竞赛推进，结题时以超额交付呈现。切忌申报书承诺发明专利或高水平论文——周期与不确定性不可控。"),
  h2("7.4  结题报告要点"),
  p("结构建议：项目概述与目标完成情况对照表（申报书承诺逐条对照，完成或超额，附证据编号）；研究内容与技术成果（四大子课题的产出，图表化）；成果清单（软著证书号、论文录用信息、竞赛奖项、试点规模数据）；应用情况与效益（批改耗时对比、提交率变化、师生反馈摘录、可用性量表得分）；经费使用决算；团队分工与成员成长；不足与展望。写作要领：一切结论给证据编号，一切数据给测量方法，评审最认可以下三类证据——第三方证书、真实用户数据、可复现的实验设置。"),
  h2("7.5  答辩 PPT 十页大纲"),
  tcap("表 7-2  答辩 PPT 页面大纲（十分钟版）"),
  tbl(["页码", "内容", "讲法提示"], [
    ["1", "痛点故事：一门课三百份拓扑图作业，教师怎么改、怎么查重", "用一个真实数字场景开场，三十秒建立问题感"],
    ["2", "方案总览与系统架构（三端一服务架构图）", "强调已完成、已部署，一句话带过技术栈"],
    ["3", "现场演示或录屏：发布、小程序提交、AI 批改、查重可视化", "压轴放查重双拓扑对比页，视觉冲击最强"],
    ["4", "创新点一：多粒度图形作业查重（流水线图解）", "讲清四级流水线与为什么图结构权重最高"],
    ["5", "创新点二：可信 AI 批改闭环（流程图加置信度机制）", "强调模型不算总分、低置信转人工、权责归教师"],
    ["6", "实验与数据：一致性对照实验、查重评估、试点统计", "只放真实数据；没有的写成实验方案，勿编造"],
    ["7", "成果：软著、论文、竞赛、试点规模", "证书与录用截图拼版"],
    ["8", "应用价值与教育公平意义", "师资薄弱学校的公平评价场景，一两句即可"],
    ["9", "团队分工与经费使用", "对应到模块与成果，体现真实协作"],
    ["10", "总结与展望（多模态查重、知识追踪）", "收尾回到口号：让每一分都可信"]
  ], [8, 44, 48]),
  h2("7.6  预答辩问题库"),
  tcap("表 7-3  高频尖锐问题与应答要点"),
  tbl(["问题", "应答要点"], [
    ["AI 打分错了谁负责？", "权责设计：模型只出维度分，总分由服务端按量规聚合；低置信自动转教师复核，学生端显示 AI 已评待教师确认；最终成绩由教师确认回写，责任主体始终是教师"],
    ["学生数据隐私怎么保障？", "私有化部署选项、文件十分钟短时效票据、上传归属校验、路径围栏；试点前有知情同意；后续将补充数据留存与删除策略（如实说明现状与计划）"],
    ["与学习通等平台的区别？", "不做大而全，聚焦两处空白：主观作业可信 AI 批改与图形作业查重；大平台无班委收集组织模型；可互补共存"],
    ["查重误判怎么办？", "结果定位为辅助证据而非定罪：五维雷达与双图对比把判断依据可视化，最终由教师裁定；支持重新检测；后续将补充申诉流程"],
    ["大模型接口成本与依赖？", "批改走异步队列摊平峰值；接口为可插拔设计，可随时切换国产低价模型或校内私有化部署开源模型；成本在试点中实测并公布单次批改成本"],
    ["为什么用图同构而不是深度学习？", "教育场景要求可解释与小样本可用：图方法无需训练数据且证据可解释；已在计划中引入图嵌入提升大规模比对效率（D5）"],
    ["拓扑图作业场景是不是太窄？", "检测内核是通用图比对：已支持文档图文混合，规划中扩展代码语法树与流程图（D1）；图是统一抽象，拓扑图只是首个落点"],
    ["团队凭什么能做成？", "系统已完成并部署运行（演示与访问账号）；成员分工与模块一一对应；已有测试与评测设施"],
    ["试点效果如何量化？", "批改耗时对比、AI 与教师评分一致性指标、提交率变化、可用性量表得分；测量方案已在实验设计中固定"],
    ["这个项目的创新到底是算法还是工程？", "两者都有：方法层是图结构查重与置信度人机协同机制，工程层是让其可运行可审计的队列与提示词治理；论文主攻方法层"]
  ], [26, 74]),
  h2("7.7  演示策略"),
  p("三分钟演示脚本建议：教师网页端发布作业（附拓扑图样例）开始；切小程序，学生拍照提交；回到网页端发起 AI 一键批改，展示维度雷达图与低置信度转复核的工单；教师采纳一条、调整一条；进入查重中心对全班发起检测，以双拓扑图并排对比与同构判定收尾。全程准备录屏备份以防现场网络故障；演示账号提前灌好一个三十人班级的数据，保证查重结果有可疑样本可看。")
];

// ----- 第八章 -----
const ch8 = [
  h1("第八章  研究方向拓展与成果产出规划"),
  h2("8.1  五个可拓展研究方向"),
  pb("方向一：多模态学术诚信检测。", "研究问题：异构作业形态（图形、代码、文档图文）能否统一为图表示并共用比对内核。数据与方法基础：检测服务的图提取与比对内核、docx 图文降级路径已就位，代码语法树转图为核心增量。产出：算法论文与检测引擎软著。"),
  pb("方向二：大模型教育测评可信性。", "研究问题：量规约束、置信度分流对评分一致性与稳定性的实际效果；不同模型与温度条件下的差异。基础：一致性基准脚本、提示词灰度路由天然支持 A/B 对照。产出：核心实证论文。"),
  pb("方向三：知识追踪与个性化反馈。", "研究问题：从批改产生的结构化知识错误出发，能否构建学生知识点掌握度并驱动个性化练习推荐。基础：批改结果的知识性错误字段、作业提交全量数据。产出：功能模块与教育技术论文。"),
  pb("方向四：教育数据挖掘。", "研究问题：提交时间行为（提交时刻与截止时间的差值字段已入库）与成绩、拖延模式的关联。基础：提交记录表的时间戳与成绩字段，试点后数据量即可支撑分析。产出：短文或数据分析章节。"),
  pb("方向五：低资源可信批改。", "研究问题：量化后的开源小模型能否在私有化环境达到可用一致性，服务数据敏感学校。基础：接口可插拔设计使模型替换成本极低。产出：对比报告，亦是差异化卖点。"),
  h2("8.2  成果产出矩阵"),
  tcap("表 8-1  成果产出矩阵与建议去向"),
  tbl(["类别", "名称或选题", "说明与建议去向"], [
    ["软著一", "信衡校园作业提交与批改管理系统 V1.0", "网页端加后端主体；立项即申请"],
    ["软著二", "基于图结构比对的作业相似性检测系统 V1.0", "检测微服务加查重中心；与软著一分开申请，凸显算法资产"],
    ["软著三", "基于大模型的作业智能批改与人工复核系统 V1.0", "批改模块与复核工作台"],
    ["软著四（可选）", "信衡作业平台微信小程序软件 V1.0", "小程序端代码独立成件"],
    ["论文一", "基于评分量规与置信度分流的大模型作业自动批改一致性实证研究", "教育技术类或计算机教育类期刊（如现代教育技术、计算机教育）"],
    ["论文二", "融合图像特征与图结构比对的图形类作业抄袭检测方法", "计算机应用类期刊或教育相关学术会议"],
    ["论文三（可选）", "面向课程作业的知识点错误聚类与个性化反馈", "教育信息化类期刊，依赖试点数据"],
    ["竞赛一", "中国大学生计算机设计大赛（软件应用与开发或人工智能应用）", "每年上半年省赛，与系统完成度高度匹配，首选"],
    ["竞赛二", "中国国际大学生创新大赛（原互联网加）", "高教主赛道，需补商业计划书，配合 D8"],
    ["竞赛三", "挑战杯课外学术科技作品竞赛或创业计划竞赛", "学术作品线用论文一与系统；年份注意大挑小挑交替"],
    ["竞赛四（可选）", "iCAN 大学生创新创业大赛等", "备选赛道"],
    ["视频一", "系统总演示（三分钟）", "答辩与结题通用"],
    ["视频二", "查重专项（一分钟，双拓扑对比）", "竞赛与宣传素材"],
    ["视频三", "AI 批改专项（一分钟，雷达图加复核）", "同上"],
    ["其他", "试点应用报告、用户与运维手册、脱敏拓扑图作业抄袭数据集", "数据集如开放可成为社区稀缺资源，亦为论文附件"]
  ], [13, 44, 43]),
  h2("8.3  十二个月时间线总表"),
  tcap("表 8-2  大创全周期月度时间线"),
  tbl(["月份", "迭代与工程", "成果与材料"], [
    ["1", "软著三件提交；工程收尾；试点对接", "软著受理；试点方案"],
    ["2", "OCR 链路上线；试点启动", "平台 V2；基线数据"],
    ["3", "查重报告导出、学情看板、查重联动上线", "功能清单更新"],
    ["4", "订阅消息上线；批注定位开发；一致性实验启动", "实验数据集 v1"],
    ["5", "一致性对照实验执行", "中期检查材料"],
    ["6", "中期检查；试点第一阶段总结", "试点报告一；一致性初步数据"],
    ["7", "消融与鲁棒性实验；代码查重模块开发", "实验报告"],
    ["8", "论文一初稿；算法增强", "论文一初稿"],
    ["9", "错题本与知识画像开发；论文二撰写", "平台 V3；论文二初稿"],
    ["10", "试点扩面（多课程）", "试点报告二"],
    ["11", "成果汇总；视频录制；论文投稿", "录用或投稿凭证"],
    ["12", "结题报告与答辩准备", "结题全套材料"]
  ], [10, 45, 45]),
  h2("8.4  团队分工建议"),
  tcap("表 8-3  五人团队分工（按现有代码模块划分）"),
  tbl(["角色", "负责模块与任务", "材料职责"], [
    ["队长（算法）", "检测微服务、D1 与 D5 实验、R2", "论文一作；算法章节"],
    ["后端", "批改队列与提示词治理、R1、R4", "系统说明书；软著一"],
    ["前端", "网页端页面、R3、D4、演示环境", "答辩 PPT；演示视频"],
    ["小程序", "小程序端、R5、D6 降级适配", "用户手册；软著四"],
    ["测试与运营", "R8 试点组织、问卷与数据整理、D2 协助", "试点报告；结题材料汇总"]
  ], [14, 44, 42]),
  h2("8.5  结语"),
  p("信衡的大创之路可以概括为三句话：系统的完成度是立项最大的底气，短板集中在证据与成果而非代码；按本报告的两级迭代推进，先以 R 级八项补齐基本盘，再以一致性实证与多模态查重两篇论文冲击评优；始终把叙事锚定在让 AI 批改可信、让诚信检测无盲区这一时代命题上，项目就不再是一个作业管理系统，而是一套面向可信教学评价的人机协同基础设施。")
];

// =====================================================================
// 文档装配
// =====================================================================
const pgSize = { width: 11906, height: 16838 };
const pgMargin = { top: 1440, bottom: 1440, left: 1701, right: 1417 };

const doc = new Document({
  creator: "XINHENG Team",
  title: "大创项目申报与结题全景分析报告",
  styles: {
    default: {
      document: {
        run: { font: FONT_B, size: 24, color: "000000" },
        paragraph: { spacing: { line: 312 } }
      },
      heading1: {
        run: { font: FONT_H, size: 32, bold: true, color: P.heading },
        paragraph: { spacing: { before: 400, after: 200, line: 312 }, outlineLevel: 0 }
      },
      heading2: {
        run: { font: FONT_H, size: 28, bold: true, color: P.heading },
        paragraph: { spacing: { before: 280, after: 140, line: 312 }, outlineLevel: 1 }
      },
      heading3: {
        run: { font: FONT_H, size: 24, bold: true, color: P.heading },
        paragraph: { spacing: { before: 220, after: 100, line: 312 }, outlineLevel: 2 }
      }
    }
  },
  sections: [
    { // 第 1 节：封面（无页眉页脚、零页边距）
      properties: { page: { size: pgSize, margin: { top: 0, bottom: 0, left: 0, right: 0 } } },
      children: buildCoverR1({
        title: "大创项目申报与结题全景分析报告",
        subtitle: "信衡 XINHENG · 校园作业与 AI 批改平台",
        englishLabel: "INNOVATION PROJECT ANALYSIS",
        metaLines: [
          "分析对象：信衡系统全量源码（网页端 / 微信小程序 / AI 批改 / 拓扑查重）",
          "适用用途：大学生创新创业训练计划 立项申报 · 中期评优 · 结题答辩",
          "编制团队：【项目团队 / 学院名称】",
          "指导教师：【导师姓名】",
          "编制日期：2026 年 9 月"
        ],
        footerLeft: "XINHENG · Trustworthy Grading Platform",
        footerRight: "2026.09",
        palette: P
      })
    },
    { // 第 2 节：摘要 + 目录（罗马页码）
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.UPPER_ROMAN } }
      },
      headers: { default: docHeader() },
      footers: { default: pageNumFooter(true) },
      children: abstractChildren
    },
    { // 第 3 节：正文（阿拉伯页码从 1 起）
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } }
      },
      headers: { default: docHeader() },
      footers: { default: pageNumFooter(false) },
      children: [...ch1, ...ch2, ...ch3, ...ch4, ...ch5, ...ch6, ...ch7, ...ch8]
    }
  ]
});

const OUT = path.resolve(__dirname, "../docs/大创项目申报与结题全景分析报告.docx");
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT, buf);
  console.log("OK ->", OUT, buf.length, "bytes");
}).catch((e) => { console.error(e); process.exit(1); });
