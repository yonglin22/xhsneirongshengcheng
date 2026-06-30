# 朱砂 · 真机执行端 / 投屏工作室

把安卓真机接上电脑，作为执行设备跑「养号 / 截流计划」。

---

## ⚠️ 先选对路线（别上来就搞真机）

| 你的情况 | 走哪条 | 成本 |
|---|---|---|
| **一两个号、个人用** | **Chrome 插件「朱砂助手」** | ⭐ 零门槛：装扩展 → 开「执行设备」+「前台观看」→ 网页下发。不碰终端、不接线 |
| **要多台手机、规模化养号** | **真机执行端（本目录）** | ⭐⭐⭐ 要接线、装工具、开手机调试 |

> 大多数人用插件就够了。真机这套是给"手机农场"规模化用的。下面是真机路线。

---

## 真机路线 · 极简三步

### 1. 装工具（一次性）
**Mac：**
```bash
brew install android-platform-tools node scrcpy
```
**Windows：** 装 [Node](https://nodejs.org)、[platform-tools](https://developer.android.com/tools/releases/platform-tools)（adb）、[scrcpy](https://github.com/Genymobile/scrcpy)，都加入 PATH。

> 不需要 `npm install`！执行端只用 Node 内置模块。

### 2. 连手机
USB 连接 → 手机【设置→关于→连点版本号7次】开开发者 → 开 **USB 调试** → 插线后点【允许】。
**小米/红米**额外要开 **「USB调试(安全设置)」**（要登小米账号+插SIM卡），否则模拟点击被系统拦。

### 3. 双击启动
- **Mac**：双击 `start.command`（首次右键→打开，过一下安全提示；若提示无法执行，终端跑一次 `chmod +x start.command`）
- **Windows**：双击 `start.bat`

第一次会让你粘一次 **token**（网页「设备看板 → 接入真机/脚本 → 生成接入 token」，复制 zd_ 开头那串）。粘一次就存住，以后双击即用。

启动后：网页「养号/截流计划」→ 📤 下发 → 手机自动跑，scrcpy 窗口实时看。

---

## 命令行方式（进阶/调试）
```bash
node run-agent.js zd_你的token        # 单台真机执行端
scrcpy                                # 另开窗口投屏
```
配置存 `~/.zhusha-studio-token`（token）。换号删掉它重填。

## 还需适配（真机点击坐标）
真机在小红书里**精准点赞/评论**的坐标随机型不同，需按你的屏幕标定——见 `agent.js` 里 `_tapLike`/`_tapFav`/`_postComment` 的 TODO。当前默认坐标按 1080 宽屏给的，滑动浏览能通用。

## Electron 投屏看板（可选，非必须）
`npm start` 可起一个 Electron 多机投屏网格看板，但需要联网下载 Electron（国内可能慢/失败）。**不影响真机执行**——执行用上面的 `start.command` / `run-agent.js` 即可，投屏用 scrcpy。
