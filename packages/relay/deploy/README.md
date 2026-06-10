# HippoTeam relay — 部署模板

这些是把 `@huangserva/hippoteam-relay` 部署到公网 VPS、打通手机外网访问的模板文件。
**完整图文部署手册见 `.hive/reports/2026-05-30-relay-deployment-kit.html`（含每一步确切命令）。**

当前 checked-in 模板的默认公网入口统一为 `aliyun.servasyy.com`：

- relay WebSocket/API：`wss://aliyun.servasyy.com`
- APK 直下载：`https://aliyun.servasyy.com/dl/<filename>.apk`
- HTML 报告/页面查看：`https://aliyun.servasyy.com/view/<filename>.html`

`/dl/*` 用于下载二进制产物（例如 APK），应保留下载语义；`/view/*` 用于浏览器直接查看 HTML 报告或页面，避免把 HTML 当附件下载。若实际线上 Caddy/Nginx 还停在旧域名，需要人工同步真实配置并 reload，本目录只提供模板。

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

输出包含 `RELAY_AUTH_TOKEN`（填进 systemd unit）和一份 `relay.json`（填进 Mac），两边 `relay_auth_token` 必须一致。`relay.json` 里的 `relay_url` 默认应为 `wss://aliyun.servasyy.com`；改完 Mac 侧 `~/.config/hive/relay.json` 后需要重启 4010 runtime 才生效。

## APK / HTML 投递入口

对外发包或交付 HTML 时，统一使用阿里云公网域名：

- APK：上传到线上静态目录后，给 user `https://aliyun.servasyy.com/dl/<filename>.apk`。
- HTML：上传到线上静态目录后，给 user `https://aliyun.servasyy.com/view/<filename>.html`。

不要再使用旧公网入口；如果某份历史文档仍写旧域名，以本 README 和当前 deploy 模板为准。

## 读 daemon 公钥（手机端 E2E 握手需要，目前需手动传递）

```sh
node -e "console.log(require('os').homedir()+'/.config/hive/relay-keypair.json'); console.log(require(require('os').homedir()+'/.config/hive/relay-keypair.json').publicKey)"
```

> ⚠️ 手机 app 当前**没有**录入 relay_url/room/公钥的入口（QR 只带 host+token）。
> 这是已知缺口，TODO 见部署手册「手机端接入」与配套 research 笔记。
