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
5. 从素材库加入时间线，排序、裁剪、添加独立配乐，导出 MP4。

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

## 数据与队列

`data/studio.sqlite` 保存项目、历史版本、任务和模型服务设置；`data/assets` 保存原始素材和生成结果。`data` 不进入 Git，备份时包含整个目录。API Key 仅在服务端保存，设置接口不回传密钥内容。配置文件与数据库需要按照本机用户权限保护。

生成任务固化输入及服务配置；提交 ID 防止重复提交。当前单 worker 串行调度 GPU。取消状态不能被迟到的成功结果覆盖。服务重启将原运行任务标记为“待恢复”。已取得 Maestro、ComfyUI 或视频网关任务编号时，可点击“恢复查询已有任务”，沿用提交时的服务配置查询和取回结果；没有编号时必须先核对上游状态，不自动重新提交。

FFmpeg 优先使用配置路径或系统 PATH，也能发现本项目独立推理环境中的 imageio-ffmpeg 可执行程序。合成统一为 24fps、H.264/AAC，保留片段原声，支持配乐混音、SRT 字幕烧录、淡入淡出及横竖版导出。时间线按素材实际时长裁剪，超出范围会提示修正。

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
