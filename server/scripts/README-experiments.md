# 实验工具链说明（P1/P2 论文配套）

> 位置：`server/scripts/`（服务端工具）+ `docs/paper_tools/`（指标计算）+ `docs/experiment_data/`（预实验数据）
> 运行前提：MySQL(3306) / 后端(3000) / 查重服务(8000) 已启动，`server/.env` 已配置 AI key。

## 工具清单与分工

| 脚本 | 用途 | 典型命令 |
|---|---|---|
| `grading-consistency.js` | 一致性/稳定性/消融实验：金标集直连 LLM 批改，输出 MAE、±5 率、Pearson、重复极差、平均耗时、调用失败率（含达标线） | `node scripts/grading-consistency.js ../docs/experiment_data/golden-math.jsonl --template=5 --runs=3 --out=run.json` |
| `export_experiment.js` | **正式实验标准导出**（单作业）：ai.csv + teacher_template.csv + id_map.csv，支持 `--model` 多模型对齐 | `node scripts/export_experiment.js --assignment 12` |
| `export_combined.cjs` | 预实验多作业合并导出：全局 1..N 编号，与 `experiment_data/teacher.csv` 对齐 | `node scripts/export_combined.cjs --assignments 12,13,14` |
| `plagiarism-e2e-test.js` | 查重端到端测试（17 项断言，自建数据自清理，夹具缺失自动从 `scripts/fixtures/` 补齐） | `node scripts/plagiarism-e2e-test.js` |
| `automation_exp.cjs` | 环境自举：建 40 学生/班级/课程/作业并提交 100 份模拟作业（幂等） | `node scripts/automation_exp.cjs` |
| `create_templates.cjs` | 批量创建并发布 4 个学科评分模板（幂等） | `node scripts/create_templates.cjs` |
| `docs/paper_tools/compute_metrics.py` | 终端指标计算：表2/表3/表4 全部数字 + 图2/图3 重绘 | `python compute_metrics.py --teacher t.csv --ai a.csv --theta 0.6 --normalize` |

## 两条实验流水线

**A. 一致性/稳定性/消融（论文表2、表5）**

```
金标集 jsonl（student_answer + reference_answer + teacher_score）
  └→ grading-consistency.js --template=X --runs=3 --out=run-X.json
       消融四组：完整(v1.1，需先在提示词管理启用) / v1.0 / 去Rubric / 去参考答案
```

- 金标集由 `docs/experiment_data/gen_golden_set.py` 从 teacher.csv + 作业文本生成（含按题目匹配的参考答案）。
- `--out` 产出机器可读工件（逐样本分数 + 汇总 + 模型/提示词版本元数据），消融实验留档用。
- 耗时口径：本脚本直连计时；**系统不记录批改时延**（grading_results 的时间戳是入库时间，勿用作耗时）。

**B. 置信度分流（论文表3、表4、图2、图3）**

```
系统真实批量批改（教师端发起）
  └→ export_experiment.js --assignment <ID>（正式 / 单作业）
     或 export_combined.cjs --assignments 12,13,14（预实验 / 多作业合并）
       └→ compute_metrics.py --teacher teacher.csv --ai ai.csv --theta 0.6 --normalize
```

- 五信号由两个导出脚本从 `review_reasons` 反解，**正则保持一致**（改一处须同步另一处）。
- 多科目满分不一致（如作文 60 + 英语 100）时必须加 `--normalize`。

## 已知注意事项

1. **登录限流**：登录接口 15 分钟 10 次/IP；批量脚本用 JWT 直接签 token（`automation_exp.cjs` 的做法），勿循环调登录。
2. **nodemon**：脚本放 `scripts/` 下，别放 `server/` 根目录，否则保存时触发后端重启撞掉在途请求。
3. **响应约定**：后端 `success()` 恒返回 HTTP 200，判断业务结果用 JSON 的 `success`/`code` 字段。
4. **LLM 空响应**：deepseek-v4-flash 偶发空返回；consistency 脚本已内置 3 次重试 + 跳过，失败率会单独报告。
5. **查重夹具**：`scripts/fixtures/` 三张图为仓库内置；e2e 清理会删 uploads 副本，下次运行自动补齐。
