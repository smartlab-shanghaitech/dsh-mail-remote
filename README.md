# dsh-mail-remote

[![test](https://github.com/smartlab-shanghaitech/dsh-mail-remote/actions/workflows/test.yml/badge.svg)](https://github.com/smartlab-shanghaitech/dsh-mail-remote/actions/workflows/test.yml)

**通过邮件远程驱动 DSH**：手机发一封带口令的邮件 → DSH 里起（或续上）一个会话执行 → 把结果回信到原线程。

纯 Node 实现，不依赖 Python、launchd、任务计划或任何原生模块，macOS 与 Windows 安装方式一致。

---

## 它做什么

```
手机邮件 ──IMAP──▶ 本插件（DSH Host 内）──▶ 新建/续跑 DSH 会话 ──▶ 结果 ──SMTP──▶ 回信
```

- 收件箱**只读打开**（`readOnly`），不会把你的未读信标成已读
- 会话创建走 DSH 自己的 `sessionController`，任务会出现在桌面端会话列表里
- 线程 ↔ 会话用 `References` 根 / 规范化主题映射，回复同一线程即可继续上下文
- 默认权限档 `read-only` + 审批策略 `never`：需要升权的动作直接失败，不会把无人应答的审批挂死

## 安装

DSH 桌面端「插件 → 添加插件」里填包名或 Git 地址；或命令行：

从 GitHub 安装（实验室/朋友都适用）：

```bash
dsh plugin --profile desktop add github:smartlab-shanghaitech/dsh-mail-remote
```

网页版把 `desktop` 换成 `web`。桌面端也可以在「插件 → 添加插件」里填
`github:smartlab-shanghaitech/dsh-mail-remote`。

本地开发时直接装工作目录（改代码后重启或等 HMR）：

```bash
git clone https://github.com/smartlab-shanghaitech/dsh-mail-remote.git
cd dsh-mail-remote && npm install
dsh plugin --profile desktop add file:$PWD
```

安装后重启 DSH（Host 插件在启动时挂载；新装的 client 入口也需要刷新页面）。

## 从源码开发

```bash
git clone https://github.com/smartlab-shanghaitech/dsh-mail-remote.git
cd dsh-mail-remote
npm install
npm test                     # 31 项单测：闸门/正文/状态/配置/client bundle
cp dev/config.example.json dev/config.local.json   # 填自己的信息（已被 gitignore）
bash scripts/install-desktop.sh                    # 装进 desktop profile 并写配置
```

`dev/` 下的辅助脚本：

- `node dev/apply-smoke.mjs`：用假 Cordis 上下文跑一遍插件（不碰 DSH）
- `node dev/send-one.mjs "[DSH-7f3a] 测试" "正文"`：给自己发一封指令邮件
- `node dev/inspect-latest.mjs 3`：看最近 3 封邮件（含回信的线程头）
- `node bin/cli.js check --config dev/config.local.json`：IMAP/SMTP 连通性
- `node bin/cli.js poll --config dev/config.local.json --dry-run`：只看闸门判定

CI（GitHub Actions）在 ubuntu / macos / windows × Node 22/24 上跑单测。
`dev/config.local.json`、测试 DSH home、state 文件、授权码一律不进仓库。

## 配置

在 `~/.dsh/profiles/desktop/cordis.patch.yml` 里加一行覆盖（后加载的层会覆盖包内默认行）：

```yaml
- id: mail-remote
  name: dsh-mail-remote
  config:
    enabled: true
    provider: qq
    user: you@qq.com
    passwordFile: ~/.dsh-secrets/qq-mail.pass
    allowFrom: [you@qq.com]
    subjectToken: "[DSH-7f3a]"
    workdir: ~/DSH-Remote
    workspaceName: remote-dsh
```

授权码不要写进 YAML。放进 0600 文件或用环境变量：

```bash
mkdir -p ~/.dsh-secrets && chmod 700 ~/.dsh-secrets
printf 'QQ 授权码: '; read -rs code; printf '\n'
printf '%s\n' "$code" > ~/.dsh-secrets/qq-mail.pass
chmod 600 ~/.dsh-secrets/qq-mail.pass
unset code
```

或：`export DSH_MAIL_REMOTE_PASSWORD='授权码'`（环境变量优先于文件）。

### 图形设置页（推荐）

装好后打开侧栏 **插件（Plugins）→ dsh-mail-remote → 配置**，会看到一张表单：

- 邮箱类型 / 邮箱地址 / 授权码（或授权码文件路径）
- 允许的发件人、主题口令
- 工作目录、工作区名称、权限档、审批策略、轮询间隔、每小时上限
- 回信、跳过历史邮件、dry-run 开关

保存后写入 profile 的 `cordis.patch.yml` 并热重载插件，下一轮轮询即生效。
授权码直接填在表单里会随配置明文落进 profile 的 YAML；介意的话填「授权码文件」路径，或改用环境变量。

### 配置项

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `false` | `false` 时不连邮箱，只待命 |
| `provider` | `qq` | 内置 `qq` / `163` / `126`；其他邮箱用 `imap`/`smtp` 手填 |
| `user` | — | 收信邮箱地址（也是回信 From） |
| `password` / `passwordEnv` / `passwordFile` | — | 授权码三种来源，优先级：直接值 > 环境变量 > 文件 |
| `allowFrom` | — | 允许的发件人**精确地址**列表（不做域名/子串匹配） |
| `subjectToken` | — | 主题必须包含的口令，如 `[DSH-7f3a]` |
| `workdir` | `~/DSH-Remote` | 新建会话的工作目录（建议独立目录） |
| `workspaceName` | `remote-dsh` | GUI 里显示的工作区名称；插件会自动注册并把会话挂进去 |
| `permissionPreset` | `workspace-write` | `workspace-write`（默认，可写工作区）或 `read-only`；不会用 `danger-full-access` |
| `approvalPolicy` | `never` | `never` = 需要升权的动作直接失败；`ask` 在无人看界面时会挂住 |
| `pollSeconds` | `60` | 轮询间隔（10–3600） |
| `maxPerHour` | `6` | 每小时最多执行次数 |
| `maxBodyChars` | `4000` | 交给模型的正文上限 |
| `replyEnabled` | `true` | 是否回信 |
| `attachChangedFiles` | `true` | 把本次任务期间在 `workdir` 里新建/修改的文件作为附件回信 |
| `maxAttachmentFiles` | `5` | 单封回信最多附件个数 |
| `attachmentRoots` | `~/Desktop`、`~/Documents`、`~/Downloads`、工作区 | 允许显式回传的目录白名单（工作区始终允许） |
| `maxAttachmentBytes` | `10485760` | 单个附件大小上限（字节，默认 10MB） |
| `dryRun` | `false` | 只判定不执行、不回信 |
| `mailbox` | `INBOX` | 信箱 |
| `imap` / `smtp` | provider 预设 | `{host, port, secure}` |

## 已验证范围

2026-11-23 在 macOS arm64 + DSH 0.2.2-rc.1 上实测通过：

- QQ 邮箱（`imap.qq.com:993` / `smtp.qq.com:465`）IMAP/SMTP 登录、发信、收信
- 邮件 → 新建会话（`read-only` 权限档）→ 模型回答 → 回信串线程（`In-Reply-To` / `References`）
- 同一线程继续回信 → 复用原会话，上下文连续（第二轮正确答出第一轮记的数字）
- 闸门：精确白名单 / 主题口令 / Message-ID 去重 / 自动回复过滤 / 限频
- 插件热加载生效，无需重启 App 即可开始收信

未实测：Windows 真机、Linux、其他邮箱 provider（163/126 仅内置了端点）。

## 安全模型（请先读）

- **能往这个邮箱发信的人 ≈ 能在你电脑上跑一轮任务的人**。所以：用独立邮箱、精确白名单、主题口令、限频，别用主邮箱。
- 默认权限档是 `workspace-write`：会话可以改 `workdir` 里的文件，但沙箱仍只限制文件写入，读取与网络不受限（这是 DSH 沙箱的语义）。
- 回信附件只从 `workdir` 里**本次任务期间改动过**的普通文件里挑，跳过隐藏文件、`node_modules`、`.git` 等，并受个数/大小上限约束。
- 沙箱只管文件写入，网络与读取不受限；`read-only` 不是"安全模式"，只是"不可写模式"。
- 无人值守时审批不能挂在 `ask`：插件把会话钉在 `never`，需要升权的动作会失败（可在回信里看到失败原因）。
- 回信带 `X-DSH-Auto-Reply: 1`，插件会跳过带该标记的信，防止自动回复循环。
- 维护一张"已处理 Message-ID"表，重复投递不会重复执行。

**推荐用法**：手机上配置同一个邮箱，自己发给自己。这样 `From` 天然白名单，也不用把主邮箱暴露给任何脚本。

## 命令行自检（不需要安装到 DSH）

```bash
cd dsh-mail-remote
npm install
cp dev/config.example.json dev/config.local.json   # 填邮箱地址与 passwordFile
node bin/cli.js check     --config dev/config.local.json   # IMAP/SMTP 连通性
node bin/cli.js poll      --config dev/config.local.json --dry-run   # 看闸门判定
node bin/cli.js state     --config dev/config.local.json
node bin/cli.js send-test --config dev/config.local.json   # 给自己发一封自检信
```

`poll --dry-run` 不执行、不回信、不推进游标，用来验证 QQ 授权码、IMAP ID、白名单与口令是否正确。

## 回传工作区之外的文件

除了自动收集工作区内本次改动的文件，还可以让 agent 显式指定任意本地文件：在最终回答里单独写一行

```
[ATTACH: /Users/you/Desktop/论文写作/HW1.docx]
```

插件会把这行从回信正文里去掉，并把文件作为附件附上。为了不让被遥控的会话顺手把密钥传出去，显式附件只允许
`attachmentRoots` 里的目录（默认 Desktop / Documents / Downloads，工作区始终允许），并受个数和大小限制；
隐藏目录（`~/.ssh`、`~/.dsh` 等）之外的文件不会被读取。

任务里这样写即可：

> 把 /Users/you/Desktop/论文写作/HW1.docx 回传给我，最终回答单独写一行 `[ATTACH: 绝对路径]`

## 线程与续跑

- 回信带 `In-Reply-To` / `References`，直接回复 agent 的回信就会续上同一会话。
- 即使某些客户端把 `References` 截断成只指向 agent 的回信，插件也会用「规范化主题 + 发件人」回退匹配，
  仍然落到同一会话，不会另开一段。

## 排错

- `~/.dsh/mail-remote/diag.json`：插件心跳。`status: active` 表示已加载，`polling` 表示每轮在跑，`error` 会带错误信息（本次排查就是靠它定位到状态文件路径 bug）。
- `~/.dsh/mail-remote/state.json`：UID 游标、已处理 Message-ID、线程→sessionId 映射。
- 改了插件代码后如果发现不再轮询，重启一次 DSH（Host 插件不是所有改动都能热重载）。

## 测试

```bash
npm test
```

覆盖：正文清洗（引文/签名/HTML）、闸门顺序（白名单/口令/去重/自动回复/限频）、线程键、状态原子写与单写者锁、配置解析。

## 已知边界

- 插件只在 **DSH 运行时**工作：退出 App 即停。官方桌面端点 × 是留在托盘；重启电脑后需要把 DSH 加进登录项（两边系统都是 1 步）。
- 需要 desktop / web profile（含 `dsh-web-app` bundle，提供 `sessionController`）；headless profile 没有这个服务。
- Windows 与 macOS 装法一致：依赖全是纯 JS，无原生模块；CI 在 windows-latest 上跑单测。官方桌面版下载见 [deepseek.com/download](https://www.deepseek.com/download/)。
- 邮箱身份无法在协议层证明：邮箱被盗 = 命令被伪造。这是邮件通道的固有上限，不是本插件能修的。
- v1.1 起有图形设置页（插件详情 → 配置），仍保留 YAML 方式给自动化/headless。

## 卸载

```bash
dsh plugin --profile desktop remove dsh-mail-remote
```

并删掉 `cordis.patch.yml` 里的 `mail-remote` 行。

## License

MIT
