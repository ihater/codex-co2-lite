# Co2 Lite 设计

## 设计目标

Co2 Lite 面向可信内网中的固定协作者：管理员从本机后台选择一条 Codex 会话，为一个协作者生成默认永久的分享链接。浏览器刷新、服务重启和 DHCP 地址变化不应导致分享状态或历史快照丢失。

核心职责是会话选择、持久分享、消息与附件提交、链接轮换和停止分享。不提供公网中继、访客加入审批、消息审批、个人身份恢复或多级角色权限。

## 方案选择

- 复用官方 Co2 `v0.6.2` 的 Desktop bridge、`ScopedThread`、持久消息队列和附件边界，避免引入第二个 Codex writer。
- 新建独立的 Lite 服务和 LaunchAgent，不改正式 Co2 的房间协议及运行数据。
- 使用固定端口、稳定 `.local` 主机名、持久 token 和原子状态文件，代替临时 room 与租约恢复流程。
- 对外 H5 复用官方样式，只删除不再适用的审批与身份控件；管理后台可以独立实现。

## 权限模型

- 管理员只允许从 loopback 访问，使用持久化的 256-bit bearer token。
- 每个分享使用独立 256-bit bearer token，token 只存在于 URL fragment 和私有状态文件中，不进入 HTTP 请求日志。
- 链接即授权，不创建访客准入、恢复凭据或消息审批状态。
- 更换链接原子替换 token；停止分享原子删除 share，随后断开连接和释放运行时。

## 威胁模型

- 防止局域网其他设备枚举管理接口、读取未分享会话或跨 share 访问附件。
- 防止 token 进入普通 HTTP 路径、查询参数、Referer 和服务日志。
- 防止上传路径伪造、目录穿越、超额附件和旧链接在轮换或停止后继续提交。
- 不防御受邀者主动转发链接、已控制分享者电脑的攻击者、恶意浏览器扩展或被监听的可信内网。

## 安全决策与边界

- 管理 API 同时校验 loopback socket 与 owner bearer token；访客 WebSocket 和附件读取按 share token 隔离。
- token 使用加密安全随机数生成并以恒定时间比较；状态目录为 `0700`，状态和快照文件为 `0600`。
- 页面只用 DOM `textContent` 渲染会话和管理数据，CSP 禁止外部脚本、框架嵌入和跨源连接。
- HTTP 只监听 loopback 与选定的 LAN 接口，并校验 `Host`、真实 socket peer 和本机地址，不信任代理头。
- 消息提交携带 `clientUserMessageId` 防重复；提交结果不确定时不自动重发。
- LAN HTTP 页面不能假设 `crypto.randomUUID()` 可用；消息和上传 ID 优先使用该 API，不可用时以 `crypto.getRandomValues()` 生成 UUID v4。

## 高可用

- LaunchAgent 使用 `RunAtLoad + KeepAlive` 自动拉起进程。
- 端口、`.local` 主机名、owner token、share ID 和 invite token 持久化且重启不变。
- 状态和快照使用临时文件 + rename 原子替换，目录权限 `0700`、文件权限 `0600`。
- 每条会话快照独立持久化。Desktop 断开时链接仍可打开并显示最近历史，服务每 5 秒自动重连。
- 管理页 token 保留在 URL fragment 和 `sessionStorage`；访客 token 保留在分享 URL fragment 和 `sessionStorage`，刷新不会丢失。
- 规范链接使用 macOS `.local` 主机名，由 mDNS 跟随 DHCP 地址变化。

## Codex 接入

- 会话元数据只读访问 `~/.codex/state_5.sqlite`。
- 会话正文通过 Co2 Desktop bridge 的 `read_thread` 白名单读取。
- 消息通过官方 persistent queue 提交，并使用 `clientUserMessageId` 防重复。
- 不确定提交结果不会自动重发。
- `ScopedThread` 继续负责正文投影、附件授权边界和实时快照。
- 保留本地长助手消息兼容补丁：包含输出的页面若只返回 preview，会缩小页面并在必要时省略执行输出重新读取正文。

## H5 兼容边界

- 协作者访问的 H5 保持官方 Co2 的视觉风格，`lite/web/co2-style.css` 必须与 `public/style.css` 逐字节一致。
- Lite 只移除审批、身份备份、导入等不再适用的控件，不重绘会话区、状态栏、消息样式或输入区。
- 管理后台是 Lite 独立页面，不属于对外分享的 H5 兼容范围。

## 已知限制

- 持有链接即拥有该会话的读写权限；链接被转发后无法识别实际使用者，只能更换链接或停止分享。
- LAN HTTP 不提供传输加密，适用边界是可信内网；敏感网络应另行提供受控 TLS 入口。
- `.local` 依赖 mDNS；屏蔽组播 DNS 的 VLAN、访客网络或 VPN 需要内网 DNS 或固定 DHCP 映射。
- 持久快照保证离线可读，不代表 Codex 离线时仍可提交新消息。

## 变更历史

- 2026-11-26：建立独立 Lite 服务、固定管理入口、永久分享与快照恢复。
- 2026-11-26：固化对外 H5 样式兼容测试，明确官方 Co2 风格保持不变。
