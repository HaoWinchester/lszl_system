'use strict';
(function(global){
  class ActivityService{
    constructor(options={}){this.legacy=options.legacy;this.transactions=options.transactions;this.references=options.references}
    library(){return this.legacy.getActivityLibrary()}
    list(filters={}){return this.legacy.getActivities(filters)}
    title(activity){return this.legacy.activityTitle(activity)}
    async save(activity,options={}){const tx=await this.transactions.executeAsync({name:'保存活动',action:'activity.save',entityType:'activity',entityId:activity?.id,permission:'editActivities',keys:['activityOverrides'],commit:()=>this.legacy.saveActivity(activity,options)});if(tx.valid)this.references?.invalidate();return tx.valid?{...tx.value,transactionId:tx.transactionId}:{valid:false,errors:tx.errors||[]}}
    async saveMany(activities,options={}){const tx=await this.transactions.executeAsync({name:'批量保存活动',action:'activity.save.batch',entityType:'activity',permission:'editActivities',keys:['activityOverrides'],commit:()=>this.legacy.saveActivities(activities,options),metadata:{count:(activities||[]).length}});if(tx.valid)this.references?.invalidate();return tx.valid?{...tx.value,transactionId:tx.transactionId}:{valid:false,errors:tx.errors||[]}}
    async map(activityIds,mapping){const tx=await this.transactions.executeAsync({name:'设置活动知识归属',action:'activity.map',entityType:'activity',permission:'editActivities',keys:['activityOverrides'],commit:()=>this.legacy.mapActivities(activityIds,mapping),metadata:{count:(activityIds||[]).length,taxonomyId:mapping?.taxonomyId}});if(tx.valid)this.references?.invalidate();return tx.valid?{...tx.value,transactionId:tx.transactionId}:{valid:false,errors:tx.errors||[]}}
    async importPackage(payload,options={}){const tx=await this.transactions.executeAsync({name:'导入活动包',action:'activity.import',entityType:'activity-package',permission:'editActivities',keys:['activityOverrides'],commit:()=>this.legacy.importActivityPackage(payload,options)});if(tx.valid)this.references?.invalidate();return tx.valid?{...tx.value,transactionId:tx.transactionId}:{valid:false,errors:tx.errors||[]}}
    exportPackage(filters={},metadata={}){return this.legacy.exportActivityPackage(filters,metadata)}
    usage(activityId){return this.references?.referencesForActivity(activityId)||this.legacy.activityUsage(activityId)}
  }
  global.KGActivityService=ActivityService;
})(window);
