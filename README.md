# Hover Docs Translator

在 VS Code 的 Python、JavaScript 悬停说明中追加简体中文。使用你配置的 OpenAI 兼容云端 API，保留语言服务的原始英文与签名，不要求本地模型。

## 安装与配置

首版基线为 Windows 本地 VS Code 1.144.0 或更新版本，Python 使用 Microsoft Python + Pylance，JavaScript 使用内置 JS/TS 服务。请选择正确的 Python 解释器，并确保原悬停窗口确实有文档。

1. 扩展面板菜单选择 **从 VSIX 安装**，加载本项目生成的 `hover-docs-translator-0.1.0.vsix`。
2. 命令面板运行 **中文文档：配置接口、模型与密钥**。
3. 填写供应商的 HTTPS API 根路径（如其文档要求 `/v1`，请保留），程序只追加 `/chat/completions`。向导会展示最终地址；不要输入完整 `/chat/completions` URL。
4. 填写供应商模型名和 API Key，确认将文档说明发送到该接口。
5. 在 `.py`、`.js` 中悬停函数、类或方法。原文先出现，译文稍后以“中文翻译”区块追加。

API Key 保存在 VS Code SecretStorage，不写入 `settings.json`。更换接口后需重新绑定密钥并确认云端发送。点击状态栏“中文文档”可暂停、切换显示、清缓存、撤回同意、清除密钥或查看诊断。

## 数据与费用

自动模式会发送语言服务提供的自然语言说明，其中可能包含私有项目文档。代码块、代码形式的签名和内联代码由本地 AST 保护，不发送完整源文件、文件 URI 或完整示例代码。请求仍可能含说明中的标识符，供应商可能计费。其他扩展查询 Hover 时也可能间接触发翻译。

仅在受信任本地工作区且配置/密钥/云端同意齐备时请求。工作区设置不能覆盖服务地址或模型。缓存只在当前进程内，不保存文档到磁盘；日志只记录本地错误分类。退出即清空缓存；卸载前可运行清除密钥与撤回同意命令。

默认限制：单次 6000 个可译字符、并发 2、队列 8（最长等待 3 秒）、每分钟 20 个新请求、HTTP 超时 15 秒、响应上限 512 KiB。缓存最多 500 条/10 MiB，24 小时 TTL。可在用户设置调整部分预算。

## 已知边界

- 原语言服务的英文不能被本插件统一移除；“仅译文”只控制插件自己的区块。
- 采集现有说明期间，新悬停可能本次只有原文；重新悬停可重试。语言服务一直不返回时插件进入采集降级，原 Hover 和正常编辑不受阻。
- 不支持首版范围外的远程窗口、Web、Notebook、JSX、自动补全或参数提示。
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
npm run package
```

集成测试使用隔离的用户数据与扩展目录，默认使用 `D:\DevTools\VSCode\Code.exe`；其他位置可通过 `VSCODE_EXECUTABLE` 指定。测试目录中仅链接本机已安装的 Python/Pylance 相关扩展，不修改原安装和配置。真实语言服务测试需要本机已有 Python + Pylance；未安装时应先安装依赖。云端测试使用假传输，不需要真实密钥或付费请求。

## 设计与来源

- [需求](requirements.md)、[详细设计](detailed-design.md)、[调研](research.md)
- 参考 [YiiGuxing/TranslationPlugin](https://github.com/YiiGuxing/TranslationPlugin) 的文档翻译体验；本项目独立实现 VS Code 版本，未复制其 Kotlin 代码。
- Markdown 处理采用 unified/remark（MIT）。打包依赖许可见 `THIRD_PARTY_NOTICES.md`。
