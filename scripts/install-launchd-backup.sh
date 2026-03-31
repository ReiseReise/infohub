#!/usr/bin/env bash
# 安装本地 launchd 定时备份任务（macOS）

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENT_ID="${BACKUP_LAUNCHD_LABEL:-com.infohub.backup}"
HOUR="${BACKUP_SCHEDULE_HOUR:-2}"
MINUTE="${BACKUP_SCHEDULE_MINUTE:-30}"
LAUNCH_AGENTS_DIR="${HOME}/Library/LaunchAgents"
PLIST_PATH="${LAUNCH_AGENTS_DIR}/${AGENT_ID}.plist"
LOG_DIR="${ROOT_DIR}/logs"
LOG_PATH="${LOG_DIR}/launchd-backup.log"

mkdir -p "$LAUNCH_AGENTS_DIR" "$LOG_DIR"

cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${AGENT_ID}</string>
    <key>ProgramArguments</key>
    <array>
      <string>/bin/bash</string>
      <string>-lc</string>
      <string>cd '${ROOT_DIR}' &amp;&amp; make portable-backup &gt;&gt; '${LOG_PATH}' 2&gt;&amp;1</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>StartCalendarInterval</key>
    <dict>
      <key>Hour</key>
      <integer>${HOUR}</integer>
      <key>Minute</key>
      <integer>${MINUTE}</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>${LOG_PATH}</string>
    <key>StandardErrorPath</key>
    <string>${LOG_PATH}</string>
    <key>WorkingDirectory</key>
    <string>${ROOT_DIR}</string>
  </dict>
</plist>
PLIST

launchctl unload "$PLIST_PATH" >/dev/null 2>&1 || true
launchctl load -w "$PLIST_PATH"

echo "✅ launchd 备份任务已安装"
echo "   Label: ${AGENT_ID}"
echo "   时间: 每天 ${HOUR}:$(printf '%02d' "$MINUTE")"
echo "   Plist: ${PLIST_PATH}"
echo "   日志: ${LOG_PATH}"
