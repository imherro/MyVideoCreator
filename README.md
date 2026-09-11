# 映序 · MyVideoCreator

个人 AI 视频创作 Web 工作室。浏览器编辑项目，有显卡的主机运行模型与持久化队列。团队协作不在当前范围内。

## 运行

Windows，Python 3.11+ 与 Node.js 20+：

```powershell
.\Install-Studio.ps1
.\Start-Studio.cmd
```

主机打开 http://127.0.0.1:7868，首次由用户设置工作室密码。其他电脑访问 `http://主机局域网IP:7868` 并使用同一密码登录。主机需要保持运行；关闭浏览器不会中断队列。远程访问可使用已有私人组网，或者配置 HTTPS 反向代理；不要将未受保护的推理引擎直接暴露到公网。

当前主机的局域网地址在首次开发检查时为 `192.168.2.100`，可能随网络改变。程序不会自行修改防火墙。允许 Python 入站访问时限定到需要的私人网络。

前后端同源，所有浏览器请求均使用相对 `/api` 地址。媒体文件通过认证后的 HTTP 接口读取，支持视频范围请求。

## 创作

1. 创建剧本节点，选择本地 GGUF，输入故事并生成。
2. 点击“继续拆解分镜”，生成后导入分镜表。
3. 按镜头建立图像和视频节点，连接参考图，选择本地图像/视频服务。
4. 生成结果自动关联到节点；历史生成可切换版本。
5. 点击“剪辑”进入 Twick 多轨工作区，生成初剪后继续精剪并导出 MP4。

## 多轨剪辑与导出

剪辑工作区直接使用当前项目的素材库，不复制媒体文件。视频、图片和音频片段始终保存原项目 `assetId`；重新打开项目或更换访问主机后会用该 ID 恢复当前素材 URL。

- 支持多轨视频、图片叠加和多轨音频，以及拖动、trim、split、片段重叠、吸附、撤销和重做。
- 工具栏可增加视频轨、音频轨和标题，并将项目中的 SRT 导入为可逐条编辑的字幕轨。
- 右侧属性可设置时间、素材入点、速度、音量、音量关键帧、音画淡入淡出、位置、尺寸、旋转、透明度、滤镜、转场和同类型素材替换。
- 快捷键：`S` 在播放头切分，`Ctrl/Cmd+D` 复制；Twick 原生支持 `Delete`、`Ctrl/Cmd+Z` 与重做。
- “生成初剪”按分镜顺序建立 V1，并保留镜头、节点和素材关联；已有背景音乐会进入独立音轨。
- 左侧素材点 `+` 或双击会顺序追加到对应轨道；拖到轨道则从当前播放头加入。`V` 是视频/图片轨，`A` 是音频轨，`T` 是标题轨，画面轨越靠上越覆盖下层。
- “空视频轨”只用于新建叠加层，不会自动加入素材；误建的空轨可用“清理空轨”一次删除。

剪辑工程保存在 `Project.document.editor.timeline`。编辑器中的“导出工程”和导出面板都会优先提交该工程；没有编辑工程时继续使用原 `Clip[]` 导出。高级导出由 `backend/editor_renderer.py` 编译为 native FFmpeg filter graph，支持多轨合成、图片 overlay、交叉淡化、标题/字幕、静态 transform、滤镜、多路音频、音量关键帧及淡入淡出。导出仍运行在原持久化任务队列中，保留进度、取消、服务重启恢复和成片素材登记。

## 构图工具

- 宫格：按分镜排列镜头图，支持两列/三列、分页和带描述的 PNG 图板导出。
- 全景：素材库中的全景构图可浏览等距柱状全景图，保存指定视角为普通参考图。
- 3D 导演台：添加角色与物体占位，调整位置、大小、朝向，保存多个机位；截图后创建带构图参考的图像节点。场景随项目保存，截图隐藏辅助网格与选中高亮。

## 默认模型与独立推理

按用户指定，默认使用：

- 生文：Qwen3.8-27B-Uncensored-noMTP-Q4_K_M.gguf。
- 生图：Flux 2 Klein Base 9B INT8，加载 Flux_Klein_9B_NSFW.safetensors，默认强度 1。
- 生视频：MiniMax-H3-FL2VA-pruned_rank8_int8_convrot.safetensors，文本编码器暂用已有 qwen3vl-32B-MiniMax-H3-Q2_K.gguf。Q4_K_M 暂不下载。

推理代码位于 `inference/engine`，独立 Python 环境位于 `.inference-env`，权重位于 `inference/engine/ckpts`，LoRA 位于 `inference/engine/loras`。运行时不需要 TestMaestro 的代码、环境或服务。工作室自动启动只监听本机的 7870 推理服务；其他电脑只访问工作室 7868 端口。

内置推理基于 Maestro / WanGP，按用户声明用于个人非商业学习。来源、许可和改动见 `inference/NOTICE.md` 与 `inference/engine/LICENSE.txt`，第三方组件保留原许可证。大权重通过 NTFS 硬链接导入本项目，删除原文件路径不影响本项目；它不是指向原目录的快捷方式或符号链接。不要原地修改权重文件内容；替换权重时使用新文件。

`Install-Studio.ps1` 仅安装 Web 前后端依赖并构建页面，不下载模型，也不新建 GPU 推理环境。当前机器已具备独立推理环境；迁移到新机器后仍需重新创建匹配的 Python/CUDA 环境，不能直接假定复制的 venv 可移植。

首次迁移使用 `scripts/import_local_engine.py`；它只用于一次性导入，日常运行不调用它。模型环境已在本机导入，软件备份应包含独立环境、推理目录及工作室 data。

此外保留 ComfyUI API 工作流、OpenAI 兼容图文和异步 JSON 视频网关。MiniMax Hailuo 2.3 已有原生视频适配器：支持 768P 的 6/10 秒文生视频或单首帧图生视频，以及 1080P 的 6 秒模式；首帧为 JPEG、PNG 或 WebP，短边大于 300px、文件小于 20MB。该适配器在任务提交后保存供应商任务编号，服务中断可恢复查询而不重复提交；供应商实际账号验收仍需使用者配置密钥后完成。其余厂商原生 API 尚未全面接入。云端任务必须显式选择允许调用，本地失败不会自动切换云端。

Replicate 模型平台也可作为云端服务添加。它能运行平台提供的官方模型，例如 Seedance、Kling、Veo、Flux、Imagen，以及填写 `owner/model:版本 ID` 的社区模型。每个服务配置选择一种用途并填写该模型的输入 JSON；`{{prompt}}`、`{{system_prompt}}`、`{{target_duration}}`、`{{image}}` 和 `{{images}}` 会在提交时替换。参考素材会作为 data URI 发送给该云端服务。Replicate 的输入和输出字段随模型而异，请在模型 API 页面核对输入模板与计费；取消按钮会同时请求取消远端 prediction。真实账号调用尚未在本机验收。

火山方舟作为统一 Provider 接入：在“模型与服务”中点击“添加火山方舟”，保存一次 ARK API Key，再点击“保存并验证 Key”。服务端通过方舟 `/models` 验证 Key 并读取模型目录，不提交生成任务；验证成功后，文本、图片和视频模型均可从目录选择，也可手动填写自定义接入点 ID。每类模型旁的“检测”用于确认所选 ID 是否出现在方舟目录中，不产生图片或视频费用；目录存在不代表账号已经开通该模型，实际权限以首次生成结果为准。默认地址为 `https://ark.cn-beijing.volces.com/api/v3`。文本与分镜复用 OpenAI-compatible `/chat/completions`；Seedream 文生图及单张/多张参考图调用 `/images/generations`，参考图由服务端从当前项目素材库读取并转换为 data URI；Seedance 文生视频、单首帧图生视频及首尾帧视频调用 `/contents/generations/tasks`，首尾帧分别以 `first_frame` / `last_frame` 角色发送，task id 会立即持久化，服务中断后只恢复查询原任务。媒体结果仍下载并登记到当前项目素材库。浏览器读取配置时只获得 `api_key_set`，不会取得完整 Key。当前尚不向 Seedance 发送一般参考图、参考音频或参考视频。

## 项目 Schema 与默认模型策略

项目文档现在带有 `schemaVersion`。旧项目和历史版本在读取时通过纯函数迁移到当前内存结构；历史 JSON 不会被后台改写，只有用户正常保存当前项目时才持久化当前 Schema。Phase 0 已预留并行的 `filmBible.visual/continuity/style/story` 结构，尚未开始生成视觉卡片或改变分镜协议。

“我的项目”面板可分别设置项目默认文本、图片和视频 Provider/Model。解析顺序为“节点显式覆盖 → 项目默认 → 现有系统回退”；继承结果不会被写回成节点覆盖。新建项目在已经配置火山方舟时默认选择该服务的三类模型；迁移后的旧项目保持三个空策略，继续使用原有回退。Provider 被删除后配置会保留并显示失效，生成解析不会静默切换到其他收费服务。项目文档只保存 Provider ID 和 Model ID，不保存 API Key。

## 数据与队列

`data/studio.sqlite` 保存项目、历史版本、任务和模型服务设置；`data/assets` 保存原始素材和生成结果。`data` 不进入 Git，备份时包含整个目录。API Key 仅在服务端保存，设置接口不回传密钥内容。配置文件与数据库需要按照本机用户权限保护。

素材同时具有两个独立维度：`kind` 表示图片、视频、音频或字幕，`category` 表示角色、场景、道具、分镜、音乐、音效、人声、参考或其他；`source` 记录上传或系统生成。旧素材启动后无损迁移为 `category=other`、`source=uploaded`，文件仍保持 `data/assets/asset-uuid.ext`，分类变化不会移动或修改文件。素材库可组合筛选媒体类型与业务分类，上传时可指定分类，已有素材可直接重新归类。系统生成器可以通过任务上下文指定分类，为 Film Bible 的角色、场景和道具参考图预留接口。

生成任务固化输入及服务配置；提交 ID 防止重复提交。当前单 worker 串行调度 GPU。取消状态不能被迟到的成功结果覆盖。服务重启将原运行任务标记为“待恢复”。已取得 Maestro、ComfyUI 或视频网关任务编号时，可点击“恢复查询已有任务”，沿用提交时的服务配置查询和取回结果；没有编号时必须先核对上游状态，不自动重新提交。

FFmpeg 优先使用配置路径或系统 PATH，也能发现本项目独立推理环境中的 imageio-ffmpeg 可执行程序。合成统一为 24fps、H.264/AAC。legacy 时间线和新的 Twick 多轨工程均可导出；素材范围会在渲染前校验，跨项目素材 ID 会被拒绝。

## 开发与验证

```powershell
python -m uvicorn backend.app:app --host 127.0.0.1 --port 7868
npm run dev
npm run build
npm test
python -m pytest -q
```

开发浏览器使用 Vite 的 5178 端口，其 `/api` 代理到 7868；生产使用后端直接服务 `dist`。测试使用独立临时数据库，不设置实际工作室密码。

完整设计与研究边界见 [DESIGN_RESEARCH.md](DESIGN_RESEARCH.md)。开发中状态与未验收项见 [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)。
