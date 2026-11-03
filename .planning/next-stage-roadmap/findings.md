# 已核验事实

- 当前HEAD87179c6，版本0.4.0，四种本地file语言Python/JS/Java/TS，加本地已保存Python.ipynb代码单元格；两种悬停路径。
- 已读README、verification、Java/TS既有规划、extension、settings、commands、diagnostics、experimental provider和scope。
- 实验接管2.5秒等待后返回原文，后台完成缓存，下次悬停使用；当前无逐请求的完成反馈。
- diagnostics只显示模式、错误或聚合活跃数；缺少当前上下文不翻译原因和阶段耗时。
- 配置向导依次写入endpoint/model/key/consent；没有连接测试或只读诊断报告命令。
- 模型调用stream=false，统一JSON段落协议和标记校验；缓存只在内存、目标固定简中。真实模型质量证据主要是用户以前的DeepSeek成功反馈。
- Java Javadoc command链接触发整片原样保留，已在0.4测试明确记录；属于当前保真策略，不是本轮新发现的缺陷。
- 0.4新增语言/Notebook真实测试记录来自macOS1.144；没有新增语言可见Hover DOM/截图断言；与旧Windows0.3测试证据需区分。
- 官方VSCode Hover/StatusBar/Proposed API文档已核验；后续不承诺单次Hover的流式原地更新，也不把实验包直接发布Marketplace。

## 用户方向

已答复：优先打磨悬浮翻译：等待体验、配置诊断、译文质量。

## 对标核验

- 固定上游commit bb50b0f4debe5464ffe99ede63c95e5456862bb7。
- 主代理独立读取TranslatableDocumentationTarget.kt：DocumentationResult.updates+MutableSharedFlow更新同一文档结果，属于JetBrains能力。
- 主代理独立读取OpenAiRequestConfig.kt：stream固定false；“反馈及时”不等于“流式请求”。
- 主代理独立读取PromptService.kt：文档与文本模板分开，可按模型取模板；未核实独立术语表模块，术语偏好是我们自己的候选。
- 来源与固定链接已写docs/next-stage-roadmap.md，外部内容仅为研究数据。

## 整合结论

三路探索完成。推荐0.5.0核心为状态与主动查看、本地诊断/固定样例测试、真实文档质量基线；复杂分块与自动刷新独立探索。暂缓泛化文本翻译、多服务、TTS/词典、持久历史与公开发行。

## 详细设计核验

- 主代理复读extension、两个provider、mode controller、discovery、coordinator、client、cache、settings/change、commands、security和现有测试入口。
- 官方showHover源码支持noAutoFocus，但原生无障碍行为和已开窗口重算不保证；本设计不假定后台自动刷新能力。
- 协调器reset目前默认同时清block/cooldown；新诊断设计明确拆开取消与解除阻断，保留冷却和频率。
- cache.set可能拒存超大条目，get会提升LRU，因此“请求完成”不能等同永久缓存可用；选择完成事实文案而非新缓存元数据层。
- 运行时URI仅用于归属，日志/复制报告排除完整URL、model、URI、secret键和所有内容。
- 现有test/integration/renderer.ts的CDP是隔离测试观察路径，不应进入生产判断Hover可见性。
- 再次读取上游固定DocumentationTarget及VSCode Hover/StatusBar官方文档；链接归档在详细设计与独立验证计划。源码滚动main行为后续必须对实际安装版本验证。
