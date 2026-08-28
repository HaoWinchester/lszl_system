# UAT 部署

UAT 域名为 `uat.aihuanpu.com`，应用只监听服务器本机 `127.0.0.1:18087`。Nginx 配置必须来自 `deploy/`，UAT 部署不创建备份文件。

## 首次启用 HTTPS

只有服务器尚无 `uat.aihuanpu.com` 证书时执行一次：

```bash
rsync -az deploy/nginx-uat-acme.aihuanpu.com.conf resume-prod:/tmp/nginx-uat-acme.aihuanpu.com.conf
ssh resume-prod 'sudo install -m 0644 /tmp/nginx-uat-acme.aihuanpu.com.conf /etc/nginx/conf.d/uat.aihuanpu.com.conf && sudo nginx -t && sudo systemctl reload nginx'
ssh resume-prod 'sudo certbot certonly --webroot -w /var/www/html -d uat.aihuanpu.com --non-interactive --agree-tos'
```

证书签发成功后再安装最终配置：

```bash
rsync -az deploy/nginx-uat.aihuanpu.com.conf resume-prod:/tmp/nginx-uat.aihuanpu.com.conf
ssh resume-prod 'test -s /etc/letsencrypt/live/uat.aihuanpu.com/fullchain.pem && test -s /etc/letsencrypt/live/uat.aihuanpu.com/privkey.pem && sudo install -m 0644 /tmp/nginx-uat.aihuanpu.com.conf /etc/nginx/conf.d/uat.aihuanpu.com.conf && sudo nginx -t && sudo systemctl reload nginx'
```

若签发失败，保留 ACME bootstrap 配置继续提供 HTTP，禁止安装引用不存在证书的最终配置。

## 常规更新

```bash
bash deploy/update-uat.sh
```

脚本会构建并 promote 不可变前端 release、更新 UAT 容器、安装 Git 中的最终 Nginx 配置，然后验证公网 HTTPS 健康检查。发布前必须确认 active release 文件数和关键页面完整，禁止手工覆盖 release site。

本机 `manage-new-legacy.js update` / promote 成功只代表本机 release 更新，不代表公网已部署。宣布 UAT 发布完成前，必须同时核对公网页面 `data-release`、公网关键 JS/CSS 与候选的 SHA-256、UAT 容器 active 指针和迁移版本；不能用 `127.0.0.1:5173` 的验收替代 `https://uat.aihuanpu.com`。同步记录正式站容器 ID 与公网版本，更新后确认正式站未变。浏览器登录业务回归和 HTTP 文件核验须分别描述。

## 验证

```bash
curl -I http://uat.aihuanpu.com/
curl --http2 -I https://uat.aihuanpu.com/
curl --compressed -I https://uat.aihuanpu.com/bundles/home-shell.js
curl --compressed https://uat.aihuanpu.com/api/v1/health
```

预期 HTTP 返回 301，HTTPS 能协商 HTTP/2，JS/CSS/JSON 可压缩响应包含 `Content-Encoding: gzip`。
