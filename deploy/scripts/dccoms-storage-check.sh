#!/usr/bin/env bash
set -euo pipefail

WARN=70
CRIT=80
PANIC=90

usage=$(df -P /data | awk 'NR==2 {gsub("%","",$5); print $5}')
free=$(df -h /data | awk 'NR==2 {print $4}')

if [ "$usage" -ge "$PANIC" ]; then
    logger -p daemon.crit \
      "DC Coms STORAGE PANIC: /data ${usage}% full, ${free} free"
elif [ "$usage" -ge "$CRIT" ]; then
    logger -p daemon.err \
      "DC Coms STORAGE CRITICAL: /data ${usage}% full, ${free} free"
elif [ "$usage" -ge "$WARN" ]; then
    logger -p daemon.warning \
      "DC Coms STORAGE WARNING: /data ${usage}% full, ${free} free"
fi
