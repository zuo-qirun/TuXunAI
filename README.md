# 图寻实时辅助 AI

这是一个在本地运行的图寻练习助手。它可以捕获屏幕、上传截图或直接粘贴图片，并结合视觉模型与外置知识库，给出候选国家、线索理由和下一步观察建议。
现在还会额外输出城市候选，按更接近 Plonkit 训练思路的分层判断来跑。

## 启动

```powershell
npm start
```

打开：

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

- 点击“选择屏幕”或上传/粘贴截图。
- 先看文字、车牌、驾驶方向和道路标线。
- 再看电线杆、路牌、街景车和环境。
- 需要时用手动线索做修正。

## Chrome 扩展

仓库里还带了一个 Chrome 扩展入口，路径是 `extension/`。

加载方法：

1. 启动本地助手：`npm start`
2. 打开 `chrome://extensions`
3. 开启“开发者模式”
4. 选择“加载已解压的扩展程序”
5. 指向本仓库里的 `extension/` 文件夹

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
