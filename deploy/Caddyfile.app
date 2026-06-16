# Caddy 自动 HTTPS 反代主站。把 yonglin.chat 与 www 的 DNS A 记录指向本 VPS 公网 IP。
# 写进 /etc/caddy/Caddyfile 后：systemctl reload caddy
# 香港 VPS 免备案；Caddy 会自动申请/续期 Let's Encrypt 证书（需放行 80/443）。

yonglin.chat, www.yonglin.chat {
    reverse_proxy 127.0.0.1:8787
    encode gzip
    request_body {
        max_size 30MB
    }
}
