# Phase 3 / Phase 4 验收矩阵

更新：2026-09-11。

本文件记录当前实现与自动化证据。MyVideoCreator 仍拥有 Project、Asset、AI 工作流和任务队列；Twick 只承担浏览器剪辑内核和实时播放器。

## Phase 3 — 编辑能力

| 要求 | 当前实现 | 验收证据 |
| --- | --- | --- |
| split | 播放头切分，保留素材入点与关联 metadata | `EditorShortcuts.tsx`、`splitElement()`、前端 domain action tests |
| trim | 时间线拖拽 trim、属性面板精确长度与素材入点 | Twick editor + `setElementDuration()` / `setMediaSourceIn()` |
| multi-track / overlap | 可新增视频、音频轨；跨轨片段可重叠并按轨道顺序合成 | `EditorToolbar.tsx`、真实 FFmpeg 多轨测试 |
| transitions | 淡化和交叉淡化，保存来源、目标和时长 | `setTransition()`、真实红蓝中间混合帧测试 |
| text | 标题轨、文字内容、字号、颜色、位置、旋转和透明度 | `addTextElement()`、标题可见像素测试 |
| subtitles | 导入 SRT 为 caption track，保存逐条时间与内容 | `srt.ts`、SRT parser tests、真实字幕烧录测试 |
| image overlay | 图片可拖入轨道并调整位置、尺寸、旋转、透明度 | `assetAdapter.ts`、真实角落叠加像素测试 |
| audio volume | 视频原声与音频素材均可设置 0–200% 静态音量 | `setElementVolume()`、真实频谱静音/混音测试 |
| fade | 独立画面和音频淡入淡出；画面淡化同步 Twick 预览动画 | `setElementFade()`、compiler graph tests |
| snapping | 移动操作调用 Twick `snapTime`，吸附零点及所有片段边界 | `collectSnapTargets()` / `moveElement()` |
| keyboard shortcuts | S 切分、Ctrl/Cmd+D 复制；Delete、撤销和重做使用 Twick 原生能力 | `EditorShortcuts.tsx` |
| save / restore | `document.editor.timeline` 进入项目 revision 和 SQLite，素材 URL 按稳定 assetId 重绑定 | `TimelinePersistence`、API round-trip test、asset rebinding tests |
| AI initial edit | 分镜视频按 shot 顺序建立 V1，保留 shot/node/asset，加入原声和可选音乐轨 | `initialTimeline.ts` tests |

Twick 0.15.31 的播放器能实时播放媒体、静态音量、变换、颜色滤镜和画面淡化。该版本尚未解释自身的 transition metadata，也不支持音量关键帧实时试听；编辑器在对应控件旁明确标注，原生导出器会完整渲染这些设置。

## Phase 4 — 原生渲染器

```text
Project.document.editor.timeline
  → EditorRenderCompiler
  → one native FFmpeg filter graph
  → existing export job / progress / cancel / asset registration
```

| 要求 | 编译结果 | 验收证据 |
| --- | --- | --- |
| multi-track compositing | 背景加所有可见视频/图片轨，遵循 track/zIndex 顺序 | 真实底图 + overlay 输出测试 |
| overlay | scale/object-fit 后按 x/y 和 alpha overlay | 定点像素断言 |
| xfade | 目标画面预卷，来源淡出与目标 alpha 淡入 | 红、混合、蓝三时点解码断言 |
| text / subtitle | 标题和 caption 生成项目临时 ASS 并烧录 | 两类真实白色文字像素断言 |
| transform | x/y、width/height、rotation、opacity | filter graph 检查 + overlay 输出测试 |
| volume automation | 片段内关键帧线性插值，叠加静态音量和淡化 | 880Hz 三时点振幅断言 |
| music | 普通音频轨支持 trim、rate、loop、delay、volume、fade | AI 初剪测试 + 多路音频真实导出 |
| effects | 与 Twick 预览 ID 对齐的颜色滤镜编译到 FFmpeg | 全部公开滤镜逐项执行测试 |
| compatibility | 无 editor timeline 时继续走 legacy exporter | legacy 双镜、原声/BGM/SRT 测试 |
| validation | 拒绝跨项目素材、错误类型/范围/转场及无法兑现的第三方高级效果 | compiler rejection tests |

渲染器不信任浏览器传入的媒体 URL，只通过当前项目的 `assetId` 解析 `data/assets` 文件，因此没有第二套素材库，也不会接受跨项目引用。原 `document.timeline: Clip[]` 和 AI 生成链路保留。
