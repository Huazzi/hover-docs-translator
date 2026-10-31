# Findings

## 本地事实

- hoverDocumentProvider.ts 使用固定 H3 中文翻译标题；isTrusted=false、supportHtml=false。
- markdownCodec.ts 克隆完整 AST 并替换段落/标题/单元格；代码块仍输出，因此签名可能重复。
- paired 在原 children 后追加硬换行和中文，所有三类单元采取相同格式。
- extension.ts 对命名空间任何配置变化重建缓存并 reset，显示切换也影响翻译池。
- 用户报告已真实安装并以 deepseek-flash 看到翻译；未提供具体展示截图，本轮问题判断来源为代码。

## 官方证据（2026-10-31）

- https://code.visualstudio.com/api/references/vscode-api#HoverProvider ：多个提供者 Hover 合并；返回值为单个 Hover 或 Promise，没有逐次更新协议。
- https://code.visualstudio.com/api/references/vscode-api#MarkdownString ：Markdown 格式；HTML 仅有限安全子集；命令链接需要显式信任。
- https://code.visualstudio.com/api/extension-guides/command#command-uris ：可在 Hover 使用命令链接；本轮推荐不引入新的命令链接信任边界。

## 独立探索与架构结论

- display_content_exploration：结构保真与来源边界；实际只读样例确认表格硬换行被序列化为空格，采用整表对照。
- display_interaction_exploration：不可变配置快照，仅 paired 改变时不 reset；混合服务变更仍强制失效，进行中 Hover 使用旧快照。
- 根代理已复读 provider、codec、settings、extension、commands、diagnostics、content 测试、renderer 与 fixture。
- 对架构备选的取舍：标题采用单套中英标题，避免每标题后增加一个原文块；表格按整表配对；显示配置分流作为独立实施小步，因涉及生命周期，实施时需高风险评估。
- 用户已选择中文排版与信息层级；默认中文阅读，逐段对照为可选。
- 第三个独立探索/架构 display_lifecycle 完成：比较双方全部非展示键、仅 paired 真的变化走展示更新；缺失/异常均完整失效；测试使用生产共用分发函数和真实配置事件。

## 已确定边界

- 签名省略须保留源内容边界，无法高置信识别则保留；示例不得统一删掉。
- 默认完整呈现已有译文；不以节省高度为由静默删参数、异常、警告。
