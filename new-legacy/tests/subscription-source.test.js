'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function subscriptionApi(){
  const window={addEventListener(){}};
  const context={window,document:{addEventListener(){}},console};
  for(const name of ['plans','orders','redeem-codes','core']){
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,`../src/37-subscription-${name}.js`),'utf8'),context);
  }
  return window.KGSubscription;
}

test('subscription source labels use Chinese display text and never expose unknown canonical values',()=>{
  const api=subscriptionApi();
  const labels={default:'默认',manual:'管理员调整',redeem_code:'兑换码',wechat_pay:'微信支付',order:'订单开通',referral:'推荐奖励'};
  for(const [source,expected] of Object.entries(labels)){
    assert.equal(api.sourceLabel(source),expected);
    api.hydrateSubscriptions({student:{username:'student',planId:'monthly',source,orderId:'preserved-order'}});
    const summary=api.subscriptionSummary('student');
    assert.equal(summary.sourceText,expected);
    assert.equal(summary.subscription.source,source,'display mapping preserves canonical source');
    assert.equal(summary.subscription.orderId,'preserved-order');
  }
  for(const source of ['future_internal_source','toString','__proto__',undefined,null,'']){
    assert.equal(api.sourceLabel(source),'其他来源');
  }
  api.hydrateSubscriptions({student:{username:'student',source:'future_internal_source'}});
  assert.equal(api.subscriptionSummary('student').sourceText,'其他来源');
});
