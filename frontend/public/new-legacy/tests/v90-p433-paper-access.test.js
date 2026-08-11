'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

global.window = global;
global.KGAuthCore = {
  currentUser: () => global.__paperAccessUser || null,
};
global.KGRolePermissions = {
  currentRole: () => global.__paperAccessRole || 'guest',
};
global.KGSubscription = {
  canUse: feature => feature === 'allExamPapers' && global.__localExamEntitlement === true,
};

const servicePath = path.resolve(__dirname, '../src/58-paper-access-service.js');
delete require.cache[servicePath];
const access = require(servicePath);

const freePaper = { accessPolicy: { accessLevel: 'free' } };
const vipPaper = { accessPolicy: { accessLevel: 'member' } };

global.__paperAccessRole = 'student';
global.__paperAccessUser = { username: 'free-student', role: 'student' };
global.__localExamEntitlement = false;
global.KGServerEntitlements = { allExamPapers: false };
assert.deepEqual(access.inspect(freePaper), {
  allowed: true,
  accessLevel: 'free',
  state: 'free',
  code: 'FREE_PAPER',
  message: '免费试卷',
});
assert.equal(access.inspect(vipPaper).allowed, false);
assert.equal(access.inspect(vipPaper).code, 'MEMBERSHIP_REQUIRED');

global.KGServerEntitlements = { allExamPapers: true };
assert.equal(access.inspect(vipPaper).allowed, true);
assert.equal(access.inspect(vipPaper).code, 'MEMBER_ACCESS');

global.KGServerEntitlements = undefined;
global.__localExamEntitlement = true;
assert.equal(access.inspect(vipPaper).allowed, true);

global.__paperAccessRole = 'teacher';
global.__paperAccessUser = { username: 'teacher', role: 'teacher' };
global.__localExamEntitlement = false;
assert.equal(access.inspect(vipPaper).code, 'ROLE_BYPASS');

global.__paperAccessRole = 'guest';
global.__paperAccessUser = null;
assert.equal(access.inspect(vipPaper).code, 'LOGIN_REQUIRED');
assert.equal(access.normalizeAccessLevel('premium'), 'member');

delete global.KGSubscriptionPlansModule;
const plansPath = path.resolve(__dirname, '../src/37-subscription-plans.js');
delete require.cache[plansPath];
require(plansPath);
const plans = global.KGSubscriptionPlansModule({
  readJSON: (_key, fallback) => fallback,
  writeJSON: () => true,
});

assert.equal(plans.planById('free').features.allExamPapers, false);
for (const planId of ['monthly', 'quarterly', 'half_year', 'lifetime']) {
  assert.equal(plans.planById(planId).features.allExamPapers, true, `${planId} 应包含全部已发布试卷权益`);
}
assert.equal(plans.featureLabel('allExamPapers'), '全部已发布试卷');

console.log('v90-p433 paper access tests passed');
