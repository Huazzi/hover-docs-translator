# 悬浮翻译 · Hover Docs Translator

在 VS Code 的 Python、JavaScript、Java、TypeScript 悬停说明中显示简体中文，也支持本地 `.ipynb` 的 Python 代码单元格。使用你配置的 OpenAI 兼容云端 API，不要求本地模型。默认稳定模式追加译文，也可选择实验性悬停接管，减少原文重复。0.4.0 将新增语言与 Notebook 支持一并打包。

## 安装与配置

使用本地桌面 VS Code 1.144.0 或更新版本。Python 使用 Microsoft Python + Pylance；JavaScript/TypeScript 使用内置 JS/TS 服务；Java 需要 Red Hat 的 Language Support for Java，并等待语言服务就绪。请选择相应项目解释器或 JDK，并确保原悬停窗口确实有文档。

1. 扩展面板菜单选择 **从 VSIX 安装**，加载本项目生成的 `hover-docs-translator-0.4.0.vsix`。
2. 命令面板运行 **悬浮翻译：配置接口、模型与密钥**。从旧版升级时通常无需重新配置。
3. 填写供应商的 HTTPS API 根路径（如其文档要求 `/v1`，请保留），程序只追加 `/chat/completions`。向导会展示最终地址；不要输入完整 `/chat/completions` URL。
4. 填写供应商模型名和 API Key，确认将文档说明发送到该接口。
5. 在 `.py`、`.js`、`.java`、`.ts` 或本地已保存 `.ipynb` 的 Python 代码单元格中悬停函数、类或方法。原文先出现，译文稍后加入同一悬停窗口，直接显示正文，不再附加“中文说明”标题。最终排列顺序由 VS Code 决定。

Notebook 支持稳定追加和实验接管，沿用现有接口、密钥和云端同意。使用 VS Code 的 Jupyter Notebook 编辑器，并确保 Python/Pylance 已提供原生悬停说明；翻译本身不要求执行单元格。仅处理 Python 代码单元格的文档说明，不翻译 Markdown 单元格、输出或整个 Notebook 文件。编辑或删除当前单元格、关闭 Notebook 标签时会取消相关请求。未保存的新建 Notebook、远程 Notebook 和其他 Notebook 类型暂不支持。

Java/TypeScript 同样支持两种悬停模式。在本地 `.java` 中悬停 JDK/JAR API 可以翻译语言服务提供的文档；跳转进入 `jdt:` 虚拟库源码后的悬停暂不支持。带命令链接、可见 HTML 等无法安全重建的 Javadoc 分片，实验接管保留原文。TSX/JSX 和 Java Notebook 暂不支持。

## 可选：实验性悬停接管（0.3.0）

这是一份自用实验安装包，声明了 `documentFiltersExclusive` Proposed API，不能直接发布到 Marketplace。默认仍使用稳定模式，无需启用实验权限；接口、模型、Key 和云端同意沿用原配置。

1. 安装后完全退出 VS Code，再从命令行启动（已有进程可能使新参数不生效）：

   ```powershell
   code --enable-proposed-api local-hover-docs.hover-docs-translator
   ```

2. 命令面板运行 **悬浮翻译：选择悬停模式**，选择 **实验性悬停接管**。也可以点击状态栏“悬浮翻译”进入菜单。
3. **悬浮翻译：选择显示方式** 中选择“中文阅读”，显示中文正文并保留签名、示例；选择“中英对照”，每段原文后紧接中文，表格按原表→译表展示，不再额外追加完整英文文档。

本机稳定版 VS Code 1.144.0 已实测；跨版本不保证。官方推荐 Insiders；[实验 API 的启用与分享说明](https://code.visualstudio.com/api/advanced-topics/using-proposed-api)也提供通过“首选项：配置运行时参数”手动配置 `enable-proposed-api` 的方式。本插件不会修改你的 argv.json 或快捷方式。

取得原文后最多等待译文 2.5 秒（用户设置 `hoverDocsTranslator.takeoverWaitMs` 可调）。超过上限先显示原文，翻译在原请求超时限制内继续；稍后重新悬停使用已完成的缓存，不会强行刷新当前悬浮窗口。编辑/关闭文档、切回稳定模式、撤回同意或服务配置变化会取消相关后台任务。

没有 Key/同意、暂停或翻译失败时显示原文。实验权限或接口不可用会回退稳定模式，状态栏提示原因；原文采集故障时当前一次悬停可能为空，下一次走稳定模式。再次选择实验模式可重试。随时选择稳定模式即可恢复旧行为，也可重新安装保留的0.2.1包。

相对/命令链接、图片、可见 HTML、主题图标等暂不能安全重建的分片会原样保留，可能仍有英文。诊断、decoration 或其他独占扩展不由本插件全权控制；多来源顺序、JS详细悬停展开能力也不保证与原生一致。

## 显示方式

- 默认“中文阅读”：统一章节层级，保留参数列表、引用、链接和示例代码；0.2.1 起移除插件额外的译文标题。
- 运行 **悬浮翻译：选择显示方式** 可选择“中英对照”：稳定模式结合语言服务原文阅读译文，0.3.1 起不再额外复制“原文：”段落、原文标题或原文表格；实验接管仍按原文→中文逐段呈现，不增加原文标签。
- 显示方式从下一次悬停生效，复用有效译文缓存；已开始的请求保持原显示模式。
- 超出字符预算的内容会在相应段落或表格处注明并保留原文。
- 仅省略可可靠识别且与说明分开的重复签名；复杂或不确定的签名、示例继续保留。

安装0.4.0后，按 VS Code 提示重载窗口即可使用。保留现有 API Key、接口、模型、云端同意、悬停模式和显示模式。

API Key 保存在 VS Code SecretStorage，不写入 `settings.json`。更换接口后需重新绑定密钥并确认云端发送。点击状态栏“悬浮翻译”可暂停、切换显示、清缓存、撤回同意、清除密钥或查看诊断。

## 数据与费用

自动模式会发送语言服务提供的自然语言说明，其中可能包含私有项目文档。代码块、代码形式的签名和内联代码由本地 AST 保护，不发送完整源文件、文件 URI 或完整示例代码。请求仍可能含说明中的标识符，供应商可能计费。其他扩展查询 Hover 时也可能间接触发翻译。

仅在受信任本地工作区且配置/密钥/云端同意齐备时请求。工作区设置不能覆盖服务地址或模型。缓存只在当前进程内，不保存文档到磁盘；日志只记录本地错误分类。退出即清空缓存；卸载前可运行清除密钥与撤回同意命令。

默认限制：单次 6000 个可译字符、并发 2、队列 8（最长等待 3 秒）、每分钟 20 个新请求、HTTP 超时 15 秒、响应上限 512 KiB。缓存最多 500 条/10 MiB，24 小时 TTL。可在用户设置调整部分预算。

## 已知边界

- 稳定模式不能移除语言服务英文；实验接管可以重建单份语言文档，但有上述兼容与保真边界。
- 采集现有说明期间，新悬停可能本次只有原文；重新悬停可重试。语言服务一直不返回时插件进入采集降级，原 Hover 和正常编辑不受阻。
- 不支持远程窗口、Web、TSX/JSX、Java 虚拟源码、自动补全或参数提示；Notebook 仅支持本地已保存 `.ipynb` 的 Python 代码单元格。
- 纯代码、没有说明、无法安全拆分的签名保留原文。译文可能存在语义误差，请对照原文。
- 401/403/404、协议不兼容会暂停当前配置的新自动请求；更新配置或密钥恢复。429 会冷却，不做无限重试。
- HTTP 取消不保证云端停止计算或免除费用。接口需支持 Chat Completions 的 Bearer 鉴权和普通文本 JSON 响应；不依赖工具调用或结构化输出 API。

## 开发与验证

```powershell
npm ci
npm run typecheck
npm run test:unit
npm run build
npm run test:integration
npm run test:takeover
npm run package
npm run test:installed
```

集成测试使用隔离的用户数据与扩展目录，Windows 默认使用 `D:\DevTools\VSCode\Code.exe`，macOS 默认使用 `/Applications/Visual Studio Code.app/Contents/MacOS/Code`；其他位置可通过 `VSCODE_EXECUTABLE` 指定。测试目录按版本链接本机已安装的 Python/Pylance 与 Red Hat Java 扩展，并在隔离配置中禁用扩展自动更新。真实语言服务测试需要这些扩展可正常启动；Notebook 测试使用 VS Code 内置的 `.ipynb` 支持，验证同单元格和跨单元格说明，不执行代码。云端测试使用假传输，不需要真实密钥或付费请求。`test:installed` 在 Windows/macOS 的隔离目录安装实际 VSIX，验证版本、注册及实验模式门禁；该冒烟使用受控原文，不代表真实云端翻译质量验收。

## 设计与来源

- [需求](requirements.md)、[详细设计](detailed-design.md)、[调研](research.md)
- 参考 [YiiGuxing/TranslationPlugin](https://github.com/YiiGuxing/TranslationPlugin) 的文档翻译体验；本项目独立实现 VS Code 版本，未复制其 Kotlin 代码。
- Markdown 处理采用 unified/remark（MIT）。打包依赖许可见 `THIRD_PARTY_NOTICES.md`。
