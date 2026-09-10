import { assignPair, pairLabel } from '../../domain/pc-practice';
import { loadQuestionAsset, removeQuestionAsset } from '../../services/question-assets';
Component({
  properties: {
    question: { type: Object, value: {} },
    selectedIds: { type: Array, value: [] },
    selectedPairs: {type:Object,value:{}},
    submitted: { type: Boolean, value: false },
    showAnalysis: { type: Boolean, value: false },
    showResult: { type: Boolean, value: false },
    compact: { type: Boolean, value: false },
  },
  data: { caseOpen:true, activeLeft:'', pairRows:[], matchingStatus:'', assetImages:[], assetErrors:[], materialImages:[], displayQuestion: { images: [], options: [] }, displayOptions: [], answerLabel: '', selectedLabel: '', outcome: '' },
  observers: {
    'question, selectedIds, showAnalysis, showResult, selectedPairs'(question: any, selectedIds: string[], showAnalysis: boolean, showResult: boolean, selectedPairs:Record<string,string>) {
      const selected = new Set((selectedIds || []).map(String));
      const safeQuestion = question && typeof question === 'object' ? question : { images: [], options: [] };
      const reveal = showAnalysis || showResult;
      const correctIds = reveal ? (safeQuestion.correctOptionIds?.length ? safeQuestion.correctOptionIds : safeQuestion.correctAnswer ? [safeQuestion.correctAnswer] : []).map(String) : [];
      const correct = new Set(correctIds);
      const pairs=selectedPairs||{}, matching=safeQuestion.type==='matching';
      this.setData({
        pairRows:(safeQuestion.matching?.left||[]).map((left:any,index:number)=>({id:left.id,text:left.text,number:index+1,selectedId:pairs[left.id]||'',selectedText:safeQuestion.matching.right.find((r:any)=>r.id===pairs[left.id])?.text||'选择候选答案',correctText:reveal?safeQuestion.matching.right.find((r:any)=>r.id===safeQuestion.matching.correctPairs?.[left.id])?.text:'',verdict:reveal?(pairs[left.id]===safeQuestion.matching.correctPairs?.[left.id]?'correct':'wrong'):''})),
        displayQuestion: { ...safeQuestion, images: safeQuestion.images || [], options: safeQuestion.options || [] },
        displayOptions: (safeQuestion.options || []).map((option: any) => ({
          ...option, selected: selected.has(String(option.id)),
          verdict: !reveal || !correct.size ? '' : correct.has(String(option.id)) ? 'correct' : selected.has(String(option.id)) ? 'wrong' : '',
        })),
        answerLabel: matching?pairLabel(safeQuestion,safeQuestion.matching?.correctPairs):correctIds.join('、') || '请参考解析',
        selectedLabel: matching?pairLabel(safeQuestion,pairs):[...selected].join('、') || '未作答',
        outcome: matching ? !Object.keys(pairs).length ? '本题未作答' : (safeQuestion.matching?.left||[]).every((item:any)=>pairs[item.id]===safeQuestion.matching.correctPairs?.[item.id]) ? '回答正确' : '回答有误' : !correct.size ? '作答已记录' : correct.size === selected.size && [...correct].every(id => selected.has(id)) ? '回答正确' : selected.size ? '回答有误' : '本题未作答',
      });
      this.loadAssets?.(safeQuestion);
    },
  },
  lifetimes:{detached(){(this as any)._assetToken=((this as any)._assetToken||0)+1;for(const file of (this as any)._assetFiles||[])removeQuestionAsset(file);}},
  methods: {
    async loadAssets(question:any,force=false){
      const list=[...(question.imageAssets||[]).map((asset:any)=>({...asset,material:false})),...(question.material?.images||[]).map((asset:any)=>({...asset,material:true}))];
      const key=JSON.stringify(list.map((item:any)=>[item.id,item.material]));if(!force&&(this as any)._assetKey===key)return;
      (this as any)._assetKey=key;const token=((this as any)._assetToken||0)+1;(this as any)._assetToken=token;
      for(const file of (this as any)._assetFiles||[])removeQuestionAsset(file);(this as any)._assetFiles=[];
      this.setData({assetImages:[],materialImages:[],assetErrors:[]});
      const results=await Promise.all(list.map(async(asset:any)=>{try{return {...asset,src:await loadQuestionAsset(asset)};}catch{return {...asset,error:true};}}));
      if((this as any)._assetToken!==token){results.forEach((item:any)=>{if(item.src)removeQuestionAsset(item.src);});return;}
      (this as any)._assetFiles=results.filter((item:any)=>item.src).map((item:any)=>item.src);
      this.setData({assetImages:results.filter((item:any)=>!item.material&&!item.error),materialImages:results.filter((item:any)=>item.material&&!item.error),assetErrors:results.filter((item:any)=>item.error)});
    },
    retryAssets(){this.loadAssets(this.properties.question,true);},
    toggleCase(){this.setData({caseOpen:!this.data.caseOpen});},
    chooseLeft(event:any){if(this.properties.submitted)return;this.setData({activeLeft:String(event.currentTarget.dataset.id),matchingStatus:'请选择下方候选答案'});},
    chooseRight(event:any){if(this.properties.submitted)return;if(!this.data.activeLeft){this.setData({matchingStatus:'请先选择上方条目'});return;}const pairs=assignPair(this.properties.question,this.properties.selectedPairs,this.data.activeLeft,String(event.currentTarget.dataset.id));this.setData({activeLeft:'',matchingStatus:`已配对 ${Object.keys(pairs).length} 项`});this.triggerEvent('change',{selectedPairs:pairs});},
    clearPair(event:any){if(this.properties.submitted)return;this.triggerEvent('change',{selectedPairs:assignPair(this.properties.question,this.properties.selectedPairs,String(event.currentTarget.dataset.id),'')});},
    onChoose(event: any) {
      if (this.properties.submitted) return;
      this.triggerEvent('change', { optionId: String(event.currentTarget.dataset.id || '') });
    },
    previewImage(event: any) {
      const current = String(event.currentTarget.dataset.src || '');
      if (!current) return;
      wx.previewImage({ current, urls: [current] });
    },
  },
});
