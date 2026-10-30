# 首版验证记录

日期：2026-10-30；状态：实施后验证记录，独立代码审查待进行。

## 环境

- Windows，本机 VS Code 1.144.0，构建 `2c33b50b16c472efe58357d1d2a8a5414bc23fbf`。
- Pylance 2026.4.1，Microsoft Python 2026.10.0；JavaScript 内置 JS/TS 语言服务。
- 隔离 `.vscode-test/user` 和 `.test-extensions` 目录；未修改用户日常 VS Code 配置、扩展或项目代码。

## 已验证

- 类型检查：`npm run typecheck` 通过。
- 单元测试：15 项通过，涵盖异步 RPC 重入、取消/超时后 gate 保持、迟到异常、AST 保护与安全重构、输出校验、endpoint 规范化、凭证绑定、授权撤回、缓存、共享任务取消、队列/速率、401 阻断及 HTTP 超限。
- 真实扩展宿主：JavaScript、Python 的本地函数和 Node EventEmitter / pathlib.Path 外部类取得非空原 Hover，原型 provider 调用次数为 2（外层 + 被隔离的自身回调）。
- 真实窗口 DOM：生产 Hover provider 使用假翻译传输，英文首先出现；2 秒后中文追加到同一个原生 Hover，英文仍保留；重复查询命中内容缓存。
- 安全配置：VS Code 拒绝将 machine scope 的 endpoint 写入 Workspace；用户 endpoint 不被工作区改写。

## 运行过程中的调整

- 首次类型检查发现 VS Code Thenable 与 Promise 的边界类型、字符串字面量推断，已修正。
- 工作区设置安全用例最初尝试写入并再读回，VS Code 正确拒绝写入；调整为断言拒绝。
- 本地仓库没有远程 URL，VSCE 默认无法重写 README 相对链接；打包使用 no-rewrite-relative-links，不伪造远程仓库地址。
- Markdown 字符预算按完整段落/标题/表格单元选择前缀，代码和 inline code 由本地 AST 保留；没有把完整源文件发送到假翻译客户端。

## 尚未验证或承诺的范围

- 未配置用户的真实云端 API Key，未进行任何付费翻译请求；具体供应商与模型的兼容性、延迟、译文语义质量仍需用户配置后验收。
- 外部类原型覆盖 Node/Python 标准库；requests/lodash 的真实第三方包矩阵尚未全部运行。
- 界面验证使用 2 秒假传输；并非 10 秒延迟、所有 Pylance 版本、所有其他 Hover 扩展组合都已验证。
- 原文采集期间并发新悬停可能本次只有英文，这是批准设计的已知边界；未声称消除该窗口。
- WSL/SSH/Dev Container、Notebook/Web/JSX 不在首版支持范围。
