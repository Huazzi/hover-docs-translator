# Feature Plan

- Feature: 翻译展示优化探索与设计（2026-10-31）
- Plan ID: hover-display-v2
- Risk classification: high（展示设置分流涉及请求生命周期；补第三独立探索与架构，实施后三级审查）
- Current phase: 6 - Independent review
- Owner: root

## Approval Gates

| Gate | Decision | Status |
| --- | --- | --- |
| A | 展示范围 | 用户明确选择“中文排版与信息层级”；无关键阻塞 |
| B | 实施方案 | 已批准：用户选择紧凑中文方案并要求“开始实施本次优化修改，并升级版本号和安装包” |
| C | 实现审查 | 实施与验证后执行 |

## Phases

- [x] 1. Discovery；确认真实 DeepSeek 翻译成功为用户反馈。
- [x] 2. 两个只读探索及根代理核验。
- [x] 3. 澄清优先方向，明确原生 Hover 限制。
- [x] 4. 两个独立架构建议、整合方案和预览。
- [x] 5. 实施0.2.0、单元及集成回归。
- [ ] 6. 三个独立审查。
- [ ] 7. 审查处置与安装包交付。

## Constraints

- 保留已批准公开 Hover API 路线；用户已批准实施、版本升级和打包，旧0.1.0包保留。
- 不把模拟预览当真实 VS Code 效果；原生英文、排序、字号、间距与滚动不由扩展全权控制。
- 默认不增加模型请求、不进行摘要、不扩展上传范围。

## Errors

- Context7 的 vscode 检索未返回官方扩展 API；使用官方 API 网页与本地固定类型声明核验。
- Python 入口是 WindowsApps 别名，session-catchup 未运行成功；通过现有计划和 Git 状态手动恢复。预览改用本地 Node 服务。
- Playwright CLI 禁止 file: 导航，改为仅监听 127.0.0.1 的本地预览服务。
