# MarkMind uTools 插件

MarkMind 是一个通过 OpenAI 兼容 `/v1/chat/completions` 接口处理选中内容和 AI 对话的 uTools 插件。

## 功能

- 四个入口：翻译、总结、解释、AI 对话。
- 翻译、总结、解释使用相同的上下输入/输出结构。
- 输入框支持 `Enter` 发送、`Shift + Enter` 换行。
- AI 对话支持会话管理。
- AI 对话支持助手层级：助手下管理多个话题，每个助手可设置名称和 Prompt。
- 翻译、总结、解释和每个对话话题都可选择自己的模型，并记住上次使用项。
- 支持图片和文本类文档附件；图片最多 3 张，需要在模型上标识为多模态。
- 支持多个 provider；每个 provider 可配置多个模型，并选择一个 provider/model 作为默认使用项。
- 支持从 `/v1/models` 或 `/models` 拉取模型列表。
- 支持流式请求、API Key 可为空、SSL 证书校验开关、直连/系统代理/自定义代理；新 provider 默认使用系统代理。

## 在 uTools 中调试

1. 打开 uTools 开发者工具。
2. 选择本目录下的 `plugin.json`。
3. 进入插件后打开“设置”，新增 provider。
4. API 地址必须填写完整的 `/v1/chat/completions` 地址，例如：

```text
https://api.example.com/v1/chat/completions
```

自定义代理支持 `http://host:port` 或 `https://host:port`。直连模式使用 Node 原生请求，不读取系统代理或环境代理。

## 附件说明

图片会按 OpenAI 兼容的 `image_url` 多模态消息发送。文本类文档会解析为文本上下文并随消息发送；当前轻量版本不解析 PDF、DOCX、PPTX、XLSX 等二进制文档格式。

## 本地检查

```bash
npm run check
```
