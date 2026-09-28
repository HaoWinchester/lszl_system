import { create } from '../domain/feature-usage-clock';
import { getSessionToken } from './session';
import { getApiBaseUrl } from '../config/index';
let current: any = null;
let timer: ReturnType<typeof setInterval> | null = null;
let queue: any[] = [];
let sending = false;
let retryAt = 0;
const INTERVAL_MS = 15000;
function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.floor(Math.random()*16); return (c === 'x' ? r : (r & 3 | 8)).toString(16);
  });
}
function feature(page: any): string {
  const key = String(page?.usageFeature || page?.route || '').replace(/^pages\//, '').replace(/\/index$/, '');
  if (key === 'practice') {
    const manualAnalysis = page.data?.analysisExpanded && page.data?.showResult && page.data?.policy?.revealAfterAnswer;
    return page.data?.showAnalysis || manualAnalysis ? 'analysis' : 'practice';
  }
  return ({home:'home',papers:'papers',growth:'growth',profile:'profile',
    'practice-setup':'papers',result:'analysis',history:'analysis',revenge:'recall'} as Record<string,string>)[key] || '';
}
function drain(): void {
  if (sending || !queue.length || Date.now() < retryAt) return;
  const entry = queue[0];
  if (entry.identity !== getSessionToken() || Date.now()-Date.parse(entry.endedAt)>600000) {
    queue.shift(); drain(); return;
  }
  sending = true;
  let continueDrain = false;
  const { identity: token, ...data } = entry;
  wx.request({url:`${getApiBaseUrl()}/api/v1/analytics/feature-intervals`,method:'POST',data,
    header:{Authorization:`Bearer ${token}`,'content-type':'application/json'},timeout:8000,
    success(response: any) {
      continueDrain = response.statusCode >= 200 && response.statusCode < 500 && response.statusCode !== 429;
      if (continueDrain && queue[0] === entry) queue.shift();
    },
    // Analytics never clears authentication or redirects the learner.
    complete() {
      sending = false;
      retryAt = continueDrain ? 0 : Date.now() + INTERVAL_MS;
      if (continueDrain) drain();
    },
  });
}
const clock = create({now:()=>Date.now(),uuid,emit:(entry:any)=>{
  queue.push(entry);if(queue.length>64)queue.shift();drain();
}});
function sync(): void { clock.select(feature(current),getSessionToken()); }
export function usageShow(page: any): void {
  if (!feature(page)) return;
  current = page; sync(); clock.visibility(true);
  if (timer === null) timer = setInterval(()=>{sync();clock.tick();drain();},INTERVAL_MS);
}
export function usageHide(page: any): void {
  if (current !== page) return;
  usageBackground();
}
export function usageBackground(): void {
  sync();clock.visibility(false);drain();current=null;
  if(timer !== null) clearInterval(timer);timer=null;
}
export function usageTouch(page: any): void {
  // Native scrolling belongs to the tabs host, while sampling belongs to its visible panel.
  if (page?.route === 'pages/tabs/index') {
    if (page.hostHidden || page.restoringScroll || !current || current.panelVisible === false || current.panelPageHidden) return;
    const active = page.selectComponent?.(`#panel-${page.data?.activeTab}`);
    if (active !== current) return;
    page = active;
  }
  if (current !== page) return;
  sync();clock.touch();drain();
}
