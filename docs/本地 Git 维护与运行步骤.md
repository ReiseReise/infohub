# 信息中枢 v3 本地 Git 维护与运行步骤

> 更新时间：2026-03-31
> 适用场景：当前项目目录还不是 Git 仓库，你想开始自己维护，并且后面能在本地持续更新和运行。

---

## 1. 先把当前目录变成 Git 仓库

先确认你就在项目根目录：

```bash
cd "<infohub-v3-root>"
```

当前目录还不是 Git 仓库，所以第一步是初始化：

```bash
git init -b main
git add .
git commit -m "chore: initialize infohub-v3"
```

说明：

- 仓库里已经有 `.gitignore`，默认不会提交 `.env`、`data/`、`backups/`、`exports/`、`local-secrets/` 这类本地和敏感内容
- 真正会进 Git 的主要是代码、脚本、Docker 配置和文档

---

## 2. 绑定远端仓库并首次推送

如果你打算放到 GitHub / GitLab / Gitea，先在对应平台建一个空仓库，然后执行：

```bash
git remote add origin <你的仓库地址>
git push -u origin main
```

例子：

```bash
git remote add origin git@github.com:yourname/infohub-v3.git
git push -u origin main
```

执行完以后，你后面只需要维护这个本地目录，然后正常 `commit / push / pull` 就行。

---

## 3. 后面日常怎么更新代码

### 3.1 你自己本地改完后提交

```bash
git status
git add .
git commit -m "feat: 描述这次改动"
git push origin main
```

如果你不想一次性把所有文件都提交，可以改成：

```bash
git add docker-compose.yml services/ apps/ docs/
git commit -m "feat: storage backup status"
git push origin main
```

### 3.2 你在另一台机器或远端改过，这台机器要同步

```bash
git pull --rebase origin main
```

如果你本地也改了东西，建议顺序是：

```bash
git status
git add .
git commit -m "wip: local changes"
git pull --rebase origin main
git push origin main
```

---

## 4. 你本地怎么运行

### 4.1 第一次或重建启动

如果 `.env` 已经配过，就不要再覆盖它。

```bash
cd "<infohub-v3-root>"
docker compose up -d --build
```

### 4.2 检查服务是否正常

```bash
docker compose ps
curl http://127.0.0.1/health
curl http://127.0.0.1/api/health
```

正常的话：

- Web 入口：`http://127.0.0.1/`
- 管理员检查页：登录后进入 `设置 -> 诊断中心`

---

## 5. 平时怎么停、怎么重启、怎么看日志

### 停止容器

```bash
docker compose down
```

### 不重建直接启动

```bash
docker compose up -d
```

### 重新构建后启动

```bash
docker compose up -d --build
```

### 看日志

```bash
docker compose logs -f hub-engine
docker compose logs -f nginx
docker compose logs -f audio-service
```

---

## 6. 你后面每次更新后的推荐流程

最稳的一条线：

```bash
git pull --rebase origin main
docker compose up -d --build
docker compose ps
curl http://127.0.0.1/health
curl http://127.0.0.1/api/health
```

意思是：

1. 先把代码更新下来
2. 再重建容器
3. 最后看健康检查

---

## 7. 备份建议

你现在这套本地运行已经做了：

- 运行数据目录：`./data`
- 导出目录：`./exports`
- 备份目录：`./backups`

手动备份命令：

```bash
make portable-backup
```

如果后面要装 Mac 定时备份：

```bash
make install-launchd-backup
```

---

## 8. 我建议你现在就执行的最短步骤

### 如果你要先纳入 Git

```bash
cd "<infohub-v3-root>"
git init -b main
git add .
git commit -m "chore: initialize infohub-v3"
git remote add origin <你的仓库地址>
git push -u origin main
```

### 如果你要先本地跑起来

```bash
cd "<infohub-v3-root>"
docker compose up -d --build
docker compose ps
curl http://127.0.0.1/health
curl http://127.0.0.1/api/health
```
