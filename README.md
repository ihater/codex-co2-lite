# [Co2 Lite](https://github.com/ihater/codex-co2-lite)

[Co2 Lite](https://github.com/ihater/codex-co2-lite) 源自 Codex Co2 `v0.6.2`，是独立本地简化版。它只保留会话选择、永久链接、消息与附件提交、停止分享，不包含访客加入审批、消息审批、邀请恢复申请或公网中继。

[项目仓库](https://github.com/ihater/codex-co2-lite) · [English](README.en.md)

## 启动

双击 `启动 Co2 Lite.command`。首次使用时，Codex Desktop 可能打开本地桥接插件页面；按页面提示完成安装后，后台会自动连接并恢复所有共享。

管理后台固定为 `http://127.0.0.1:55661/admin`。启动脚本会自动附带本机管理凭据打开，不能把后台地址分享给同事。

后台操作：

1. 选择 Codex 会话。
2. 填写协作者名称。
3. 点击“生成永久链接”，链接会自动复制。
4. “更换链接”会立刻撤销旧链接并生成新链接。
5. “停止分享”会立刻撤销链接并断开已打开的页面。

协作者可以点击输入框左侧“＋”选择图片或文件，也可以直接粘贴截图、拖入图片；每条消息最多 8 个附件，单个不超过 32 MiB，合计不超过 64 MiB。

双击 `停止 Co2 Lite.command` 可停止进程。状态不会删除；再次启动后端口、管理凭据、分享 ID 和访客 token 都保持不变，原链接继续有效。

## 数据

运行数据位于 `.lite-data/`：

- `state.json`：固定端口、管理凭据和有效分享链接，权限 `0600`。
- `snapshots/`：最近一次会话快照；Codex 暂时离线时访客刷新仍可看到历史。
- `.coop/`：独立 Desktop bridge、消息队列记录和访客上传目录。
- `service.log`、`service-error.log`：后台日志。

分享链接使用稳定的 macOS `.local` 主机名，不绑定 DHCP 地址。后台同时显示当前 IPv4 回退地址；回退地址会随 DHCP 变化，规范链接不会。

## 验证

```bash
npm install
npm run lite:test
```

原 Co2 源码保留在仓库中作为经过审计的 Desktop 接入层。Lite 新增代码位于 `lite/`，两套服务使用不同运行目录、端口和 LaunchAgent，不会共享房间或凭据。

## 开源说明

本项目是独立维护的实验性衍生项目，不是 OpenAI 官方产品，也不由 OpenAI 背书。项目沿用上游 MIT 许可证；上游版权声明及第三方组件许可见 [LICENSE](LICENSE) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
