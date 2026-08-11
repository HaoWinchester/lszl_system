'use strict';

/* Shared canvas settings dialog. */
(function(global){
  const ICON_CLOSE='<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"></path></svg>';
  function create(options={}){
    const appearance=global.KGCanvasAppearanceController;
    if(!appearance)throw new Error('CanvasSettingsController requires KGCanvasAppearanceController');
    let dialog=null,previewController=null,original=null,draft=null,destroyed=false;
    function palette(theme){return appearance.PALETTES[theme]||appearance.PALETTES.light}
    function renderSwatches(){
      const root=dialog?.querySelector('[data-uc-color-list]');if(!root)return;
      root.innerHTML=palette(draft.theme).map(item=>`<button type="button" class="uc-color-swatch${item.color.toLowerCase()===draft.backgroundColor.toLowerCase()?' is-active':''}" data-uc-color="${item.color}" aria-label="${item.label}" title="${item.label}"><span style="--uc-swatch:${item.color}"></span><b>${item.label}</b></button>`).join('');
    }
    function sync(){
      if(!dialog)return;
      dialog.querySelectorAll('[data-uc-theme]').forEach(button=>button.classList.toggle('is-active',button.dataset.ucTheme===draft.theme));
      dialog.querySelectorAll('[data-uc-pattern]').forEach(button=>button.classList.toggle('is-active',button.dataset.ucPattern===draft.pattern));
      renderSwatches();
      const preview=dialog.querySelector('[data-uc-preview]');
      appearance.applySurface(preview,draft);appearance.applyViewport(preview,{x:16,y:12,zoom:1});
      const value=dialog.querySelector('[data-uc-current-value]');if(value)value.textContent=(draft.theme==='dark'?'深色':'亮色')+' · '+({dots:'点状背景',grid:'网格背景',solid:'纯色背景'}[draft.pattern]);
    }
    function ensure(){
      if(dialog)return dialog;
      dialog=document.createElement('div');
      dialog.className='uc-settings-backdrop';dialog.hidden=true;
      dialog.innerHTML=`<section class="uc-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="ucCanvasSettingsTitle">
        <header><div><small>VIEW SETTINGS</small><h2 id="ucCanvasSettingsTitle">画布设置</h2><p>统一首页、多题、单题和深度回忆画布的背景与显示偏好。</p></div><button type="button" class="uc-icon-button" data-uc-close aria-label="关闭">${ICON_CLOSE}</button></header>
        <div class="uc-settings-body">
          <div class="uc-setting-block"><div class="uc-setting-title"><strong>明暗模式</strong><span data-uc-current-value></span></div><div class="uc-segmented"><button type="button" data-uc-theme="light">亮色</button><button type="button" data-uc-theme="dark">深色</button></div></div>
          <div class="uc-setting-block"><div class="uc-setting-title"><strong>背景类型</strong><span>随画布平移与缩放</span></div><div class="uc-pattern-grid"><button type="button" data-uc-pattern="dots"><i class="is-dots"></i><b>点状背景</b></button><button type="button" data-uc-pattern="grid"><i class="is-grid"></i><b>网格背景</b></button><button type="button" data-uc-pattern="solid"><i class="is-solid"></i><b>纯色背景</b></button></div></div>
          <div class="uc-setting-block"><div class="uc-setting-title"><strong>背景颜色</strong><span>不同明暗模式分别记忆</span></div><div class="uc-color-list" data-uc-color-list></div></div>
          <div class="uc-setting-block"><div class="uc-setting-title"><strong>实时预览</strong><span>节点颜色与关系线颜色不会改变</span></div><div class="uc-settings-preview" data-uc-preview><span></span><span></span><span></span><svg aria-hidden="true" viewBox="0 0 320 120"><path d="M72 66 C120 24, 198 92, 252 48"></path></svg></div></div>
        </div>
        <footer><button type="button" data-uc-cancel>取消</button><button type="button" class="is-primary" data-uc-confirm>确认</button></footer>
      </section>`;
      document.body.appendChild(dialog);
      dialog.addEventListener('click',event=>{
        if(event.target===dialog){cancel();return}
        const theme=event.target.closest('[data-uc-theme]');if(theme){
          draft.theme=theme.dataset.ucTheme==='dark'?'dark':'light';
          draft.backgroundColor=draft.theme==='dark'?draft.darkColor:draft.lightColor;
          appearance.write(draft,{source:'canvas-settings-preview'});sync();return;
        }
        const pattern=event.target.closest('[data-uc-pattern]');if(pattern){draft.pattern=pattern.dataset.ucPattern;appearance.write(draft,{source:'canvas-settings-preview'});sync();return}
        const swatch=event.target.closest('[data-uc-color]');if(swatch){
          draft.backgroundColor=swatch.dataset.ucColor;
          if(draft.theme==='dark')draft.darkColor=draft.backgroundColor;else draft.lightColor=draft.backgroundColor;
          appearance.write(draft,{source:'canvas-settings-preview'});sync();return;
        }
        if(event.target.closest('[data-uc-close],[data-uc-cancel]'))cancel();
        if(event.target.closest('[data-uc-confirm]'))confirm();
      });
      document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!dialog.hidden)cancel()});
      return dialog;
    }
    function open(){
      if(destroyed)return false;ensure();
      original=appearance.read();draft=appearance.normalize(original);
      dialog.hidden=false;document.body.classList.add('uc-settings-open');sync();
      dialog.querySelector('[data-uc-close]')?.focus();return true;
    }
    function close(){if(!dialog)return;dialog.hidden=true;document.body.classList.remove('uc-settings-open')}
    function cancel(){if(original)appearance.write(original,{source:'canvas-settings-cancel'});close()}
    function confirm(){appearance.write(draft,{source:'canvas-settings-confirm'});close();options.onConfirm?.(appearance.read())}
    return Object.freeze({open,close,cancel,confirm,destroy(){destroyed=true;dialog?.remove();dialog=null;return true}});
  }
  global.KGCanvasSettingsController=Object.freeze({create});
})(window);
