# 图寻实时辅助 AI

这是一个在本地运行的图寻练习助手。它可以捕获屏幕、上传截图或直接粘贴图片，并结合视觉模型与外置知识库，给出候选国家、线索理由和下一步观察建议。
现在还会额外输出城市候选，按更接近 Plonkit 训练思路的分层判断来跑。

## 启动

```powershell
npm start
```

打开后会看到插件下载页：

```text
http://localhost:4173
```

## 视觉模型

默认使用本地 Ollama 视觉模型。可通过环境变量切换：

```powershell
$env:VISION_PROVIDER="ollama"
$env:VISION_MODE="balanced"
$env:VISION_MODEL="qwen3-vl:4b"
npm start
```

可选模式：

- `fast`：`moondream`
- `balanced`：`qwen3-vl:4b`
- `accurate`：`qwen3-vl:8b`

如果你的 Ollama 不在默认地址：

```powershell
$env:OLLAMA_HOST="http://127.0.0.1:11434"
npm start
```

## 外置知识库

知识库文件在：

```text
data/knowledge-base.json
```

这里会同步管理：

- 网页端线索按钮
- 自动识图可用标签
- 国别画像与评分权重
- 文本线索规则
- 画面统计规则
- 城市候选提示

以后要继续加判断条件，优先改这份文件。

## 使用方式

网页端已停用，识图流程集中在 Chrome 扩展里维护。先启动本地助手，再安装扩展并从插件弹窗里选择游戏模式、推理模式和 AI 抓图模式，然后抓图识图、查看历史日志。

游戏模式：

- `世界`：图寻世界模式，不会把中国大陆作为答案。
- `中国`：图寻中国模式，只在中国街景中判断省、市和区域。

推理模式：

- `快速`：只跑第一轮识图，不启用复核；会注入最近确认过的常用知识点。
- `精准`：模型先给出初判，服务端再按初判和线索检索图寻具体资料片段，让模型结合资料复判；如果答案被模型改动，会继续按新答案检索资料再复判，最多由 `AGENT_REVIEW_ROUNDS` 控制。

需要全局关闭精准复核时设置：

```powershell
$env:AGENT_REVIEW="0"
npm start
```

可调整精准复核最多轮数：

```powershell
$env:AGENT_REVIEW_ROUNDS="2"
npm start
```

记忆功能：

- 每次插件给出答案后，可以点“准确”或“不准确”。
- 点“准确”时，服务端会让模型生成 1-3 条常用知识点并写入 `data/tuxun-memory.json`。
- 后续识图会优先带上相关记忆；快速模式也会使用最近确认过的知识点。

完整图寻文档已放在：

```text
data/tuxun-docs/
```

其中 `markdown/` 和 `lake/` 是爬取下来的详细资料，`metadata.json` 和 `toc.json` 是目录与爬取元数据。迁移服务器时复制 `data/tuxun-docs/` 后，可直接运行：

```powershell
npm run build:tuxun-summary
```

重新生成 `data/tuxun-doc-summary.json`。

## Chrome 扩展

仓库里的 Chrome 扩展入口是 `extension/`。服务启动时会自动把它打包成：

```text
dist/TuXunAI.zip
```

`extension/` 文件夹发生变化时，本地服务会自动重新生成这个 ZIP，网页根路径会提供下载链接。

加载方法：

1. 启动本地助手：`npm start`
2. 打开 `http://localhost:4173` 下载并解压插件 ZIP，或直接使用仓库里的 `extension/` 文件夹。
3. 打开 `chrome://extensions`
4. 开启“开发者模式”
5. 选择“加载已解压的扩展程序”
6. 指向解压后的插件文件夹，或本仓库里的 `extension/` 文件夹

装好后，点击扩展图标会自动抓取当前标签页可见区域，并把截图发给本地识图服务。结果会直接显示在弹窗里。

弹窗里可以直接填写服务地址。默认是 `http://localhost:4173`，如果你把服务部署到了树莓派或远程主机，就把域名填进去，例如：

```text
https://tuxun.example.com
```

## 树莓派部署

最简单的方式是把这个项目放到树莓派上直接跑 Node 服务，再用反向代理挂一个域名。

1. 安装 Node.js 18+ 和 Git。
2. 拉取仓库并进入目录。
3. 启动本地服务：

```powershell
npm start
```

4. 如果要让局域网或公网访问，推荐前面加一层 Nginx 或 Caddy，把域名转发到 `127.0.0.1:4173`。
5. 把扩展里的服务地址改成你的域名。

如果你想长期运行，建议再包一层 `systemd` 服务或者 `pm2`，这样树莓派重启后也会自动起来。

### 常见提示

- 如果页面提示 `Ollama is not running or not reachable`，通常表示服务启动时没有读到 `VISION_PROVIDER=newapi` 或相关 `NEWAPI_*` 环境变量。
- 这时先检查 `systemd` 的 `EnvironmentFile` 是否真的加载了你的 `.env` 文件。
- 你也可以在树莓派上直接运行 `printenv | grep -E 'VISION_PROVIDER|NEWAPI|OPENAI|OLLAMA'` 看当前进程环境。
