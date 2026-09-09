# 核心流程科技视觉与动效

新增首页科技主视觉、Agent 透明核心与创作引导图；保留原有产品图片、深浅主题、草稿和任务 API。原始 PNG 与优化 WebP 均保存在 `apps/web/public/inspiration/`，生成提示词见同目录 `tech-assets.md`。三个 WebP 合计 148,448 字节，核心素材保留 alpha 通道。

## 交互行为

- 首页：青绿光轨、细网格和一次性内容入场；移动端单独裁切图片，文案和按钮由 HTML 渲染。
- 发现页：卡片抬升、图片微缩放、前八张卡片错峰入场；收藏动画只随已确认的本地保存状态变化。沿用现有本地收藏语义，后台镜像失败不会被描述为云端收藏成功。
- 图片：固定容器预留空间，缓存命中直接显示，加载失败显示占位并保留页面入口。
- 创作：步骤切换定位到编辑区域，已填内容保留；校验失败聚焦第一个错误字段。保存提示仍来自实际本地保存结果。
- Agent：运行状态驱动环形动效；等待确认、完成、失败和中断有不同反馈。轮询不重新挂载任务或完成图标。记录默认跟随底部，向上阅读时显示“查看最新记录”，不会抢走阅读位置。
- 通用：140ms 按压、240ms 切换、320ms 入场；离屏/后台暂停装饰动效，减少动态效果模式停用相关动画，键盘焦点保持可见。

## 验收与复现

浏览器脚本：`tests/visual-ux.test.mjs`。使用 Playwright 和 Edge 无头浏览器；拦截 gateway 请求并注入独立测试数据，不需要真实账号、模型密钥或运行中的 gateway。非本地外部请求被阻止，写入操作不会到达真实服务。

先在 `apps/web` 下启动 3100 端口的前端。可设置 `NEXT_DIST_DIR=.next-ux-check`，先执行生产构建，再启动生产服务。类型检查使用项目现有 TypeScript 配置。

然后从项目根目录执行：

```powershell
# Playwright 已在当前 Node 环境可解析时，可省略此变量。
$env:PLAYWRIGHT_MODULE_DIR = '你的 Playwright 安装目录'
# 如浏览器/FFmpeg 安装在自定义目录，指向该目录。
$env:PLAYWRIGHT_BROWSERS_PATH = '你的 Playwright 浏览器目录'
node tests/visual-ux.test.mjs
```

默认地址为 `http://127.0.0.1:3100`；可通过 `UX_BASE_URL` 修改。`UX_BROWSER_CHANNEL` 默认为 `msedge`。`UX_RECORD=0` 可跳过录屏。输出目录通过 `UX_OUTPUT_DIR` 设置，默认 `docs/ux-artifacts`。

检查范围：390/768/1440 宽度、深浅主题、键盘焦点、减少动态效果、离屏暂停、图片慢加载/失败、收藏失败与筛选空结果、草稿保存/失败与校验定位、六种 Agent 状态、完成动画不会随轮询重播、执行记录滚动保护与回到最新。

本次生产构建和类型检查通过。浏览器最终通过记录见 `ux-artifacts/acceptance.json`；本轮只验证前端状态呈现，不代表真实模型或端到端业务服务已验收。

## 交付物

- `ux-artifacts/core-ux-demo.webm`：1440×900 网页实际录屏，画面持续标注隔离测试数据。
- `ux-artifacts/demo-home.png`、`demo-discover.png`、`demo-studio.png`、`demo-agent-welcome.png`、`demo-agent.png`：核心流程截图。
- `ux-artifacts/home-{390,768,1440}-{light,dark}.png`：响应式主题截图。
