"""关系化反馈与站内消息服务。"""
from __future__ import annotations
import base64, binascii, json, re, time, uuid
from typing import Any
from sqlalchemy import and_, delete, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.engagement import Announcement, AnnouncementAudience, Feedback, FeedbackReceipt, FeedbackReply, MessageReceipt
from app.models.user import User
from sqlalchemy.dialects.postgresql import insert

FEEDBACK_KEY="kg_user_feedback_v1"; ANNOUNCEMENT_KEY="kg_announcements_v1"
FEEDBACK_STATUSES={"pending","in_progress","resolved","closed"}; MESSAGE_STATUSES={"draft","published","withdrawn"}
MAX_ENGAGEMENT_PAYLOAD_BYTES=256*1024; MAX_ATTACHMENT_BYTES=160*1024; MAX_ENGAGEMENT_ROWS=1000; MAX_RECEIPTS=5000; MAX_PAGE_SIZE=200
MAX_FEEDBACK_WRITES_PER_MINUTE=5; MAX_MESSAGE_WRITES_PER_MINUTE=30
ATTACHMENT_DATA_URL_RE=re.compile(r"^data:image/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$",re.I)
class EngagementNotFoundError(ValueError): pass
class EngagementValidationError(ValueError): pass
class EngagementRateLimitError(EngagementValidationError): pass
def _now(): return int(time.time()*1000)
def _clean(v): return str(v or "").strip()
def _json(v): return json.dumps(v,ensure_ascii=False,separators=(",",":"))
def validate_payload_size(p):
    try: size=len(_json(p).encode())
    except (TypeError,ValueError) as e: raise EngagementValidationError("请求内容无法解析。") from e
    if size>MAX_ENGAGEMENT_PAYLOAD_BYTES: raise EngagementValidationError("请求内容过大，请缩小附件或正文后重试。")
def _max(label,v,n):
    v=_clean(v)
    if len(v)>n: raise EngagementValidationError(f"{label}不能超过 {n} 个字符。")
    return v
def validate_feedback_fields(p):
    title,detail=_max("反馈标题",p.get("title"),100),_max("详细描述",p.get("detail"),4000)
    _max("联系方式",p.get("contact"),120); _max("页面地址",p.get("page"),255); _max("应用版本",p.get("appVersion"),64)
    if not title or not detail: raise EngagementValidationError("请填写反馈标题和详细描述。")
    return title,detail
def validate_feedback_attachment(v):
    if v in (None,""): return None
    if not isinstance(v,dict): raise EngagementValidationError("截图附件格式无效。")
    m=ATTACHMENT_DATA_URL_RE.fullmatch(_clean(v.get("dataUrl")))
    if not m: raise EngagementValidationError("截图仅支持规范的 PNG、JPG、WebP 或 GIF 数据。")
    try: data=base64.b64decode(m.group(2),validate=True); size=int(v.get("size"))
    except (ValueError,TypeError,binascii.Error) as e: raise EngagementValidationError("截图内容无法解析。") from e
    if not data or len(data)>MAX_ATTACHMENT_BYTES or size!=len(data): raise EngagementValidationError("截图大小与内容不一致。")
    mime=f"image/{m.group(1).lower()}"; sig={"image/png":data.startswith(b"\x89PNG\r\n\x1a\n"),"image/jpeg":data.startswith(b"\xff\xd8\xff"),"image/gif":data.startswith((b"GIF87a",b"GIF89a")),"image/webp":len(data)>=12 and data[:4]==b"RIFF" and data[8:12]==b"WEBP"}
    if not sig.get(mime,False): raise EngagementValidationError("截图内容与图片类型不一致。")
    if _clean(v.get("type")) and _clean(v.get("type")).lower()!=mime: raise EngagementValidationError("截图类型与内容不一致。")
    return {"name":_max("截图文件名",v.get("name") or "附件",120),"type":mime,"size":size,"dataUrl":_clean(v.get("dataUrl"))}
def _normalize_audience_patch(p, base=None):
    if not isinstance(p, dict) or "audience" not in p:
        return _normalize_audience(base or {"type": "all"})
    return _normalize_audience(p.get("audience"))

def validate_reply_message(message):
    message=_clean(message)
    if not message: raise EngagementValidationError("回复内容不能为空。")
    if len(message)>4000: raise EngagementValidationError("回复内容不能超过 4000 个字符。")
    return message

def validate_link(link):
    link=_clean(link)
    if link and not (link.startswith("https://") or link.startswith("http://")): raise EngagementValidationError("消息链接仅支持 HTTP(S)。")
    return link

def _normalize_audience(p):
    p=p if isinstance(p,dict) else {}; typ=_clean(p.get("type")) or "all"
    if typ not in {"all","roles","users"}: raise EngagementValidationError("消息受众类型无效。")
    roles=list(dict.fromkeys(_clean(x) for x in p.get("roles",[]) if _clean(x))); users=list(dict.fromkeys(_clean(x) for x in p.get("users",[]) if _clean(x)))
    if len(users)>200: raise EngagementValidationError("指定用户不能超过 200 个。")
    if any(len(x)>64 for x in users+roles): raise EngagementValidationError("受众标识不能超过 64 个字符。")
    if typ=="roles" and not roles: raise EngagementValidationError("请选择至少一个接收角色。")
    if typ=="users" and not users: raise EngagementValidationError("请选择至少一个接收用户。")
    return {"type":typ,"roles":roles,"users":users}

def validate_message_fields(p,base=None):
    b=base or {}; title=_max("消息标题",p.get("title",b.get("title")),120); body=_max("消息正文",p.get("body",b.get("body")),6000); validate_link(_max("消息链接",p.get("link",b.get("link")),2048))
    if not title or not body: raise EngagementValidationError("请填写消息标题和正文。")
    return title,body
def page_rows(rows,*,limit,offset):
    limit=max(1,min(int(limit),MAX_PAGE_SIZE)); offset=max(0,int(offset)); page=rows[offset:offset+limit]
    return page,{"total":len(rows),"limit":limit,"offset":offset,"hasMore":offset+len(page)<len(rows)}
def bound_collection(rows): return rows[:MAX_ENGAGEMENT_ROWS]
def merge_receipts(c,u):
    m=dict(c)
    for k,v in u.items():
        if _clean(k): m[_clean(k)]=max(int(m.get(_clean(k),0)),int(v or 0))
    return dict(sorted(m.items(),key=lambda x:x[1],reverse=True)[:MAX_RECEIPTS])
def enforce_feedback_rate(rows,username,*,now=None):
    now=_now() if now is None else now
    if sum(1 for r in rows if _clean((r.get("submittedBy") or {}).get("username"))==username and int(r.get("createdAt") or 0)>=now-60000)>=MAX_FEEDBACK_WRITES_PER_MINUTE: raise EngagementRateLimitError("反馈提交过于频繁，请稍后再试。")
def enforce_message_rate(rows,username,*,now=None):
    now=_now() if now is None else now
    if sum(1 for r in rows if _clean(r.get("createdBy"))==username and int(r.get("createdAt") or 0)>=now-60000)>=MAX_MESSAGE_WRITES_PER_MINUTE: raise EngagementRateLimitError("消息创建过于频繁，请稍后再试。")
def trusted_legacy_rows(key,owner,role,storage):
    try: rows=json.loads(storage.get(key,"[]")) if isinstance(storage,dict) else []
    except (TypeError,ValueError,json.JSONDecodeError): return []
    if not isinstance(rows,list): return []
    if key==ANNOUNCEMENT_KEY:
        return [{**r,"createdBy":owner} for r in rows if isinstance(r,dict)] if role=="admin" else []
    if key==FEEDBACK_KEY and role=="admin": return [r for r in rows if isinstance(r,dict)]
    out=[]
    for r in rows:
        if not isinstance(r,dict): continue
        actor=r.get("submittedBy") if isinstance(r.get("submittedBy"),dict) else {}
        if _clean(actor.get("username"))==owner:
            out.append({**r,"submittedBy":{**actor,"username":owner},"status":"pending","replies":[]})
    return out

async def _lock(db: AsyncSession, name: str) -> None:
    return None
async def _read_receipts(db: AsyncSession, username: str, prefix: str) -> dict[str,int]:
    if prefix.startswith("kg_user_message"):
        rows=(await db.scalars(select(MessageReceipt).where(MessageReceipt.username==username))).all()
        return {row.announcement_id:row.read_at for row in rows}
    rows=(await db.scalars(select(FeedbackReceipt).where(FeedbackReceipt.username==username))).all()
    return {row.feedback_id:row.read_at for row in rows}
async def _save_receipts(db: AsyncSession, username: str, prefix: str, updates: dict[str,int]) -> None:
    await _lock(db, username)
    current = await _read_receipts(db, username, prefix)
    merged=merge_receipts(current, updates)
    if prefix.startswith("kg_user_message"):
        values=[{"id":f"receipt-{uuid.uuid4().hex}","announcement_id":key,"username":username,"read_at":timestamp} for key,timestamp in merged.items()]
        statement=insert(MessageReceipt).values(values).on_conflict_do_update(constraint="uq_message_receipt",set_={"read_at":func.greatest(MessageReceipt.read_at,insert(MessageReceipt).excluded.read_at)})
    else:
        values=[{"id":f"receipt-{uuid.uuid4().hex}","feedback_id":key,"username":username,"read_at":timestamp} for key,timestamp in merged.items()]
        statement=insert(FeedbackReceipt).values(values).on_conflict_do_update(constraint="uq_feedback_receipt",set_={"read_at":func.greatest(FeedbackReceipt.read_at,insert(FeedbackReceipt).excluded.read_at)})
    if values: await db.execute(statement)
    await db.commit()
def _fd(f,rs,read=0): return {"id":f.id,"type":f.type,"title":f.title,"detail":f.detail,"page":f.page,"appVersion":f.app_version,"contact":f.contact,"attachment":f.attachment,"status":f.status,"submittedBy":{"username":f.submitted_by},"createdAt":f.created_at,"updatedAt":f.updated_at,"replies":[{"id":r.id,"message":r.message,"actor":r.actor,"createdAt":r.created_at} for r in rs],"lastReadAt":read,"unreadReplyCount":sum(r.created_at>read for r in rs)}
async def _allf(db, *, limit=None, offset=0):
    limit=max(1,min(int(limit or MAX_PAGE_SIZE),MAX_PAGE_SIZE)); offset=max(0,int(offset))
    total=int(await db.scalar(select(func.count()).select_from(Feedback)) or 0)
    query=select(Feedback).order_by(Feedback.updated_at.desc(),Feedback.id).limit(limit).offset(offset)
    fs=list((await db.scalars(query)).all())
    if not fs: return {"items":[],"pagination":{"total":total,"limit":limit,"offset":offset,"hasMore":offset<total}}
    ids=[f.id for f in fs]
    replies=list((await db.scalars(select(FeedbackReply).where(FeedbackReply.feedback_id.in_(ids)).order_by(FeedbackReply.created_at))).all())
    grouped={identifier:[] for identifier in ids}
    for reply in replies: grouped[reply.feedback_id].append(reply)
    items=[_fd(feedback, grouped[feedback.id]) for feedback in fs]
    return {"items":items,"pagination":{"total":total,"limit":limit,"offset":offset,"hasMore":offset+len(items)<total}}
async def submit_feedback(db,user,p):
    validate_payload_size(p); title,detail=validate_feedback_fields(p); now=_now()
    recent = (await db.scalars(select(Feedback).where(Feedback.submitted_by == user.username, Feedback.created_at >= now - 60000))).all()
    if len(recent) >= MAX_FEEDBACK_WRITES_PER_MINUTE: raise EngagementRateLimitError("反馈提交过于频繁，请稍后再试。")
    f=Feedback(id=f"feedback-{uuid.uuid4().hex}",type=_clean(p.get("type")) or "suggestion",title=title,detail=detail,page=_clean(p.get("page")),app_version=_clean(p.get("appVersion")),contact=_clean(p.get("contact")),attachment=validate_feedback_attachment(p.get("attachment")),status="pending",submitted_by=user.username,created_at=now,updated_at=now); db.add(f); await db.commit(); return _fd(f,[])
async def list_feedback(db, *, limit=None, offset=0):
    return await _allf(db, limit=limit, offset=offset)
async def list_my_feedback(db,user, *, limit=None, offset=0):
    limit=max(1,min(int(limit or MAX_PAGE_SIZE),MAX_PAGE_SIZE)); offset=max(0,int(offset))
    total=int(await db.scalar(select(func.count()).select_from(Feedback).where(Feedback.submitted_by==user.username)) or 0)
    query=select(Feedback).where(Feedback.submitted_by==user.username).order_by(Feedback.updated_at.desc(),Feedback.id).limit(limit).offset(offset)
    rows=list((await db.scalars(query)).all())
    if not rows: return {"items":[],"pagination":{"total":total,"limit":limit,"offset":offset,"hasMore":offset<total}}
    ids=[f.id for f in rows]; replies=list((await db.scalars(select(FeedbackReply).where(FeedbackReply.feedback_id.in_(ids)).order_by(FeedbackReply.created_at,FeedbackReply.id))).all()); grouped={key:[] for key in ids}
    for reply in replies: grouped[reply.feedback_id].append(reply)
    reads=await _read_receipts(db,user.username,"kg_user_feedback_reply_reads_v1__")
    out=[]
    for f in rows:
        read=reads.get(f.id,0); out.append(_fd(f,grouped[f.id],read))
    return {"items":out,"pagination":{"total":total,"limit":limit,"offset":offset,"hasMore":offset+len(out)<total}}
async def mark_feedback_read(db,user,feedback_id):
    f=await db.get(Feedback,feedback_id)
    if not f or f.submitted_by!=user.username: raise EngagementNotFoundError("反馈不存在。")
    now=_now()
    statement=insert(FeedbackReceipt).values(id=f"receipt-{uuid.uuid4().hex}",feedback_id=feedback_id,username=user.username,read_at=now).on_conflict_do_update(constraint="uq_feedback_receipt",set_={"read_at":func.greatest(FeedbackReceipt.read_at,insert(FeedbackReceipt).excluded.read_at)})
    await db.execute(statement); await db.commit()
async def update_feedback(db,user,feedback_id,p):
    f=await db.get(Feedback,feedback_id)
    if not f: raise EngagementNotFoundError("反馈不存在或已删除。")
    s=_clean(p.get("status"))
    if s not in FEEDBACK_STATUSES: raise EngagementValidationError("反馈状态无效。")
    f.status=s; f.updated_at=_now(); await db.commit()
    rows=await _allf(db); return next((row for row in rows["items"] if row["id"]==feedback_id), _fd(f,[]))
async def reply_feedback(db,user,feedback_id,p):
    validate_payload_size(p); msg=validate_reply_message(p.get("message"))
    f=await db.get(Feedback,feedback_id)
    if not f: raise EngagementNotFoundError("反馈不存在或已删除。")
    now=_now(); db.add(FeedbackReply(id=f"reply-{uuid.uuid4().hex}",feedback_id=feedback_id,message=msg,actor=user.display_name or user.username,actor_username=user.username,created_at=now)); f.status="in_progress" if f.status=="pending" else f.status; f.updated_at=now; await db.commit(); rows=await _allf(db); return next((row for row in rows["items"] if row["id"]==feedback_id), _fd(f,[]))
async def list_announcements(db, *, limit=None, offset=0):
    limit=max(1,min(int(limit or MAX_PAGE_SIZE),MAX_PAGE_SIZE)); offset=max(0,int(offset))
    total=int(await db.scalar(select(func.count()).select_from(Announcement)) or 0)
    query=select(Announcement).order_by(Announcement.updated_at.desc(),Announcement.id).limit(limit).offset(offset)
    rows=(await db.scalars(query)).all()
    if not rows: return {"items":[],"pagination":{"total":total,"limit":limit,"offset":offset,"hasMore":offset<total}}
    ids=[row.id for row in rows]
    audiences=list((await db.scalars(select(AnnouncementAudience).where(AnnouncementAudience.announcement_id.in_(ids)))).all())
    grouped={identifier:[] for identifier in ids}
    for audience in audiences: grouped[audience.announcement_id].append(audience)
    out=[]
    for a in rows:
        aa=grouped[a.id]; typ=aa[0].audience_type if aa else "all"; out.append({"id":a.id,"title":a.title,"body":a.body,"link":a.link,"audience":{"type":typ,"roles":[x.audience_value for x in aa if x.audience_type=="roles"],"users":[x.audience_value for x in aa if x.audience_type=="users"]},"status":a.status,"publishAt":a.publish_at,"expiresAt":a.expires_at,"publishedAt":a.published_at,"withdrawnAt":a.withdrawn_at,"createdBy":a.created_by,"createdAt":a.created_at,"updatedAt":a.updated_at})
    return {"items":out,"pagination":{"total":total,"limit":limit,"offset":offset,"hasMore":offset+len(out)<total}}
async def save_announcement(db,user,p,message_id=None):
    validate_payload_size(p); a=await db.get(Announcement,message_id) if message_id else None
    if message_id and not a: raise EngagementNotFoundError("消息不存在。")
    b={"title":a.title,"body":a.body} if a else {}; title,body=validate_message_fields(p,b); now=_now()
    if a is None:
        recent=(await db.scalars(select(Announcement).where(Announcement.created_by==user.username, Announcement.created_at>=now-60000))).all()
        if len(recent)>=MAX_MESSAGE_WRITES_PER_MINUTE: raise EngagementRateLimitError("消息创建过于频繁，请稍后再试。")
        aud=_normalize_audience(p.get("audience",{"type":"all"}))
    else:
        if "audience" in p:
            aud=_normalize_audience(p["audience"])
        else:
            existing=list((await db.scalars(select(AnnouncementAudience).where(AnnouncementAudience.announcement_id==a.id))).all())
            typ=existing[0].audience_type if existing else "all"
            aud={"type":typ,"roles":[x.audience_value for x in existing if x.audience_type=="roles"],"users":[x.audience_value for x in existing if x.audience_type=="users"]}
    if not a:a=Announcement(id=f"message-{uuid.uuid4().hex}",created_by=user.username,created_at=now,status="draft",published_at=0,withdrawn_at=0); db.add(a)
    a.title,a.body=title,body;a.link=validate_link(_clean(p.get("link",a.link or "")));a.publish_at=int(p.get("publishAt",a.publish_at) or 0);a.expires_at=int(p.get("expiresAt",a.expires_at) or 0)
    if a.expires_at and a.publish_at and a.expires_at<=a.publish_at: raise EngagementValidationError("消息过期时间必须晚于发布时间。")
    a.updated_at=now;await db.flush();await db.execute(delete(AnnouncementAudience).where(AnnouncementAudience.announcement_id==a.id)); vals=[""] if aud["type"]=="all" else aud["roles"] if aud["type"]=="roles" else aud["users"]
    for v in vals:db.add(AnnouncementAudience(id=f"aud-{uuid.uuid4().hex}",announcement_id=a.id,audience_type=aud["type"],audience_value=v))
    await db.commit(); return next(x for x in (await list_announcements(db))["items"] if x["id"]==a.id)
async def publish_announcement(db,user,message_id,p):
    a=await db.get(Announcement,message_id)
    if not a: raise EngagementNotFoundError("消息不存在。")
    now=_now();a.status="published";a.publish_at=int(p.get("publishAt") or now);a.expires_at=int(p.get("expiresAt") or a.expires_at);a.published_at=now;a.withdrawn_at=0;a.updated_at=now
    validate_link(a.link)
    if a.expires_at and a.expires_at<=a.publish_at: raise EngagementValidationError("消息过期时间必须晚于发布时间。")
    await db.commit();return next(x for x in (await list_announcements(db))["items"] if x["id"]==a.id)
async def withdraw_announcement(db,user,message_id):
    a=await db.get(Announcement,message_id)
    if not a: raise EngagementNotFoundError("消息不存在。")
    a.status="withdrawn";a.withdrawn_at=a.updated_at=_now();await db.commit();return next(x for x in (await list_announcements(db))["items"] if x["id"]==a.id)
async def delete_announcement(db,user,message_id):
    a=await db.get(Announcement,message_id)
    if not a: raise EngagementNotFoundError("消息不存在。")
    if a.status=="published":raise EngagementValidationError("已发布消息请先撤回，不能直接删除。")
    await db.delete(a);await db.commit()
def _allows(a,u):return a["type"]=="all" or (a["type"]=="roles" and u.role in a["roles"]) or (a["type"]=="users" and u.username in a["users"])
async def list_user_messages(db,user, *, limit=None, offset=0):
    now=_now(); limit=max(1,min(int(limit or MAX_PAGE_SIZE),MAX_PAGE_SIZE)); offset=max(0,int(offset))
    audience=or_(AnnouncementAudience.audience_type=="all",and_(AnnouncementAudience.audience_type=="roles",AnnouncementAudience.audience_value==user.role),and_(AnnouncementAudience.audience_type=="users",AnnouncementAudience.audience_value==user.username))
    visible=exists(select(AnnouncementAudience.id).where(AnnouncementAudience.announcement_id==Announcement.id, audience))
    base=select(Announcement).where(Announcement.status=="published",(Announcement.publish_at==0)|(Announcement.publish_at<=now),(Announcement.expires_at==0)|(Announcement.expires_at>now),visible)
    total=int(await db.scalar(select(func.count()).select_from(base.subquery())) or 0)
    rows=(await db.scalars(base.order_by(Announcement.updated_at.desc(),Announcement.id).limit(limit).offset(offset))).all(); ids=[row.id for row in rows]
    audiences=list((await db.scalars(select(AnnouncementAudience).where(AnnouncementAudience.announcement_id.in_(ids)))).all()) if ids else []
    grouped={key:[] for key in ids}
    for item in audiences: grouped[item.announcement_id].append(item)
    reads={x.announcement_id:x.read_at for x in (await db.scalars(select(MessageReceipt).where(MessageReceipt.username==user.username, MessageReceipt.announcement_id.in_(ids)))).all()} if ids else {}
    out=[]
    for row in rows:
        aa=grouped[row.id]; typ=aa[0].audience_type if aa else "all"; aud={"type":typ,"roles":[x.audience_value for x in aa if x.audience_type=="roles"],"users":[x.audience_value for x in aa if x.audience_type=="users"]}
        out.append({"id":row.id,"title":row.title,"body":row.body,"link":row.link,"audience":aud,"status":row.status,"publishAt":row.publish_at,"expiresAt":row.expires_at,"publishedAt":row.published_at,"withdrawnAt":row.withdrawn_at,"createdBy":row.created_by,"createdAt":row.created_at,"updatedAt":row.updated_at,"readAt":reads.get(row.id,0),"read":bool(reads.get(row.id,0))})
    return {"items":out,"pagination":{"total":total,"limit":limit,"offset":offset,"hasMore":offset+len(out)<total}}
async def unread_summary(db,user):
    now=_now(); audience=or_(AnnouncementAudience.audience_type=="all",and_(AnnouncementAudience.audience_type=="roles",AnnouncementAudience.audience_value==user.role),and_(AnnouncementAudience.audience_type=="users",AnnouncementAudience.audience_value==user.username)); visible=exists(select(AnnouncementAudience.id).where(AnnouncementAudience.announcement_id==Announcement.id,audience))
    unread_messages=int(await db.scalar(select(func.count()).select_from(Announcement).where(Announcement.status=="published",(Announcement.publish_at==0)|(Announcement.publish_at<=now),(Announcement.expires_at==0)|(Announcement.expires_at>now),visible,~exists(select(MessageReceipt.id).where(MessageReceipt.announcement_id==Announcement.id,MessageReceipt.username==user.username))) ) or 0)
    unread_feedback=int(await db.scalar(select(func.count()).select_from(FeedbackReply).join(Feedback,Feedback.id==FeedbackReply.feedback_id).outerjoin(FeedbackReceipt,and_(FeedbackReceipt.feedback_id==Feedback.id,FeedbackReceipt.username==user.username)).where(Feedback.submitted_by==user.username,FeedbackReply.created_at>func.coalesce(FeedbackReceipt.read_at,0))) or 0)
    return {"messages":unread_messages,"feedbackReplies":unread_feedback,"total":unread_messages+unread_feedback}
async def mark_message_read(db,user,message_id):
    if not any(x["id"]==message_id for x in (await list_user_messages(db,user))["items"]):raise EngagementNotFoundError("消息不存在或当前不可见。")
    now=_now(); statement=insert(MessageReceipt).values(id=f"receipt-{uuid.uuid4().hex}",announcement_id=message_id,username=user.username,read_at=now).on_conflict_do_update(constraint="uq_message_receipt",set_={"read_at":func.greatest(MessageReceipt.read_at,insert(MessageReceipt).excluded.read_at)})
    await db.execute(statement); await db.commit()
async def mark_all_messages_read(db,user):
    rows=(await list_user_messages(db,user))["items"]; now=_now()
    if not rows: return
    values=[{"id":f"receipt-{uuid.uuid4().hex}","announcement_id":row["id"],"username":user.username,"read_at":now} for row in rows]
    await db.execute(insert(MessageReceipt).values(values).on_conflict_do_update(constraint="uq_message_receipt",set_={"read_at":func.greatest(MessageReceipt.read_at,insert(MessageReceipt).excluded.read_at)}))
    await db.commit()
