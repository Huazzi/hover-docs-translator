# 原生原文区的控制边界

核实日期：2026-11-01。用户建议删除顶部译文标题，并将尾部重复原文标为“完整原文”，优先探索直接隐藏原文。

后续探索更新：已通过Proposal独占provider和实验查询命令验证有条件接管路线，支持单份逐段中英对照及仅中文；详见 [实测报告](hover-takeover-research.md)。下文公共稳定API限制仍成立，不再将实验路线视为未经验证的猜测。

## 结论

- 删除我们自己生成的标题可直接实现；0.2.1 移除 `hoverMarkdown` 的固定“中文说明”前缀，保留预算不足提示与源文档小节标题。
- 原生原文由 Pylance / JavaScript 服务等提供者贡献，VS Code 将它们与翻译提供者内容合并，并非本插件为了回退再复制整份原文。
- 公共 HoverProvider 接口只能贡献自己的结果，不提供修改其他提供者内容、取消它们的展示或设置最终相邻位置的入口。
- 编辑器实现先并发采集、按结果到达展示，再按 provider ordinal 排列。完成时间不等于最终显示顺序。用户当前看到中文在前、原文在后是可能的，但不能把它当作公共接口保证。
- 因此不能可靠地给其他提供者的原生块加“完整原文”标题；把这行文字塞在本插件结果尾部，遇到反向排列、多提供者、其他说明块时会产生悬空或错误标签。
- 中英对照模式中本插件自行输出的原文仍使用“原文：”/“原文表格”标签，它和无法控制的原生原文是两种不同来源。

## 可选路线

继续采用公共API的原生悬停路线：保留原生原文，尽量减少插件区的装饰与重复，当前推荐。

独立中文阅读面板/视图：可完全控制中英内容和折叠，但属于另一阅读入口，不能等同于消除原生悬停中的英文。

若必须改变原生悬停合并行为，需要进一步评估私有机制、编辑器改造或语言服务集成；本次没有验证其可发布性与跨版本可靠性，也不将其承诺为普通扩展的受支持能力。

## 一手来源

- [Hover / HoverProvider 公共 API](https://code.visualstudio.com/api/references/vscode-api#HoverProvider)：同位置多个Hover由编辑器合并，扩展返回自身Hover与range。
- [getHover.ts](https://github.com/microsoft/vscode/blob/main/src/vs/editor/contrib/hover/browser/getHover.ts)：`getHoverProviderResultsAsAsyncIterable` 并发执行provider并保留ordinal。
- [markdownHoverParticipant.ts](https://github.com/microsoft/vscode/blob/main/src/vs/editor/contrib/hover/browser/markdownHoverParticipant.ts)：`_renderHoverParts` 按ordinal排序并分别渲染各内容块。

来源为核实日期获取的main实现，内部实现不是插件兼容承诺。0.2.1不调用这些私有接口。
