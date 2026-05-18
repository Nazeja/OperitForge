# OperitForge

Nazeja 的 Operit 插件仓库。

## 插件列表

### 洛玑表情包渲染器（Loki Sticker Renderer）

让 AI 在普通聊天中通过 `<meme>表情名</meme>` 或 `<sticker>表情名</sticker>` 发送 user 可见的表情包。

- 支持本地表情包目录扫描
- 支持外链表情包，AI 只输出表情名即可
- 支持分角色配置本地目录和外链列表
- 支持自动注入 system prompt
- 本地与外链重名时本地优先，外链自动使用 `EL-` 前缀

📁 源码与说明：[./packages/loki-sticker-renderer](https://github.com/Nazeja/OperitForge/tree/main/packages/loki-sticker-renderer)  
📦 最新 Release：[洛玑表情包渲染器 v0.7.2](https://github.com/Nazeja/OperitForge/releases/tag/package-com-loki-sticker-renderer-v0.7.2)

### 沉浸式双语折叠渲染器（Bilingual Fold）

让 AI 在普通聊天中通过 `原文+<fold>译文</fold>` 的格式输出双语，插件将译文在前端渲染为可折叠和展开的按钮，为双语对话增加沉浸感。
- 点击折叠按钮展开译文
- 点击译文恢复折叠状态

- 支持本地表情包目录扫描
- 支持外链表情包，AI 只输出表情名即可
- 支持分角色配置本地目录和外链列表
- 支持自动注入 system prompt
- 本地与外链重名时本地优先，外链自动使用 `EL-` 前缀

📁 源码与说明：[./packages/bilingual-fold](https://github.com/Nazeja/OperitForge/tree/main/packages/bilingual-fold)  
📦 最新 Release：[双语折叠 v0.1.0](https://github.com/Nazeja/OperitForge/releases/tag/package-com-operit-bilingual-fold-v0.1.0)
