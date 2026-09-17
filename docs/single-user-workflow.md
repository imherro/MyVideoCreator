# 单人版策划与剧本流程

改编策划、剧本室不再提供提交审核、批准和退回修改操作。保存、AI 任务完成、进入下一步不会自动创建后续生成任务。

- 改编策划的“进入剧本”先保存当前策划，保存失败不跳转。
- 剧本室的“进入分镜规划”先保存当前剧本，正文为空或仍过期则提示修订。
- 剧本生成按故事核心、故事弧、改编策略、目标集字段和有效章节引用校验。其他集尚未完成不阻塞当前集。
- 有成片的分集仍受保护，不能被整部策划或剧本重新生成覆盖。
- 连续性上下文包含未过期的已保存前集剧本，并区分已拍摄剧本和仅有规划。
- 原著或规划变化仍使受影响的剧本过期；保留旧结果。未修改正文等字段的重复保存不清除过期状态，不增加剧本版本。

## 兼容约定

本次不批量重写旧项目、任务快照或数据库枚举。`draft`、`review`、`approved` 都可以代表可用的已保存内容；是否可继续由内容与 `stale` 状态共同判断，不能再仅用 `approved` 作为生成门槛。旧 review/approve API 暂留给旧客户端兼容，新界面不调用它们，也不需要开启任何审核设置。

后端统一检查入口为 `validate_script_generation_ready`，前端为 `sharedPlanningReady`、`episodePlanningReady` 和 `scriptReady`。前端检查用于引导，后端检查决定剧本任务是否能提交和写入结果。

验证：`tests/test_adaptation.py`、`tests/test_source_library.py`、`tests/test_production_migration.py`、`tests/workflow_guide.test.mjs`。
