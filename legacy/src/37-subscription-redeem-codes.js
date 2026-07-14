"use strict";

/*
 * 学员订阅卡密模块。
 *
 * 本文件只负责：卡密生成、查询、启停、删除与学员兑换。
 * 对外仍由 37-subscription-core.js 汇总到 window.KGSubscription。
 */
(function(){
  window.KGSubscriptionRedeemCodesModule = function(ctx={}){
    const REDEEM_CODE_KEY = "kg_student_subscription_redeem_codes_v1";

    const REDEEM_CODE_STATUS_LABELS = {
      unused:"未使用",
      used:"已使用",
      disabled:"已停用"
    };

    function normalizeRedeemCodeText(value){
      return String(value||"").trim().toUpperCase().replace(/\s+/g,"");
    }
    function redeemCodeStatusLabel(status){
      return REDEEM_CODE_STATUS_LABELS[status] || status || "未知";
    }
    function cleanRedeemCodeStatus(status){
      status=String(status||"unused").trim();
      return REDEEM_CODE_STATUS_LABELS[status] ? status : "unused";
    }
    function normalizeRedeemCode(record={}){
      const now=Date.now();
      const plan=ctx.planById(record.planId||"monthly");
      const code=normalizeRedeemCodeText(record.code || randomRedeemCode());
      const createdAt=Number(record.createdAt)||now;
      return {
        id:String(record.id||ctx.uid("redeem_code")),
        code,
        planId:plan.id,
        planName:String(record.planName||plan.name||plan.id),
        status:cleanRedeemCodeStatus(record.status),
        createdAt,
        updatedAt:Number(record.updatedAt)||createdAt,
        usedAt:Number(record.usedAt)||0,
        usedBy:String(record.usedBy||""),
        createdBy:String(record.createdBy||ctx.currentUsername()||"system-admin"),
        note:String(record.note||""),
        source:String(record.source||"admin")
      };
    }
    function readRedeemCodes(){
      const raw=ctx.readJSON(REDEEM_CODE_KEY,[]);
      const list=Array.isArray(raw) ? raw : [];
      return list.map(normalizeRedeemCode).filter(item=>item.code);
    }
    function saveRedeemCodes(list){
      const seen=new Set();
      const out=(Array.isArray(list)?list:[]).map(normalizeRedeemCode).filter(item=>{
        if(!item.code || seen.has(item.code))return false;
        seen.add(item.code);
        return true;
      }).slice(0,2000);
      ctx.writeJSON(REDEEM_CODE_KEY,out);
      window.dispatchEvent(new CustomEvent("kg-subscription-redeem-code-change",{detail:{codes:out}}));
      return out;
    }
    function redeemCodeList(options={}){
      let list=readRedeemCodes();
      if(options.status) list=list.filter(item=>item.status===String(options.status));
      if(options.planId) list=list.filter(item=>item.planId===ctx.normalizePlanId(options.planId));
      if(options.keyword){
        const kw=normalizeRedeemCodeText(options.keyword);
        list=list.filter(item=>item.code.includes(kw) || String(item.usedBy||"").includes(options.keyword));
      }
      return list.sort((a,b)=>(Number(b.createdAt)||0)-(Number(a.createdAt)||0));
    }
    function randomCodeGroup(len=4){
      const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      let out="";
      const c=globalThis.crypto;
      if(c && c.getRandomValues){
        const arr=new Uint8Array(len);
        c.getRandomValues(arr);
        for(let i=0;i<len;i++) out+=chars[arr[i]%chars.length];
      }else{
        for(let i=0;i<len;i++) out+=chars[Math.floor(Math.random()*chars.length)];
      }
      return out;
    }
    function randomRedeemCode(prefix="VIP"){
      const safePrefix=normalizeRedeemCodeText(prefix||"VIP").replace(/[^A-Z0-9]/g,"").slice(0,8)||"VIP";
      return `${safePrefix}-${randomCodeGroup()}-${randomCodeGroup()}-${randomCodeGroup()}`;
    }
    function generateRedeemCodes(options={}){
      const plan=ctx.planById(options.planId||"monthly");
      if(plan.id==="free") return {ok:false,message:"免费学员无需生成卡密。"};
      const count=Math.max(1,Math.min(200,Math.round(Number(options.count)||1)));
      const prefix=options.prefix || (plan.shortName || plan.id || "VIP");
      const note=String(options.note||"");
      const codes=readRedeemCodes();
      const existing=new Set(codes.map(item=>item.code));
      const created=[];
      let guard=0;
      while(created.length<count && guard<count*20){
        guard++;
        const code=randomRedeemCode(prefix);
        if(existing.has(code))continue;
        existing.add(code);
        created.push(normalizeRedeemCode({
          id:ctx.uid("redeem_code"),
          code,
          planId:plan.id,
          planName:plan.name,
          status:"unused",
          createdAt:Date.now(),
          updatedAt:Date.now(),
          createdBy:String(options.createdBy||ctx.currentUsername()||"system-admin"),
          note
        }));
      }
      if(!created.length) return {ok:false,message:"卡密生成失败，请重试。"};
      saveRedeemCodes([...created,...codes]);
      ctx.logAction("生成订阅卡密","SYSTEM",`${plan.name} × ${created.length}`);
      return {ok:true,codes:created,message:`已生成 ${created.length} 张 ${plan.name} 卡密。`};
    }
    function updateRedeemCode(id,patch={}){
      const list=readRedeemCodes();
      const idx=list.findIndex(item=>item.id===id || item.code===normalizeRedeemCodeText(id));
      if(idx<0) return null;
      const next=normalizeRedeemCode({...list[idx],...patch,updatedAt:Date.now()});
      list[idx]=next;
      saveRedeemCodes(list);
      return next;
    }
    function disableRedeemCode(id){
      const code=updateRedeemCode(id,{status:"disabled"});
      if(code) ctx.logAction("停用订阅卡密","SYSTEM",code.code);
      return code;
    }
    function enableRedeemCode(id){
      const code=updateRedeemCode(id,{status:"unused",usedAt:0,usedBy:""});
      if(code) ctx.logAction("启用订阅卡密","SYSTEM",code.code);
      return code;
    }
    function removeRedeemCode(id){
      const list=readRedeemCodes();
      const target=list.find(item=>item.id===id || item.code===normalizeRedeemCodeText(id));
      const next=list.filter(item=>item.id!==id && item.code!==normalizeRedeemCodeText(id));
      if(next.length===list.length) return false;
      saveRedeemCodes(next);
      ctx.logAction("删除订阅卡密","SYSTEM",target?target.code:String(id||""));
      return true;
    }
    function redeemCode(input,options={}){
      const codeText=normalizeRedeemCodeText(input);
      if(!codeText) return {ok:false,message:"请输入卡密。"};
      const user=options.user || ctx.currentUser();
      const username=String(options.username || (user&&user.username) || ctx.currentUsername() || "").trim();
      if(!username) return {ok:false,message:"请先登录学员账号后再使用卡密。"};
      const role=String(options.role || (user&&user.role) || ctx.currentRole() || "guest");
      if(role==="admin"||role==="teacher") return {ok:false,message:"当前身份不需要订阅卡密。"};
      if(role==="viewer"||role==="guest") return {ok:false,message:"游客不进入订阅体系，请切换为学员账号后使用卡密。"};
      if(role!=="student") return {ok:false,message:"只有学员账号可以使用订阅卡密。"};
      const list=readRedeemCodes();
      const idx=list.findIndex(item=>item.code===codeText);
      if(idx<0) return {ok:false,message:"卡密不存在，请核对后重试。"};
      const item={...list[idx]};
      if(item.status==="used") return {ok:false,message:`该卡密已被 ${item.usedBy||"其他账号"} 使用。`};
      if(item.status==="disabled") return {ok:false,message:"该卡密已停用，请联系管理员。"};
      const subscription=ctx.renewStudentSubscription(username,item.planId,{source:"redeem_code",orderId:item.id,note:`卡密兑换：${item.code}`});
      item.status="used";
      item.usedAt=Date.now();
      item.usedBy=username;
      item.updatedAt=Date.now();
      list[idx]=normalizeRedeemCode(item);
      saveRedeemCodes(list);
      ctx.logAction("兑换订阅卡密",username,`${item.planName} · ${item.code}`);
      return {ok:true,code:list[idx],subscription,message:`卡密兑换成功，已开通/续费 ${item.planName}。`};
    }

    return {
      REDEEM_CODE_KEY,
      REDEEM_CODE_STATUS_LABELS,
      readRedeemCodes,
      saveRedeemCodes,
      redeemCodeList,
      generateRedeemCodes,
      redeemCode,
      disableRedeemCode,
      enableRedeemCode,
      removeRedeemCode,
      redeemCodeStatusLabel
    };
  };
})();
