# 原生Hover接管原型（研究用，不是正式扩展）

目的：验证Proposal独占提供者能否采集普通语言服务原文并返回一份逐段中英对照。仅替换两个固定句子，不调用云模型，也不读取正式插件密钥。

仓库根目录运行：

```powershell
# 负例：未声明提案，预期注册失败
node docs/experiments/hover-takeover/run.mjs

# 隔离开发宿主，显式开启提案
node docs/experiments/hover-takeover/run.mjs --proposed

# 隔离普通扩展加载，非开发模式，仍显式开启提案
node docs/experiments/hover-takeover/run.mjs --installed
```

需要已有仓库依赖、本机VSCode及Python/Pylance扩展。默认VSCode路径 `D:\DevTools\VSCode\Code.exe`，可用环境变量 `VSCODE_EXECUTABLE` 覆盖。使用独立用户目录/扩展目录，只把本机Python相关扩展链接入实验目录。CDP端口9419，不能同时运行多份实验。

脚本会启动并关闭一个独立实验窗口。`--installed` 将解包实验扩展放入专用目录，断言ExtensionMode.Production；没有调用正式用户配置下的安装命令，没有修改全局argv.json，也没有Marketplace发布。

受控样例验证：Python/JS逐段对照和仅中文、DOM单份原文、自回调次数、并发、翻译失败回退、返回空导致原文消失、第三方普通/独占provider、decoration、补全/参数提示/定义，以及注销后恢复。

结果写入项目 `.vscode-test/takeover/` 或 `.vscode-test/takeover-installed/`；正式实验结论见 [研究报告](../../hover-takeover-research.md)，经过复核的证据在evidence目录。

不要把此原型当作生产译文管线：它没有通用AST译文重建、完整范围/元数据保真、网络请求和取消策略。
