.PHONY: help build-engine build-web qa-verify qa-full qa-real-audio docs-check archive acceptance-users hn-test-package import-legacy-config seed-daily-report-agents portable-export portable-import portable-backup install-launchd-backup gate

help:
	@echo "可用命令:"
	@echo "  make build-engine  - 构建后端 hub-engine"
	@echo "  make build-web     - 构建前端 web"
	@echo "  make qa-verify    - 执行全量回归但不写入报告"
	@echo "  make qa-full       - 执行全量回归并输出报告"
	@echo "  make qa-real-audio - 执行真实平台音频链接烟测（不纳入默认 gate）"
	@echo "  make docs-check    - 严格文档检查"
	@echo "  make archive       - 生成迭代归档骨架（需 STAGE/TOPIC）"
	@echo "  make acceptance-users - 准备本地验收账号（管理员+普通用户）"
	@echo "  make hn-test-package - 导入 HN Popular Blogs 测试订阅包"
	@echo "  make import-legacy-config - 从旧项目导入可复用凭证与配置（默认 dry-run）"
	@echo "  make seed-daily-report-agents - 注入日报多智能体默认模板与场景绑定"
	@echo "  make portable-export - 导出单仓库迁移包（可配 PORTABLE_PASSPHRASE）"
	@echo "  make portable-backup - 生成本地快照并按配置归档到 OSS"
	@echo "  make portable-import BUNDLE=... YES=1 - 恢复迁移包"
	@echo "  make install-launchd-backup - 安装备份定时任务（Mac）"
	@echo "  make gate          - 执行严格门禁"

build-engine:
	cd services/hub-engine && npm run build

build-web:
	cd apps/web && npm run build

qa-verify:
	bash scripts/qa/run-regression.sh --full --no-report

qa-full:
	bash scripts/qa/run-regression.sh --full --output qa/reports/$$(date +%Y%m%d_%H%M%S)-full.md

qa-real-audio:
	bash qa/p0/test_audio_url_real_platforms.sh

docs-check:
	bash scripts/docs/check-docs.sh --strict

archive:
	@if [ -z "$(STAGE)" ] || [ -z "$(TOPIC)" ]; then \
		echo "请使用: make archive STAGE=stage-bc TOPIC=topic-name"; \
		exit 1; \
	fi
	bash scripts/docs/init-archive.sh --stage "$(STAGE)" --topic "$(TOPIC)"

acceptance-users:
	bash scripts/dev/prepare-acceptance-users.sh

hn-test-package:
	bash scripts/dev/import-hn-test-package.sh

import-legacy-config:
	bash scripts/dev/import-legacy-configs.sh

seed-daily-report-agents:
	bash scripts/dev/seed-daily-report-agents.sh

portable-export:
	bash scripts/portable/export-bundle.sh "$(if $(OUT),$(OUT),./portable-bundles)"

portable-backup:
	bash scripts/portable/backup-archive.sh

portable-import:
	@if [ -z "$(BUNDLE)" ]; then \
		echo "请使用: make portable-import BUNDLE=./portable-bundles/infohub-v3-portable-xxxx.tar.gz YES=1"; \
		exit 1; \
	fi
	bash scripts/portable/import-bundle.sh "$(BUNDLE)" $(if $(YES),--yes,)

install-launchd-backup:
	bash scripts/install-launchd-backup.sh

gate: build-engine build-web qa-verify docs-check
	@echo "Gate passed."
