# 微信 ClawBot (iLink) 接入指南

## 概述

acp-link 支持通过微信 iLink Bot API（ClawBot 协议）接入微信，将微信私聊消息桥接到 ACP 兼容的 AI Agent。

该实现参考了 [wechat-acp](https://github.com/formulahendry/wechat-acp) 项目的 iLink 协议。

## 功能特性

- ✅ QR 码扫码登录（终端显示二维码 URL）
- ✅ Token 持久化（重启无需重新扫码）
- ✅ Long-poll 消息轮询
- ✅ 文本消息收发
- ✅ 图片/文件/视频/语音 接收
- ✅ 图片/文件 上传发送
- ✅ CDN 媒体文件加解密（AES-128-ECB）
- ✅ 流式消息输出（GENERATING → FINISH）
- ✅ 自动重连 + session 过期重新登录
- ✅ 语音消息自动转文字

## 限制

- ⚠️ 仅支持私聊消息（群消息自动忽略）
- ⚠️ 不支持消息卡片（仅纯文本回复）
- ⚠️ 不支持 topic/thread 概念
- ⚠️ 不支持表情回复中止
- ⚠️ 暂未提供 MCP Tools

## 配置

在 `config.toml` 中声明 `[im.wechat]` 即可启用：

```toml
# 使用微信 ClawBot（与 [im.feishu] 互斥，只能选一个）
[im.wechat]

[backend]
cmd = "kiro-cli"
args = ["acp"]
```

无需填写任何字段。所有运行时数据自动存储在 `~/.acp-link/wechat/` 下。

## 多账号支持

支持多个微信账号同时接入同一个 agent：

- 首次启动时弹出 QR 码，扫码登录第一个账号
- 登录成功后，该实例开始轮询消息
- 每扫一个码自动新增一个实例，token 持久化到独立子目录
- 下次启动自动加载所有已登录的实例（无需重扫）
- 所有实例收到的消息统一汇入同一个 agent 处理管道
- 回复时自动路由到收到该用户消息的那个实例

## 首次启动

1. 启动 acp-link
2. 终端弹出 QR 码 URL，用微信扫码确认登录
3. 登录成功后 token 自动保存
4. 后续启动自动恢复所有已登录实例

## 存储结构

```
~/.acp-link/wechat/
└── tokens.json     # 所有账号信息（数组）
```

`tokens.json` 内容示例：
```json
[
  {
    "token": "bot_token_xxx",
    "base_url": "https://xxx.ilink.qq.com",
    "account_id": "bot_id_1",
    "user_id": "user_xxx",
    "sync_buf": "...",
    "saved_at": "2026-06-04T10:00:00Z"
  },
  { ... }
]
```

每扫一个码，自动追加到该文件。`sync_buf` 是消息轮询断点，确保重启后不重复收消息。

## 消息映射

| 微信消息类型 | acp-link 统一类型 | 说明 |
|---|---|---|
| 文本 | Text | 直接传递 |
| 图片 | Image | CDNMedia JSON 作为 image_key |
| 文件 | File | CDNMedia JSON 作为 file_key |
| 语音 | Text / Audio | 有转文字结果时优先用文字 |
| 视频 | Media | CDNMedia JSON 作为 file_key |

## 与飞书的差异

| 特性 | 飞书 | 微信 |
|---|---|---|
| 连接方式 | WebSocket 长连接 | HTTP Long-poll |
| 消息回复 | 卡片消息（富文本） | 纯文本 |
| 消息更新 | 更新卡片内容 | 相同 client_id 重发 |
| Topic/Thread | 支持 | 不支持（用 session_id 代替） |
| 表情中止 | 支持 (❌) | 不支持 |
| MCP Tools | feishu_send_file 等 | 暂无 |
| 认证方式 | App ID + Secret | QR 码扫码登录 |
