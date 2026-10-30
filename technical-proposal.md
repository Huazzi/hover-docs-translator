# 悬停文档中文翻译插件：技术方案

状态：首版技术方案草案；[详细设计](detailed-design.md)方案 A 已批准实施，验证进展见 [verification.md](verification.md)  
日期：2026-10-30  
对应需求：[requirements.md](requirements.md)

## 1. 方案概述

采用独立的 VS Code 扩展，以 TypeScript 编写。扩展获取 Python、JavaScript 语言服务在当前位置生成的 Hover 内容，提取其中的自然语言说明，调用用户配置的 OpenAI 兼容云端接口翻译，再通过 VS Code Hover API 展示中文。首版保持已有语言服务及其原始文档正常工作。

此方案不移植 IntelliJ IDEA 插件源码；复用的是“自动翻译文档、可查看原文、按需缓存”的产品体验。

## 2. 平台依据

- [`vscode.executeHoverProvider`](https://code.visualstudio.com/api/references/commands)接受文档 URI 和位置，返回各 Hover provider 生成的 `Hover[]`。这为获取外部库的现有说明提供入口。
- [`languages.registerHoverProvider`](https://code.visualstudio.com/api/references/vscode-api)允许扩展为指定语言和位置提供额外 Hover 内容。多个 provider 的结果会被合并，因此插件能追加中文内容，但无法普遍强制移除其他 provider 的英文内容。
- [`ExtensionContext.secrets`](https://code.visualstudio.com/api/references/vscode-api)提供加密的 SecretStorage，用于保存 API Key；普通设置只保存非敏感的 Base URL、模型名和显示偏好。

## 3. 高层结构

| 模块 | 职责 |
| --- | --- |
| Hover 接入 | 限定 `python`、`javascript`，取得当前文档位置和取消信号；调用现有 Hover provider；避免自身递归。 |
| 内容处理 | 识别自然语言段落与签名、代码块、链接，形成待翻译文本和需保留的结构。 |
| 翻译服务 | 读取 Base URL、模型和密钥，调用 OpenAI 兼容接口；处理超时、错误、取消和输出校验。 |
| 缓存 | 使用文档内容摘要、目标语言、服务和模型作为键；限制容量，提供清空命令。 |
| 展示与设置 | 在 Hover 中展示中文或中英对照；提供启停、模式切换、密钥设置和诊断日志。 |

首版数据路径：代码符号悬停 → 获取现有 Hover → 提取说明 → 查缓存 → 请求翻译（未命中时）→ 校验并缓存 → 在原悬停区域追加译文。

## 4. 关键技术决策

### 4.1 获取现有文档

优先使用官方 `vscode.executeHoverProvider` 命令取得当前符号的 Hover 结果，不依赖直接解析 Python 包或 JavaScript 依赖文件。这样可复用用户已安装的 Python/JavaScript 语言服务对符号的解析能力。对于没有 Hover 内容的符号，不请求翻译。

源码调研确认该命令会再次匹配本插件自身，也没有可传入的取消令牌。详细设计建议使用具有 collecting/draining 生命周期的实例级原文采集协调器：占用期间嵌套回调立即退出，底层命令真正 settle 才释放；云端翻译阶段在协调器之外并发执行。代价是采集窗口内真实并发悬停也可能漏译，需先过原型验证门槛。早期草案中“按请求作用域保护即可”的表述不足以覆盖跨扩展宿主回调，已由详细设计第 4 节修正。

### 4.2 文档拆分与翻译

先处理 Markdown 中的自然语言段落，保护 fenced code、inline code、函数签名、参数名、类型名、URL 和链接目标。对文档长度设置上限；超长内容只翻译可见摘要或明确截断并标示。翻译提示要求忠实翻译、保留术语和 Markdown，不补充未经原文支持的 API 用法。译文校验失败时不覆盖原文。

### 4.3 云端 API 与密钥

首版使用用户自行配置的 OpenAI 兼容 `Base URL + model + API Key`。插件提供“设置/清除 API Key”命令，通过 `SecretStorage` 读写；日志中隐藏密钥和请求头。只有用户启用自动翻译且配置完整后，才发送待翻译文档。接口和模型可更换，首版不承诺适配每家供应商的非标准响应格式。

### 4.4 缓存与生命周期

首版先采用进程内有界缓存，键包含原文摘要、目标语言、Base URL 和模型，避免不同配置共用错误译文。编辑器内容变化、请求取消或鼠标移到新符号时，不展示过期结果。跨会话持久化缓存留作后续决策，以免无意保存私有库说明。

### 4.5 展示策略

默认在原有悬停内容之后追加标记清楚的“中文翻译”区块。插件的“仅译文”设置只控制插件自己返回的内容，不能保证隐藏语言服务本身的英文内容。原位替换全部英文悬停内容不列为首版承诺。

## 5. 技术风险与验证门槛

| 风险 | 影响 | 原型阶段验证方式 |
| --- | --- | --- |
| `executeHoverProvider` 与自身 Hover provider 互相调用 | 递归、卡住或重复请求 | 分别在 Python、JavaScript 项目中验证一次自动悬停的调用次数、返回内容和取消行为。 |
| 语言服务返回内容格式不同 | 签名或 Markdown 被误译 | 对 Python 外部包和 JavaScript 外部包各选函数、类样本检查内容拆分。 |
| 云端请求延迟 | 悬停窗口等待过久、鼠标移走后结果错位 | 验证异步显示、取消和缓存命中；记录实际延迟。 |
| 多个 Hover provider 合并 | 原文与译文重复、顺序不理想 | 在常用语言扩展组合下检查显示顺序，并以明确标题区分译文。 |
| API 成本与私有文档外发 | 额外费用或信息暴露 | 验证字符上限、缓存、启停和首次云端调用提示。 |

首个技术门槛是：**在不修改语言服务的条件下，稳定取得 Python 和 JavaScript 的现有 Hover 文档，并在自动悬停中追加正确的译文。**若此门槛失败，停止扩展功能范围，先修订方案。

## 6. 阶段划分

1. **可行性原型**：验证 Hover 获取、重入保护、Python/JavaScript 样本、API 调用与展示。
2. **首版实现**：完成设置、安全存储、内容拆分、缓存、错误处理和显示模式。
3. **首版验收**：按需求文档的完成定义检查实际项目体验，再决定是否扩展 TypeScript、Go 等语言。

本文件只确定路线和验证门槛；类、函数、数据结构、配置项的最终名称及具体交互细节留到详细设计阶段。

## 7. 参考资料

- [VS Code 内置命令](https://code.visualstudio.com/api/references/commands)
- [VS Code 扩展 API：HoverProvider、Hover、SecretStorage](https://code.visualstudio.com/api/references/vscode-api)
- [VS Code 语言扩展指南](https://code.visualstudio.com/api/language-extensions/programmatic-language-features)
- [IntelliJ Translation 插件功能说明](https://github.com/YiiGuxing/TranslationPlugin)
