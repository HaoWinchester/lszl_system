import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(resolve(import.meta.dirname, '../../new-legacy/src/32-wechat-login.js'), 'utf8');
function harness(mobile, readyState, {narrow=mobile, coarse=mobile}={}) {
  const requests = [], listeners = new Map();
  let panelInitializations = 0;
  const back = {};
  const container = {isConnected:true,innerHTML:'', closest:()=>null, querySelector:()=>back};
  const window = {WxLogin:function(){},matchMedia:query=>({matches:query.includes('max-width')?narrow:coarse}), navigator:{userAgent: mobile ? 'iPhone' : 'Desktop'}};
  const document = {
    readyState,
    addEventListener(type, listener) { listeners.set(type, listener) },
    getElementById(id) { if (id === 'authModal') panelInitializations++; return null },
    querySelector() { return null },
  };
  vm.runInNewContext(source, {window, navigator:window.navigator, document,
    location:{pathname:'/practice-mode.html',search:'',hash:''}, URLSearchParams, URL,
    fetch:async(url)=>{requests.push(url); return {ok:true,json:async()=>url.endsWith('/config')
      ? {mode:'official'}
      : {authUrl:'https://open.weixin.qq.com/connect/qrconnect?appid=test&redirect_uri=https%3A%2F%2Fexample.test&state=test'}}}, console});
  return {window,container,requests,back,panelInitializations:()=>panelInitializations,
    domReady() { document.readyState='interactive'; listeners.get('DOMContentLoaded')?.() }};
}
for (const readyState of ['loading', 'complete']) {
  test(`narrow desktop retains the official scan flow when DOM is ${readyState}`, async()=>{
    const h=harness(false,readyState,{narrow:true,coarse:false});
    if(readyState==='loading')h.domReady();
    await h.window.KGWechatLogin.renderPanel(h.container);
    assert.match(h.container.innerHTML,/wechat-login-qr/);
    assert.doesNotMatch(h.container.innerHTML,/手机登录/);
    assert.equal(h.requests.filter(url=>url.includes('/auth-url?')).length,1);
  });
  for (const mobile of [true, false]) {
    test(`${mobile ? 'mobile password alternative without self-scan QR' : 'desktop official QR and password fallback'} initializes when DOM is ${readyState}`, async()=>{
      const h=harness(mobile, readyState);
      assert.equal(h.panelInitializations(),readyState==='loading'?0:1);
      assert.equal(h.requests.length,readyState==='loading'?0:1);
      if(readyState==='loading')h.domReady();
      await Promise.resolve();
      assert.equal(h.panelInitializations(),1);
      assert.equal(h.requests.filter(url=>url.endsWith('/config')).length,1);
      await h.window.KGWechatLogin.renderPanel(h.container);
      assert.match(h.container.innerHTML,/使用账号密码登录/);
      assert.equal(h.requests.length,mobile?1:2,'only public config and desktop authorization may be requested');
      if(mobile){
        assert.match(h.container.innerHTML,/手机登录/);
        assert.match(h.container.innerHTML,/微信.*搜索.*幻谱知习/);
        assert.match(h.container.innerHTML,/首次.*密码|设置.*密码/);
        assert.doesNotMatch(h.container.innerHTML,/wechat-login-qr/);
        assert.equal(h.requests.filter(url=>url.includes('/auth-url?')).length,0);
        assert.equal(typeof h.back.onclick,'function');
      }else{
        assert.equal(h.requests.filter(url=>url.includes('/auth-url?')).length,1);
        assert.match(h.container.innerHTML,/wechat-login-qr/);
      }
    });
  }
}
