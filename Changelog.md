## v(Version Goes Here)

<details>
<summary><strong> 🐞 修复问题 </strong></summary>


**🍎 macOS**

- macOS：修复窗口无法拖动，支持从左上角图标、页面标题栏和左下角流量视图拖动窗口，双击这些区域可缩放窗口

</details>

<details>
<summary><strong> ✨ 新增功能 </strong></summary>

- 规则页支持启用/禁用规则并显示命中次数（重启内核后规则恢复启用）

</details>

<details>
<summary><strong> 🚀 优化改进 </strong></summary>


</details>

## v2.5.9

<details>
<summary><strong> 🐞 修复问题 </strong></summary>

- 修复定时自动备份重启后不启动、修改其他设置后倒计时被重置的问题
- 修复订阅和远程配置下载对响应体大小无限制的问题
- 修复通过深链导入订阅未经确认就下载，并可能在首次启动时立即启用的问题
- 修复轻量模式退出请求被中断后状态卡住、托盘开关失效的问题
- 修复通过 URL 导入订阅时，即使导入的订阅并非当前使用的订阅，也会重新加载当前配置
- 修复节点密码等日期格式字符串在运行配置序列化时丢失引号、导致内核校验失败的问题
- 修复 首页 网站测速失败后卡片一直显示测试中
- 修复 代理 页展开分组后不显示最新测速结果，需切换节点才刷新

**🍎 macOS**

- 修复旧版 macOS WebView 缺少 `Array.prototype.at` 导致首页渲染失败的问题
- macOS：修复主窗口失焦后 ⌘W、⌘Q 偶尔仍被占用的问题

**🐧 Linux**

- Linux：修复 deb/rpm 安装包错误包含多余的 `frontend-contract` 可执行文件，导致下游重新打包失败的问题

</details>

<details>
<summary><strong> ✨ 新增功能 </strong></summary>


</details>

<details>
<summary><strong> 🚀 优化改进 </strong></summary>

- 记住「启用系统标题栏」设置，Windows/macOS 即时生效，Linux 重启后生效

**🖥️ Windows**

- Windows 系统代理默认绕过 `*.local` 域名，访问局域网设备的 `.local` 主机名时不再经过代理

</details>
