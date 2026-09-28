import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(resolve(import.meta.dirname, '../../new-legacy/src/32-wechat-login.js'), 'utf8');
function harness(mobile) {
  let requests = 0;
  const back = {};
  const container = {isConnected:true,innerHTML:'', closest:()=>null, querySelector:()=>back};
  const window = {WxLogin:function(){},matchMedia:()=>({matches:mobile}), navigator:{userAgent: mobile ? 'iPhone' : 'Desktop'}};
  vm.runInNewContext(source, {window, navigator:window.navigator, document:{addEventListener(){}},
    location:{pathname:'/practice-mode.html',search:'',hash:''}, URLSearchParams, URL,
    fetch:async()=>{requests++; return {ok:true,json:async()=>({authUrl:'https://open.weixin.qq.com/connect/qrconnect?appid=test&redirect_uri=https%3A%2F%2Fexample.test&state=test'})}}, console});
  return {window,container,requests:()=>requests,back};
}
test('mobile WeChat entry gives a usable password alternative without loading self-scan QR', async()=>{
  const h=harness(true);
  await h.window.KGWechatLogin.renderPanel(h.container);
  assert.match(h.container.innerHTML,/手机登录/);
  assert.match(h.container.innerHTML,/使用账号密码登录/);
  assert.match(h.container.innerHTML,/微信.*搜索.*幻谱知习/);
  assert.match(h.container.innerHTML,/首次.*密码|设置.*密码/);
  assert.doesNotMatch(h.container.innerHTML,/wechat-login-qr/);
  assert.equal(h.requests(),0);
  assert.equal(typeof h.back.onclick,'function');
});
test('desktop retains its official QR login and password fallback', async()=>{
  const h=harness(false);
  await h.window.KGWechatLogin.renderPanel(h.container);
  assert.equal(h.requests(),1);
  assert.match(h.container.innerHTML,/wechat-login-qr/);
  assert.match(h.container.innerHTML,/使用账号密码登录/);
});
