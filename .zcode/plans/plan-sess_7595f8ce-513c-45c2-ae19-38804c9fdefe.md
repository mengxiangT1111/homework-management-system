# 班级负责人功能（学委/班长/课代表）实施方案

## 一、需求确认
- **三种职务**：学委（每班≤2）、班长（每班≤1）、课代表（每门课可多个）
- **产生方式**：老师/管理员在班级/课程管理中指定
- **职务身份**：仍是学生（role='student' 不变），通过独立字段表达职务
- **权限范围**（学委=班长=课代表，三者相同）：
  - ✅ 查看本班/本课作业提交统计（谁交谁没交）
  - ✅ 催交未交同学（发通知）
  - ✅ 代他人提交作业
  - ✅ 打包下载全部作业 + 导出未交名单
  - ❌ 不含打分/批改/发布作业（这些仍是教师专属）

## 二、数据模型改动（核心）

### 1. 扩展 ClassStudent 表（班长/学委）
在现有 `class_students` 表加一个字段：
```js
role_in_class: {
  type: ENUM('student','monitor','commissary'),  // 普通学生/班长/学委
  defaultValue: 'student'
}
```
- 班长(monitor)、学委(commissary) 各有数量上限校验（后端控制器层做）

### 2. 新增 CourseRepresentative 表（课代表，关联课程）
因为课代表绑定的是"课程"不是"班级"，单独建表：
```js
CourseRepresentative = { id, course_id, student_id }
// 联合唯一 (course_id, student_id)
```

### 3. 新增权限判定工具 `utils/permission.js`
集中所有"是否是某作业/课程/班级的负责人"判定，避免 8 处重复代码：
```js
async isAssignmentManager(userId, assignmentId)
// 一个学生对该作业是否有管理权：
//   是本班班长/学委，或是该作业所属课程的课代表
async isClassManager(userId, classId)  // 班长或学委
async isCourseManager(userId, courseId) // 课代表
```

## 三、后端改动清单

### 控制器（放行负责人，共 8 处）
| 文件.方法 | 改动 |
|---|---|
| assignmentController.listAssignmentSubmissions | 负责人可查看 |
| assignmentController.getUnsubmittedList | 负责人可查看 |
| submissionController.remindUnsubmitted | 负责人可催交 |
| submissionController.downloadAll | 负责人可下载 |
| submissionController.exportUnsubmittedExcel | 负责人可导出 |
| submissionController.submitAssignment | **新增**：负责人可代他人提交（带 student_id 参数） |

统一改造模式（原代码）：
```js
if (req.user.role === 'teacher' && assignment.teacher_id !== req.user.id) return fail(...)
```
改为：
```js
const isMgr = req.user.role === 'student' ? await isAssignmentManager(req.user.id, id) : false
const isOwner = assignment.teacher_id === req.user.id
if (!(isOwner || isMgr || req.user.role==='admin')) return fail(res,'无权操作',403)
```

### 路由（requireRole 放行 student，共 5 处）
把以下路由的 `requireRole('teacher','admin')` 改为 `requireRole('student','teacher','admin')`（具体是否真有权限由控制器内部判断）：
- `assignments.js`: `/submissions`、`/unsubmitted`
- `submissions.js`: `/assignment/:id/remind`、`/download`、`/export`

### 新增管理接口
- `classController`：`setRole(classId, studentId, role)` 设置/取消 班长/学委
- `courseController`：`addRepresentative`/`removeRepresentative` 课代表增删
- 新增路由：`POST /classes/:id/role`、`POST /courses/:id/representatives`、`DELETE /courses/:id/representatives/:studentId`

## 四、前端改动清单

### 1. 学生端新增"我的职责"页面
- 学委/班长/课代表登录后，侧边栏出现「作业收交」菜单
- 页面内：列出本班（学委/班长）或本课（课代表）的作业 → 点击进入批阅式收交页（复用 teacher/Review.vue 改造一个简化版）
- 收交页功能：查看提交统计、催交、代交、打包下载、导出名单（**不显示打分/评语区**）

### 2. 管理员/教师端
- **班级管理**（admin/Classes.vue + teacher 查看班级）：学生列表里显示职务标签 + "设为班长/学委"操作（带名额校验提示）
- **课程管理**：新增"课代表管理"，可添加/移除课代表

### 3. API 封装（api/index.js）
新增：`classApi.setRole`、`classApi.removeRole`、`courseApi.addRep`、`courseApi.removeRep`、`courseApi.listReps`

## 五、实施顺序（6 批，每批完整可运行）

1. **数据层**：ClassStudent 加 role_in_class 字段；新建 CourseRepresentative 模型；模型关联；新增 permission.js
2. **职务管理接口**：班级设班长/学委、课程设课代表的 CRUD + 名额校验
3. **权限放行**：改 5 个路由的 requireRole + 6 个控制器方法的权限判定
4. **代交作业**：submissionController.submitAssignment 支持 student_id 参数（代他人提交）
5. **前端职务管理**：班级/课程管理页加设职务 UI
6. **前端负责人收交页**：学生端新菜单 + 简化版收交页（看统计/催交/代交/下载/导出）

## 六、不改动的内容（明确边界）
- 用户表 role 字段不动（负责人仍是 student）
- 发布作业、打分批改仍是教师专属
- 学生原有的"提交自己作业""查看我的提交"等逻辑不动

---
此方案改动涉及后端约 10 个文件 + 前端约 5 个文件，权限边界清晰（用统一 permission 工具集中判定）。请确认是否按此方案实施。