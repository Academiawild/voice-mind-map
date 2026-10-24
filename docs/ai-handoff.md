# AI 接手说明

## First Read

1. `AGENTS.md`
2. `README.md`
3. `docs/project-structure.md`
4. `docs/ai-handoff.md`

## 不可破坏的边界

- 只做 macOS 本地 Web MVP；不扩展账号、云同步、协作、桌面端或移动端。
- AI 地址必须是 loopback HTTP，不能把导图内容发送到远程模型。
- `shared/mind-map/*` 是最敏感的领域逻辑；所有 AI 输出必须先过 ChangeSet schema，再经过 guard/apply 和完整响应校验。
- 不得恢复 full-tree fallback、normalize、模糊标题寻址、旧 source/命令别名或 V1 endpoint。
- 浏览器只连接同源 `/api`，不得直连 FunASR。
- 实时 PCM 不得进入 ffmpeg；完整文件 HTTP 转写与实时 WebSocket 必须保持分离。
- 不要读取、迁移或删除旧 localStorage key；只使用 `voice-mind-map:workspace:v2`。

## AI 管线与提示词

提示词位于 `server/modules/ai/prompt/`，拆成六部分：

- `organizing.ts`：忠实整理、最小必要变更、去重与正文策略。
- `source.ts`：`user | summary | inference` 来源边界。
- `canvas.ts`：四向布局、order、relative placement 和 importance。
- `protocol.ts`：唯一 ChangeSet JSON 与九类命令。
- `modes.ts`：初始化、manual、live、batch、focused expansion。
- `compiler.ts`：当前文档的 compact context、选择、坐标和最近反馈。

Ollama provider 使用有限层级展开的 ChangeSet JSON Schema 约束本地生成：前三层节点要求完整字段和 source 枚举，relations/group/navigation 字段也有约束；更深节点仍允许生成并交给规范 Zod schema 验证。不要将递归 `$ref` 节点 schema 直接交给 Ollama grammar。provider 负责请求、一次低温修复和错误归一化，application service 负责 revision、policy、确定性应用、来源纠正和最终响应校验。模型原始 `unknown` 不能绕过 Zod。

## 前端状态

`src/features/workspace/reducer.ts` 是唯一正式工作区状态：document、captureSession、selection、activity、history、serviceStatus，以及不持久化的近期用户反馈。history 保存最多 30 个文档与位置快照。

- ASR partial 只进入 `captureSession.partialTranscript`。
- AI 响应同时检查 AbortController generation、当前 revision 和 ChangeSet baseRevision。
- HTTP 客户端断开通过 response close / request aborted 传播 AbortSignal 到 application service 和 Ollama fetch；每次修复或重试前后都检查取消，不把 abort 归一化成离线错误。
- undo/redo 会中止请求并递增 generation，因此旧响应不能覆盖撤销结果。
- V2 持久化包含正式文档、位置、视角、推测展开状态，以及新增的 navigation、savedInputs、draft、acknowledgedCaptureIds；缺失新字段的原 V2 数据使用空值默认。原话和已提交录音 ID 不进入 undo 历史。普通分支折叠是页面内 UI 状态。
- 画布面板、AI 更新和 undo 都不能自动 fitView；只有用户显式点击“显示全图”或切换主题总览时才调整视角。

## 捕捉与恢复

显式阶段为 `idle → requesting → recording → finalizing → transcribing/archiving → organizing → completed/failed`，允许实时和 HTTP fallback 两条路径。`CaptureJournalStore` 使用原子替换写 `.runtime/capture-journal-v2.json`；`recognized` 会出现在 pending，AI 成功提交后才标为 `organized`。

- 浏览器握手前缓存最多 512 KB PCM；停止时关闭 PCM 与 MediaRecorder 后发送 end，重复 stop 无效。初始化失败也释放麦克风轨道。
- `2pass-online` 是增量片段，`2pass-offline` 替换当前片段；已确认片段独立累计，不再将修正前后的文字拼接或用 contains 去掉真实重复。
- 代理给 end 控制附上唯一 wav_name，并向上游发送零长度二进制帧触发已有音频的 flush（本地 FunASR 对文本配置单独 continue）；只有匹配该标记的 final 才带 `complete:true`。排队中的分段 final 不能提前关闭整段录音。不要用固定延时或“收到任意 final”代替结束确认。
- 浏览器先安装 final waiter，再发送 end；最多等待 8 秒。断开、错误、没有 `complete:true` 或尚有未确认片段时走完整 Blob HTTP fallback。物理麦克风/噪声并不由自动化测试覆盖。
- `capture/recognized` 仅在草稿为空时填入转写；识别原文仍独立用于归档和整理，避免覆盖录音期间输入的另一份草稿。

## 思考导航

- 默认使用“思路”桌面，导图是可切换视角；两者共用正式文档。桌面给一个主要入口和可选入口，将自答（写入草稿）与 AI 推演（发起请求）分开。两者都追加而不覆盖草稿。
- `thinking-tools.ts` 的三个显式动作分别要求先后判断、跨主题联想和具体前提挑战；使用现有 `organize(..., { generated: true })` 管线，继承当前 selection，全图时显式传 null。
- `setNodeStatus` 使用现有 status 枚举，保留原始 source，支持历史和持久化。`activeThinkingEntries` 只隐藏 done/later 子树的推荐并按 nodeId 去重，不改变存储内容。
- 桌面查找覆盖嵌套节点标题和正文。`useThinkingDeskMemory` 在 App 内持有搜索词、所选切入点及按搜索词分别保存的滚动位置，切换视角不丢失；右栏按视角/选中节点记忆滚动。连线说明开关也由 App 持有。这些阅读状态不跨刷新持久化。
- 普通切换视角不触发 fitView；点击“显示全图”会切到导图并明确 fit。
- ChangeSet 新增可选 `navigation`（最多三项 nodeId/reason/nextStep）；必须经过共享 schema 验证。application service 按最终文档过滤不可定位的入口。
- 提示词要求具体节点、跨分支关系解释、可验证的推测与具体下一步，不强行给用户设定优先级。不能用硬编码关键词将个人材料强制归类。
- 右栏基于导航和文档 relations 渲染；点击入口显式展开祖先路径，选中节点只突出直接关系，不自动 fitView。
- `selectedNodeId:null` 明确表示全图分析，不能用 `??` 回落到当前 selection。
- 自动生成的导航指令不记作用户原话、不清空现有草稿。整理结果仅清空提交时的同一份草稿。
- 录音提交成功后，ack 失败只显示同步提示，不将已成功的整理改为失败。已提交 ID 持久化并在恢复时仅重试 ack，禁止再次调用 AI。当前不支持多标签页并发去重。
- 取消、手工语义修改和 undo/redo 会中止请求并传播到 Ollama HTTP 连接；离开 organizing 状态，保留草稿，忽略迟到响应，禁止取消后的修复/重试。
- 控制器保留当前失败的 organization attempt（原始 input、selectedNodeId、inputId、submittedDraft）或导入 File。重试沿用该记录，不重复保存原话，不清空后写草稿，不受后来 selection 变化影响；成功或本地语义修改后清除重试记录。
- 原始输入目前保存在浏览器，磁盘级文字归档和逐节点证据引用尚未实现，不宣称永久备份或逐句溯源。

## 运行时

- `scripts/runtime-supervisor.mjs` 是开发/生产共用实现。
- `scripts/runtime-diagnostics.mjs` 同时供启动器与 doctor 使用。
- 生产只有 `web-api`、`http-asr`、`realtime-asr` 三个受管进程，不运行 Vite。
- 开发增加 `frontend-dev`，API 和语音仍复用同一环境/manifest 规则。
- manifest 版本为 4；启动器会校验版本并安全关闭同项目的旧实例后再升级。旧 `outputs/` 保留但不重新索引。

## Required Checks

任何修改至少运行：

```sh
npm run lint
npm run format:check
npm run typecheck
```

行为、schema、服务或运行时变化还要运行：

```sh
npm test
npm run test:coverage
npm run test:integration
npm run test:python
npm run build
```

领域覆盖率阈值为 lines/statements/functions/branches 全部不低于 85%。Playwright E2E 位于 `e2e/`，包括空白文字生成、自动应用、撤销、161 节点 / 20 联系连续阅读切换，以及取消与重试。录音 hook 测试覆盖两分钟连续片段、迟到 final、断线、超时、握手缓存、重复停止和初始化失败；真实本地 ASR 长语音需另用合成音频复测。
