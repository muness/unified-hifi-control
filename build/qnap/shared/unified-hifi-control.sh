#!/bin/bash

CONF=/etc/config/qpkg.conf
QPKG_NAME="unified-hifi-control"
QPKG_ROOT=$(/sbin/getcfg $QPKG_NAME Install_Path -f $CONF)
PID_FILE="${QPKG_ROOT}/unified-hifi-control.pid"
LOG_FILE="${QPKG_ROOT}/unified-hifi-control.log"

start_daemon() {
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        echo "${QPKG_NAME} is already running"
        return 0
    fi

    echo "Starting ${QPKG_NAME}..."
    cd "${QPKG_ROOT}" || exit 1

    nohup "${QPKG_ROOT}/unified-hifi-control" >> "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"

    sleep 2

    if kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        /sbin/setcfg $QPKG_NAME Enable TRUE -f $CONF
        echo "${QPKG_NAME} started successfully"
        return 0
    else
        echo "Failed to start ${QPKG_NAME}"
        rm -f "$PID_FILE"
        return 1
    fi
}

stop_daemon() {
    if [ ! -f "$PID_FILE" ]; then
        echo "${QPKG_NAME} is not running"
        return 0
    fi

    echo "Stopping ${QPKG_NAME}..."

    PID=$(cat "$PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
        kill "$PID"
        sleep 2

        if kill -0 "$PID" 2>/dev/null; then
            kill -9 "$PID"
        fi
    fi

    rm -f "$PID_FILE"
    echo "${QPKG_NAME} stopped"
    return 0
}

restart_daemon() {
    stop_daemon
    sleep 1
    start_daemon
}

daemon_status() {
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        return 0
    fi
    return 1
}

case "$1" in
    start)
        start_daemon
        ;;
    stop)
        stop_daemon
        ;;
    restart)
        restart_daemon
        ;;
    status)
        if daemon_status; then
            echo "${QPKG_NAME} is running"
            exit 0
        else
            echo "${QPKG_NAME} is stopped"
            exit 1
        fi
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status}"
        exit 1
        ;;
esac

exit 0
