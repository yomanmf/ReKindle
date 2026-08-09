#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
    echo "install.sh must run as root" >&2
    exit 1
fi

source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
install -m 0755 "$source_dir/kindle-e2e.py" /opt/vmwatch/kindle-e2e.py
install -m 0644 "$source_dir/kindle-e2e.service" /etc/systemd/system/kindle-e2e.service
install -m 0644 "$source_dir/kindle-e2e.timer" /etc/systemd/system/kindle-e2e.timer
systemctl daemon-reload
systemctl enable --now kindle-e2e.timer
