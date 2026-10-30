# 对标项目与 VS Code 开发调研

日期：2026-10-30。用途：为首版详细设计提供证据；本轮仅阅读源码与官方文档，未编写或运行扩展原型，未调用付费翻译接口。

## 1. 调研范围和版本

- 对标项目：YiiGuxing/TranslationPlugin，源码快照 `bb50b0f4debe5464ffe99ede63c95e5456862bb7`。
- VS Code：源码快照 `8046bb1f9ca754bc1344a108831433e13a42176c`。
- Pyright：源码快照 `74743ab17950a6bd205935e21808102a610d40a1`。它仅用于了解 Python Hover 的可能结构，不能当作闭源 Pylance 实际输出的完整证明。
- 这些 SHA 是调研时远端分支快照，不代表用户已安装版本或最终支持的最低版本。
- 三个只读探索视角：对标执行链；VS Code Hover 调用/展示；语言服务兼容与数据边界。主代理独立复读关键源码后整合。

## 2. 对标项目的实现方式

对标插件包装原有 DocumentationTarget，保留原来的文档计算能力；自动翻译时使用异步 DocumentationResult 和 updates 流更新同一窗口，更新流结束时取消翻译任务。这种流式 UI 能力依赖 JetBrains 平台，不能直接移植到 VS Code。[源码](https://github.com/YiiGuxing/TranslationPlugin/blob/bb50b0f4debe5464ffe99ede63c95e5456862bb7/src/main/kotlin/cn/yiiguxing/plugin/translate/documentation/TranslatableDocumentationTarget.kt)

它处理 HTML 文档时，会先保护签名区域、底部信息和 pre 代码块，并应用语言相关过滤，翻译后恢复。值得借鉴的是在本地保护结构；VS Code 的主要输入是 Markdown，需要独立的 Markdown 处理方案。[源码](https://github.com/YiiGuxing/TranslationPlugin/blob/bb50b0f4debe5464ffe99ede63c95e5456862bb7/src/main/kotlin/cn/yiiguxing/plugin/translate/documentation/Documentations.kt)

OpenAI 路径对保护后的 HTML 内容进行翻译，并把引擎、模型/配置及提示词等信息纳入缓存依据；它不等于完全复用通用 HTML 占位翻译策略。其 HTTP 服务区分 endpoint 和 API path，使用独立凭证管理。[翻译入口](https://github.com/YiiGuxing/TranslationPlugin/blob/bb50b0f4debe5464ffe99ede63c95e5456862bb7/src/main/kotlin/cn/yiiguxing/plugin/translate/trans/openai/OpenAiTranslator.kt)、[HTTP 服务](https://github.com/YiiGuxing/TranslationPlugin/blob/bb50b0f4debe5464ffe99ede63c95e5456862bb7/src/main/kotlin/cn/yiiguxing/plugin/translate/trans/openai/OpenAiService.kt)

探索报告另列出内存/磁盘缓存、PasswordSafe 和 HTML 翻译测试作为后续实现参考，不能把这些平台设施直接当作 VS Code 的实现。首版推荐内存缓存、VS Code SecretStorage。对标项目使用 MIT 许可证；若后续复制实质代码，需保留相应版权和许可声明。[仓库](https://github.com/YiiGuxing/TranslationPlugin/tree/bb50b0f4debe5464ffe99ede63c95e5456862bb7)、[许可](https://github.com/YiiGuxing/TranslationPlugin/blob/bb50b0f4debe5464ffe99ede63c95e5456862bb7/LICENSE)

## 3. VS Code 已验证的事实

### 3.1 可以读取完整 Hover，但不会自动排除自身

公开 `vscode.executeHoverProvider(uri, position)` 返回 Hover 数组；内部命令会并行调用匹配 provider，使用 CancellationToken.None，按结果到达顺序收集。数组首项不保证是主要语言服务，也不能由父请求传入取消信号。[官方命令](https://code.visualstudio.com/api/references/commands)、[getHover.ts](https://github.com/microsoft/vscode/blob/8046bb1f9ca754bc1344a108831433e13a42176c/src/vs/editor/contrib/hover/browser/getHover.ts)

普通翻译 HoverProvider 内调用该命令会再次匹配自身。需要显式阻止嵌套调用；嵌套调用若加入父调用等待的 Promise，会造成等待环。`_recursive` 变体中的 recursive 参数与 exclusive selector 处理有关，并非防递归开关。首版不使用实验命令、内部 exclusive 字段或修改编辑器文件。[注册表源码](https://github.com/microsoft/vscode/blob/8046bb1f9ca754bc1344a108831433e13a42176c/src/vs/editor/common/languageFeatureRegistry.ts)、[扩展宿主适配](https://github.com/microsoft/vscode/blob/8046bb1f9ca754bc1344a108831433e13a42176c/src/vs/workbench/api/common/extHostLanguageFeatures.ts)

### 3.2 可以追加较晚返回的结果，不能任意修改原文窗口

Hover 操作随着异步结果到达更新显示。因此设计可以让原语言 provider 先返回英文，翻译 provider 等待云端响应后返回一次中文。公共 API 没有通用的 onDidChangeHover；不能先返回“翻译中”对象，再依靠修改对象保证刷新。[hoverOperation.ts](https://github.com/microsoft/vscode/blob/8046bb1f9ca754bc1344a108831433e13a42176c/src/vs/editor/contrib/hover/browser/hoverOperation.ts)、[HoverProvider API](https://code.visualstudio.com/api/references/vscode-api#HoverProvider)

多个 provider 的内容由 VS Code 合并，扩展不能统一删除别人生成的英文内容，也不保证自己的区块永远排在最下方。公共 Hover 对象没有 provider ID 或外部库来源字段；其他扩展调用读取 Hover 命令时，也可能间接触发翻译。[Hover API](https://code.visualstudio.com/api/references/vscode-api#Hover)

### 3.3 JavaScript 和 Python 输入差异

JavaScript 的内置 TypeScriptHoverProvider 调用 tsserver quickinfo；签名代码块可以标记为 typescript，而不是 javascript。应保护所有代码块，不能按当前编辑器语言筛选围栏。[JS Hover 实现](https://github.com/microsoft/vscode/blob/8046bb1f9ca754bc1344a108831433e13a42176c/extensions/typescript-language-features/src/languageFeatures/hover.ts)

Pyright 可以返回带 python 围栏的签名和文档 Markdown，也可以返回纯文本；无法可靠区分签名的纯文本应保守跳过。Pylance 运行时样本需在未来原型阶段单独获取。[Pyright 实现](https://github.com/microsoft/pyright/blob/74743ab17950a6bd205935e21808102a610d40a1/packages/pyright-internal/src/languageService/hoverProvider.ts)、[Pylance 仓库说明](https://github.com/microsoft/pylance-release)

### 3.4 密钥、配置与运行位置

API Key 使用 SecretStorage。服务地址、模型、密钥绑定和云端发送同意必须由用户控制；不能让工作区设置覆盖 endpoint 后继续使用用户密钥。Workspace Trust 也不能代替用户对文档外发的同意。[配置作用域](https://code.visualstudio.com/api/references/contribution-points#contributes.configuration)、[SecretStorage](https://code.visualstudio.com/api/references/vscode-api#SecretStorage)、[Workspace Trust](https://code.visualstudio.com/api/extension-guides/workspace-trust)

桌面和远程扩展主机可能处于不同机器，影响网络与凭证环境。首版推荐 Windows 本地桌面验收，WSL/SSH/Dev Container 后续单独验证。[Extension Host](https://code.visualstudio.com/api/advanced-topics/extension-host)

## 4. 用户已确认的决定

1. 接受原有英文保留并追加中文，优先自动悬停稳定。
2. Python/JavaScript 中有文档的符号都可翻译，首次启用时确认向配置的云端发送内容。
3. 语言服务、库、云端 API 协议与远程支持范围“按推荐”：首版以 Windows 本地、Pylance/内置 JS 服务、标准 Chat Completions 协议为基线，远程支持后续扩展；不绑定某个供应商或固定模型。

## 5. 尚未通过实测的边界

- 重入隔离期间真实悬停也可能被跳过，需以稳定性优先，并在原型中测量影响。
- 长耗时云端请求能否在目标稳定版的悬停窗口中理想追加，尚无实际验证。
- 父 Hover 取消不能取消正在执行的读取 Hover 命令；只能丢弃迟到结果，并尽量中止后续 HTTP。
- HTTP 取消不表示云端一定停止计算或免除费用。
- 不同 Pylance 版本、JSDoc 格式、多 provider 组合和代理网络仍需集成验证。
- 本轮“源码已验证”不等于“扩展已运行验证”。
