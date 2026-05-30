# HippoTeam relay — 部署模板

这些是把 `@huangserva/hippoteam-relay` 部署到公网 VPS、打通手机外网访问的模板文件。
**完整图文部署手册见 `.hive/reports/2026-05-30-relay-deployment-kit.html`（含每一步确切命令）。**

| 文件 | 用途 | 放哪 |
|---|---|---|
| `hippoteam-relay.service` | systemd 常驻 relay | `/etc/systemd/system/` |
| `Caddyfile.example` | Caddy 反代（推荐，自动 TLS） | `/etc/caddy/Caddyfile` |
| `nginx-relay.conf.example` | Nginx + certbot 反代（替代方案） | `/etc/nginx/sites-available/` |
| `relay.json.example` | Mac runtime 接入配置 | `~/.config/hive/relay.json` |

## 生成密钥/标识

```sh
cd packages/relay && pnpm build && node dist/src/keygen-cli.js
```

输出包含 `RELAY_AUTH_TOKEN`（填进 systemd unit）和一份 `relay.json`（填进 Mac），两边 `relay_auth_token` 必须一致。

## 读 daemon 公钥（手机端 E2E 握手需要，目前需手动传递）

```sh
node -e "console.log(require('os').homedir()+'/.config/hive/relay-keypair.json'); console.log(require(require('os').homedir()+'/.config/hive/relay-keypair.json').publicKey)"
```

> ⚠️ 手机 app 当前**没有**录入 relay_url/room/公钥的入口（QR 只带 host+token）。
> 这是已知缺口，TODO 见部署手册「手机端接入」与配套 research 笔记。
