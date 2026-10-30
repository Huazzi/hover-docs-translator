# Independent Review

## Review Inputs

- Approved architecture: 用户明确批准方案 A 和实施，见 architecture.md Gate B。
- Diff reviewed: range 0feee48..efa82c234498cd78acff876a426ae22d3df0a383，三个只读审查进行中。
- Verification already run: 类型检查、15 单元测试、真实 Pylance/JS 扩展宿主、实际 DOM 异步展示与缓存、VSIX 打包。

## Scope and Coverage

- Review target: 上述 Git range 的全部改动，未由主代理预选文件或排除路径。
- Scope source: OCR delegate | native Git fallback | diff artifact fallback
- Reviewed paths:
- OCR-excluded paths:
- Rule groups:

## Reviewer Reports

- review_correctness：并发失败会缩短已有 Retry-After 冷却，P2/99。
- review_quality：段落被拆成独立文本片段且短句被跳过，P2/95；文档变化/关闭不主动取消排队或执行中的翻译消费者，P2/88。
- review_security：段落上下文缺失，P2/90（合并）；安全引用链接丢失，P2/100；裸签名被当作说明翻译，P2/95。未发现达到报告阈值的额外密钥、endpoint、重定向、日志或输出执行漏洞；不等于完整安全认证。

## Findings

| Severity | Confidence | Location | Finding | Proposed disposition |
| --- | --- | --- | --- | --- |
| P2 | 95 | src/content/markdownCodec.ts:36–52 | 按 Text 叶节点检测/翻译，Use `foo`. 等短句不翻译；条件返回文档丢失代码字面量上下文 | 恢复整段/单元格 + 受保护内联占位符的批准设计，严格校验并回填；补短句、条件返回、强调/链接测试 |
| P2 | 100 | src/content/markdownCodec.ts:20–25 | 移除定义并展开 linkReference，合法 Markdown 引用链接在译文丢失 | 先解析引用定义并只保留 HTTP(S) 目标，再清理和重构；补 identity round-trip 用例 |
| P2 | 95 | src/content/markdownCodec.ts:36–37 | calculateResult(first, second) 这种无说明裸签名被发送翻译 | 保守识别纯签名，直接跳过；补 JS/Python 无围栏签名用例 |
| P2 | 88 | src/hover/hoverDocumentProvider.ts:19–21,33–34 | 文档改变或关闭仅在结果返回后丢弃，没有主动取消消费者，旧文档仍可能排队后发送和计费 | 订阅对应文档变化/关闭并 abort，结束后 dispose；补排队/执行期间失效测试 |
| P2 | 99 | src/translation/translationCoordinator.ts:84 | 后到的 500/网络失败把已有 429 的 120 秒冷却覆盖为约 5 秒 | 同一配置代次保留 max(已有截止时间, 新截止时间)，补并发 429→500/timeout 测试 |

## Coverage Limits and Verification Gaps

- 未运行真实云端付费请求；requests/lodash 包矩阵与更多延迟/扩展组合尚未全量验证。详见 verification.md。
- 三位审查均成功使用 open-code-review-delegate：完整检查 OCR 选定的 24/24 路径，0 跳过；规则为默认、package、TypeScript/JavaScript、JSON。主代理未预先限制文件。
- OCR 排除 17 路径：unsupported_ext 为 .planning 三份变更文件、README、THIRD_PARTY_NOTICES、detailed-design、requirements、technical-proposal、verification；provider_directory 为 .vscode/launch.json；default_path 为 package-lock.json、两个 fixture、四份 unit 测试文件。这些不计入已审查范围；规范文档仅作为上下文参考。
- 审查代理执行只读内存复现（冷却、Markdown），未改变文件、未重新运行全部测试、未调用付费 API。主代理对照源码验证了对应路径，合并重复问题为 5 项。

## No-Finding Statements

- 

## Gate C Approval

- Proposed actions: 修复全部 5 项 P2，补有针对性的回归测试，重新执行类型检查/单测/必要集成与打包；实施的架构保持不变。
- User approval: pending；未对这些发现做任何代码修正。
- Approval timestamp: 未批准。
- Accepted residual risks: 真实云端供应商联调、第三方包矩阵及采集窗口漏译仍需后续验收；尚未被用户作为终态风险接受。
