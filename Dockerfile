FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y mysql-server nginx supervisor && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Configure MySQL to listen on all interfaces
RUN sed -i "s/^bind-address\s*=.*/bind-address = 0.0.0.0/" /etc/mysql/mysql.conf.d/mysqld.cnf

COPY nginx_config /etc/nginx/sites-available/default
COPY web /usr/share/nginx/html
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY .env /root/.env
COPY init_mysql.sh /root/init_mysql.sh
RUN chmod +x /root/init_mysql.sh

EXPOSE 8080 3306

CMD ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
