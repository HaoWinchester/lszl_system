"""Engagement runtime migration mappers, isolated from the domain service."""
from __future__ import annotations
import json
import re
from typing import Any, Mapping
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert
from app.models.engagement import Announcement, AnnouncementAudience, Feedback, FeedbackReply, FeedbackReceipt, MessageReceipt
from app.models.user import User

FEEDBACK_KEY = "kg_user_feedback_v1"
ANNOUNCEMENT_KEY = "kg_announcements_v1"

def _clean(value: Any) -> str:
    return str(value or "").strip()

def _rows(value: Any) -> list[dict[str, Any]]:
    try: value = json.loads(value) if isinstance(value, str) else value
    except (TypeError, ValueError, json.JSONDecodeError): return []
    return [dict(x) for x in value if isinstance(x, Mapping)] if isinstance(value, list) else []

def expected_canonical(payload: Any, source_key: str) -> list[dict[str, Any]]:
    rows=_rows(payload); result=[]
    for raw in rows:
        identifier=_clean(raw.get("id"))
        if not identifier: continue
        if source_key==ANNOUNCEMENT_KEY:
            a=raw.get("audience") if isinstance(raw.get("audience"),Mapping) else {"type":"all"}; typ=_clean(a.get("type")) or "all"
            result.append({"id":identifier,"title":_clean(raw.get("title")),"body":_clean(raw.get("body")),"link":_clean(raw.get("link")),"status":_clean(raw.get("status")) or "draft","publishAt":int(raw.get("publishAt") or 0),"expiresAt":int(raw.get("expiresAt") or 0),"publishedAt":int(raw.get("publishedAt") or 0),"withdrawnAt":int(raw.get("withdrawnAt") or 0),"createdBy":_clean(raw.get("createdBy")),"audience":{"type":typ,"roles":[_clean(x) for x in a.get("roles",[]) if _clean(x)],"users":[_clean(x) for x in a.get("users",[]) if _clean(x)]}})
        elif source_key==FEEDBACK_KEY:
            actor=raw.get("submittedBy") if isinstance(raw.get("submittedBy"),Mapping) else {}; rs=raw.get("replies") if isinstance(raw.get("replies"),list) else []
            result.append({"id":identifier,"type":_clean(raw.get("type")) or "suggestion","title":_clean(raw.get("title")),"detail":_clean(raw.get("detail")),"page":_clean(raw.get("page")),"appVersion":_clean(raw.get("appVersion")),"contact":_clean(raw.get("contact")),"attachment":raw.get("attachment"),"status":_clean(raw.get("status")) or "pending","submittedBy":{"username":_clean(actor.get("username"))},"replies":[{"id":_clean(x.get("id")),"message":_clean(x.get("message")),"actor":_clean(x.get("actor")),"actorUsername":_clean(x.get("actorUsername")),"createdAt":int(x.get("createdAt") or 0)} for x in rs if isinstance(x,Mapping) and _clean(x.get("id"))]})
    return result

def _validate_announcement(raw: Mapping[str, Any]) -> None:
    if not _clean(raw.get("title")) or not _clean(raw.get("body")):
        raise ValueError("announcement source is missing title or body")
    creator = raw.get("createdBy")
    if isinstance(creator, Mapping): creator = creator.get("username") or creator.get("id")
    if not _clean(creator):
        raise ValueError("announcement source is missing creator")
    link = _clean(raw.get("link"))
    if link and not re.match(r"^https?://", link, re.I):
        raise ValueError("announcement link must use HTTP(S)")
    attachment = raw.get("attachment")
    if attachment is not None and not isinstance(attachment, Mapping):
        raise ValueError("announcement attachment must be an object")

def _canonical_announcement(raw: Mapping[str, Any], row: Announcement, audience: Mapping[str, Any]) -> dict[str, Any]:
    return {"id":row.id,"title":row.title,"body":row.body,"link":row.link,"status":row.status,"publishAt":row.publish_at,"expiresAt":row.expires_at,"publishedAt":row.published_at,"withdrawnAt":row.withdrawn_at,"createdBy":row.created_by,"audience":dict(audience)}

def _canonical_feedback(raw: Mapping[str, Any], row: Feedback, replies: list[FeedbackReply]) -> dict[str, Any]:
    return {"id":row.id,"type":row.type,"title":row.title,"detail":row.detail,"page":row.page,"appVersion":row.app_version,"contact":row.contact,"attachment":row.attachment,"status":row.status,"submittedBy":{"username":row.submitted_by},"replies":[{"id":x.id,"message":x.message,"actor":x.actor,"actorUsername":x.actor_username,"createdAt":x.created_at} for x in replies]}

async def _trusted_owner(db: AsyncSession, candidate: str, fallback: str) -> str:
    candidate = _clean(candidate)
    if candidate and await db.get(User, candidate): return candidate
    fallback = _clean(fallback)
    if fallback and await db.get(User, fallback): return fallback
    raise ValueError("engagement migration owner is not a trusted user")

async def _announcement_mapper(db: AsyncSession, item: Any) -> Mapping[str, Any]:
    rows = _rows(item.source_payload)
    for raw in rows:
        _validate_announcement(raw)
        identifier = _clean(raw.get("id"))
        if not identifier: continue
        row = await db.get(Announcement, identifier)
        actor = await _trusted_owner(db, _clean(raw.get("createdBy")), _clean(item.owner_scope))
        now = int(raw.get("updatedAt") or raw.get("createdAt") or 0)
        if row is None:
            row = Announcement(id=identifier, title=_clean(raw.get("title")), body=_clean(raw.get("body")), link=_clean(raw.get("link")), status=_clean(raw.get("status")) or "draft", publish_at=int(raw.get("publishAt") or 0), expires_at=int(raw.get("expiresAt") or 0), published_at=int(raw.get("publishedAt") or 0), withdrawn_at=int(raw.get("withdrawnAt") or 0), created_by=actor, created_at=int(raw.get("createdAt") or now), updated_at=now)
            db.add(row)
        else:
            row.title=_clean(raw.get("title")); row.body=_clean(raw.get("body")); row.link=_clean(raw.get("link")); row.status=_clean(raw.get("status")) or "draft"; row.publish_at=int(raw.get("publishAt") or 0); row.expires_at=int(raw.get("expiresAt") or 0); row.published_at=int(raw.get("publishedAt") or 0); row.withdrawn_at=int(raw.get("withdrawnAt") or 0); row.created_by=actor; row.updated_at=now
        audience = raw.get("audience") if isinstance(raw.get("audience"), Mapping) else {"type": "all"}
        typ = _clean(audience.get("type")) or "all"
        values = [""] if typ == "all" else [_clean(x) for x in audience.get("roles" if typ == "roles" else "users", []) if _clean(x)]
        await db.execute(delete(AnnouncementAudience).where(AnnouncementAudience.announcement_id == identifier))
        for value in values:
            await db.execute(insert(AnnouncementAudience).values(id=f"aud-{identifier}-{typ}-{value or 'all'}"[:64], announcement_id=identifier, audience_type=typ, audience_value=value).on_conflict_do_nothing(constraint="uq_announcement_audience"))
    await db.flush()
    canonical = []
    for raw in rows:
        row = await db.get(Announcement, _clean(raw.get("id")))
        if row is not None:
            audience_rows=list((await db.scalars(select(AnnouncementAudience).where(AnnouncementAudience.announcement_id==row.id))).all())
            typ=audience_rows[0].audience_type if audience_rows else "all"
            audience={"type":typ,"roles":[x.audience_value for x in audience_rows if x.audience_type=="roles"],"users":[x.audience_value for x in audience_rows if x.audience_type=="users"]}
            canonical.append(_canonical_announcement(raw,row,audience))
    return {"canonical_payload": canonical}
async def _feedback_mapper(db: AsyncSession, item: Any) -> Mapping[str, Any]:
    rows = _rows(item.source_payload)
    for raw in rows:
        identifier = _clean(raw.get("id")); actor = raw.get("submittedBy") if isinstance(raw.get("submittedBy"), Mapping) else {}
        owner = await _trusted_owner(db, _clean(actor.get("username")), _clean(item.owner_scope))
        if not identifier or not owner: continue
        row = await db.get(Feedback, identifier)
        if row is None:
            row = Feedback(id=identifier, type=_clean(raw.get("type")) or "suggestion", title=_clean(raw.get("title")), detail=_clean(raw.get("detail")), page=_clean(raw.get("page")), app_version=_clean(raw.get("appVersion")), contact=_clean(raw.get("contact")), attachment=raw.get("attachment"), status=_clean(raw.get("status")) or "pending", submitted_by=owner, created_at=int(raw.get("createdAt") or 0), updated_at=int(raw.get("updatedAt") or raw.get("createdAt") or 0)); db.add(row)
        else:
            row.type=_clean(raw.get("type")) or "suggestion"; row.title=_clean(raw.get("title")); row.detail=_clean(raw.get("detail")); row.page=_clean(raw.get("page")); row.app_version=_clean(raw.get("appVersion")); row.contact=_clean(raw.get("contact")); row.attachment=raw.get("attachment"); row.status=_clean(raw.get("status")) or "pending"; row.submitted_by=owner; row.updated_at=int(raw.get("updatedAt") or raw.get("createdAt") or 0)
        source_reply_ids={_clean(reply.get("id")) for reply in raw.get("replies",[]) if isinstance(reply,Mapping) and _clean(reply.get("id"))}
        if source_reply_ids:
            await db.execute(delete(FeedbackReply).where(FeedbackReply.feedback_id==identifier, FeedbackReply.id.not_in(source_reply_ids)))
        else:
            await db.execute(delete(FeedbackReply).where(FeedbackReply.feedback_id==identifier))
        for reply in raw.get("replies", []) if isinstance(raw.get("replies"), list) else []:
            reply_id = _clean(reply.get("id"))
            if reply_id:
                reply_actor=await _trusted_owner(db, _clean(reply.get("actorUsername")), owner)
                await db.execute(insert(FeedbackReply).values(id=reply_id,feedback_id=identifier,message=_clean(reply.get("message")),actor=_clean(reply.get("actor")) or reply_actor,actor_username=reply_actor,created_at=int(reply.get("createdAt") or 0)).on_conflict_do_nothing(index_elements=[FeedbackReply.id]))
    await db.flush(); canonical=[]
    for raw in rows:
        row=await db.get(Feedback,_clean(raw.get("id")))
        if row is not None: canonical.append({"id":row.id,"title":row.title,"detail":row.detail,"status":row.status,"submittedBy":{"username":row.submitted_by}})
    return {"canonical_payload":canonical}

async def _receipt_mapper(db: AsyncSession, item: Any) -> Mapping[str, Any]:
    owner = await _trusted_owner(db, "", _clean(item.owner_scope)); payload=item.source_payload
    if isinstance(payload,str):
        try: payload=json.loads(payload)
        except (TypeError,ValueError,json.JSONDecodeError): payload={}
    payload=payload if isinstance(payload,Mapping) else {}; is_message=str(item.source_key).startswith("kg_user_message_reads_v1__")
    model=MessageReceipt if is_message else FeedbackReceipt; id_field="announcement_id" if is_message else "feedback_id"; constraint="uq_message_receipt" if is_message else "uq_feedback_receipt"
    valid=set((await db.scalars(select(Announcement.id if is_message else Feedback.id))).all()); rows=[]
    for identifier,timestamp in payload.items():
        identifier=_clean(identifier)
        if identifier and identifier in valid: rows.append({"id":f"receipt-{owner}-{identifier}"[:64],id_field:identifier,"username":owner,"read_at":int(timestamp or 0)})
    if rows:
        await db.execute(insert(model).values(rows).on_conflict_do_update(constraint=constraint,set_={"read_at":insert(model).excluded.read_at})); await db.flush()
    return {"canonical_payload":sorted(rows,key=lambda x:(x[id_field],x["username"]))}

MAPPERS = {FEEDBACK_KEY: _feedback_mapper, ANNOUNCEMENT_KEY: _announcement_mapper, "kg_user_message_reads_v1__": _receipt_mapper, "kg_user_feedback_reply_reads_v1__": _receipt_mapper}
