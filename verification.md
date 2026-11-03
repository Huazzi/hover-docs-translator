# 首版验证记录

## 0.5.0 实施验证（2026-11-02，批准修复与打包）

此段为最新实施记录，下文保留历次版本证据。manifest和lockfile已升级0.5.0，产物为hover-docs-translator-0.5.0.vsix。

- 环境：Windows、VS Code1.144.0（2c33b50b16）、Microsoft Python2026.10.0、Pylance2026.4.1、Red Hat Java1.58.0与内置JS/TS服务，沿用隔离测试profile。
- typecheck、build通过，84个单元测试通过（含30例质量结构夹具、状态归属、配置诊断脱敏、固定样本单次确认/去重/取消、401/429及频率保护，以及两项命令层通知生命周期回归）。
- test:integration和test:takeover完整通过。新体验验证：原生光标处查看、阶段观察、缓存复用、接管后台完成不重开已关闭窗口、异步检查期间换光标不打开旧目标、真实诊断QuickPick内容可见。
- Java/TypeScript/Notebook两种模式的可见Hover断言通过，截图位于.vscode-test/language-ui-{java,typescript}-{false,true}.png、notebook-ui-{false,true}.png；新等待体验截图experience-{false,true}.png。原有三主题、Pylance/JS、语言范围、Notebook排队/执行/后台取消、权限和原文回退回归通过。
- 日志：.vscode-test/experience-unit.log、experience-stable.log、experience-takeover.log。截图/日志仅本机验证，不纳入安装包。
- 修正测试观察器只读取可见Hover；Java模拟失败后按新约定等待保留的冷却，不通过reset绕过保护。诊断QuickPick等待列表内容渲染而非仅标题。
- 三路只读审查：OCR24/24可审文件，追加7/7被排除测试/夹具。用户批准唯一P2修复：testing锁仅覆盖probe.run，结果通知不再持锁。成功/失败通知未关闭时可新测，在途仍去重，关闭旧通知不解锁新请求。两项新回归在旧实现失败、修复后通过。处置及精确范围见[审查记录](.planning/next-stage-roadmap/review.md)。未声称定点修复后又做过新一轮全量审查。
- 实际0.5.0 VSIX在Windows隔离profile分别安装，Production模式两次通过：无实验权限回退稳定；有权限接管后可恢复稳定。确认版本、Java/TS/JS激活、原文完整与四个新增命令注册。安装冒烟使用受控源文档，不等同于真实云端测试。结果位于.vscode-test/installed-0.5.0-{stable,proposed}/result.json。
- 修复后的验证为typecheck、84项单元、构建/打包与实际安装冒烟；上文两套完整语言/UI集成在本轮核心实现完成后执行并通过，未因仅通知锁修复而重复整套。
- 未执行真实云端API或语义评分，未改变提示词；[质量基线](docs/quality-baseline.md)将真实模型结果明确标为未评估。G4复杂分片与G5自动刷新未接入。未修改日常安装的扩展或用户API设置。

日期：2026-10-30；状态：独立审查完成，用户批准的 5 项修复已完成并回归验证。

## 环境

- Windows，本机 VS Code 1.144.0，构建 `2c33b50b16c472efe58357d1d2a8a5414bc23fbf`。
- Pylance 2026.4.1，Microsoft Python 2026.10.0；JavaScript 内置 JS/TS 语言服务。
- 隔离 `.vscode-test/user` 和 `.test-extensions` 目录；未修改用户日常 VS Code 配置、扩展或项目代码。

## 已验证

- 类型检查：`npm run typecheck` 通过。
- 单元测试：21 项通过，涵盖异步 RPC 重入、取消/超时后 gate 保持、迟到异常、AST 保护与安全重构、输出校验、endpoint 规范化、凭证绑定、授权撤回、缓存、共享任务取消、队列/速率、401 阻断及 HTTP 超限；新增完整段落占位符、短句、引用链接、裸签名、完整段落预算、并发冷却回归。
- 真实扩展宿主：JavaScript、Python 的本地函数和 Node EventEmitter / pathlib.Path 外部类取得非空原 Hover，原型 provider 调用次数为 2（外层 + 被隔离的自身回调）。
- 真实窗口 DOM：生产 Hover provider 使用假翻译传输，英文首先出现；2 秒后中文追加到同一个原生 Hover，英文仍保留；重复查询命中内容缓存。
- 安全配置：VS Code 拒绝将 machine scope 的 endpoint 写入 Workspace；用户 endpoint 不被工作区改写。
- 真实扩展宿主取消回归：文档修改、文档/标签关闭 × 排队、执行中共四种组合全部通过。排队的过期文档不会启动 HTTP，执行中的最后一个消费者被取消后会 Abort 请求。

## 独立审查及批准修复

三个只读审查检查了初版 OCR 选定的 24 个路径，合并为 5 项 P2，用户已明确批准全部修复。当前由主代理修复并补充针对性回归；未声称修复后的代码又经历了一轮完整独立审查。

1. 完整段落/标题/表格单元发送给模型；本地占位符保留代码、格式和链接结构，校验数量、标识和顺序。短句也能翻译。
2. 先按每个源 Markdown 文档解析引用链接定义，再清理不安全内容，合法 HTTP(S) 引用链接得到保留。
3. 可识别的 JS/Python 裸签名跳过翻译；有说明的正常句子继续翻译。
4. 对应文档修改、关闭和标签关闭触发消费者 Abort，事件监听在结束时释放。
5. 同一配置下冷却截止时间取既有值与新值的较大者，后到的 500/timeout 不再缩短 429 Retry-After。

## 运行过程中的调整

- 首次类型检查发现 VS Code Thenable 与 Promise 的边界类型、字符串字面量推断，已修正。
- 工作区设置安全用例最初尝试写入并再读回，VS Code 正确拒绝写入；调整为断言拒绝。
- 本地仓库没有远程 URL，VSCE 默认无法重写 README 相对链接；打包使用 no-rewrite-relative-links，不伪造远程仓库地址。
- Markdown 字符预算按完整段落/标题/表格单元选择前缀，代码和 inline code 由本地 AST 保留；没有把完整源文件发送到假翻译客户端。
- 修复回归首轮发现：关闭标签不保证立即触发 TextDocument 关闭。补充标签关闭事件后，排队/执行中的关闭回归均通过。

## 尚未验证或承诺的范围

- 未配置用户的真实云端 API Key，未进行任何付费翻译请求；具体供应商与模型的兼容性、延迟、译文语义质量仍需用户配置后验收。
- 外部类原型覆盖 Node/Python 标准库；requests/lodash 的真实第三方包矩阵尚未全部运行。
- 界面验证使用 2 秒假传输；并非 10 秒延迟、所有 Pylance 版本、所有其他 Hover 扩展组合都已验证。
- 原文采集期间并发新悬停可能本次只有英文，这是批准设计的已知边界；未声称消除该窗口。
- WSL/SSH/Dev Container、Notebook/Web/JSX 不在首版支持范围。

## 0.2.0 展示优化验证（2026-10-31）

- 用户已报告0.1.0真实安装、配置 deepseek-flash 后能看到译文；这是用户验收反馈，不是自动化供应商矩阵。
- `npm run typecheck`、30项单元测试、构建与VSIX打包通过。
- 最终源码的真实 VS Code 集成通过，日志 `.vscode-test/integration-0.2.0.log`（忽略提交）。
- 真实配置事件触发生产共用分发函数：进行中切显示方式不主动Abort、旧快照保持旧模式；下一次对照展示命中同一缓存，云请求计数为1。
- 改变模型仍失效并取消旧任务。单元测试覆盖全部非展示字段的混合变更、读取失败、401阻断与429冷却不可被显示切换清除。
- 原有文档修改/关闭 × 排队/执行四组回归继续通过。
- 在 Default Light Modern / Default Dark Modern / Default High Contrast 下，实际可见Hover宽度约408px，DOM确认H4中文章节、完整分组表格、原文引用；保存三张原生Hover截图于 `.vscode-test/display-*.png`。
- 新增真实 Pylance Google风格 docstring、JS JSDoc 样本，参数、返回值和异常说明均保留。单元覆盖嵌套列表、表格对齐、安全链接、模型注入、预算标记、代码与签名。
- 首轮主题测试误读隐藏旧Hover，测试改为选择可见窗口并等待主题刷新；没有通过修改产品代码规避断言。
- 尚未覆盖全部360/520/720px宽度、NumPy风格与所有第三方库组合；未在用户普通VS Code窗口中安装或修改配置，未发送付费云请求。
- 独立审查记录见 `.planning/hover-display-v2/review.md`。

## 0.2.1 标题移除（2026-11-01）

- 用户要求译文正文直接显示，删除本插件固定的“中文说明”标题；不删除源文档自己的小节标题，不改变翻译/安全/缓存路径。
- 本次为局部低风险显示修订，更新既有断言；typecheck、30项单元、完整真实VSCode集成均通过。
- 三主题可见DOM确认没有“中文说明”标题，对照表格/章节仍在；Python/JS样本、缓存分流与取消回归通过。日志 `.vscode-test/integration-0.2.1.log`。
- 原生原文不能通过公共Hover API可靠隐藏或加前缀，故未添加可能错位的“完整原文”。一手来源与备选路线记录在 `docs/hover-original-boundary.md`。
- 保留0.2.0安装包；没有修改用户的普通VSCode配置，也未进行付费云请求。

## 0.3.0 实验接管验证（2026-11-01）

- 保留稳定默认路径；新增自用 Proposed API 接管。运行环境为 Windows / VS Code1.144.0，Python/Pylance及内置JS/TS服务。
- `npm run typecheck`、36项单元测试、构建和VSIX打包通过。
- `npm run test:integration` 通过：原有三主题、Python/JS说明、排队/执行取消、显示快照和缓存检查；无实验API时实际选择接管自动回退稳定模式。日志 `.vscode-test/stable-030-integration.log`。
- `npm run test:takeover` 通过：Python/JS并发原文读取、单份原文→中文、签名/跳转保留、原生DOM计数与截图、中文阅读缓存复用。无配置/暂停/无权限/纯中文、HTTP/结构错误等返回原文；原文对象的特殊链接/legacy代码保持不变，译文Markdown不继承信任。
- 短等待用受控30ms预算验证：先原文，Hover token随后取消不终止受控后台任务；下次缓存命中、HTTP计数1。等待期取消仍终止请求；编辑/关闭/失效/dispose取消后台任务。原文失败或超时触发回退，合法空结果不误触发。
- 单元覆盖在途源请求去重、跨文档并发、超时draining容量、迟到拒绝、模式能力门禁/失败锁存/过期探测、AST结构与签名、不可安全重建内容、身份译文去重和设置无变化不重置401/429保护。
- `npm run test:installed` 将实际0.3.0 VSIX和只读探针安装到隔离目录，普通生产模式启动，无开发标志。未启用提案：原生+探针共2份Hover，稳定回退成功；显式启用：接管合并为1份，切稳定后恢复2份。两个结果文件位于 `.vscode-test/installed-030-{stable,proposed}/result.json`，日志 `.vscode-test/installed-030.log`。
- 原型与实装区别已验证：本轮测试实际安装VSIX，不只是手动放置解包目录。测试探针也用VSIX安装，以进入新版扩展注册表。
- 首轮测试发现并修正：getCommands只列内部后端名而非API别名；JS baseUri和Pylance不可见注释需要安全支持。测试脚本还修正了Electron环境变量必须删除（置空仍触发Node模式）的启动差异。
- 没有调用用户DeepSeek Key或付费API、没有更改常用VSCode设置。当前接管翻译集成使用受控假传输，用户真实模型延迟与质量需实际使用验收。
- 未承诺跨VSCode版本、所有库/扩展共存、原始多provider顺序、JS详细Hover展开、诊断内容消除、远程窗口或Web兼容。复杂标记片段保留英文是明确的保真回退。
- 独立审查记录位于 `.planning/hover-takeover/review.md`。

## 0.3.1 移除额外原文区块（2026-11-01）

- 按用户要求删除稳定模式中英对照额外生成的“原文：”引用区块，以及重复的原文标题/表格。利用语言服务已有原文对照；实验接管保留原文→中文配对，不添加原文标签。
- 本次为局部显示修订，不涉及请求、权限、缓存或注册流程变更；更新既有回归断言。
- 类型检查、36项单元测试、真实VSCode稳定模式与实验接管集成均通过。
- 三主题原生DOM确认没有额外原文标签/引用；受控样例表格为原语言服务1份+译文1份，不再第三次复制。Python/JS说明、缓存复用、取消和失败兜底回归通过。
- 集成日志：`.vscode-test/stable-031-integration.log`、`.vscode-test/takeover-031-integration.log`。安装冒烟使用独立031目录和0.3.1版本断言。
- 不修改用户常用VSCode配置，不调用真实云端API；保留旧版VSIX。

## 本地 Notebook Python 悬停支持（2026-11-01，审查已确认）

- 新增本地已保存 `.ipynb` / `jupyter-notebook` Python 代码单元格，覆盖稳定追加和实验接管。统一 selector 与运行时单元格归属校验；不放宽远程窗口、工作区信任、云端同意或密钥门禁。
- macOS / VS Code 1.144.0，使用内置 `vscode.ipynb` 和已安装 Python/Pylance。无需额外链接 Jupyter，无需运行单元格、选择 kernel 或调用付费 API 即取得本次样例的同单元格及跨单元格文档。
- `npm run typecheck`、36项单元测试、`npm run build` 通过。
- `npm run test:integration` 通过：Notebook 单独打开激活、真实单元格 selector、Python code cell 归属、Markdown/非 Python/untitled 排除、真实 Pylance 原文、稳定译文、签名、缓存复用、显示切换、拒绝权限不发请求、翻译错误原文保留；现有 Python/JavaScript、三主题 DOM、设置和取消回归通过。
- `npm run test:takeover` 通过：Notebook 真实递归原文和单份接管、中英对照/中文模式、缓存复用、权限/失败兜底；现有 Python/JavaScript 接管 UI 和生命周期回归通过。
- Notebook 生命周期覆盖：稳定/接管的排队及执行中请求，在编辑/删除当前单元格或关闭 Notebook 标签时取消；接管超时后台任务同样取消。另一个单元格的文本/metadata 更新不会误取消当前请求。
- 集成日志：`.vscode-test/notebook-stable.log`、`.vscode-test/notebook-takeover.log`。首次启动因 macOS 可执行文件名与预期不符失败，按实际安装修正为 `Contents/MacOS/Code` 后通过。隔离测试配置禁用扩展自动更新。
- 未执行 Windows 安装冒烟、真实云端模型质量/延迟验收或跨 VS Code 版本测试；本轮没有生成或安装新 VSIX。远程、untitled、自定义 Notebook 及其他单元格语言不在本次支持范围。

- 两位独立 OCR workspace 审查均为 No findings，各覆盖8/8代码文件，排除9项文档/规划/fixture路径，详见 `.planning/notebook-python-hover/review.md`。Notebook 本次为真实文档/provider API 全流程验证，未新增 Notebook 可见悬浮 UI 的 DOM/截图断言。用户已于2026-11-01接受审查结果及验证边界并批准最终收尾。

## 0.4.0 Java / TypeScript 与 Notebook 合并发布（2026-11-01）

- 在共享 file 语言范围及激活事件中加入 Java、TypeScript；保留已批准的 Python Notebook 支持。云端确认文案同步范围，接口、密钥、同意、缓存和请求生命周期沿用既有机制，无新增依赖。
- macOS / VS Code 1.144.0，真实 TypeScript 内置语言服务与 Red Hat Java 1.58.0（扩展自带 JRE 25.0.4.1）。不修改系统 JDK，不运行样例程序或 Notebook kernel，不调用用户真实云端 API。
- 类型检查、36项单元测试和构建通过；完整稳定/实验接管集成均通过。新增验证真实泛型 TypeScript 与 Java Javadoc 原文、实际 fenced 签名保留、受控中文译文、缓存/显示切换、权限拒绝与翻译失败保留原文，以及 TSX/JSX、Java Notebook 排除。
- Java 的 `@throws` 异常类型实际携带 `command:java.open.file` 链接。稳定模式翻译净化后的说明；实验模式保留含该链接的完整原文分片。另一个无此标记的参数/返回说明在实验模式正常翻译；没有放宽信任或 URL 白名单，也没有为测试删除复杂样例。
- Python/JavaScript 原有三主题可见 DOM、取消、设置及实验接管回归通过；Notebook 同单元格/跨单元格 Pylance、缓存、权限/失败兜底与15项排队/执行/后台取消场景通过。新增语言的测试为真实文档/provider API 全流程，没有新增其可见 Hover DOM/截图断言。
- 日志：`.vscode-test/release040-stable.log`、`.vscode-test/release040-takeover.log`。原文结构证据为 `.vscode-test/language-{java,typescript}-{false,true}.json`。首次 Java 测试因隔离扩展注册表未发现新链接失败，改为按版本暂存依赖后取得真实来源；签名断言改为比对真实 fenced 签名而非假定未限定类名的格式。
- 0.4.0 打包沿用自用 Proposed API VSIX。安装冒烟脚本从 manifest 读取版本、在 Windows/macOS 独立目录安装实际包，以 Production 模式和受控原文检查版本、激活、Java/TS 注册及提案门禁；它不代表真实 Java 语言服务或云端质量验收。产物审计、安装结果和 SHA256 记录在本次发布计划的 progress/review 中。
- 本机重新验证不覆盖 Windows、跨 VS Code 版本、真实云端翻译质量/延迟；TSX/JSX、jdt 虚拟源码、Java Notebook、远程及未保存 Notebook 不在本次支持范围。
