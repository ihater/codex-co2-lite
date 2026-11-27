# [Co2 Lite](https://github.com/ihater/codex-co2-lite)

[Co2 Lite](https://github.com/ihater/codex-co2-lite) is a standalone local edition derived from Codex Co2 `v0.6.2`. It keeps conversation selection, permanent links, text and attachment submission, link rotation, and share revocation. It removes guest admission, per-message approval, recovery requests, and the public relay.

[Repository](https://github.com/ihater/codex-co2-lite) · [简体中文](README.md)

## Start

Double-click `启动 Co2 Lite.command` on the host Mac. On first use, Codex Desktop may open the local bridge plugin page. Install the plugin as prompted; the manager reconnects and restores active shares automatically.

The manager is always available at `http://127.0.0.1:55661/admin`. The launcher opens it with the local manager credential. Never send the manager URL to a collaborator.

1. Select a Codex conversation.
2. Enter the collaborator's display name.
3. Choose **Generate permanent link**. The link is copied automatically.
4. Use **Rotate link** to revoke the old URL immediately.
5. Use **Stop sharing** to revoke the URL and disconnect open guest pages.

Guests can choose files, paste screenshots, or drag images into the composer. Each message supports up to 8 attachments, 32 MiB per file, and 64 MiB total.

Double-click `停止 Co2 Lite.command` to stop the process. Restarting preserves the port, manager credential, share IDs, guest tokens, and snapshots, so existing links remain valid.

## Runtime data

Private runtime data is stored under `.lite-data/` and is excluded from Git:

- `state.json`: stable port, manager credential, and active share tokens.
- `snapshots/`: the latest conversation snapshots for offline reads.
- `.coop/`: the isolated Desktop bridge, delivery queue, and guest uploads.
- `service.log` and `service-error.log`: local service logs.

Canonical share URLs use a stable macOS `.local` hostname instead of a DHCP address. The manager also displays current IPv4 fallback URLs.

## Verify

```sh
npm install
npm run lite:test
```

The audited upstream Desktop integration source is retained in this repository. Lite-specific code lives under `lite/`; Lite and the upstream service use separate ports, state directories, and LaunchAgents.

## Security boundary

Possession of a guest URL grants read/write access to its shared conversation. Use Co2 Lite only on a trusted LAN, share URLs privately, and rotate or stop a share if its URL may have leaked. LAN traffic is plain HTTP, not end-to-end encrypted.

This is an independently maintained experimental derivative, not an official OpenAI product or an OpenAI-endorsed integration. The project retains the upstream MIT license and notices; see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
