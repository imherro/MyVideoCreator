# Phase 5 验收矩阵

更新：2026-09-12。

Phase 5 只实现 Visual Version 升级、影响分析、陈旧提示和 Generation Fingerprint。它不会创建图片或视频任务，也不会调用 Provider。

| 要求 | 实现 | 自动化证据 |
| --- | --- | --- |
| locked v1 派生 v2 | `forkLockedVisualVersion()` 创建新 ID、递增版本号、`parentVersionId=v1` 的 draft，并只更新 Card 的 `currentVersionId` | `film_bible_versioning.test.mjs` |
| v1 不可变 | 客户端不提供原地编辑；项目保存边界的 `validate_film_bible_transition()` 拒绝修改、覆盖或删除 locked/deprecated 版本 | 前端版本测试、Python 领域测试、API 绕过测试 |
| Shot 不自动升级 | fork 不改任何 `shot.assetBindings` | 前端与 API 分步 round-trip 测试 |
| 显式范围升级 | `upgradeVisualBindings()` 支持指定 Shot、scene、sequence，只替换同 Card 的绑定 | selected / scene / sequence 测试 |
| impacted-shot discovery | `discoverImpactedShots()` 比较每个 Shot 的同 Card 绑定与 `currentVersionId`，只返回旧绑定 | 精确列表及升级后列表测试 |
| stale 与旧媒体 | 显式升级或 style version 变化只给已有分镜节点写入 `stale` 和原因，保留 `assetId`、`resultJob` 与素材文件 | 前端测试、API 文件读取测试 |
| 重开自动对账 | 读取项目时 `reconcile_generation_staleness()` 用当前绑定、style、compiler、Provider/模型重算指纹；不匹配即提示 stale | compiler/provider/model 变化及 API reopen 测试 |
| 下游传播 | 视觉依赖陈旧会传播到该 Shot 的 image、video 和已生成图下游，不删除任何结果 | image→video 前端与 Python 测试 |
| Generation Fingerprint | 服务端以 canonical JSON 的 SHA-256 覆盖 Shot 变量、按语义顺序的绑定版本、style version、compiler version、resolved provider/model | deterministic 及逐依赖变化测试 |
| 结果 provenance | Compiler 把指纹冻结进 Job input；素材登记把同一指纹写入 Asset metadata 和 Job result；浏览器应用结果时持久化到节点 | compiler、asset registration、graph 回归测试 |
| deprecated 解析 | 已经锁定后再弃用的版本可继续为旧 Shot 编译，不能建立新绑定 | Reference Compiler 和绑定测试 |
| 无自动费用 | fork、impact、upgrade、stale 都是纯项目操作；API 分步测试验证 Job 数始终不变 | API round-trip 测试 |

数据迁移把 `Project.document.schemaVersion` 提升为 3，并为旧项目补充 `filmBible.styleVersion=1`。迁移只返回升级后的副本，不重写 SQLite 中的历史 revision。

明确保留到后续的接口边界：continuity state machine、相似度评分、区域身份控制、ControlNet、多视图板、自动参考板、Director Agent 和自动 Model Router。本阶段没有实现这些能力，也没有改动 Twick。
