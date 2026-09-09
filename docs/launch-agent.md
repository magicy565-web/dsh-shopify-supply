# 产品发布 Agent

入口 `/#agent`。正式入口只接受 DSH 模型运行时，未配置时返回 503；不会转为模板或 in-memory 执行。

## 已接入

- DeepSeek Harness JSON-RPC 子进程、模型选择、现有审批桥。
- 用户目标及补充指令 → 模型自主选择搜索/目录工具 → 阶段证据 → 经确认写入完整草稿。
- 工具：search_public_web、get_launch_run、write_campaign_draft、record_launch_stage，加既有目录与报价比较工具。
- 服务端 JSON 保存任务、阶段、事件和草稿；写入串行化；失败不会破坏后续保存。
- 登录账号隔离任务；正式工具写入只允许内部凭据调用。
- 页面支持任务选择、执行记录、审批、停止、继续和失败重试；可将草稿确认转入账号项目工作台。
- 服务重启后保留成果，标记中断的执行待恢复。恢复会把已保存阶段和草稿交给模型重新规划，不承诺逐 token 恢复。

## 运行配置

在项目根目录的 `.env` 中配置 `AGENT_RUNTIME=dsh`、`DEEPSEEK_API_KEY`，并将 `DEEPSEEK_BASE_URL` 指向 OpenAI 兼容网关（FastAIToken 使用 `https://www.fastaitoken.com/v1`）。可用 `DSH_MODEL` 指定该网关实际授权的模型。密钥仅留在服务端，不放入 NEXT_PUBLIC 环境变量、不提交仓库。

运行现有 `dev:gateway` 与 `dev:web`。默认网关 8787、网页 3000。需要重启网关才能读取新的环境变量。使用现有注册/登录入口创建自己的创作者账号。

Harness 依赖固定 rc.6，关闭自动 peer 安装，显式声明依赖以避免 rc.8 混装。

## 验证与边界

已通过全工作区构建；10 项生命周期/审批测试、3 项 DSH 固定版本/事件映射/无密钥子进程启动测试、4 项发布 Agent 保存/校验/事件/权限测试。

真实模型合同测试因未配置 DEEPSEEK_API_KEY 跳过，完整模型任务仍须配置后验收。公开搜索仅使用 Wikipedia 与 DuckDuckGo Instant Answer，不能当作全面竞品调研。没有图片生成、供应商外发询价和支付能力。当前 JSON 存储适用于单网关实例，尚非多实例生产部署。

发布专项测试：先构建网关及其依赖，再运行 `node --test tests/launch-agent.test.mjs`。
