import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const repo = resolve('..')

test('UAT ACME bootstrap keeps HTTP proxy available without referencing a certificate', () => {
  const path = resolve(repo, 'deploy/nginx-uat-acme.aihuanpu.com.conf')
  assert.equal(existsSync(path), true)
  const config = readFileSync(path, 'utf8')
  assert.match(config, /listen\s+80\s*;/)
  assert.match(config, /server_name\s+uat\.aihuanpu\.com\s*;/)
  assert.match(config, /location\s+\^~\s+\/\.well-known\/acme-challenge\//)
  assert.match(config, /root\s+\/var\/www\/html\s*;/)
  assert.match(config, /proxy_pass\s+http:\/\/127\.0\.0\.1:18087\s*;/)
  assert.doesNotMatch(config, /listen\s+443|ssl_certificate/)
})

test('final UAT config redirects HTTP and serves HTTPS over HTTP2 with gzip', () => {
  const config = readFileSync(resolve(repo, 'deploy/nginx-uat.aihuanpu.com.conf'), 'utf8')
  assert.match(config, /listen\s+80\s*;/)
  assert.match(config, /location\s+\^~\s+\/\.well-known\/acme-challenge\//)
  assert.match(config, /return\s+301\s+https:\/\/\$host\$request_uri\s*;/)
  assert.match(config, /listen\s+443\s+ssl\s+http2\s*;/)
  assert.match(config, /ssl_certificate\s+\/etc\/letsencrypt\/live\/uat\.aihuanpu\.com\/fullchain\.pem\s*;/)
  assert.match(config, /ssl_certificate_key\s+\/etc\/letsencrypt\/live\/uat\.aihuanpu\.com\/privkey\.pem\s*;/)
  assert.match(config, /proxy_pass\s+http:\/\/127\.0\.0\.1:18087\s*;/)
  assert.match(config, /gzip\s+on\s*;/)
  assert.match(config, /gzip_vary\s+on\s*;/)
  assert.match(config, /gzip_proxied\s+any\s*;/)
  for (const type of ['text/css', 'application/json', 'application/javascript', 'text/javascript', 'application/xml', 'image/svg+xml']) {
    assert.match(config, new RegExp(type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.doesNotMatch(config, /Strict-Transport-Security|add_header\s+HSTS/i)
})

test('UAT updater installs the committed HTTPS config without backups and verifies HTTPS', () => {
  const script = readFileSync(resolve(repo, 'deploy/update-uat.sh'), 'utf8')
  assert.match(script, /nginx-uat\.aihuanpu\.com\.conf/)
  assert.match(script, /sudo\s+test\s+-s\s+\/etc\/letsencrypt\/live\/uat\.aihuanpu\.com\/fullchain\.pem/)
  assert.match(script, /sudo\s+test\s+-s\s+\/etc\/letsencrypt\/live\/uat\.aihuanpu\.com\/privkey\.pem/)
  assert.match(script, /nginx\s+-t/)
  assert.match(script, /systemctl\s+reload\s+nginx/)
  assert.match(script, /https:\/\/uat\.aihuanpu\.com\/api\/v1\/health/)
  assert.match(script, /UAT 更新完成：https:\/\/uat\.aihuanpu\.com/)
  assert.doesNotMatch(script, /nginx-uat[^\n]*(?:\.bak|backup)|cp[^\n]+nginx[^\n]+backup/i)
})
