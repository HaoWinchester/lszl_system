'use strict';
;(function(global){
  const PREFERENCE='kg_practice_sound_v1__';

  // Device preference only. Answer history and correctness never enter storage.
  function create({button,getOwner=()=>'',getFeedbackEnabled=()=>true}={}){
    let owner=readOwner(),enabled=readEnabled(),active=false,disposed=false,audio=null,epoch=0;
    const playing=new Set();
    function readOwner(){try{return String(getOwner()||'')}catch(_){return ''}}
    function preferenceKey(){return owner?PREFERENCE+encodeURIComponent(owner):null}
    function readEnabled(){try{const key=preferenceKey();return !!key&&global.KGDevicePreferences?.getJSON(key,false)===true}catch(_){return false}}
    function render(){
      if(!button)return;
      button.textContent=enabled?'音效开':'音效关';
      button.setAttribute('aria-pressed',String(enabled));
      button.setAttribute('aria-label',enabled?'音效开，点击关闭':'音效关，点击开启');
      button.title=enabled?'关闭答题音效':'开启答题音效';
    }
    function cleanup(record){
      playing.delete(record);record.oscillator.onended=null;
      try{record.oscillator.disconnect()}catch(_){}
      try{record.gain.disconnect()}catch(_){}
    }
    function stop({close=false}={}){
      epoch++;
      for(const record of playing){try{record.oscillator.stop()}catch(_){}cleanup(record)}
      if(close&&audio){const previous=audio;audio=null;try{Promise.resolve(previous.close()).catch(()=>{})}catch(_){}}
    }
    function syncOwner(){
      const next=readOwner();if(next===owner)return;
      stop({close:true});active=false;owner=next;enabled=readEnabled();render();
    }
    function context(){
      if(disposed||!enabled)return null;
      if(audio?.state==='closed')audio=null;
      if(!audio){try{const Constructor=global.AudioContext||global.webkitAudioContext;if(Constructor)audio=new Constructor()}catch(_){audio=null}}
      return audio;
    }
    // Called only from toggle or accepted answer user gestures; never at load.
    async function unlock(){
      try{const current=context();if(!current)return false;if(current.state==='suspended')await current.resume();return current.state==='running'}catch(_){return false}
    }
    function canPlay(){try{return !disposed&&enabled&&active&&getFeedbackEnabled()===true}catch(_){return false}}
    async function play(correct){
      try{
        syncOwner();if(typeof correct!=='boolean'||!canPlay())return false;
        stop();const request=epoch,requestOwner=owner;
        if(!await unlock())return false;
        // resume() may settle after mute, a view transition or an account change.
        syncOwner();if(request!==epoch||requestOwner!==owner||!canPlay()||audio?.state!=='running')return false;
        const current=audio,now=current.currentTime,duration=correct?0.18:0.22;
        const oscillator=current.createOscillator(),gain=current.createGain(),record={oscillator,gain};
        playing.add(record);oscillator.onended=()=>cleanup(record);
        oscillator.type=correct?'sine':'triangle';
        oscillator.frequency.setValueAtTime(correct?660:180,now);
        oscillator.frequency.exponentialRampToValueAtTime(correct?880:120,now+duration);
        gain.gain.setValueAtTime(0,now);
        gain.gain.linearRampToValueAtTime(0.045,now+0.012);
        gain.gain.exponentialRampToValueAtTime(0.001,now+duration-0.015);
        gain.gain.setValueAtTime(0,now+duration);
        oscillator.connect(gain);gain.connect(current.destination);
        oscillator.start(now);oscillator.stop(now+duration);
        return true;
      }catch(_){stop();return false}
    }
    function toggle(){
      if(disposed)return;
      syncOwner();enabled=!enabled;stop({close:!enabled});render();
      try{const key=preferenceKey();if(key)global.KGDevicePreferences?.setJSON(key,enabled)}catch(_){}
      if(enabled)void unlock();
    }
    function setActive(value){syncOwner();active=!disposed&&value===true;if(!active)stop({close:true})}
    function onPageHide(){setActive(false)}
    function dispose(){disposed=true;active=false;stop({close:true});button?.removeEventListener('click',toggle);global.removeEventListener?.('kg-auth-session-change',syncOwner);global.removeEventListener?.('pagehide',onPageHide)}
    button?.addEventListener('click',toggle);
    global.addEventListener?.('kg-auth-session-change',syncOwner);
    global.addEventListener?.('pagehide',onPageHide);
    render();
    return Object.freeze({play,stop,setActive,dispose});
  }
  global.KGPracticeSound=Object.freeze({create});
})(window);
