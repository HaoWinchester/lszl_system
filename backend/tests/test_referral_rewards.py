"""First confirmed payment referral gifts on disposable PostgreSQL transactions."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.subscription import Subscription
from app.models.referral import ReferralBinding
from app.services import referral_service, subscription_service

NOW=datetime(2035,1,5,12,tzinfo=timezone.utc)
AUTH='/api/v1/auth'

@pytest.fixture(autouse=True)
def fixed_reward_clock(monkeypatch):
    monkeypatch.setattr(referral_service,'now_utc',lambda:NOW,raising=False)
    monkeypatch.setattr(subscription_service,'now_utc',lambda:NOW)


def register_only(client,code=None,name=None,**extra):
    username=name or 'gift_'+uuid4().hex[:20]
    payload={'username':username,'password':'isolated-test-password',**extra}
    if code is not None:payload['referralCode']=code
    return username,client.post(AUTH+'/register',json=payload)


def pay(username):
    from app.models.subscription import SubscriptionOrder
    key=uuid4().hex
    async def activate(db):
        db.add(SubscriptionOrder(id=key,username=username,plan_id='monthly',status='pending',pay_status='pending',amount=100))
        await db.flush()
        await subscription_service.activate_paid_order(db,key,'tx-'+key,100,True)
    run(activate)

def register_and_pay(client,code=None,name=None,**extra):
    name,response=register_only(client,code,name,**extra)
    if code and response.status_code==200:
        with ThreadPoolExecutor(max_workers=1) as pool:pool.submit(pay,name).result(timeout=20)
    return name,response

def test_registration_does_not_reward_until_first_positive_payment():
    with TestClient(app) as inviter,TestClient(app) as child:
        parent,code=owner(inviter)
        name,response=register_only(child,code);assert response.status_code==200
        assert sub(parent) is None and sub(name) is None
        pay(name)
        assert sub(parent)['expires_at']==NOW+timedelta(days=7)
        assert sub(name)['expires_at']==NOW+timedelta(days=37)
        pay(name)
        assert sub(parent)['expires_at']==NOW+timedelta(days=7)
        assert sub(name)['expires_at']==NOW+timedelta(days=67)


def run(operation):
    async def transaction():
        async with AsyncSessionLocal() as db:
            value=await operation(db)
            await db.commit()
            return value
    return asyncio.run(transaction())


def sub(username):
    async def read(db):
        row=await db.get(Subscription,username)
        return None if row is None else {key:getattr(row,key) for key in ('plan_id','status','started_at','expires_at','source','order_id','note')}
    return run(read)


def provision(username,plan='monthly',expires=None,status='active'):
    async def put(db):
        db.add(Subscription(username=username,plan_id=plan,status=status,started_at=NOW-timedelta(days=40),expires_at=expires,source='manual',note='existing note'))
    run(put)


def owner(client):
    name,response=register_and_pay(client);assert response.status_code==200
    response=client.post(AUTH+'/me/referral');assert response.status_code==200,response.text
    return name,response.json()['code']


def test_first_payment_adds_seven_days_to_both_accounts():
    with TestClient(app) as inviter,TestClient(app) as child:
        parent,code=owner(inviter)
        name,response=register_and_pay(child,code);assert response.status_code==200,response.text
        for username,client in [(parent,inviter),(name,child)]:
            record=sub(username)
            assert record is not None,'successful recommendation must create the real subscription'
            assert record['plan_id']=='monthly' and record['status']=='active'
            assert record['expires_at']==NOW+timedelta(days=7 if username==parent else 37)
            assert record['source']==('referral' if username==parent else 'wechat_pay')
            assert client.get('/api/v1/subscriptions/me').json()['entitlements']['allExamPapers'] is True
        async def receipt(db):
            binding=await db.get(ReferralBinding,name)
            assert binding.rewards_granted_at==NOW
        run(receipt)
        summary=inviter.get(AUTH+'/me/referral').json()
        assert summary['rewardEnabled'] is True and summary['rewardDays']==7
        assert name not in str(summary)


@pytest.mark.parametrize('plan,expiry,status,want_expiry,want_status',[
    ('free',None,'active',NOW+timedelta(days=7),'active'),
    ('quarterly',NOW+timedelta(days=10),'active',NOW+timedelta(days=17),'active'),
    ('half_year',NOW-timedelta(days=2),'expired',NOW+timedelta(days=7),'active'),
    ('monthly',NOW+timedelta(days=5),'paused',NOW+timedelta(days=12),'paused'),
])
def test_reward_extends_finite_membership_without_losing_days(plan,expiry,status,want_expiry,want_status):
    with TestClient(app) as inviter,TestClient(app) as child:
        parent,code=owner(inviter);provision(parent,plan,expiry,status)
        _,response=register_and_pay(child,code);assert response.status_code==200,response.text
        result=sub(parent);assert result['expires_at']==want_expiry
        assert result['status']==want_status
        assert result['plan_id']==('monthly' if plan=='free' else plan)
        if expiry and expiry>NOW:assert result['started_at']==NOW-timedelta(days=40)
        else:assert result['started_at']==NOW


def test_lifetime_subscription_is_preserved_while_invitee_gets_gift():
    with TestClient(app) as inviter,TestClient(app) as child:
        parent,code=owner(inviter);provision(parent,'lifetime',None)
        original=sub(parent)
        name,response=register_and_pay(child,code);assert response.status_code==200
        assert sub(parent)==original
        assert sub(name)['expires_at']==NOW+timedelta(days=37)


def test_failure_after_first_gift_rolls_back_payment_and_both_gifts(monkeypatch):
    original=subscription_service.grant_membership_days
    calls=[]
    async def fail_second(db,username,**kwargs):
        calls.append(username)
        if len(calls)==2:raise ValueError('gift temporarily unavailable')
        return await original(db,username,**kwargs)
    with TestClient(app) as inviter,TestClient(app) as child:
        parent,code=owner(inviter)
        name,response=register_only(child,code);assert response.status_code==200
        monkeypatch.setattr(subscription_service,'grant_membership_days',fail_second)
        with pytest.raises(ValueError):pay(name)
        assert sub(parent) is None and sub(name) is None
        async def receipt(db):assert (await db.get(ReferralBinding,name)).rewards_granted_at is None
        run(receipt)


def test_duplicate_registration_and_paid_reward_receipt_replay_cannot_extend_twice():
    with TestClient(app) as inviter,TestClient(app) as child:
        parent,code=owner(inviter)
        name,response=register_and_pay(child,code);assert response.status_code==200
        before_parent,before_child=sub(parent),sub(name)
        _,response=register_and_pay(child,code,name=name);assert response.status_code==400
        async def replay(db):
            grant=getattr(referral_service,'grant_paid_referral_rewards',None)
            assert callable(grant),'idempotent binding reward operation is required'
            assert await grant(db,name) is False
            assert await grant(db,name) is False
        run(replay)
        assert sub(parent)==before_parent and sub(name)==before_child


def test_concurrent_invites_stack_all_four_rewards_without_lost_updates():
    with TestClient(app) as inviter:
        parent,code=owner(inviter)
        def invite(_):
            child=TestClient(app)
            name,response=register_and_pay(child,code);assert response.status_code==200,response.text
            return name
        with ThreadPoolExecutor(max_workers=4) as pool:children=list(pool.map(invite,range(4)))
        assert sub(parent)['expires_at']==NOW+timedelta(days=28)
        for name in children:assert sub(name)['expires_at']==NOW+timedelta(days=37)
        assert inviter.get(AUTH+'/me/referral').json()['registeredCount']==4


def test_concurrent_same_registration_and_payment_only_create_one_pair_of_rewards():
    with TestClient(app) as inviter:
        parent,code=owner(inviter);name='gift_duplicate_'+uuid4().hex[:12]
        def invite(_):
            return register_and_pay(TestClient(app),code,name=name)[1].status_code
        with ThreadPoolExecutor(max_workers=2) as pool:statuses=list(pool.map(invite,range(2)))
        assert sorted(statuses)[0]==200 and sorted(statuses)[1] in (400,409)
        assert sub(parent)['expires_at']==NOW+timedelta(days=7)
        assert sub(name)['expires_at']==NOW+timedelta(days=37)


def test_client_cannot_choose_reward_days_or_recipients_and_no_code_means_no_gift():
    with TestClient(app) as inviter,TestClient(app) as child,TestClient(app) as unrelated:
        parent,code=owner(inviter)
        victim,response=register_and_pay(unrelated);assert response.status_code==200
        assert sub(victim) is None
        name,response=register_and_pay(child,code,rewardDays=999,recipient=victim,rewardRecipient=victim)
        assert response.status_code==200,response.text
        assert sub(victim) is None
        assert sub(parent)['expires_at']==NOW+timedelta(days=7)
        assert sub(name)['expires_at']==NOW+timedelta(days=37)
        assert child.post(AUTH+'/me/referral/rewards',json={'recipient':victim,'days':999}).status_code in (404,405)


def test_reading_historical_binding_does_not_retroactively_award_membership():
    with TestClient(app) as inviter,TestClient(app) as child:
        parent,code=owner(inviter);name,response=register_and_pay(child);assert response.status_code==200
        async def historical(db):db.add(ReferralBinding(invitee_username=name,inviter_username=parent))
        run(historical)
        assert inviter.get(AUTH+'/me/referral').json()['registeredCount']==1
        inviter.post(AUTH+'/me/referral')
        assert sub(parent) is None and sub(name) is None


@pytest.mark.parametrize('operation',['admin','redeem','payment','approve'])
def test_existing_subscription_writers_refresh_stale_session_after_a_gift(operation):
    """An earlier permission read must not write back pre-gift expiry metadata."""
    from app.models.subscription import RedeemCode, SubscriptionOrder
    with TestClient(app) as inviter,TestClient(app) as child:
        parent,code=owner(inviter);provision(parent,expires=NOW+timedelta(days=10))
        token=uuid4().hex
        async def exercise():
            async with AsyncSessionLocal() as db:
                stale=await db.get(Subscription,parent)
                if operation=='redeem':
                    db.add(RedeemCode(id=token,code=token.upper(),plan_id='monthly',status='unused'))
                elif operation in ('payment','approve'):
                    db.add(SubscriptionOrder(id=token,username=parent,plan_id='monthly',status='pending',pay_status='pending'))
                await db.commit()
                assert stale.expires_at==NOW+timedelta(days=10)
                _,response=register_and_pay(child,code);assert response.status_code==200,response.text
                assert stale.expires_at==NOW+timedelta(days=10),'this session deliberately retains its earlier snapshot'
                if operation=='admin':await subscription_service.admin_set(db,parent,'monthly',None,None,'fixture-admin')
                elif operation=='redeem':await subscription_service.redeem(db,parent,token.upper())
                elif operation=='payment':await subscription_service.activate_paid_order(db,token,'fixture-payment')
                else:await subscription_service.approve_order(db,token,'fixture-admin')
                result=await db.get(Subscription,parent)
                assert result.expires_at==NOW+timedelta(days=47)
        asyncio.run(exercise())


def test_initial_subscription_get_and_paid_reward_do_not_race_first_insert():
    from threading import Barrier
    with TestClient(app) as inviter:
        parent,code=owner(inviter);cookies=dict(inviter.cookies);barrier=Barrier(2)
        def get():
            with TestClient(app) as reader:
                reader.cookies.update(cookies);barrier.wait(timeout=10)
                response=reader.get('/api/v1/subscriptions/me');assert response.status_code==200,response.text
        def signup():
            with TestClient(app) as child:
                barrier.wait(timeout=10);_,response=register_and_pay(child,code);assert response.status_code==200,response.text
        with ThreadPoolExecutor(max_workers=2) as pool:
            one=pool.submit(get);two=pool.submit(signup);one.result();two.result()
        assert sub(parent)['expires_at']==NOW+timedelta(days=7)


@pytest.mark.parametrize('role,allowed',[('student',True),('viewer',False),('teacher',True),('admin',True)])
def test_gifts_do_not_change_role_or_bypass_viewer_permissions(role,allowed):
    with TestClient(app) as inviter,TestClient(app) as child:
        parent,code=owner(inviter)
        async def set_role(db):
            from app.models.user import User
            user=await db.get(User,parent);user.role=role
        run(set_role)
        _,response=register_and_pay(child,code);assert response.status_code==200
        assert inviter.get(AUTH+'/me').json()['user']['role']==role
        assert inviter.get('/api/v1/subscriptions/me').json()['entitlements']['allExamPapers'] is allowed


def test_active_paid_metadata_and_paused_lifetime_are_not_rewritten():
    with TestClient(app) as inviter,TestClient(app) as child:
        parent,code=owner(inviter);provision(parent,expires=NOW+timedelta(days=3))
        original=sub(parent);_,response=register_and_pay(child,code);assert response.status_code==200
        after=sub(parent)
        assert after['source']==original['source'] and after['order_id']==original['order_id']
        assert after['expires_at']==NOW+timedelta(days=10)
    with TestClient(app) as inviter,TestClient(app) as child:
        parent,code=owner(inviter);provision(parent,'lifetime',None,'paused');original=sub(parent)
        _,response=register_and_pay(child,code);assert response.status_code==200
        assert sub(parent)==original
        assert inviter.get('/api/v1/subscriptions/me').json()['entitlements']['allExamPapers'] is False


def test_subscription_expiring_exactly_now_restarts_from_same_server_time():
    with TestClient(app) as inviter,TestClient(app) as child:
        parent,code=owner(inviter);provision(parent,expires=NOW)
        _,response=register_and_pay(child,code);assert response.status_code==200
        assert sub(parent)['started_at']==NOW
        assert sub(parent)['expires_at']==NOW+timedelta(days=7)


def test_real_member_only_template_access_unlocks_after_referral_payment():
    from app.models.user import User
    with TestClient(app) as teacher,TestClient(app) as inviter,TestClient(app) as child:
        author,response=register_and_pay(teacher);assert response.status_code==200
        async def promote(db):
            user=await db.get(User,author);user.role='teacher'
        run(promote)
        response=teacher.post('/api/v1/files',json={'name':'referral gift permission fixture','graphData':{'nodes':[{'id':'gift-node','title':'Gift permission fixture','x':200,'y':200}],'links':[]}})
        assert response.status_code==200,response.text
        file_id=response.json()['file']['id']
        response=teacher.post('/api/v1/graph-templates',json={'sourceFileId':file_id,'expectedFileRevision':1,'name':'referral membership fixture','description':'isolated fixture','memberOnly':True})
        assert response.status_code==201,response.text
        template=response.json()['template']
        path='/api/v1/graph-templates/'+template['id']+'/loads'
        parent,code=owner(inviter)
        assert inviter.post(path,json={'requestId':uuid4().hex,'version':template['version']}).status_code==403
        _,response=register_and_pay(child,code);assert response.status_code==200
        for client in (inviter,child):
            response=client.post(path,json={'requestId':uuid4().hex,'version':template['version']})
            assert response.status_code==201,response.text

@pytest.mark.parametrize('state',['mismatch','cancelled','failed','zero','unverified','historical'])
def test_payment_validation_and_historical_receipt_do_not_issue_new_gift(state):
    from app.models.subscription import SubscriptionOrder
    with TestClient(app) as inviter,TestClient(app) as child:
        parent,code=owner(inviter);name,response=register_only(child,code);assert response.status_code==200
        key=uuid4().hex
        async def setup(db):
            db.add(SubscriptionOrder(id=key,username=name,plan_id='monthly',status='cancelled' if state=='cancelled' else 'pending',pay_status='failed' if state=='failed' else 'pending',amount=0 if state=='zero' else 100))
            if state=='historical':(await db.get(ReferralBinding,name)).rewards_granted_at=NOW-timedelta(days=10)
        run(setup)
        async def activate(db):
            if state=='unverified':return await subscription_service.approve_order(db,key,'fixture-admin')
            return await subscription_service.activate_paid_order(db,key,'tx',99 if state=='mismatch' else (0 if state=='zero' else 100),True)
        if state in ('mismatch','cancelled','failed'):
            with pytest.raises(ValueError):run(activate)
        else:run(activate)
        assert sub(parent) is None
        if state=='historical':assert sub(name)['expires_at']==NOW+timedelta(days=30)


def test_cross_referral_concurrent_payments_and_repeated_notifications_do_not_deadlock():
    from app.models.subscription import SubscriptionOrder
    with TestClient(app) as inviter,TestClient(app) as child:
        parent,code=owner(inviter);name,response=register_only(child,code);assert response.status_code==200
        keys=[uuid4().hex,uuid4().hex]
        async def setup(db):
            db.add(ReferralBinding(invitee_username=parent,inviter_username=name))
            for key,username in zip(keys,[parent,name]):db.add(SubscriptionOrder(id=key,username=username,plan_id='monthly',status='pending',pay_status='pending',amount=100))
        run(setup)
        def notify(key):return run(lambda db:subscription_service.activate_paid_order(db,key,'tx-'+key,100,True))
        with ThreadPoolExecutor(max_workers=4) as pool:
            futures=[pool.submit(notify,key) for key in keys*2]
            for future in futures:future.result(timeout=20)
        for username in (parent,name):assert sub(username)['expires_at']==NOW+timedelta(days=44)
