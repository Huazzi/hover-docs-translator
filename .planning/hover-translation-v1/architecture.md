# Architecture Decision

## Context

- 设计阶段已结束；用户明确批准方案 A 并授权 Git 仓库和实施。
- Gate A 已确认：用户选择保留英文追加中文；Python/JavaScript 中有文档符号皆可翻译，首次启用确认云端发送；验证环境/API/远程需求由用户授权“按推荐”。
- 据此采用首版验证基线：Windows 本地 VS Code 桌面；Microsoft Python + Pylance，JavaScript 内置 TS 服务；Python pathlib/requests、JS Node API/lodash；OpenAI 兼容 Chat Completions、用户自选云端模型；远程扩展主机列为后续适配。
- 待用户回答后启动三个只读架构子代理，再整合 detailed-design.md 并提交 Gate B。

## Options Considered

### Option A

- Design: 单 HoverProvider + 实例级原文采集协调器 + Markdown AST 结构保护 + 非流式 Chat Completions。
- Benefits: 稳定公开 API；生命周期明确；平台、网络、内容处理独立。
- Costs and risks: 采集期间其他真实悬停可能漏译；底层读取不可取消，长时间不返回时需 draining 降级。必须先过真实原型门槛。

### Option B

- Design: 按 URI/版本/位置防重入；另外比较语言服务专用适配、手动面板。
- Benefits: 按位置防重入可能提高不同位置并发；专用适配可绕过自身读取循环。
- Costs and risks: 来源身份不可区分，专用适配维护成本大；手动面板偏离用户已确认体验。详见 detailed-design.md 第 2 节。

## Recommended Option

- Recommendation: 方案 A，用户已批准实施。
- Rationale: 三个独立架构报告对比后优先有界的自身重入行为，公开记录漏译窗口。
- File change map: detailed-design.md 第 9 节；当前只新增 research.md、detailed-design.md，更新两份草案与规划。
- Data flow and error handling: detailed-design.md 第 3–8 节。
- Test plan: 第 10 节，mock RPC 迟到回调与真实 Pylance/JS 扩展宿主是首要门槛；本轮未运行。
- Migration or rollback plan: 第 11 节；无迁移，停用插件恢复原 Hover，显式命令清凭证。

## Gate B Approval

- Proposed choice: 方案 A，参数预算和风险见详细设计。设计选择不等于代码实施授权。
- User approval: approved，用户明确接受公开 Hover API + 原文采集协调器 + 异步追加中文，并授权创建 Git 仓库与实施。
- Approval timestamp: 2026-10-30，当前会话。
- Material changes after approval: 不适用。
