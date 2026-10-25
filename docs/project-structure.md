# 项目结构

项目是一个 npm 包内的模块化单体。领域层不访问 React、Express、网络或文件系统；基础设施实现本地 Ollama、FunASR、归档和进程边界。

## 目录

```text
src/
  features/
    workspace/       单一 reducer/controller、历史和 V2 持久化
    capture/         捕捉状态机、MediaRecorder、AudioWorklet/PCM adapters
    mind-map/        思路桌面、React Flow 画布、思考工具、联系线索、节点编辑和导出
    runtime/         同源 API client 与前端响应二次校验
  lib/               确定性布局、音频采样和画布转换
  styles/            tokens、base、workspace、canvas、capture、activity

server/
  modules/
    ai/              prompt compiler、ChangeSet application service
    transcription/   完整文件转写 application service
    capture-journal/ CaptureRecord 状态与恢复日志
  infrastructure/
    ai/              Ollama provider、JSON Schema、一次修复和错误归一化
    files/           成功录音归档与转写日志
  routes/             严格 HTTP contract
  runtime/            当前实例安全关闭

shared/
  mind-map/           唯一规范领域模型、commands、guard、apply、selectors
  capture/            CaptureRecord HTTP contract
  runtime/            GET /api/status contract

scripts/
  runtime-supervisor.mjs   开发/生产共用端口、spawn 和 manifest
  runtime-diagnostics.mjs  启动器与 doctor 共用诊断
```

## Mind map 协议

唯一正式文档是 `MindMapDocument`：

```ts
{
  schemaVersion: 2
  revision: number
  title: string
  root: MindMapNode
  relations: MindMapRelation[]
  groups: MindMapGroup[]
}
```

所有节点必须有 `source: user | summary | inference`。类型全部从 Zod schema 推导；schema 使用 strict object，拒绝未知字段、旧 `ai` source、snake_case 命令和历史别名。

AI 只能返回：

```ts
{
  baseRevision: number
  summary: string
  commands: MindMapCommand[]
  navigation?: { nodeId: string; reason: string; nextStep: string }[]
}
```

命令为 `replaceDocument`、`addNode`、`updateNode`、`moveNode`、`deleteNode`、`upsertRelation`、`deleteRelation`、`upsertGroup`、`deleteGroup`。应用顺序固定：请求校验 → prompt → AI unknown → ChangeSet 校验 → policy guard → 纯函数 apply → 完整文档/响应二次校验 → revision + 1。

`navigation` 是最多三个建议入口，使用共享 strict Zod schema 校验；服务端在命令应用后移除不存在的节点引用。它随工作区持久化和 undo/redo，而不写入正式导图节点。没有导航的旧响应仍可读取。换切入点可以只更新导航，不必生成节点或提高文档 revision。联系仍使用规范 `relations`，`label` 解释联系，`dashed` 表示推测。画布的局部高亮与普通分支折叠不修改领域文档。

`thinking-desk.tsx` 是默认阅读视图，`thinking-desk-memory.ts` 在 App 中保存页面内的查找词、入口选择和滚动位置，`thinking-tools.ts` 保存三种快捷分析指令与推荐的展示筛选。已完成或暂放的子树仅从当前推荐中隐藏，不删导航原数据。状态修改复用规范 `updateNode`，但不会把 AI 内容来源改为 `user`。所有分析按钮仍经过原有后端验证管线。阅读视角、查找词和入口切换只在本次页面内保留。

guard 禁止未授权整图替换、删除根、循环父子、重复 ID、悬空 relation/group、过量节点、自动批量删除独有用户事实和一次删除超过半数节点。目标 ID 只能精确匹配。

## API

- `GET /api/status`
- `POST /api/mind-map/change`
- `POST /api/transcription/file`
- `WS /api/transcription/stream`
- `POST /api/transcription/archive`
- `GET /api/captures/pending`
- `POST /api/captures/:id/organized`
- `POST /api/runtime/shutdown`

所有 JSON 请求与响应都使用共享 Zod contract；浏览器再次校验响应。项目不保留 V1 endpoint。

取消整理时，HTTP route 监听客户端断开并把 AbortSignal 传到 service/provider；后续修复和重试不会在已取消的请求上继续。失败重试使用控制器内保存的原请求上下文，与尚未提交的新草稿分开。

## 语音安全边界

- 浏览器 WebSocket 只连接同源 `/api/transcription/stream`。
- 本地 Node 代理才连接 FunASR；上游握手前最多缓存 512 KB PCM。
- 浏览器也在同源 WebSocket 建立前缓存最多 512 KB PCM，避免开头丢帧；停止采集后才发送 end。
- 实时片段在代理内分为已确认文本和当前 online 文本，offline 修正替换当前片段。end 使用唯一 wav_name 和零长度上游二进制 flush，只有标记匹配的 final 带 `complete:true`，避免分段结果被误认成整段结束。
- 实时 PCM 不进入 ffmpeg。
- 实时失败或 8 秒内没有完整结束确认时，复用已录制完整 Blob 进入 HTTP 文件转写；普通分段 final 不会取消这条回退保障。
- 只有识别成功的录音写入 `outputs/`；失败只进入 `.runtime` 捕捉日志。
- AudioWorklet 优先采集 PCM，浏览器不支持时使用 ScriptProcessor 回退。

## 运行时

生产使用一个 Node 进程托管 `dist`、HTTP API 和 WebSocket，不启动 Vite。supervisor 另外管理 HTTP ASR、实时 ASR 两个 Python 进程。开发模式复用同一端口、环境变量、manifest 和诊断库，再启动 Vite。

AI 推理通过本机 `127.0.0.1:11434` 的 Ollama API 完成。启动器在 Ollama 未运行时打开 Ollama.app，但不会在关闭工作区时强制退出 Ollama，因为它可能同时服务其他本地应用。

`.runtime-pids.json` 当前版本为 4，记录 runtimeId、模式、项目根目录、端口、健康地址和受管进程。关闭时会核对 runtimeId、绝对项目目录、命令标识和监听端口；启动新版时会安全关停同项目的旧 manifest 实例。

## 可选在线 AI

`server/infrastructure/ai/api-change-provider.ts` 提供独立的 HTTPS 在线模型接入；`server/config/env.ts` 解析本地与在线两组配置，`server/index.ts` 选择 provider。`shared/runtime/schema.ts` 和状态路由仅返回服务类型、模型名称及就绪状态，不返回 API 密钥。启动脚本按 provider 决定是否检查 Ollama。
