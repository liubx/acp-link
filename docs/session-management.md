# 会话管理机制

本文档说明 acp-link 的消息路由、会话生命周期和流式输出行为。

---

## 1. 消息入口与 @路由

### 单聊（p2p）

所有消息直接通过，无需 @bot。

### 群聊（group）

群聊消息必须经过 @路由判断才会被处理：

| 场景 | 结果 | 活跃窗口操作 |
|------|------|-------------|
| @了 bot（可同时 @其他人） | ✅ 通过 | 记录/刷新窗口 |
| 只 @了其他人，没 @bot | ❌ 跳过 | **清除窗口** |
| 话题内未 @任何人，在活跃窗口内 | ✅ 免@ 通过 | 刷新窗口 |
| 话题内未 @任何人，不在活跃窗口 | ❌ 跳过 | — |
| 群顶层消息未 @bot | ❌ 跳过 | — |

### 免@ 机制

用户 @bot 后，同一话题内 **5 分钟**内的后续消息自动免@，无需重复 @bot。

- **窗口类型**：滑动窗口，每次免@通过后重置计时器
- **窗口粒度**：`{chat_id}:{sender_id}`，每个用户在每个群独立计时
- **清除条件**：用户 @了其他人但没 @bot → 主动清除窗口（视为切换对话对象）

### @占位符替换

飞书消息中的 `@_user_1` 等占位符会通过 mentions 列表替换为实际显示名，传给 agent 的是可读文本。

---

## 2. 会话生命周期

### 标识体系

```
message_id  →  topic_id (飞书话题)  →  session_id (ACP agent 会话)
```

三者通过 `SessionMap` 持久化到 `~/.acp-link/sessions.json`。

### 新会话创建（全量模式）

当用户首次 @bot 发消息时：

1. `reply_message("...")` — 创建飞书话题，获得 `thread_id`
2. `map_topic(message_id, thread_id)` — 持久化 message_id → topic_id 映射
3. `aggregate_topic()` — 从飞书 REST API 拉取话题内全部历史消息
4. 构建 `ContentBlocks`（文本 + 图片 + 文件 + 链接）
5. `bridge.new_session()` — 创建 ACP session
6. `session_map.insert(thread_id, session_id)` — 持久化 topic_id → session_id
7. `prompt_stream()` — 流式输出回复

### 增量追加（已有会话）

当用户在已有话题内继续回复时：

1. 通过 `root_id → topic_id → session_id` 查找已有会话
2. `load_session()`（首次加载后缓存到 `loaded_sessions`，后续跳过）
3. 只发送当前消息文本 + pending 附件（不重新聚合历史）
4. `prompt_stream()` — 流式输出回复

### 会话过期清理

- 每小时定时执行 `cleanup_expired`
- 超过 `session_retention` 天（默认 7 天）的 session 自动移除
- 同时清理资源文件（`data/`）、临时目录（`temp/`）、滚动日志

---

## 3. 消息类型处理

| 消息类型 | actionable | 处理方式 |
|---------|-----------|---------|
| 文本 | ✅ | 立即触发 ACP 处理 |
| 链接（飞书云文档 URL） | ✅ | 首次回复提示等待文字指令，后续作为 actionable |
| 图片 | ❌ | 存入 pending，等待文字指令 |
| 文件 | ❌ | 存入 pending，等待文字指令 |
| 音频/视频/表情包 | ❌ | 回复提示，不处理 |

### 附件暂存机制

图片和文件不会单独触发 agent 处理，而是暂存到 `pending_attachments`：

- 按 `thread_id` 或 `chat:{chat_id}` 分组存储
- 下一条文字消息到达时，附件随文字一起打包发给 agent
- **防重复**：仅当 session 已建立时才入队 pending；无 session 时首条文字会触发 `aggregate_topic` 从飞书拉全量历史（已包含附件）

---

## 4. 流式输出

agent 响应以流式 chunk 形式到达，实时更新飞书消息卡片：

- **节流间隔**：300ms（避免飞书 API 频率限制）
- **后台更新**：spawn 独立 task 执行消息更新，不阻塞 chunk 接收
- **防并发冲突**：上一次更新未完成时跳过本次，下次带上所有累积内容
- **工具调用提示**：agent 执行工具时显示 `...`
- **空响应**：流结束后无内容则显示 `(无响应)`

---

## 5. 中止机制

用户可以通过对 bot 回复消息添加 ❌ (CrossMark) 表情来中止当前处理：

1. 飞书 WS 收到 `im.message.reaction.created_v1` 事件
2. `message_id` 加入 `abort_set`
3. 流式循环每收到 chunk 时检查 `abort_set`
4. 命中后：
   - 追加 `⚠️ 已中止` 到回复内容
   - 发送 ACP `cancel` 通知 agent 停止发起新工具调用
   - 继续消费剩余 chunk（不立即 break，确保不丢数据）
5. 流结束后从 `abort_set` 移除

---

## 6. 进程池与路由

### 架构

- 默认 `pool_size=4` 个 kiro-cli 子进程
- 每个 worker 运行在独立线程的 `LocalSet` 内（ACP Client 是 `!Send`）
- 通过 `mpsc::channel` 接收命令，串行执行

### 路由策略

```
routing_key (= thread_id) → FNV-1a 64位稳定哈希 → mod pool_size → worker 索引
```

- 同一会话始终路由到同一 worker → session 级别串行一致性
- 不同会话分散到不同 worker → 跨会话并行处理

### 容错

- Worker 崩溃 → 双重检查 → 自动重启（10s 超时）→ 重试一次
- Keepalive：独立 worker 每 6 小时发送轻量 prompt，防止认证 token 过期

---

## 7. 持久化与容错

| 机制 | 说明 |
|------|------|
| SessionMap 原子写入 | 先写 `.tmp` 再 `rename`，防崩溃损坏 |
| 优雅关机 | SIGTERM / Ctrl+C → flush session 映射后退出 |
| WS 断线重连 | `listen()` 出错后 sleep 5s 自动重连 |
| SIGHUP 热重载 | 重新加载 `config.toml`（cron 任务等） |
| loaded_sessions 缓存 | 避免重复 `load_session` 调用 |
| 消息 ID 去重 | `seen_ids` 窗口防止 WS 重连后重复处理 |
| 资源文件 SHA256 去重 | `ResourceStore` 避免重复下载 |

---

## 8. 定时任务（Cron）

通过 `config.toml` 的 `[[cron]]` 配置块定义：

```toml
[[cron]]
name = "daily-report"
schedule = "0 9 * * *"
prompt = "生成今日工作报告"
chat_id = "oc_xxx"
```

- 独立 scheduler，支持 SIGHUP 热重载
- 执行时创建临时 session → 发送 prompt → 流式输出到指定群聊
- 与主消息处理共享 AcpBridge 进程池
