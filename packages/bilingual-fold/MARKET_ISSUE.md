<!-- operit-market-json: {"type":"package","projectId":"com-operit-bilingual-fold","projectDisplayName":"双语折叠","projectDescription":"双语模式插件，在对话中支持<fold>译文</fold>标签，将译文渲染为可展开/收起的按钮，并配置自定义选项。适合双语 RP、外语学习、翻译对照阅读等场景。插件不自动注入提示词，只提供渲染与配置；内置双语提示词可手动复制到角色卡、世界书、用户偏好或 system prompt。","runtimePackageId":"com.operit.bilingual_fold","publisherLogin":"Nazeja","releaseTag":"package-com-operit-bilingual-fold-v0.1.0","assetName":"com.operit.bilingual_fold-0.1.0.toolpkg","downloadUrl":"https://github.com/Nazeja/OperitForge/releases/download/package-com-operit-bilingual-fold-v0.1.0/com.operit.bilingual_fold-0.1.0.toolpkg","sha256":"3991c3160baf9c23f7189333b27870e57c920ffea433bbbe92e9604fc2ec0c56","version":"0.1.0","displayName":"双语折叠","description":"双语模式插件，在对话中支持<fold>译文</fold>标签，将译文渲染为可展开/收起的按钮，并配置自定义选项。","sourceFileName":"com.operit.bilingual_fold-0.1.0.toolpkg"} -->
<!-- operit-parser-version: forge-v3 -->

## Package

# 双语折叠（Bilingual Fold）

双语模式插件，在对话中支持 `<fold>译文</fold>` 标签，将译文渲染为可展开/收起的按钮，并提供自定义选项。

适合：

- 双语 RP
- 外语学习
- 翻译对照阅读
- 想让原文保持原生气泡样式、译文按需展开的聊天场景

## 使用格式

```text
The rain had stopped, but the city still smelled like thunder.
<fold>雨已经停了，但整座城市仍然闻起来像雷声。</fold>
```

多行示例：

```text
He did not answer immediately.
For a moment, only the sea spoke between them.
<fold>他没有立刻回答。
有那么一瞬间，只有海在他们之间说话。</fold>
```

插件本身不限制语言方向，可以用于外文→中文、中文→英文，或其他双语场景。

## 主要功能

- 支持 `<fold>...</fold>` 标签折叠渲染译文。
- 原文保持 Operit 原生气泡样式。
- 折叠状态显示可点击按钮，展开后按钮原地替换为译文。
- 点击译文本身可再次收起。
- 支持输入栏菜单临时开启 / 关闭折叠渲染。
- 支持默认展开译文。
- 支持配置点击区域宽度：40% / 50% / 60% / 70% / 80%。
- 支持自定义折叠按钮样式，最多 16 字符。
- 内置双语模式提示词，可手动复制。
- 不自动注入提示词，保持低侵入。

## 下载

Release：
https://github.com/Nazeja/OperitForge/releases/tag/package-com-operit-bilingual-fold-v0.1.0

成品包：
https://github.com/Nazeja/OperitForge/releases/download/package-com-operit-bilingual-fold-v0.1.0/com.operit.bilingual_fold-0.1.0.toolpkg

SHA256：

```text
3991c3160baf9c23f7189333b27870e57c920ffea433bbbe92e9604fc2ec0c56
```

## 源码与说明

https://github.com/Nazeja/OperitForge/tree/main/packages/bilingual-fold

## 已知限制

- 输入栏“双语折叠”开关是临时运行状态，清后台或重启插件后会恢复默认开启。
- 插件只负责渲染 `<fold>` 标签，不会自动让模型输出双语内容。
- 如果模型把 `<fold>` 标签放进 Markdown 代码块，Operit 可能不会按 XML 标签渲染。
