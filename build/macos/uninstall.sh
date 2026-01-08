#!/bin/bash

# Uninstall script for Unified Hi-Fi Control

echo "Uninstalling Unified Hi-Fi Control..."

# Stop and unload the service
launchctl stop com.cloudatlas.unified-hifi-control 2>/dev/null || true
launchctl unload /Library/LaunchDaemons/com.cloudatlas.unified-hifi-control.plist 2>/dev/null || true

# Remove files
rm -f /usr/local/bin/unified-hifi-control
rm -f /Library/LaunchDaemons/com.cloudatlas.unified-hifi-control.plist

# Optionally remove data (ask user)
read -p "Remove configuration data? [y/N] " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -rf /usr/local/var/unified-hifi-control
    echo "Configuration data removed."
fi

# Remove package receipt
pkgutil --forget com.cloudatlas.unified-hifi-control 2>/dev/null || true

echo "Unified Hi-Fi Control has been uninstalled."
