# 当前实现审查范围

- 本轮使用OCR核验最新提交87179c6（相对父提交fb5297f）。
- 审查者roadmap_code_audit只读；已用OCR commit preview/rule解析scope并逐文件审阅。
- 这不是下一阶段实现后的Phase6审查，也不代表对整个现有仓库的全量审计。
- Findings：No findings，没有可确认的高置信缺陷；不进行修复。

## 覆盖

精确提交87179c6a391a81a3876088a935a6136af05d9808，父提交fb5297f；total_files30，reviewable13，reviewed13，skipped0，excluded17，coverage_rate100%（仅可审查文件）。规则为package清单组和TypeScript/JavaScript组。

已审清单（状态/路径）：

- modified: package.json
- modified: scripts/installed-smoke.mjs
- modified: scripts/integration.mjs
- modified: src/extension.ts
- modified: src/hover/experimentalHoverProvider.ts
- modified: src/hover/hoverDocumentProvider.ts
- added: src/hover/hoverDocumentScope.ts
- modified: src/ui/commands.ts
- modified: test/integration/index.ts
- modified: test/integration/installedSmoke.ts
- added: test/integration/languages.ts
- added: test/integration/notebook.ts
- modified: test/integration/takeover.ts

OCR排除：unsupported_ext13项（java-typescript-040与notebook-python-hover各5份规划Markdown，CHANGELOG.md、README.md、verification.md）；default_path4项（package-lock.json、test/fixtures/Sample.java、sample.ipynb、sample.ts）。背景读取不计入审查覆盖。

## 限制与处理

没有重跑测试，没有修改产品或审查驱动修复。最新记录来自macOS1.144；Windows0.4、Java/TS/Notebook可见DOM与真实模型语义/延迟是已知验证缺口。Java复杂链接整片英文是原设计的保真策略，不作为新bug报告。

主代理复读了当前实现和上述关键证据，并检查规划内容与已实现范围一致。路线图尚不是详细架构审批，也不是Phase6实施后审查。

## 详细设计复核（续篇，非代码审查）

- 三路独立架构报告已整合为详细设计与G4/G5独立验证计划。
- design_waiting复核后补齐：viewEpoch清展示归属、B结束不回退旧A；showHover前复验异步期间编辑器/光标/配置是否改变。
- design_diagnostics复核后补齐：snapshot显式接收当前perMinute；lastValidServiceIdentity防止清空再恢复原配置解除阻断；重复保存endpoint/model与显式重设Key区分。
- 主代理选择不扩展缓存元数据查询，仅显示近期完成事实；首批真实语义评估建议缩为6例，每批后续单独确认预算。
- 本次未产生生产代码差异，因此没有重新运行OCR提交审查或Phase6；上一轮13/13审查统计不作为新功能通过依据。
- 仅核对设计文档一致性、文件引用与Git改动范围；不运行产品测试或真实API。

## 实施后审查 / Gate C（2026-11-02）

目标workspace（git diff HEAD及untracked），基线87179c6。review_experience_security、review_experience_lifecycle、review_experience_tests三路只读审查；各自使用OCR preview/rule完整解析范围，并按主代理补充范围独立审查被排除的测试/夹具。

### 唯一确认发现

**P2 / correctness / 99：连接测试结束后，结果通知仍占用重测锁。**

位置：src/ui/experienceCommands.ts:66–68（testing于第62行拦截）。probe.run已经完成，但await say等待无按钮结果通知被关闭，finally尚未将testing设为false；用户立即重试或修配置后重试可能无响应。

主代理只读内存复现：将当前模块esbuild为内存CJS，在vm注入不结束的showInformationMessage Promise；首次probe结束后再次调用计数仍1，关闭通知后再调用变2，实际HTTP0、文件修改0。

建议处置：锁只覆盖probe.run，在显示结果通知前释放；补“请求进行中去重”和“旧通知仍未关闭时可新测”的命令层回归。修复后重跑相关检查，再升0.5.0与打包/隔离安装验证。当前未应用修复，待用户确认。

### 覆盖

OCR total_files42，reviewable24，reviewed24，skipped0，excluded18，coverage_rate100%（仅OCR可审集合）。额外native supplemental7/7，单独计数；不得称为OCR已审。11个Markdown为背景，不计代码审查覆盖。

OCR已审（M=modified，A=untracked/new）：

- M package.json
- M src/config/settingsChange.ts
- M src/content/markdownCodec.ts
- M src/content/takeoverHoverContent.ts
- M src/extension.ts
- M src/hover/experimentalHoverProvider.ts
- M src/hover/hoverDocumentProvider.ts
- A src/hover/hoverActivityTracker.ts
- M src/security/credentialStore.ts
- M src/translation/chatCompletionsClient.ts
- M src/translation/translationCoordinator.ts
- A src/translation/translationVersion.ts
- M src/ui/commands.ts
- M src/ui/diagnostics.ts
- A src/ui/configurationDiagnostics.ts
- A src/ui/connectionProbe.ts
- A src/ui/experienceCommands.ts
- A src/ui/statusMessages.ts
- M test/integration/index.ts
- M test/integration/languages.ts
- M test/integration/notebook.ts
- M test/integration/renderer.ts
- M test/integration/takeover.ts
- A test/integration/experience.ts

OCR default_path排除但已native supplemental复核：test/unit/security.test.ts、translation.test.ts、activity.test.ts、configurationDiagnostics.test.ts、connectionProbe.test.ts、quality.test.ts；test/fixtures/quality/cases.json。

OCR unsupported_ext排除：CHANGELOG.md、README.md；.planning/next-stage-roadmap下architecture/findings/progress/review/task_plan.md；docs下next-stage-detailed-design/next-stage-roadmap/next-stage-validation-plan/quality-baseline.md。

### 验证与限制

- 主代理实际执行typecheck、build、82个单元测试全部通过；Windows VSCode1.144.0稳定/实验接管两套完整集成通过，包含最新真实诊断QuickPick、新命令、背景完成不重开、失效光标命令、Java/TS/Notebook可见UI与取消矩阵。
- 观察到并修正测试自身两类旧假设：清缓存应保留冷却；只读可见Hover而非隐藏DOM文本。QuickPick断言等待列表渲染，不只等标题。
- 截图及日志保存在.vscode-test，未纳入git。当前尚未生成新VSIX或执行新安装包冒烟，版本仍0.4.0。
- 三路未发现达到门槛的凭据泄露、未经确认发送或保护绕过；这不等同全仓或供应商安全保证。
- 30例fake transport仅证明结构，不证明真实语义；未取得真实调用预算，提示词未改。G4/G5未接入。

### Gate C 已批准并修复

用户明确选择“修复、验证并打包0.5.0”。主代理将testing锁限制在probe.run，结果通知非阻塞且不再持锁。新增test/unit/experienceCommands.test.ts，在实际模块的内存bundle中模拟VSCode通知：成功和失败通知未关闭仍可新测；确认/请求在途仍去重；关闭旧通知不解除新请求的锁。

两项新测试先在旧实现失败（实际调用数1，期望2），修复后通过；typecheck及84项单元全部通过。此为用户批准的定点修复及回归，并未声称修复后又进行了新一轮完整三路审查。0.5.0包与Production隔离安装两模式均通过，新增四命令注册已验证，真实API仍未执行。产物摘要见progress的最终记录。
