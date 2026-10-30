# Discovery Findings

## Verified Facts

- 项目当前只有 requirements.md 与 technical-proposal.md；无实现代码。
- 已读取官方内置命令文档：https://code.visualstudio.com/api/references/commands ，存在 executeHoverProvider 返回 Hover[]。
- 已读取官方 API：https://code.visualstudio.com/api/references/vscode-api ，多个 Hover provider 合并，SecretStorage 用于密钥；获取完整文档与统一屏蔽原文是两个不同问题。
- 本次调查远端快照：microsoft/vscode main = 8046bb1f9ca754bc1344a108831433e13a42176c；YiiGuxing/TranslationPlugin master = bb50b0f4debe5464ffe99ede63c95e5456862bb7。分支 HEAD 不等于用户安装版本。

## Similar Features and Local Patterns

- 

## Entry Points and Data Flow

- 主代理已独立读取 VS Code 快照 getHover.ts：_executeHoverProvider 调用所有匹配 provider；CancellationToken.None；recursive 版本向 registry.ordered 传 recursive=true，这个参数不能直接解读为自动避开插件自身的递归调用。
- 主代理已独立读取 JS 内置 hover.ts：从 TS server quickinfo 取得文档；签名 code fence 使用 typescript，JS 文件也不能只保护 javascript fence。文档 Markdown 与签名分开。
- 源码：https://github.com/microsoft/vscode/blob/8046bb1f9ca754bc1344a108831433e13a42176c/src/vs/editor/contrib/hover/browser/getHover.ts
- 源码：https://github.com/microsoft/vscode/blob/8046bb1f9ca754bc1344a108831433e13a42176c/extensions/typescript-language-features/src/languageFeatures/hover.ts

## Essential Files

- 

## Risks and Open Questions

- 已异步询问用户：能否接受原文后追加中文；自动翻译全部符号还是仅确认外部依赖；语言服务、库、API 服务和远程环境。
- Gate A 尚未确认，继续只读探索，不进入 Phase 4 架构选型。
- 用户已确认：接受在原文后追加中文，优先稳定的自动悬停。其余两个问题等待回答。
- 后续用户已确认所有文档符号均可翻译、首次确认外发；环境/API/远程按推荐。Gate A 已通过。
- 三个探索报告已到达：对标通过包装原 DocumentationTarget 并用 updates 流更新同窗（VS Code 不能照搬）；VS Code 普通 HoverProvider 可等待后一次返回译文，尚需原型验证长延迟/取消。
- 官方 Hover 对象无 provider/source origin 标签；Pylance 闭源，Pyright 仅作格式参考，不能代替实际 Pylance 样本。
- 工作区不应能覆盖云端 endpoint 并借用用户密钥；模型输出不得继承原 Markdown 的命令信任能力。
- 工具记录：Python 远程源码批读命令 exit 1 且无输出，改用 web raw 逐文件读取；没有将这次读取失败记为功能验证失败。远程扩展官方文档 web 请求一次超时，改读 extension-host 官方页。
