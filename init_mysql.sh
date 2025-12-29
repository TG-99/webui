#!/bin/bash
set -e

# Load environment variables from .env
export $(grep -v '^#' /root/.env | xargs)

# Initialize data directory if empty
if [ ! -d "/var/lib/mysql/mysql" ]; then
    mysqld --initialize-insecure --user=mysql
fi

# Start MySQL in the background
mysqld_safe &

# Wait for MySQL to be ready
until mysqladmin ping >/dev/null 2>&1; do
    sleep 1
done

# Create DB and user if not exist
mysql -u root <<MYSQL_SCRIPT
CREATE DATABASE IF NOT EXISTS \`${MYSQL_DATABASE}\`;
CREATE USER IF NOT EXISTS '${MYSQL_USER}'@'%' IDENTIFIED BY '${MYSQL_PASSWORD}';
GRANT ALL PRIVILEGES ON \`${MYSQL_DATABASE}\`.* TO '${MYSQL_USER}'@'%';
FLUSH PRIVILEGES;
MYSQL_SCRIPT

# Stop background MySQL, then exec the real foreground process
mysqladmin -u root shutdown

# Start MySQL in foreground for Supervisor
exec /usr/sbin/mysqld