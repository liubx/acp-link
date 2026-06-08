# HTTP API 文档

## POST /api/ask

通过 HTTP 直接与 agent 对话，返回 SSE（Server-Sent Events）流式响应。

### 地址

```
http://127.0.0.1:9800/api/ask
```

端口与 MCP Server 共用（默认 9800，可在 `config.toml` 的 `[mcp] port` 中修改）。

### 请求

**Content-Type**: `application/json`

```json
{
  "question": "你好",
  "session": "my-project"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| question | string | 是 | 提问内容 |
| session | string | 否 | 会话标识，相同 session 共享对话上下文（多轮对话）。不传则使用 `"default"` |

### 响应

**Content-Type**: `text/event-stream`

返回 SSE 流，每个事件格式为 `data: <JSON>\n\n`：

```
data: {"type":"text","content":"你"}
data: {"type":"text","content":"好！有什么可以帮你的？"}
data: {"type":"tool","content":"正在搜索..."}
data: {"type":"text","content":"搜索结果如下..."}
data: {"type":"done"}
```

| type | 说明 |
|---|---|
| text | 文本增量（agent 回复的一部分） |
| tool | 工具调用状态提示（如"正在搜索..."） |
| done | 流结束标记 |

### 错误响应

| HTTP 状态码 | 说明 |
|---|---|
| 400 | question 为空 |
| 500 | session 创建失败或 agent 调用失败 |
| 503 | ACP bridge 不可用 |

### 示例

**curl**:

```bash
curl -N -X POST http://127.0.0.1:9800/api/ask \
  -H "Content-Type: application/json" \
  -d '{"question":"今天天气怎么样","session":"test"}'
```

**JavaScript (fetch)**:

```javascript
const resp = await fetch('http://127.0.0.1:9800/api/ask', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ question: '你好', session: 'chat-1' })
});

const reader = resp.body.getReader();
const decoder = new TextDecoder();
let fullText = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const chunk = decoder.decode(value);
  for (const line of chunk.split('\n')) {
    if (line.startsWith('data: ')) {
      const event = JSON.parse(line.slice(6));
      if (event.type === 'text') fullText += event.content;
      if (event.type === 'done') console.log('完成:', fullText);
    }
  }
}
```

**Python**:

```python
import requests
import json

resp = requests.post(
    'http://127.0.0.1:9800/api/ask',
    json={'question': '你好', 'session': 'test'},
    stream=True
)

for line in resp.iter_lines():
    if line and line.startswith(b'data: '):
        event = json.loads(line[6:])
        if event['type'] == 'text':
            print(event['content'], end='', flush=True)
        elif event['type'] == 'done':
            print('\n--- done ---')
```

### 多轮对话

相同 `session` 的请求共享一个 agent session，支持多轮上下文：

```bash
# 第一轮
curl -N -X POST http://127.0.0.1:9800/api/ask \
  -d '{"question":"记住：我叫小明","session":"demo"}'

# 第二轮（同一 session，agent 记得上下文）
curl -N -X POST http://127.0.0.1:9800/api/ask \
  -d '{"question":"我叫什么名字？","session":"demo"}'
```

### 注意事项

- 响应是流式的，客户端需支持 SSE 或 chunked transfer
- agent 处理时间取决于任务复杂度（简单问答 2-5 秒，tool call 可能 10-60 秒）
- `session` 的生命周期跟 IM 消息的 session 独立，互不影响
- CORS 已开启（`Access-Control-Allow-Origin: *`），前端可直接调用
