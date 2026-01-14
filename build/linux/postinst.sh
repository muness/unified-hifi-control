#!/bin/bash
# Post-installation script for unified-hifi-control

# Reload systemd
systemctl daemon-reload

# Enable and start the service
systemctl enable unified-hifi-control.service
systemctl start unified-hifi-control.service

echo "Unified Hi-Fi Control installed successfully!"
echo "Service is running on http://localhost:8088"
