# RSS 界面原型

由 Local Codex 生成的可交互网页原型，围绕知乎文章、B站视频和播客设计。采用纸白背景、中文阅读排版、陶土色强调和统一时间信息流。

## 打开预览

当前项目开发服务提供预览：

http://localhost:5173/designs/rss-redesign/index.html

也可以直接打开本目录的 `index.html`。保留同级 `assets` 文件夹，无须安装依赖。

如需独立启动本地预览：

```sh
# 在仓库根目录运行
python3 -m http.server 5174 --directory designs/rss-redesign
```

然后访问 http://localhost:5174/ 。

## 查看设计

- `index.html`：完整 HTML、CSS、JavaScript 与示例数据。
- `DESIGN.md`：交互说明、样式 token、React 组件映射和后端接入要求。
- `BRIEF.md`：用户确认的设计目标。
- `preview-desktop.jpg`：桌面混合信息流。
- `preview-article.jpg`、`preview-video.jpg`、`preview-podcast.jpg`：三类内容详情。
- `preview-mobile.jpg`、`preview-mobile-article.jpg`：手机信息流及文章阅读。

## 验证与范围

2026-10-14 已检查桌面 1440×960 和手机 390×844 的布局与主要交互：类别筛选、搜索、收藏、未读同步、三种详情、订阅地址校验与添加、手机订阅抽屉、播客章节跳转和倍速。播客打开后切换到文章，底部播放器保留；视频清晰度切换保持在原型页面。浏览器未发现 JavaScript 错误。

这是使用示例数据的设计原型。媒体播放为计时演示，尚未接入真实 RSS、知乎内容、B站视频流、播客音频或账号登录。正式接入参考 `DESIGN.md`。

收藏、阅读状态及新增示例订阅仅存于本地原型的专用存储，不写入 RSS 数据库。浏览器验收添加了一个“文章示例订阅”，用于验证新增订阅空状态。

设计文件位于仓库的 `designs/rss-redesign` 目录。
