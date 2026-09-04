"""Contracts for persisted WeChat mini-program authentication state."""

from app.models.wechat_mini import WechatMiniAuthTicket, WechatMiniSession


def test_wechat_mini_auth_tables_are_registered() -> None:
    assert WechatMiniAuthTicket.__table__.name == "wechat_mini_auth_tickets"
    assert WechatMiniSession.__table__.name == "wechat_mini_sessions"
    assert WechatMiniSession.__table__.c.token_digest.unique is True
    assert WechatMiniAuthTicket.__table__.c.ticket_digest.unique is True


def test_session_records_have_lifecycle_and_audit_columns() -> None:
    columns = WechatMiniSession.__table__.c
    assert columns.username.foreign_keys
    assert columns.login_session_id.nullable is False
    assert columns.created_at.nullable is False
    assert columns.last_seen_at.nullable is False
    assert columns.expires_at.nullable is False
    assert columns.revoked_at.nullable is True
    assert columns.client_metadata.nullable is False


def test_binding_tickets_are_expiring_and_one_time() -> None:
    columns = WechatMiniAuthTicket.__table__.c
    assert columns.openid.nullable is False
    assert columns.unionid.nullable is True
    assert columns.expires_at.nullable is False
    assert columns.consumed_at.nullable is True
