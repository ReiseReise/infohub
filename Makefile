.PHONY: help build build-engine build-web test-engine test-web test-audio lint-web config-policy-test portable-artifact-test portable-import-safety-test security-context-test qa-isolation-test check-unit qa-verify qa-full qa-real-audio docs-check gate gate-integration archive acceptance-users hn-test-package import-legacy-config seed-daily-report-agents portable-export portable-import portable-backup install-launchd-backup

help:
	@echo "可用命令:"
	@echo "  make build-engine  - 构建后端 hub-engine"
	@echo "  make build-web     - 构建前端 web"
	@echo "  make test-engine   - 执行 Hub Engine 单元测试"
	@echo "  make test-web      - 执行 Web 单元测试"
	@echo "  make test-audio    - 用 host python unittest 执行音频测试"
	@echo "  make lint-web      - 执行 Web ESLint"
	@echo "  make check-unit    - 执行三组单测、Web lint 与 portable 策略测试"
	@echo "  make qa-verify    - 当前拒绝：尚无完整隔离 QA runner"
	@echo "  make qa-full      - 当前拒绝：尚无完整隔离 QA runner"
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
	@echo "  make gate          - 执行安全静态门禁（单测 + lint + build + docs）"
	@echo "  make gate-integration - 当前拒绝：尚无完整隔离 QA runner"

build: build-engine build-web

build-engine:
	cd services/hub-engine && npm run build

build-web:
	cd apps/web && npm run build

test-engine:
	cd services/hub-engine && npm test

test-web:
	cd apps/web && npm test

test-audio:
	python3 -m unittest discover -s services/audio/tests -p 'test_*.py'

lint-web:
	cd apps/web && npm run lint

config-policy-test:
	bash scripts/portable/config-policy.test.sh

portable-artifact-test:
	bash scripts/portable/artifact-policy.test.sh

portable-import-safety-test:
	bash scripts/portable/import-safety-policy.test.sh

security-context-test:
	bash scripts/reproducibility/security-context.test.sh

qa-isolation-test:
	bash scripts/qa/isolation-policy.test.sh
	bash qa/helpers/redis-read.test.sh

check-unit: test-engine test-web test-audio lint-web config-policy-test portable-artifact-test portable-import-safety-test security-context-test qa-isolation-test

qa-verify:
	@echo "qa-verify 已关闭：full suite 仍含未参数化的热栈依赖，且项目尚无完整隔离 QA runner/manifest。"; exit 1

qa-full:
	@echo "qa-full 已关闭：full suite 仍含未参数化的热栈依赖，且项目尚无完整隔离 QA runner/manifest。"; exit 1

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

gate: check-unit build docs-check
	@echo "Gate passed."

gate-integration:
	@echo "gate-integration 已关闭：在完整隔离 QA runner 与依赖清单落地前不得运行。"; exit 1
