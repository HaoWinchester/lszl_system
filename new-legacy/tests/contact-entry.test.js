import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const read = name => fs.readFileSync(new URL(name, root), 'utf8');
const landing = read('landing.html');
const landingJs = read('src/landing.js');
const support = read('src/103-support-center.js');
const landingCss = read('styles/landing.css');
const supportCss = read('styles/support-center.css');

test('landing exposes contact navigation and shared modal', () => {
  assert.match(landing, /class="landing-contact-btn"[^>]*data-open-contact/);
  assert.match(landing, /id="landingContactModal"/);
  assert.match(landing, /assets\/(?:%E5%AE%A2%E6%9C%8D%E4%BA%8C%E7%BB%B4%E7%A0%81|客服二维码)\/1\.jpg/);
  assert.match(landingJs, /data-open-contact/);
  assert.match(landingJs, /landingContactModalClose/);
});

test('support center exposes contact action and QR image', () => {
  assert.match(support, /data-support-action="contact"/);
  assert.match(support, /contact-service-qrcode/);
  assert.match(support, /assets\/客服二维码\/1\.jpg/);
});

test('contact styles define button and modal presentation', () => {
  assert.match(landingCss, /\.landing-nav \.landing-contact-btn/);
  assert.match(landingCss, /\.landing-contact-modal-backdrop/);
  assert.match(supportCss, /\.contact-service-qrcode/);
});

test('customer QR image exists', () => {
  assert.equal(fs.existsSync(new URL('assets/客服二维码/1.jpg', root)), true);
});
