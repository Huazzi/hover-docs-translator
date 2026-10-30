# 悬停文档中文翻译插件：详细设计

版本：0.1，2026-10-30  
状态：方案 A 已由用户批准并进入实施；当前实现与验证范围见 [verification.md](verification.md)  
输入：[需求](requirements.md)、[技术草案](technical-proposal.md)、[源码调研](research.md)

## 1. 已确认的需求与支持基线

用户已确认：保留语言服务原有英文，在同一悬停窗口追加中文；Python/JavaScript 中有文档的符号都可以翻译，首次启用时确认云端发送；语言服务、样本、云端协议和远程支持范围按推荐确定。

推荐首版支持基线如下，提交 Gate B 选择：

| 项目 | 首版决定 |
| --- | --- |
| 环境 | Windows 本地 VS Code 桌面；普通 file 文档，语言 ID 为 python、javascript |
| Python | Microsoft Python + Pylance，正确选择解释器；验收样本 pathlib、requests |
| JavaScript | VS Code 内置 JS/TS 语言服务；Node API、带类型/JSDoc 的 lodash；类场景用 EventEmitter 等 |
| 云端协议 | 用户自带 API Key，OpenAI 兼容 Chat Completions；不指定唯一供应商、固定模型 |
| 翻译范围 | 已有 Hover 中可识别的自然语言说明；包含私有工作区文档；无说明不补写 |
| 展示 | 原 Hover 不变，插件默认只返回带标题的中文区块；可选择插件内部中英配对展示 |
| 缓存 | 当前扩展进程内，有界；不把文档或译文写入磁盘 |
| 后续范围 | WSL、SSH、Dev Container、Web、Notebook、JSX、其他语言单独适配 |

这里的支持基线不是已完成兼容性测试。开发时应选择一个实际稳定版作为冻结基线，固定 @types/vscode 和 engines.vscode；不得以调研的 main 分支 SHA 代替最低支持版本。远程窗口首版不启动自动云端翻译，并显示范围说明。

## 2. 架构选择与取舍

### 2.1 推荐方案 A：稳定公开 API + 独占原文采集 + 异步追加

注册单个 HoverProvider，通过公开 executeHoverProvider 读取原文；采集阶段用扩展实例范围的协调器阻止自身重入；原文拿到后释放采集占用，再处理 Markdown、缓存与云端请求。译文作为一次异步结果返回，由 VS Code 合并展示。

三个独立架构视角分别检查了最小实现与对标复用、可维护的 Hover 生命周期、密钥/网络/内容边界。推荐采用最明确的独占采集生命周期，接受采集窗口内并发悬停可能暂时只有原文的代价。该代价必须经过真实原型验证，不能留作普通性能优化。

| 选项 | 优点 | 代价与结论 |
| --- | --- | --- |
| A：实例级采集 gate | 自身重入、超时和迟到回调的行为易于约束；不依赖调用链跨 RPC 传播 | 原文采集期间其他真实悬停也可能跳过译文；推荐，以原型门槛约束 |
| B：仅按 URI/版本/位置防重入 | 不同位置可同时采集 | 仍分不清同位置真实请求与嵌套请求；跨位置调用更复杂；首版不优先 |
| C：Python/JS 专用语言服务适配 | 可避免自己的 Hover 采集循环 | Pylance 无通用公开内部接口，需要语言专用维护；首版不采用 |
| D：手动命令/独立面板 | 采集和展示控制更直接 | 无法满足当前自动悬停体验；仅在 A 不可接受时重新讨论 |

不使用临时注销/重新注册 provider、改写 VS Code 文件、Proposed API 或内部 _recursive 命令来绕过问题。来源依据见 [调研第 3 节](research.md#3-vs-code-已验证的事实)。

## 3. 组件与逻辑契约

下列接口是设计契约，尚非已有代码。

| 组件 | 输入/输出 | 责任 |
| --- | --- | --- |
| HoverDocumentProvider | document、position、token → Hover 或 undefined | 最先检查采集 gate；校验配置与支持范围，捕获快照，驱动流程并发布一次结果 |
| HoverDiscoveryCoordinator | Snapshot → Collected / Busy / Cancelled / Timeout / Failed | 独占执行公开读取命令，阻止自身回调，跟踪真实 settle |
| MarkdownCodec | Hover[] → ProtectedDocument | 过滤重复内容、拆分说明、保护技术结构；恢复安全 Markdown |
| TranslationCoordinator | ProtectedDocument + ConfigSnapshot + consumer → 译文 | 缓存、内容级任务复用、订阅取消、限流和过期校验 |
| ChatCompletionsClient | segments、配置、AbortSignal → 响应文本 | HTTP 传输和协议校验，不操控编辑器或弹窗 |
| SettingsService / CredentialStore / ConsentStore | 用户设置/SecretStorage/globalState → 配置快照 | endpoint 规范化、密钥绑定、授权和配置代次 |
| MemoryTranslationCache | CacheKey → 已校验片段 | 有界 LRU，容量/TTL/代次失效 |
| Commands / Diagnostics | 用户操作、脱敏事件 → 配置/状态 | 配置向导、暂停、清理、撤回授权、状态栏和 Output Channel |

核心值对象：

- Snapshot：URI、document.version、position、languageId、configRevision、cacheGeneration；不长期持有 document。
- ConfigSnapshot：规范化完整 endpoint、model、目标语言 zh-CN、请求限制、revision、当前凭证绑定是否有效；普通对象不包含 API Key。
- ProtectedDocument：内容摘要、可译 segment 列表、受保护 AST 与原始结构、合法源链接、原文片段；只在当前请求中使用。
- TranslationResult：经过校验的 segment ID 到译文文本映射；不包含模型自由生成的可执行 Markdown。

## 4. 自动悬停与采集生命周期

### 4.1 正常路径

1. VS Code 并行调用原语言 provider 与本插件 provider；原英文可先显示。
2. 本插件入口首先检查采集 gate。被占用时立即返回 undefined，不能先查缓存或复用在途任务。
3. 检查当前语言、文档方案、自动开关、工作区信任、endpoint/模型/密钥与云端授权。条件缺失时不请求云端。
4. 捕获 Snapshot，同步占用采集 gate，再调用一次 executeHoverProvider。
5. 该命令再次调用本插件时，入口直接退出；其他 provider 正常生成文档。读取返回后不按数组顺序认定主文档。
6. 底层读取 Promise 实际 settle 后释放 gate。丢弃已取消或版本变化的结果，提取可译说明。
7. 查内容缓存，未命中则订阅或创建翻译任务；等待期间保留 provider Promise，而不是先返回可变“翻译中”Hover。
8. 校验译文并再次检查 Snapshot、授权、配置和取消状态；仍有效才返回一次中文 Hover。

显示区块可能由 VS Code 排在不同 provider 内容之间；不保证译文固定处于窗口底部。

### 4.2 重入、超时与降级

采集协调器状态：idle → collecting → idle；消费者取消/超时但底层尚未完成时，进入 draining，底层 settle 后才能回到 idle。

- collecting/draining 中本插件所有 provider 回调均立即返回 undefined；不把它们排队等待父任务，不返回缓存译文，避免等待环和译文被当作原文再次采集。
- 公开命令不能接收父 Hover 的取消令牌。取消只结束消费者等待、阻止后续云端请求和展示，不能声称中止了语言服务。
- 采集超时后不能提前释放 gate；迟到的底层回调仍可能调用本插件。
- 底层永不结束时保持降级：编辑器原 Hover 正常，本插件暂停采集；状态栏提供诊断及重载窗口建议。不要在尚未 settle 时自动启动另一个采集。
- 新悬停可能落在采集窗口内而本次没有译文；用户重新悬停后重试。没有稳定 API 可以保证对被跳过的窗口强制重新展示。
- 其他扩展显式查询 Hover 也可能触发本插件；公共 API 不保证能识别真实鼠标来源，因此不承诺按物理悬停次数精确计费。

这套协调器与“全程全局布尔锁”不同：只覆盖读取语言服务的阶段，云端翻译在 gate 之外并发执行；生命周期持续到不可取消的底层操作真实结束。

## 5. Markdown 提取、翻译与恢复

1. 规范化 Hover.contents 中的 MarkdownString 和旧式代码标记；保护所有代码块，不根据 python/javascript 等围栏语言筛选。
2. 解析为 Markdown AST，签名代码块、示例代码块、inline code、链接目标、本地路径及非文本节点不交给模型改写。HTTP(S) 源链接可在译文中由本地结构保留。
3. 提取可译自然语言段落；同一请求内相同文本去重。不以数组第一个 Hover 作为唯一正文；多个有效范围须包含当前位置，展示使用当前位置词范围，缺少词范围时使用位置空范围。
4. 表格保留行列结构，只翻译单元格的文本；标题、列表和强调结构本地保留。纯代码、无说明和无法可靠拆分的纯文本签名跳过。中文为主且没有明显英文说明时跳过，不承诺精确语言识别。
5. 为段落分配稳定 ID。内联保护部分用本地占位标记表示；段落顺序和上下文可随请求发送，不发送完整源文件、URI、完整代码示例或 API Key。
6. 云端只返回 segments（id、text）；不依赖供应商支持 response_format、tool calling 或流式协议。普通文本响应也必须解析为约定结构。
7. 校验 ID 集合、唯一性、数量、长度、占位标记完整性和顺序。缺失/新增段落、保护标记改变、截断输出使整次结果失败；首版不做自动“修复 JSON”的第二次计费请求。
8. 只把译文作为文本回填原 AST，转义新生成的 Markdown 语法；不将模型返回字符串直接标为可信 Markdown。不复制模型生成的 HTML、图片、command/file/data 链接。
9. 译文区 MarkdownString.isTrusted=false，supportHtml=false；保留的源链接仅允许 HTTP(S)。原语言 provider 自身内容不改动。

保护“代码形式的参数名”可机械验证；散文中未标记的标识符和语义准确性仍需模型质量与人工样本验收，不声称占位符能保证翻译语义完全正确。

## 6. API 协议、配置与密钥

### 6.1 明确地址语义

保留需求中的 Base URL 设置，但定义为供应商的 API 根路径：供应商要求 /v1 时用户填写该段；程序只追加 /chat/completions，不自动推测 /v1。配置向导同时显示最终请求 endpoint。输入完整 /chat/completions 地址时给出纠正提示，不再重复追加。

POST 使用 Bearer API Key 和 JSON；请求体只依赖 model、messages、stream=false。响应读取 choices[0].message.content 的字符串；空内容、非字符串、错误 JSON、finish_reason 表示截断均按失败处理。首版不支持 Azure 特有鉴权/路由、Responses API、自定义请求头、工具执行或供应商自动故障切换。

仅接受 HTTPS URL，拒绝 userinfo、query、fragment；尾斜线规范化，路径大小写保留。不自动跟随重定向，不关闭 TLS 校验。供应商兼容性以用户后续选定 endpoint 的实际联调为准。

### 6.2 设置与默认值建议

命名空间建议 hoverDocsTranslator；以下为 Gate B 提案，全部关键设置使用 machine scope，并在读取时忽略工作区覆盖。首次配置通过用户命令完成。

| 配置项 | 建议默认值 | 含义 |
| --- | --- | --- |
| enabled | true，但无配置/授权不发请求 | 自动翻译总开关 |
| apiBaseUrl / model | 空 | 用户指定，未配置时不推测 |
| displayMode | translationOnly | 插件只追加中文；paired 可在插件区重复显示原文对照 |
| maxChars | 6000 | 单次可译文本上限；按完整段落选择前缀并标示“部分翻译” |
| discoveryTimeoutMs | 5000 | 消费者读取原文等待上限；不解除尚未结束的 gate |
| requestTimeoutMs | 15000 | HTTP 整体超时，不含等待队列 |
| maxConcurrentRequests / maxQueueSize | 2 / 8 | 限制云端并发；超出队列本次跳过译文 |
| requestsPerMinute | 20 | 新 HTTP 任务上限；缓存命中不占用 |
| cacheMaxEntries / cacheTtlMinutes | 500 / 1440 | 仅进程内 LRU；另设总缓存大小 10 MiB 上限 |

这些数值是可调的初始预算，不是实测性能承诺。响应体上限建议 512 KiB，排队等待上限 3 秒；超出均降级原文。

### 6.3 授权与状态失效

- Key 通过 SecretStorage 保存，键名绑定规范化最终 endpoint 的摘要。更换 endpoint 不复用旧 Key；可显式清除全部本插件凭证。
- 首次配置展示发送目的地，说明工作区私有文档也可能发送，明确同意后在 globalState 记录 endpoint + policyVersion；不记录正文。改变 endpoint 或发送政策需重新同意。
- 模型改变、Key 轮换、清除 Key、禁用、撤回同意提升 configRevision，取消在途发布，并清除相关缓存。模型改变不要求重复同意相同 endpoint 的发送范围。
- 不可信工作区不自动发送；信任工作区和同意云端发送须同时满足。设置更新不得静默替用户同意。
- 日志仅记录错误类别、耗时、字符数、缓存命中和脱敏服务信息；不记录请求/响应正文、完整文档、URI、Authorization 或 Key。

## 7. 翻译任务、缓存与取消

采集 gate 与翻译任务池完全分开。后者使用内容级 key：原文/保护结构摘要 + endpoint + model + zh-CN + promptVersion + codecVersion + 配置代次。Key 的明文或摘要都不进入内容缓存键。

- 相同内容的不同位置可共享一个翻译任务；每个调用有独立订阅者和 Snapshot。
- 一个订阅者取消不影响其他订阅者；全部取消后移出队列或 Abort HTTP，拒收迟到结果。
- 缓存仅保存验证成功的译文片段；不保存 document、URI、编辑器对象或凭证。
- 清空缓存提升 cacheGeneration，同时中止当前翻译任务，避免旧响应回填。
- 只有配置/代次仍有效且至少一个存活消费者时才写缓存并交付；取消和版本变更的消费者不收到结果。
- HTTP Abort 是客户端尽力取消，不承诺供应商停止计算或不产生费用。

## 8. 用户交互与错误

命令：配置接口与模型、设置/清除 API Key、确认/撤回云端发送、暂停/恢复自动翻译、切换插件显示模式、清空缓存、打开诊断。按用户操作展示必要确认；不在每次悬停弹出模态窗口。

| 状态/错误 | 行为 |
| --- | --- |
| 未配置 / 未同意 | 状态栏给配置入口，原 Hover 正常，不发云端请求 |
| 翻译中 | 原文先显示，状态栏标明活动任务；provider 等待一次最终结果 |
| 没有说明 / 不支持格式 / 取消 | 不追加内容，通常不通知 |
| 401/403 | 暂停该配置自动请求，提示检查凭证；用户配置后恢复 |
| 404/协议错误 | 暂停该配置并提供最终 endpoint 检查入口，不自动猜地址 |
| 429 | 冷却期间不请求；参考 Retry-After，有界冷却，无即时重试循环 |
| 超时 / 网络 / 5xx | 本次保留原文，短期失败冷却；下次悬停可再试 |
| 结构校验失败 | 丢弃译文，记录脱敏类别，不展示不完整结果 |
| 原文采集未结束 | draining 降级，说明语言服务未返回；提供诊断入口 |

不承诺模型请求能逐字符更新悬停区，也不承诺显示模式变化能立即刷新已经打开的 Hover；下一次悬停使用新配置。

## 9. 预期文件图

除本轮 Markdown 外，下表均为未来拟创建文件，不是现有实现。

| 路径 | 内容 |
| --- | --- |
| package.json、tsconfig.json、构建配置、README.md | 扩展声明、稳定 SDK、打包、依赖和用户操作说明 |
| src/extension.ts | 组件组装、语言注册、dispose |
| src/hover/hoverDocumentProvider.ts | provider 主流程与 Snapshot |
| src/hover/hoverDiscoveryCoordinator.ts | collecting/draining 生命周期 |
| src/content/markdownCodec.ts、translationValidation.ts | AST 提取/恢复、片段和保护标记校验 |
| src/translation/translationCoordinator.ts、chatCompletionsClient.ts、prompt.ts | 请求池、HTTP、版本化提示 |
| src/config/settingsService.ts | 用户设置、配置快照、endpoint 规范化 |
| src/security/credentialStore.ts、consentStore.ts | 凭证和发送授权 |
| src/cache/memoryTranslationCache.ts | LRU、TTL、容量预算 |
| src/ui/commands.ts、diagnostics.ts | 用户命令、状态栏、脱敏日志 |
| test/unit/、test/integration/、test/fixtures/python/、test/fixtures/javascript/ | 纯逻辑测试、扩展宿主和语言服务样本 |

优先复用成熟 Markdown AST 库，具体包与版本在实施前依赖核查时固定。保持传输、内容处理、VS Code 接入相互独立，不增加后台服务或数据库。

## 10. 验证计划与阻断门槛

本轮没有执行下列验证；用户批准实施后才建立测试工程。

### 10.1 原型先行门槛

在冻结的 VS Code 稳定版、Pylance/内置 JS 服务上，用假翻译传输模拟 0.1 秒、2 秒、10 秒延迟：

1. 英文先出现，中文异步追加；不要求用户按快捷键。
2. 自身嵌套调用立即退出，单次采集不产生等待环；不同位置和相同位置的并发请求有界。
3. 原文读取取消/超时后底层迟到回调仍被隔离，实际 settle 才释放 gate；永不 settle 不阻塞编辑。
4. 记录采集耗时及快速移入/移出、返回原位置的漏译情况；若正常连续悬停频繁漏译，方案 A 不通过，回到架构选择。
5. 与额外 Hover 扩展并存，完成顺序改变不破坏提取；文档修改、关闭和配置变化后无旧结果。

### 10.2 后续测试矩阵

- Python：pathlib.Path、requests.get、requests.Session、项目私有 docstring、无文档、仅签名、含示例/重载、解释器未配置。
- JavaScript：Node 函数和 EventEmitter 类、lodash、项目 JSDoc、@param/@returns/@example、重导出、无说明。
- 内容：各种 fenced/inline code、链接/表格、混合中英、纯文本签名、超长内容、重复 Hover、模型漏段/改标记/新增链接。
- 生命周期：两个订阅者取消一个、全部取消、排队溢出、清缓存/换模型/Key/endpoint 与响应竞争。
- 网络/安全：401/403/404/429/5xx、重定向、超时、空响应、非 JSON、响应超限、工作区尝试改 endpoint、授权缺失、日志检查。
- 最后选用户认可的实际云端 endpoint 和模型做一次有预算的联调；假传输测试不证明供应商兼容。

未来拟提供 typecheck、unit 和 extension-host integration 脚本；当前目录不存在这些脚本，不宣称检查已通过。

## 11. 交付、回滚与架构批准

本项目无既有实现或数据迁移。后续交付为 VSIX，安装不修改项目代码或语言服务配置；停用扩展即可恢复原生 Hover。提供清除密钥和授权命令，进程退出即清空内存缓存；卸载前可先清除凭证。

Gate B 提案：选择方案 A，接受原文保留、并发采集窗口可能漏译和语言服务卡住时降级的边界；先验证第 10.1 节门槛，再扩大实现。门槛未通过则返回设计，不转用未批准的内部 API。

用户于 2026-10-30 明确批准方案 A，并要求创建 Git 仓库和实施，Gate B 已通过。实施后进入 Phase 6 独立代码审查及 Gate C；审查产生的改动须按技能要求确认处置后执行。
