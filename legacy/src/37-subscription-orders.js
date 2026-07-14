"use strict";

/*
 * 学员订阅订单模块。
 *
 * 本文件只负责：订单申请、确认开通、取消、删除与订单状态文案。
 * 对外仍由 37-subscription-core.js 汇总到 window.KGSubscription。
 */
(function(){
  window.KGSubscriptionOrdersModule = function(ctx={}){
    const ORDER_KEY = "kg_student_subscription_orders_v1";

    const ORDER_STATUS_LABELS = {
      pending:"待确认",
      approved:"已开通",
      cancelled:"已取消"
    };

    function orderStatusLabel(status){
      return ORDER_STATUS_LABELS[status] || status || "未知";
    }
    function cleanOrderStatus(status){
      status=String(status||"pending").trim();
      return ORDER_STATUS_LABELS[status] ? status : "pending";
    }
    function normalizeOrder(order={}){
      const now=Date.now();
      const plan=ctx.planById(order.planId||"monthly");
      const username=String(order.username||"").trim();
      const createdAt=Number(order.createdAt)||now;
      return {
        id:String(order.id||ctx.uid("sub_order")),
        username,
        planId:plan.id,
        planName:String(order.planName||plan.name||plan.id),
        status:cleanOrderStatus(order.status),
        amountText:String(order.amountText||plan.priceText||""),
        originalPriceText:String(order.originalPriceText||plan.originalPriceText||""),
        discountPercent:String(order.discountPercent||plan.discountPercent||""),
        discountText:String(order.discountText||plan.discountText||""),
        createdAt,
        updatedAt:Number(order.updatedAt)||createdAt,
        approvedAt:Number(order.approvedAt)||0,
        cancelledAt:Number(order.cancelledAt)||0,
        approvedBy:String(order.approvedBy||""),
        cancelledBy:String(order.cancelledBy||""),
        actor:String(order.actor||username||ctx.currentUsername()||"student"),
        source:String(order.source||"student_request"),
        note:String(order.note||""),
        adminNote:String(order.adminNote||""),
        currentPlanId:String(order.currentPlanId||""),
        currentPlanName:String(order.currentPlanName||""),
        snapshot:order.snapshot && typeof order.snapshot==="object" ? order.snapshot : {
          planId:plan.id,
          planName:plan.name,
          priceText:plan.priceText,
          originalPriceText:plan.originalPriceText,
          discountPercent:plan.discountPercent,
          discountText:plan.discountText,
          usageText:ctx.planUsageText(plan),
          benefits:ctx.planBenefitItems(plan)
        }
      };
    }
    function readOrders(){
      const raw=ctx.readJSON(ORDER_KEY,[]);
      const list=Array.isArray(raw) ? raw : [];
      return list.map(normalizeOrder).filter(order=>order.id && order.username);
    }
    function saveOrders(list){
      const out=(Array.isArray(list)?list:[]).map(normalizeOrder).filter(order=>order.id && order.username).slice(0,500);
      ctx.writeJSON(ORDER_KEY,out);
      window.dispatchEvent(new CustomEvent("kg-subscription-order-change",{detail:{orders:out}}));
      return out;
    }
    function orderList(options={}){
      let list=readOrders();
      if(options.username) list=list.filter(order=>order.username===String(options.username).trim());
      if(options.status) list=list.filter(order=>order.status===String(options.status).trim());
      return list.sort((a,b)=>(Number(b.createdAt)||0)-(Number(a.createdAt)||0));
    }
    function pendingOrders(){
      return orderList({status:"pending"});
    }
    function currentUserOrders(){
      const username=ctx.currentUsername();
      return username ? orderList({username}) : [];
    }
    function hasPendingOrder(username,planId){
      username=String(username||ctx.currentUsername()||"").trim();
      planId=ctx.normalizePlanId(planId||"monthly");
      return !!orderList({username,status:"pending"}).find(order=>order.planId===planId);
    }
    function createOrder(planId,options={}){
      const plan=ctx.planById(planId||"monthly");
      const user=options.user || ctx.currentUser();
      const username=String(options.username || (user&&user.username) || ctx.currentUsername() || "").trim();
      if(!username) return {ok:false,message:"请先登录学员账号后再提交订阅申请。"};
      const role=String(options.role || (user&&user.role) || ctx.currentRole() || "guest");
      if(role==="admin"||role==="teacher") return {ok:false,message:"当前身份不需要订阅，可直接使用管理或教学能力。"};
      if(role==="viewer"||role==="guest") return {ok:false,message:"游客不进入订阅体系，请切换为学员账号后提交订阅申请。"};
      if(role!=="student") return {ok:false,message:"只有学员账号需要开通订阅。"};
      if(plan.id==="free") return {ok:false,message:"免费学员无需购买，可直接使用免费权益。"};
      const existing=orderList({username,status:"pending"}).find(order=>order.planId===plan.id);
      if(existing) return {ok:true,duplicate:true,order:existing,message:`你已经提交过“${plan.name}”开通申请，管理员确认后会自动生效。`};
      const current=ctx.subscriptionFor(username) || ctx.defaultSubscription(username);
      const currentPlan=ctx.planById(current.planId||"free");
      const order=normalizeOrder({
        id:ctx.uid("sub_order"),
        username,
        planId:plan.id,
        planName:plan.name,
        status:"pending",
        amountText:plan.priceText||"",
        originalPriceText:plan.originalPriceText||"",
        discountPercent:plan.discountPercent||"",
        discountText:plan.discountText||"",
        createdAt:Date.now(),
        updatedAt:Date.now(),
        actor:username,
        source:"student_request",
        note:String(options.note||""),
        currentPlanId:currentPlan.id,
        currentPlanName:currentPlan.name,
        snapshot:{
          planId:plan.id,
          planName:plan.name,
          priceText:plan.priceText,
          originalPriceText:plan.originalPriceText,
          discountPercent:plan.discountPercent,
          discountText:plan.discountText,
          usageText:ctx.planUsageText(plan),
          benefits:ctx.planBenefitItems(plan)
        }
      });
      const orders=readOrders();
      orders.unshift(order);
      saveOrders(orders);
      ctx.logAction("提交订阅申请",username,`${plan.name} · ${plan.priceText||"待配置"}`);
      return {ok:true,order,message:`“${plan.name}”订阅申请已提交，请等待管理员确认开通。`};
    }
    function approveOrder(orderId,options={}){
      const orders=readOrders();
      const idx=orders.findIndex(order=>order.id===orderId);
      if(idx<0) return {ok:false,message:"未找到该订阅申请。"};
      const order={...orders[idx]};
      if(order.status!=="pending") return {ok:false,message:`该申请当前状态为“${orderStatusLabel(order.status)}”，不能重复确认。`};
      const actor=String(options.actor || ctx.currentActor() || ctx.currentUsername() || "system-admin");
      const subscription=ctx.renewStudentSubscription(order.username,order.planId,{source:"order",orderId:order.id,note:options.note || `订单确认开通：${order.planName}`});
      order.status="approved";
      order.approvedAt=Date.now();
      order.approvedBy=actor;
      order.updatedAt=Date.now();
      order.adminNote=String(options.note||order.adminNote||"");
      orders[idx]=normalizeOrder(order);
      saveOrders(orders);
      ctx.logAction("确认订阅开通",order.username,`${order.planName} · 订单 ${order.id}`);
      return {ok:true,order:orders[idx],subscription,message:`已为 ${order.username} 开通 ${order.planName}。`};
    }
    function cancelOrder(orderId,options={}){
      const orders=readOrders();
      const idx=orders.findIndex(order=>order.id===orderId);
      if(idx<0) return {ok:false,message:"未找到该订阅申请。"};
      const order={...orders[idx]};
      if(order.status!=="pending") return {ok:false,message:`该申请当前状态为“${orderStatusLabel(order.status)}”，不能取消。`};
      const actor=String(options.actor || ctx.currentActor() || ctx.currentUsername() || "system-admin");
      order.status="cancelled";
      order.cancelledAt=Date.now();
      order.cancelledBy=actor;
      order.updatedAt=Date.now();
      order.adminNote=String(options.note||order.adminNote||"");
      orders[idx]=normalizeOrder(order);
      saveOrders(orders);
      ctx.logAction("取消订阅申请",order.username,`${order.planName} · 订单 ${order.id}`);
      return {ok:true,order:orders[idx],message:`已取消 ${order.username} 的 ${order.planName} 申请。`};
    }
    function removeOrder(orderId){
      const orders=readOrders();
      const next=orders.filter(order=>order.id!==orderId);
      if(next.length===orders.length) return false;
      saveOrders(next);
      return true;
    }

    return {
      ORDER_KEY,
      ORDER_STATUS_LABELS,
      readOrders,
      saveOrders,
      orderList,
      pendingOrders,
      currentUserOrders,
      hasPendingOrder,
      createOrder,
      approveOrder,
      cancelOrder,
      removeOrder,
      orderStatusLabel
    };
  };
})();
