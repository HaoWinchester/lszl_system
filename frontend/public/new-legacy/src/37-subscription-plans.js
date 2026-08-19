"use strict";

/*
 * 学员订阅套餐与权益模型。
 *
 * 本文件只负责：套餐常量、套餐设置、价格/折扣派生、权益/用量文案。
 * 对外仍由 37-subscription-core.js 汇总到 window.KGSubscription。
 */
(function(){
  window.KGSubscriptionPlansModule = function(ctx={}){
    const refresh = function(){
      if(typeof ctx.decorateSubscriptionElements === "function") ctx.decorateSubscriptionElements();
    };

    const PLAN_ALIASES = {
      free:"free",
      free_student:"free",
      trial:"free",
      monthly:"monthly",
      month:"monthly",
      basic:"monthly",
      basic_student:"monthly",
      quarterly:"quarterly",
      quarter:"quarterly",
      quarter_year:"quarterly",
      qtr:"quarterly",
      season:"quarterly",
      half_year:"half_year",
      halfyear:"half_year",
      half_yearly:"half_year",
      halfyearly:"half_year",
      half:"half_year",
      pro:"half_year",
      pro_student:"half_year",
      lifetime:"lifetime",
      life:"lifetime",
      forever:"lifetime"
    };

    const PLAN_ORDER = ["free","monthly","quarterly","half_year","lifetime"];

    const PLANS = {
      free:{
        id:"free",
        enabled:true,
        name:"免费学员",
        shortName:"免费",
        level:0,
        billingCycle:"free",
      durationDays:0,
        paymentAmountFen:0,
        priceText:"¥0",
        originalPriceText:"",
        discountPercent:"",
        durationText:"长期有效",
        badgeText:"体验",
        description:"适合公开示例、轻量练习和体验核心流程。",
        features:{
          basicTraining:true,
          basicRecall:true,
          personalGraph:true,
          learningPackageImport:true,
          learningPackageExport:true,
          demoOnly:true,
          allExamPapers:false
        },
        limits:{
          dailyTraining:10,
          recallMaps:1,
          graphNodes:50,
          recallNodes:30,
          importPackages:-1,
          exportPackages:-1
        }
      },
      monthly:{
        id:"monthly",
        enabled:true,
        name:"月度会员",
        shortName:"月度",
        level:1,
        billingCycle:"monthly",
      durationDays:30,
        paymentAmountFen:2900,
        priceText:"待配置",
        originalPriceText:"",
        discountPercent:"",
        durationText:"30 天",
        badgeText:"灵活",
        description:"适合短期备考、阶段性冲刺和低门槛体验完整学习能力。",
        features:{
          basicTraining:true,
          basicRecall:true,
          personalGraph:true,
          standardQuestionBank:true,
          allExamPapers:true,
          learningPackageImport:true,
          learningPackageExport:true
        },
        limits:{
          dailyTraining:80,
          recallMaps:20,
          graphNodes:-1,
          recallNodes:-1,
          importPackages:-1,
          exportPackages:-1
        }
      },
      quarterly:{
        id:"quarterly",
        enabled:true,
        name:"季度会员",
        shortName:"季度",
        level:2,
        billingCycle:"quarterly",
      durationDays:90,
        paymentAmountFen:7900,
        priceText:"待配置",
        originalPriceText:"",
        discountPercent:"",
        durationText:"90 天",
        badgeText:"进阶",
        description:"适合一个阶段的系统备考，权益与半年会员保持一致，开放更完整的题库训练和深度回忆能力。",
        features:{
          basicTraining:true,
          basicRecall:true,
          personalGraph:true,
          standardQuestionBank:true,
          allExamPapers:true,
          learningPackageImport:true,
          learningPackageExport:true,
          advancedRecall:true
        },
        limits:{
          dailyTraining:-1,
          recallMaps:-1,
          graphNodes:-1,
          recallNodes:-1,
          importPackages:-1,
          exportPackages:-1
        }
      },
      half_year:{
        id:"half_year",
        enabled:true,
        name:"半年会员",
        shortName:"半年",
        level:3,
        billingCycle:"half_year",
      durationDays:180,
        paymentAmountFen:13900,
        priceText:"待配置",
        originalPriceText:"",
        discountPercent:"",
        durationText:"180 天",
        badgeText:"推荐",
        recommended:true,
        description:"适合完整备考周期，开放更完整的题库训练和深度回忆能力。",
        features:{
          basicTraining:true,
          basicRecall:true,
          personalGraph:true,
          standardQuestionBank:true,
          allExamPapers:true,
          learningPackageImport:true,
          learningPackageExport:true,
          advancedRecall:true
        },
        limits:{
          dailyTraining:-1,
          recallMaps:-1,
          graphNodes:-1,
          recallNodes:-1,
          importPackages:-1,
          exportPackages:-1
        }
      },
      lifetime:{
        id:"lifetime",
        enabled:true,
        name:"终身会员",
        shortName:"终身",
        level:4,
        billingCycle:"lifetime",
      durationDays:-1,
        paymentAmountFen:39900,
        priceText:"待配置",
        originalPriceText:"",
        discountPercent:"",
        durationText:"永久有效",
        badgeText:"终身",
        description:"适合长期学习和深度用户，包含当前高级学习能力并预留后续高级功能。",
        features:{
          basicTraining:true,
          basicRecall:true,
          personalGraph:true,
          standardQuestionBank:true,
          allExamPapers:true,
          learningPackageImport:true,
          learningPackageExport:true,
          advancedRecall:true,
          analytics:true,
          futureAdvanced:true
        },
        limits:{
          dailyTraining:-1,
          recallMaps:-1,
          graphNodes:-1,
          recallNodes:-1,
          importPackages:-1,
          exportPackages:-1
        }
      }
    };

    const FEATURE_LABELS = {
      basicTraining:"基础刷题",
      basicRecall:"基础深度回忆",
      personalGraph:"个人知识图谱",
      demoOnly:"公开示例体验",
      standardQuestionBank:"标准题库训练",
      allExamPapers:"全部已发布试卷",
      learningPackageImport:"学习包导入",
      learningPackageExport:"学习包导出",
      advancedRecall:"高级深度回忆",
      analytics:"学习分析",
      futureAdvanced:"后续高级功能"
    };

    const LIMIT_LABELS = {
      dailyTraining:"每日训练",
      recallMaps:"回忆图谱",
      graphNodes:"图谱卡牌",
      recallNodes:"深度回忆知识点",
      importPackages:"学习包导入",
      exportPackages:"学习包导出"
    };

    function normalizePlanId(planId){
      const raw=String(planId || "free").trim();
      const lower=raw.toLowerCase();
      return PLAN_ALIASES[lower] || (PLANS[raw] ? raw : "free");
    }
    function basePlanById(planId){
      return PLANS[normalizePlanId(planId)] || PLANS.free;
    }
    function normalizeDiscountPercent(value){
      if(value == null || String(value).trim() === "") return "";
      let n=Number(String(value).replace("%","").trim());
      if(!Number.isFinite(n)) return "";
      if(n > 0 && n <= 1) n=n*100;
      n=Math.max(0,Math.min(100,n));
      return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
    }
    function normalizePaymentAmountFen(value){
      const amount=Number(value);
      return Number.isInteger(amount)&&amount>=0?amount:null;
    }
    function formatPaymentAmountFen(amountFen){
      const amount=normalizePaymentAmountFen(amountFen);
      if(amount===null)return "";
      const yuan=amount/100;
      return amount%100===0?`￥${yuan}`:`￥${yuan.toFixed(2)}`;
    }
    function splitPriceText(text){
      const raw=String(text || "").trim();
      const match=raw.match(/^([^0-9]*)([0-9]+(?:\.[0-9]+)?)(.*)$/);
      if(!match) return null;
      return {prefix:match[1] || "", amount:Number(match[2]), decimals:(match[2].split(".")[1]||"").length, suffix:match[3] || ""};
    }
    function formatDiscountAmount(amount, decimals){
      if(!Number.isFinite(amount)) return "";
      const fixed=decimals > 0 ? amount.toFixed(Math.min(decimals,2)) : String(Math.round(amount));
      return fixed.replace(/\.0+$/,"").replace(/(\.\d*?)0+$/, "$1");
    }
    function deriveDiscountPrice(originalText, discountPercent){
      const raw=String(originalText || "").trim();
      if(!raw) return "";
      const normalized=normalizeDiscountPercent(discountPercent);
      if(normalized === "") return raw;
      const info=splitPriceText(raw);
      const pct=Number(normalized);
      if(!info || !Number.isFinite(pct) || pct < 0) return raw;
      const amount=info.amount * pct / 100;
      return `${info.prefix}${formatDiscountAmount(amount,info.decimals)}${info.suffix}`;
    }
    function deriveDiscountLabel(discountPercent){
      const pct=Number(normalizeDiscountPercent(discountPercent));
      if(!Number.isFinite(pct) || pct <= 0 || pct >= 100) return "";
      const off=100-pct;
      return `-${Number.isInteger(off)?off:Number(off.toFixed(1))}%`;
    }
    function cleanPlanPatch(patch={}){
      const out={};
      if(Object.prototype.hasOwnProperty.call(patch,"enabled")) out.enabled=!!patch.enabled;
      if(Object.prototype.hasOwnProperty.call(patch,"recommended")) out.recommended=!!patch.recommended;
      ["name","shortName","priceText","originalPriceText","durationText","badgeText","description","benefitText","usageText"].forEach(key=>{
        if(Object.prototype.hasOwnProperty.call(patch,key)) out[key]=String(patch[key] == null ? "" : patch[key]).trim();
      });
      if(Object.prototype.hasOwnProperty.call(patch,"paymentAmountFen")){
        const amount=normalizePaymentAmountFen(patch.paymentAmountFen);
        if(amount!==null)out.paymentAmountFen=amount;
      }
      if(Object.prototype.hasOwnProperty.call(patch,"discountPercent")) out.discountPercent=normalizeDiscountPercent(patch.discountPercent);
      return out;
    }
    function readPlanSettings(){
      // 套餐价格只认后端：remote 由 direct-system-adapter 启动时从 /api/v1/subscriptions/plans 预载。
      // 不再读写 localStorage，避免本机缓存价与后台配置脱节。
      const remote=window.KGSubscriptionRemotePlanSettings;
      const out={};
      if(remote && typeof remote === "object"){
        PLAN_ORDER.forEach(id=>{
          if(remote[id] && typeof remote[id] === "object") out[id]=cleanPlanPatch(remote[id]);
        });
      }
      return out;
    }
    function savePlanSettings(settings){
      const out={};
      if(settings && typeof settings === "object"){
        PLAN_ORDER.forEach(id=>{
          if(settings[id] && typeof settings[id] === "object") out[id]=cleanPlanPatch(settings[id]);
        });
      }
      window.KGSubscriptionRemotePlanSettings=Object.freeze(out);
      window.dispatchEvent(new CustomEvent("kg-subscription-plan-change",{detail:{settings:out}}));
      refresh();
      return out;
    }
    function setPlanSettings(planId, patch={}){
      const id=normalizePlanId(planId);
      const settings=readPlanSettings();
      settings[id]={...(settings[id]||{}),...cleanPlanPatch(patch)};
      return savePlanSettings(settings)[id] || {};
    }
    function resetPlanSettings(planId){
      const id=normalizePlanId(planId);
      const settings=readPlanSettings();
      delete settings[id];
      savePlanSettings(settings);
      return planById(id);
    }
    function planById(planId){
      const base=basePlanById(planId);
      const settings=readPlanSettings()[base.id] || {};
      const merged={...base,...settings,id:base.id,level:base.level,billingCycle:base.billingCycle,durationDays:base.durationDays,features:{...base.features},limits:{...base.limits}};
      const serverPrice=formatPaymentAmountFen(merged.paymentAmountFen);
      const autoPrice=deriveDiscountPrice(merged.originalPriceText,merged.discountPercent);
      const discountText=deriveDiscountLabel(merged.discountPercent);
      return {...merged,priceText:serverPrice || autoPrice || merged.priceText,discountText};
    }
    function featureLabel(feature){
      return FEATURE_LABELS[feature] || feature;
    }
    function splitLines(value){
      return String(value || "")
        .split(/\r?\n/)
        .map(line=>line.trim())
        .filter(Boolean);
    }
    function defaultPlanBenefitItems(plan){
      return Object.entries(plan && plan.features || {})
        .filter(([,on])=>!!on)
        .map(([key])=>featureLabel(key));
    }
    function planBenefitItems(plan){
      const lines=splitLines(plan && plan.benefitText);
      return lines.length ? lines : defaultPlanBenefitItems(plan);
    }
    function defaultPlanUsageText(plan){
      const limits=plan && plan.limits || {};
      const keys=["dailyTraining","recallMaps","graphNodes","recallNodes"];
      const parts=keys.filter(key=>Object.prototype.hasOwnProperty.call(limits,key)).map(key=>{
        const value=limits[key];
        const text=Number(value)===-1 ? "不限" : String(value);
        return `${LIMIT_LABELS[key]||key}：${text}`;
      });
      if((plan && plan.features && (plan.features.learningPackageImport || plan.features.learningPackageExport)) || Object.prototype.hasOwnProperty.call(limits,"importPackages") || Object.prototype.hasOwnProperty.call(limits,"exportPackages")){
        parts.push("学习包导入/导出：不限");
      }
      return parts.join(" · " );
    }
    function planUsageText(plan){
      const custom=String(plan && plan.usageText || "").trim();
      return custom || defaultPlanUsageText(plan);
    }
    function planList(options={}){
      const includeDisabled=!!options.includeDisabled;
      return PLAN_ORDER.map(id=>planById(id)).filter(plan=>plan && (includeDisabled || plan.enabled !== false));
    }
    function enabledPlanList(){
      return planList({includeDisabled:false});
    }
    function expiresAtForPlan(planId, startedAt=Date.now()){
      const plan=planById(planId);
      if(!plan || plan.durationDays <= 0) return 0;
      return Number(startedAt || Date.now()) + plan.durationDays * 24 * 60 * 60 * 1000;
    }

    return {
      PLAN_ALIASES,
      PLAN_ORDER,
      PLANS,
      FEATURE_LABELS,
      LIMIT_LABELS,
      readPlanSettings,
      savePlanSettings,
      setPlanSettings,
      resetPlanSettings,
      normalizePlanId,
      basePlanById,
      planById,
      planList,
      enabledPlanList,
      expiresAtForPlan,
      deriveDiscountPrice,
      deriveDiscountLabel,
      formatPaymentAmountFen,
      featureLabel,
      planBenefitItems,
      planUsageText,
      defaultPlanBenefitItems,
      defaultPlanUsageText
    };
  };
})();
