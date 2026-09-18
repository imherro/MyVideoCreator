# Wan 3.0 / MiniMax H3 reference video integration

Verified 2026-09-18 against supplier documentation and the local HC authenticated model catalogue (read-only; no paid generation).

Sources:
- HC https://admin-aigc.huanchangai.com/async/doc (Wan 3.0 and MiniMax sections)
- RunningHub Wan https://rhtv.runninghub.cn/runninghub-api-doc-cn/api-505575336
- RunningHub H3 https://pre.runninghub.ai/runninghub-api-doc-en/api-495380675
- RunningHub H3 inputs https://www.runninghub.cn/call-api/api-detail/2133100000000504201

| Provider | Model ID in studio | Submit protocol | Resolution |
| --- | --- | --- | --- |
| HC | wan3.0-video | /video/generation/tasks, input.prompt + input.media reference_* + parameters | 480P/720P/1080P |
| HC | MiniMax-H3 | /video/generation/tasks, content reference_* | 768P/2K |
| RunningHub | alibaba/wan-3.0 | /openapi/v2/alibaba/wan-3.0/reference-to-video, imageUrls/videoUrls/audioUrls | 480P/720P/1080P |
| RunningHub | minimax/hailuo-h3 | /openapi/v2/minimax/hailuo-h3/multimodal-to-video, imageUrls/videoUrls/audioUrls | 2K |

The adapter exposes explicit multimodal reference only, including single-image input. It does not infer first-frame mode. Current application motion input remains one video per shot. Existing image references and voice samples are preserved. HC uses signed public media URLs (public base URL configuration required); RunningHub uploads media through its existing binary upload endpoint.

Conservative implemented limits: Wan 2–30 seconds, H3 5–15 seconds; reference audio/video limited to 15 seconds total per type. Wan reference video plus output may not exceed 30 seconds. H3 has 9 image / 3 audio slots and 12 total references. Wan has 10 image / 5 audio slots and 20 total references. Unsupported frame mode, dimensions, MOV, explicit seeds, and automatic duration are rejected instead of silently changing the request. H3 native audio cannot be disabled in this adapter.

This adds availability to existing explicit project/production pools once, preserving model defaults, shot overrides, and all historical task inputs. Newly configured providers include these choices. Account catalogue inclusion does not guarantee generation entitlement or balance; tests mock upstream requests and polling, not real model quality or billing.
