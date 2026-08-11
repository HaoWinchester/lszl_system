'use strict';

(function(global){
  const CARD_STYLES=new Set(['standard','sticky','rounded','rectangle','circle','triangle']);
  const LEGACY_CARD_STYLE_ALIASES=Object.freeze({text:'rounded'});
  const TEXT_ALIGNS=new Set(['left','center','right']);
  const FONT_SIZE_PRESETS=Object.freeze([6,8,10,12,14,18,24,36,48,64,80,144,288]);
  const FONT_SIZES=new Set(FONT_SIZE_PRESETS);
  const LEGACY_FONT_SIZE_MAP=Object.freeze({small:13,medium:15,large:20,xlarge:26});
  const FONT_FAMILIES=new Set(['system','sans','serif','kai','mono']);
  const FONT_WEIGHTS=new Set(['normal','bold']);
  const FONT_STYLES=new Set(['normal','italic']);
  const BORDER_STYLES=new Set(['solid','dashed','dotted']);
  const SIZE_DIMENSIONS=Object.freeze({small:{width:104,height:110},default:{width:128,height:132},big:{width:160,height:166}});
  const CARD_STYLE_DEFAULTS=Object.freeze({
    standard:Object.freeze({fillColor:'#ffffff',fillOpacity:1,headerIconColor:'#64748b',headerFillColor:'#eef2ff',bodyFillColor:'#ffffff',headerTextColor:'#ffffff',bodyTextColor:'#0f172a',regionColorsCustomized:false,borderVisible:true,borderColor:'#cbd5e1',borderWidth:1,borderStyle:'solid',borderOpacity:1,textColor:'#0f172a',textBackgroundColor:'#ffffff',textBackgroundOpacity:0,fontSize:15,fontFamily:'system',fontWeight:'bold',fontStyle:'normal',underline:false,strikeThrough:false,lineHeight:1.25,letterSpacing:0}),
    sticky:Object.freeze({fillColor:'#fef3c7',fillOpacity:1,borderVisible:true,borderColor:'#f59e0b',borderWidth:1,borderStyle:'solid',borderOpacity:.58,textColor:'#422006',textBackgroundColor:'#ffffff',textBackgroundOpacity:0,fontSize:15,fontFamily:'system',fontWeight:'bold',fontStyle:'normal',underline:false,strikeThrough:false,lineHeight:1.35,letterSpacing:0}),
    rounded:Object.freeze({fillColor:'#eff6ff',fillOpacity:1,borderVisible:true,borderColor:'#60a5fa',borderWidth:1,borderStyle:'solid',borderOpacity:.72,textColor:'#0f172a',textBackgroundColor:'#ffffff',textBackgroundOpacity:0,fontSize:15,fontFamily:'system',fontWeight:'bold',fontStyle:'normal',underline:false,strikeThrough:false,lineHeight:1.25,letterSpacing:0}),
    rectangle:Object.freeze({fillColor:'#f8fafc',fillOpacity:1,borderVisible:true,borderColor:'#64748b',borderWidth:1,borderStyle:'solid',borderOpacity:.78,textColor:'#0f172a',textBackgroundColor:'#ffffff',textBackgroundOpacity:0,fontSize:15,fontFamily:'system',fontWeight:'bold',fontStyle:'normal',underline:false,strikeThrough:false,lineHeight:1.25,letterSpacing:0}),
    circle:Object.freeze({fillColor:'#ecfeff',fillOpacity:1,borderVisible:true,borderColor:'#0891b2',borderWidth:1,borderStyle:'solid',borderOpacity:.78,textColor:'#164e63',textBackgroundColor:'#ffffff',textBackgroundOpacity:0,fontSize:15,fontFamily:'system',fontWeight:'bold',fontStyle:'normal',underline:false,strikeThrough:false,lineHeight:1.2,letterSpacing:0}),
    triangle:Object.freeze({fillColor:'#fefce8',fillOpacity:1,borderVisible:true,borderColor:'#ca8a04',borderWidth:1,borderStyle:'solid',borderOpacity:.82,textColor:'#713f12',textBackgroundColor:'#ffffff',textBackgroundOpacity:0,fontSize:14,fontFamily:'system',fontWeight:'bold',fontStyle:'normal',underline:false,strikeThrough:false,lineHeight:1.15,letterSpacing:0})
  });
  const DEFAULT_INTERACTION=Object.freeze({locked:false});
  const DEFAULT_APPEARANCE=Object.freeze({
    cardStyle:'standard',
    color:'#64748b',
    fillColor:'#ffffff',
    fillOpacity:1,
    headerIconColor:'#64748b',
    headerFillColor:'#eef2ff',
    bodyFillColor:'#ffffff',
    headerTextColor:'#ffffff',
    bodyTextColor:'#0f172a',
    regionColorsCustomized:false,
    borderVisible:true,
    borderColor:'#cbd5e1',
    borderWidth:1,
    borderStyle:'solid',
    borderOpacity:1,
    surfaceCustomized:false,
    textColor:'#0f172a',
    textBackgroundColor:'#ffffff',
    textBackgroundOpacity:0,
    textAlign:'center',
    fontSize:15,
    fontFamily:'system',
    fontWeight:'bold',
    fontStyle:'normal',
    underline:false,
    strikeThrough:false,
    lineHeight:1.25,
    letterSpacing:0,
    size:''
  });

  function clone(value){
    if(value==null||typeof value!=='object')return value;
    try{return JSON.parse(JSON.stringify(value))}catch(error){return value}
  }
  function finite(value,fallback=0){if(value==null||value==='')return fallback;const n=Number(value);return Number.isFinite(n)?n:fallback}
  function clamp(value,min,max,fallback=min){const n=finite(value,fallback);return Math.min(max,Math.max(min,n))}
  function text(value,fallback='',max=3000){const s=String(value??fallback);return s.length>max?s.slice(0,max):s}
  function safeColor(value,fallback=DEFAULT_APPEARANCE.color){return /^#[0-9a-f]{6}$/i.test(String(value||''))?String(value).toLowerCase():fallback}
  function contrastTextColor(fillColor,fillOpacity=1){
    if(Number(fillOpacity)<.18)return DEFAULT_APPEARANCE.textColor;
    const value=safeColor(fillColor,'#ffffff'),n=parseInt(value.slice(1),16),r=(n>>16)&255,g=(n>>8)&255,b=n&255;
    return (r*.299+g*.587+b*.114)<150?'#ffffff':'#0f172a';
  }
  function sizeKey(value){return value==='small'||value==='big'?value:''}
  function fontSizeValue(value,fallback=15){
    if(typeof value==='string'&&Object.prototype.hasOwnProperty.call(LEGACY_FONT_SIZE_MAP,value))return LEGACY_FONT_SIZE_MAP[value];
    return Math.round(clamp(value,6,288,fallback)*100)/100;
  }
  function fontFamilyKey(value){return FONT_FAMILIES.has(value)?value:'system'}
  function fontWeightKey(value){return FONT_WEIGHTS.has(value)?value:'bold'}
  function fontStyleKey(value){return FONT_STYLES.has(value)?value:'normal'}
  function lineHeightValue(value,fallback=1.25){return Math.round(clamp(value,.8,3,fallback)*100)/100}
  function letterSpacingValue(value,fallback=0){return Math.round(clamp(value,-1,8,fallback)*100)/100}
  function borderStyleKey(value){return BORDER_STYLES.has(value)?value:'solid'}
  function dimensionsForSize(value){return {...SIZE_DIMENSIONS[sizeKey(value)||'default']}}
  function sizeForDimensions(width,height,fallback=''){
    const w=Math.round(finite(width,0)),h=Math.round(finite(height,0));
    for(const [key,dims] of Object.entries(SIZE_DIMENSIONS)){
      if(dims.width===w&&dims.height===h)return key==='default'?'':key;
    }
    return sizeKey(fallback);
  }
  function canonicalCardStyle(value){
    const raw=String(value||'').trim();
    return LEGACY_CARD_STYLE_ALIASES[raw]||raw;
  }
  function defaultsForCardStyle(value){
    const normalized=canonicalCardStyle(value);
    const style=CARD_STYLES.has(normalized)?normalized:DEFAULT_APPEARANCE.cardStyle;
    return {...CARD_STYLE_DEFAULTS[style]};
  }
  function hasOwn(object,key){return !!object&&Object.prototype.hasOwnProperty.call(object,key)}
  function appearanceOf(raw={}){
    const nested=raw.appearance&&typeof raw.appearance==='object'?raw.appearance:{};
    const requestedStyle=canonicalCardStyle(nested.cardStyle||raw.cardStyle);
    const cardStyle=CARD_STYLES.has(requestedStyle)?requestedStyle:DEFAULT_APPEARANCE.cardStyle;
    const styleDefaults=defaultsForCardStyle(cardStyle);
    const size=sizeKey(nested.size??raw.size);
    const explicitFill=hasOwn(nested,'fillColor')?nested.fillColor:(hasOwn(raw,'fillColor')?raw.fillColor:null);
    const explicitFillOpacity=hasOwn(nested,'fillOpacity')?nested.fillOpacity:(hasOwn(raw,'fillOpacity')?raw.fillOpacity:null);
    const explicitHeaderIconColor=hasOwn(nested,'headerIconColor')?nested.headerIconColor:(hasOwn(raw,'headerIconColor')?raw.headerIconColor:null);
    const explicitHeaderFillColor=hasOwn(nested,'headerFillColor')?nested.headerFillColor:(hasOwn(raw,'headerFillColor')?raw.headerFillColor:null);
    const explicitBodyFillColor=hasOwn(nested,'bodyFillColor')?nested.bodyFillColor:(hasOwn(raw,'bodyFillColor')?raw.bodyFillColor:null);
    const explicitHeaderTextColor=hasOwn(nested,'headerTextColor')?nested.headerTextColor:(hasOwn(raw,'headerTextColor')?raw.headerTextColor:null);
    const explicitBodyTextColor=hasOwn(nested,'bodyTextColor')?nested.bodyTextColor:(hasOwn(raw,'bodyTextColor')?raw.bodyTextColor:null);
    const explicitRegionColorsCustomized=hasOwn(nested,'regionColorsCustomized')?nested.regionColorsCustomized:(hasOwn(raw,'regionColorsCustomized')?raw.regionColorsCustomized:false);
    const explicitBorderColor=hasOwn(nested,'borderColor')?nested.borderColor:(hasOwn(raw,'borderColor')?raw.borderColor:null);
    const explicitBorderVisible=hasOwn(nested,'borderVisible')?nested.borderVisible:(hasOwn(raw,'borderVisible')?raw.borderVisible:null);
    const explicitBorderWidth=hasOwn(nested,'borderWidth')?nested.borderWidth:(hasOwn(raw,'borderWidth')?raw.borderWidth:null);
    const explicitBorderStyle=hasOwn(nested,'borderStyle')?nested.borderStyle:(hasOwn(raw,'borderStyle')?raw.borderStyle:null);
    const explicitBorderOpacity=hasOwn(nested,'borderOpacity')?nested.borderOpacity:(hasOwn(raw,'borderOpacity')?raw.borderOpacity:null);
    const explicitSurfaceCustomized=hasOwn(nested,'surfaceCustomized')?nested.surfaceCustomized:(hasOwn(raw,'surfaceCustomized')?raw.surfaceCustomized:false);
    const explicitTextColor=hasOwn(nested,'textColor')?nested.textColor:(hasOwn(raw,'textColor')?raw.textColor:null);
    const explicitTextBackgroundColor=hasOwn(nested,'textBackgroundColor')?nested.textBackgroundColor:(hasOwn(raw,'textBackgroundColor')?raw.textBackgroundColor:null);
    const explicitTextBackgroundOpacity=hasOwn(nested,'textBackgroundOpacity')?nested.textBackgroundOpacity:(hasOwn(raw,'textBackgroundOpacity')?raw.textBackgroundOpacity:null);
    const explicitFontSize=hasOwn(nested,'fontSize')?nested.fontSize:(hasOwn(raw,'fontSize')?raw.fontSize:null);
    const explicitFontFamily=hasOwn(nested,'fontFamily')?nested.fontFamily:(hasOwn(raw,'fontFamily')?raw.fontFamily:null);
    const explicitFontWeight=hasOwn(nested,'fontWeight')?nested.fontWeight:(hasOwn(raw,'fontWeight')?raw.fontWeight:null);
    const explicitFontStyle=hasOwn(nested,'fontStyle')?nested.fontStyle:(hasOwn(raw,'fontStyle')?raw.fontStyle:null);
    const explicitUnderline=hasOwn(nested,'underline')?nested.underline:(hasOwn(raw,'underline')?raw.underline:null);
    const explicitStrikeThrough=hasOwn(nested,'strikeThrough')?nested.strikeThrough:(hasOwn(raw,'strikeThrough')?raw.strikeThrough:null);
    const explicitLineHeight=hasOwn(nested,'lineHeight')?nested.lineHeight:(hasOwn(raw,'lineHeight')?raw.lineHeight:null);
    const explicitLetterSpacing=hasOwn(nested,'letterSpacing')?nested.letterSpacing:(hasOwn(raw,'letterSpacing')?raw.letterSpacing:null);
    const surfaceCustomized=!!explicitSurfaceCustomized;
    const legacyTextDefault=(nested.cardStyle==='text'||raw.cardStyle==='text')&&!surfaceCustomized;
    const useTypeSurface=legacyTextDefault;
    const normalizedFill=useTypeSurface?styleDefaults.fillColor:safeColor(explicitFill,styleDefaults.fillColor);
    const normalizedFillOpacity=useTypeSurface?styleDefaults.fillOpacity:clamp(explicitFillOpacity,0,1,styleDefaults.fillOpacity);
    // Use the node type's intentional text colour for newly-created/type-default nodes.
    // For legacy nodes that explicitly supplied a custom surface but no text colour,
    // retain automatic contrast so dark fills remain readable.
    const textColorFallback=(explicitFill!=null||explicitFillOpacity!=null)
      ? contrastTextColor(normalizedFill,normalizedFillOpacity)
      : (styleDefaults.textColor||contrastTextColor(normalizedFill,normalizedFillOpacity));
    return{
      cardStyle,
      // color remains the compatibility/accent field used by older imports and controls.
      color:safeColor(nested.color??raw.color,DEFAULT_APPEARANCE.color),
      // Legacy nodes did not have fillColor. Keep their former white card surface instead of turning the whole card into the old accent color.
      fillColor:normalizedFill,
      fillOpacity:normalizedFillOpacity,
      headerIconColor:safeColor(explicitHeaderIconColor,nested.color??raw.color??styleDefaults.headerIconColor??DEFAULT_APPEARANCE.headerIconColor),
      headerFillColor:safeColor(explicitHeaderFillColor,styleDefaults.headerFillColor||normalizedFill),
      bodyFillColor:safeColor(explicitBodyFillColor,styleDefaults.bodyFillColor||normalizedFill),
      headerTextColor:safeColor(explicitHeaderTextColor,styleDefaults.headerTextColor||textColorFallback),
      bodyTextColor:safeColor(explicitBodyTextColor,styleDefaults.bodyTextColor||textColorFallback),
      regionColorsCustomized:!!explicitRegionColorsCustomized,
      borderVisible:useTypeSurface?!!styleDefaults.borderVisible:(explicitBorderVisible==null?!!styleDefaults.borderVisible:!!explicitBorderVisible),
      borderColor:useTypeSurface?styleDefaults.borderColor:safeColor(explicitBorderColor,styleDefaults.borderColor),
      borderWidth:useTypeSurface?styleDefaults.borderWidth:clamp(explicitBorderWidth,0,8,styleDefaults.borderWidth),
      borderStyle:useTypeSurface?styleDefaults.borderStyle:borderStyleKey(explicitBorderStyle??styleDefaults.borderStyle),
      borderOpacity:useTypeSurface?styleDefaults.borderOpacity:clamp(explicitBorderOpacity,0,1,styleDefaults.borderOpacity),
      surfaceCustomized,
      textColor:safeColor(explicitTextColor,textColorFallback),
      textBackgroundColor:safeColor(explicitTextBackgroundColor,styleDefaults.textBackgroundColor||'#ffffff'),
      textBackgroundOpacity:clamp(explicitTextBackgroundOpacity,0,1,styleDefaults.textBackgroundOpacity??0),
      textAlign:TEXT_ALIGNS.has(nested.textAlign||raw.textAlign)?(nested.textAlign||raw.textAlign):DEFAULT_APPEARANCE.textAlign,
      fontSize:fontSizeValue(explicitFontSize,styleDefaults.fontSize),
      fontFamily:fontFamilyKey(explicitFontFamily??styleDefaults.fontFamily),
      fontWeight:fontWeightKey(explicitFontWeight??styleDefaults.fontWeight),
      fontStyle:fontStyleKey(explicitFontStyle??styleDefaults.fontStyle),
      underline:explicitUnderline==null?!!styleDefaults.underline:!!explicitUnderline,
      strikeThrough:explicitStrikeThrough==null?!!styleDefaults.strikeThrough:!!explicitStrikeThrough,
      lineHeight:lineHeightValue(explicitLineHeight,styleDefaults.lineHeight),
      // Kept only as a legacy compatibility field. The P4.2.6 toolbar no longer exposes letter spacing.
      letterSpacing:letterSpacingValue(explicitLetterSpacing,0),
      size
    };
  }
  function interactionOf(raw={}){
    const nested=raw.interaction&&typeof raw.interaction==='object'?raw.interaction:{};
    return{locked:!!(nested.locked??raw.locked??DEFAULT_INTERACTION.locked)};
  }
  function contentOf(raw={}){
    const nested=raw.content&&typeof raw.content==='object'?raw.content:{};
    return{
      title:text(nested.title??raw.title,'未命名知识点',120).trim()||'未命名知识点',
      description:text(nested.description??raw.summary,'',3000),
      category:text(nested.category??raw.category,'',120),
      level:text(nested.level??raw.level,'基础',60),
      keywords:text(nested.keywords??raw.keywords,'',600),
      notes:text(nested.notes??raw.notes,'',3000),
      highlightTerms:text(nested.highlightTerms??raw.highlightTerms,'',600)
    };
  }
  function geometryOf(raw={},appearance=appearanceOf(raw)){
    const nested=raw.geometry&&typeof raw.geometry==='object'?raw.geometry:{};
    const dims=dimensionsForSize(appearance.size);
    return{
      x:Math.round(finite(nested.x??raw.x,0)),
      y:Math.round(finite(nested.y??raw.y,0)),
      width:Math.max(48,Math.round(finite(nested.width,dims.width))),
      height:Math.max(40,Math.round(finite(nested.height,dims.height)))
    };
  }
  function syncLegacy(node){
    if(!node||typeof node!=='object')return node;
    const content=contentOf(node),appearance=appearanceOf(node),geometry=geometryOf(node,appearance),interaction=interactionOf(node);
    node.content=content;
    node.appearance=appearance;
    node.geometry=geometry;
    node.interaction=interaction;
    node.locked=interaction.locked;
    node.title=content.title;
    node.summary=content.description;
    node.category=content.category;
    node.level=content.level;
    node.keywords=content.keywords;
    node.notes=content.notes;
    node.highlightTerms=content.highlightTerms;
    node.cardStyle=appearance.cardStyle;
    node.color=appearance.color;
    node.fillColor=appearance.fillColor;
    node.fillOpacity=appearance.fillOpacity;
    node.headerIconColor=appearance.headerIconColor;
    node.headerFillColor=appearance.headerFillColor;
    node.bodyFillColor=appearance.bodyFillColor;
    node.headerTextColor=appearance.headerTextColor;
    node.bodyTextColor=appearance.bodyTextColor;
    node.regionColorsCustomized=appearance.regionColorsCustomized;
    node.borderVisible=appearance.borderVisible;
    node.borderColor=appearance.borderColor;
    node.borderWidth=appearance.borderWidth;
    node.borderStyle=appearance.borderStyle;
    node.borderOpacity=appearance.borderOpacity;
    node.surfaceCustomized=appearance.surfaceCustomized;
    node.textColor=appearance.textColor;
    node.textBackgroundColor=appearance.textBackgroundColor;
    node.textBackgroundOpacity=appearance.textBackgroundOpacity;
    node.textAlign=appearance.textAlign;
    node.fontSize=appearance.fontSize;
    node.fontFamily=appearance.fontFamily;
    node.fontWeight=appearance.fontWeight;
    node.fontStyle=appearance.fontStyle;
    node.underline=appearance.underline;
    node.strikeThrough=appearance.strikeThrough;
    node.lineHeight=appearance.lineHeight;
    node.letterSpacing=appearance.letterSpacing;
    node.size=appearance.size;
    node.x=geometry.x;
    node.y=geometry.y;
    return node;
  }
  function normalizeNode(raw={},options={}){
    const base=raw&&typeof raw==='object'?clone(raw):{};
    base.id=text(base.id||options.id||'', '',120).trim()||(typeof options.idFactory==='function'?options.idFactory():'');
    return syncLegacy(base);
  }
  function normalizeNodes(nodes=[],options={}){
    const ids=new Set();
    return (Array.isArray(nodes)?nodes:[]).map((raw,index)=>{
      const node=normalizeNode(raw,{...options,id:raw&&raw.id,idFactory:()=>typeof options.idFactory==='function'?options.idFactory(index):`node-${index+1}`});
      if(!node.id||ids.has(node.id))node.id=typeof options.idFactory==='function'?options.idFactory(index):`node-${index+1}`;
      ids.add(node.id);
      return node;
    });
  }
  function normalizeGraph(graph={},options={}){
    const output=graph&&typeof graph==='object'?clone(graph):{};
    output.nodes=normalizeNodes(output.nodes,options);
    output.links=Array.isArray(output.links)?output.links:[];
    output.elements=normalizeTextElements(output.elements,options);
    return output;
  }
  function updateInteraction(node,patch={}){
    if(!node)return null;
    node.interaction={...interactionOf(node),...patch,locked:!!(patch.locked??interactionOf(node).locked)};
    return syncLegacy(node);
  }
  function updateContent(node,patch={}){
    if(!node)return null;
    node.content={...contentOf(node),...patch};
    return syncLegacy(node);
  }
  function normalizeAppearancePatch(current,patch={}){
    const next={...current,...patch};
    const surfaceFields=['fillColor','fillOpacity','headerIconColor','headerFillColor','bodyFillColor','headerTextColor','bodyTextColor','borderVisible','borderColor','borderWidth','borderStyle','borderOpacity'];
    if(!hasOwn(patch,'surfaceCustomized')&&surfaceFields.some(field=>hasOwn(patch,field))&&!hasOwn(patch,'cardStyle'))next.surfaceCustomized=true;
    if(!hasOwn(patch,'regionColorsCustomized')&&['headerFillColor','bodyFillColor','headerTextColor','bodyTextColor'].some(field=>hasOwn(patch,field)))next.regionColorsCustomized=true;
    next.cardStyle=canonicalCardStyle(next.cardStyle);
    if(!CARD_STYLES.has(next.cardStyle))next.cardStyle=DEFAULT_APPEARANCE.cardStyle;
    if(!TEXT_ALIGNS.has(next.textAlign))next.textAlign=DEFAULT_APPEARANCE.textAlign;
    if(hasOwn(patch,'headerIconColor')){
      next.headerIconColor=patch.headerIconColor;
      if(!hasOwn(patch,'color'))next.color=patch.headerIconColor;
    }
    if(hasOwn(patch,'color')&&!hasOwn(patch,'fillColor')&&!hasOwn(patch,'headerIconColor'))next.fillColor=patch.color;
    if(hasOwn(patch,'fillColor')&&!hasOwn(patch,'color'))next.color=patch.fillColor;
    next.color=safeColor(next.color,current.color);
    next.headerIconColor=safeColor(next.headerIconColor,next.color||current.headerIconColor||DEFAULT_APPEARANCE.headerIconColor);
    next.fillColor=safeColor(next.fillColor,defaultsForCardStyle(next.cardStyle).fillColor);
    next.fillOpacity=clamp(next.fillOpacity,0,1,current.fillOpacity);
    if(hasOwn(patch,'fillColor')){
      if(!hasOwn(patch,'headerFillColor'))next.headerFillColor=patch.fillColor;
      if(!hasOwn(patch,'bodyFillColor'))next.bodyFillColor=patch.fillColor;
    }
    if(hasOwn(patch,'textColor')){
      if(next.cardStyle!=='standard'&&!hasOwn(patch,'headerTextColor'))next.headerTextColor=patch.textColor;
      if(!hasOwn(patch,'bodyTextColor'))next.bodyTextColor=patch.textColor;
    }
    next.headerFillColor=safeColor(next.headerFillColor,next.fillColor);
    next.bodyFillColor=safeColor(next.bodyFillColor,next.fillColor);
    next.headerTextColor=safeColor(next.headerTextColor,next.textColor||contrastTextColor(next.headerFillColor,next.fillOpacity));
    next.bodyTextColor=safeColor(next.bodyTextColor,next.textColor||contrastTextColor(next.bodyFillColor,next.fillOpacity));
    next.regionColorsCustomized=!!next.regionColorsCustomized;
    next.borderVisible=!!next.borderVisible;
    next.borderColor=safeColor(next.borderColor,defaultsForCardStyle(next.cardStyle).borderColor);
    next.borderWidth=clamp(next.borderWidth,0,8,current.borderWidth);
    next.borderStyle=borderStyleKey(next.borderStyle);
    next.borderOpacity=clamp(next.borderOpacity,0,1,current.borderOpacity);
    next.surfaceCustomized=!!next.surfaceCustomized;
    next.textColor=safeColor(next.textColor,current.textColor||contrastTextColor(next.fillColor,next.fillOpacity));
    next.textBackgroundColor=safeColor(next.textBackgroundColor,current.textBackgroundColor||'#ffffff');
    next.textBackgroundOpacity=clamp(next.textBackgroundOpacity,0,1,current.textBackgroundOpacity??0);
    next.fontSize=fontSizeValue(next.fontSize,current.fontSize||15);
    next.fontFamily=fontFamilyKey(next.fontFamily);
    next.fontWeight=fontWeightKey(next.fontWeight);
    next.fontStyle=fontStyleKey(next.fontStyle);
    next.underline=!!next.underline;
    next.strikeThrough=!!next.strikeThrough;
    next.lineHeight=lineHeightValue(next.lineHeight,current.lineHeight||1.25);
    next.letterSpacing=letterSpacingValue(next.letterSpacing,0);
    next.size=sizeKey(next.size);
    return next;
  }
  function updateAppearance(node,patch={}){
    if(!node)return null;
    const current=appearanceOf(node),next=normalizeAppearancePatch(current,patch);
    node.appearance=next;
    const dims=dimensionsForSize(next.size);
    const currentGeometry=geometryOf(node,current);
    if(hasOwn(patch,'size')){
      currentGeometry.width=dims.width;
      currentGeometry.height=dims.height;
      node.geometry=currentGeometry;
    }
    return syncLegacy(node);
  }
  function resetAppearanceToCardStyle(node,cardStyle){
    if(!node)return null;
    const requested=canonicalCardStyle(cardStyle);
    const style=CARD_STYLES.has(requested)?requested:appearanceOf(node).cardStyle;
    const defaults=defaultsForCardStyle(style);
    return updateAppearance(node,{cardStyle:style,...defaults,surfaceCustomized:false,color:appearanceOf(node).color,textAlign:'center'});
  }
  function updateGeometry(node,patch={}){
    if(!node)return null;
    const current=geometryOf(node),next={...current,...patch};
    next.x=Math.round(finite(next.x,current.x));
    next.y=Math.round(finite(next.y,current.y));
    next.width=Math.max(48,Math.round(finite(next.width,current.width)));
    next.height=Math.max(40,Math.round(finite(next.height,current.height)));
    node.geometry=next;
    const appearance=appearanceOf(node);
    appearance.size=sizeForDimensions(next.width,next.height,appearance.size);
    node.appearance=appearance;
    return syncLegacy(node);
  }
  function updateNode(node,sections={}){
    if(sections.content)updateContent(node,sections.content);
    if(sections.interaction)updateInteraction(node,sections.interaction);
    if(sections.appearance)updateAppearance(node,sections.appearance);
    if(sections.geometry)updateGeometry(node,sections.geometry);
    return syncLegacy(node);
  }
  function findNode(graph,id){return (graph&&Array.isArray(graph.nodes)?graph.nodes:[]).find(node=>node&&node.id===id)||null}
  function updateNodes(graph,ids,section,patch){
    const wanted=new Set(Array.isArray(ids)?ids:[...ids||[]]);
    const changed=[];
    for(const node of graph&&Array.isArray(graph.nodes)?graph.nodes:[]){
      if(!wanted.has(node.id))continue;
      if(section==='content')updateContent(node,patch);
      else if(section==='appearance')updateAppearance(node,patch);
      else if(section==='geometry')updateGeometry(node,patch);
      else updateNode(node,patch);
      changed.push(node);
    }
    return changed;
  }
  function createIndex(graph={}){
    const nodeMap=new Map(),linkMap=new Map(),linksByNodeId=new Map();
    for(const node of Array.isArray(graph.nodes)?graph.nodes:[]){if(node&&node.id)nodeMap.set(node.id,node)}
    const add=(id,link)=>{if(!id)return;const list=linksByNodeId.get(id)||[];list.push(link);linksByNodeId.set(id,list)};
    for(const link of Array.isArray(graph.links)?graph.links:[]){
      if(!link||!link.id)continue;
      linkMap.set(link.id,link);
      if(nodeMap.has(link.from))add(link.from,link);
      if(nodeMap.has(link.to)&&link.to!==link.from)add(link.to,link);
    }
    return{nodeMap,linkMap,linksByNodeId};
  }
  function createNode(input={},options={}){
    return normalizeNode({...input,id:input.id||(typeof options.idFactory==='function'?options.idFactory():'')},options);
  }
  function view(node){
    if(!node)return null;
    return{content:contentOf(node),appearance:appearanceOf(node),geometry:geometryOf(node),interaction:interactionOf(node)};
  }

  function textElementContentOf(raw={}){
    const nested=raw.content&&typeof raw.content==='object'?raw.content:{};
    return{text:text(nested.text??raw.text,'点击编辑文字',3000)};
  }
  function textElementAppearanceOf(raw={}){
    const nested=raw.appearance&&typeof raw.appearance==='object'?raw.appearance:{};
    return{
      textColor:safeColor(nested.textColor??raw.textColor,'#0f172a'),
      textBackgroundColor:safeColor(nested.textBackgroundColor??raw.textBackgroundColor,'#ffffff'),
      textBackgroundOpacity:clamp(nested.textBackgroundOpacity??raw.textBackgroundOpacity,0,1,0),
      textAlign:TEXT_ALIGNS.has(nested.textAlign||raw.textAlign)?(nested.textAlign||raw.textAlign):'center',
      fontSize:fontSizeValue(nested.fontSize??raw.fontSize,20),
      fontFamily:fontFamilyKey(nested.fontFamily??raw.fontFamily??'system'),
      fontWeight:fontWeightKey(nested.fontWeight??raw.fontWeight??'bold'),
      fontStyle:fontStyleKey(nested.fontStyle??raw.fontStyle??'normal'),
      underline:!!(nested.underline??raw.underline),
      strikeThrough:!!(nested.strikeThrough??raw.strikeThrough),
      lineHeight:lineHeightValue(nested.lineHeight??raw.lineHeight,1.45),
      // Legacy-only compatibility value; no UI control is exposed.
      letterSpacing:letterSpacingValue(nested.letterSpacing??raw.letterSpacing,0)
    };
  }
  function textElementGeometryOf(raw={}){
    const nested=raw.geometry&&typeof raw.geometry==='object'?raw.geometry:{};
    const width=Math.max(24,Math.round(finite(nested.width??raw.width,220)));
    const height=Math.max(24,Math.round(finite(nested.height??raw.height,72)));
    const explicitManual=hasOwn(nested,'manualSize')?nested.manualSize:(hasOwn(raw,'manualSize')?raw.manualSize:null);
    const legacyDefault=(width===220&&height===72)||(width===240&&height===76);
    return{
      x:Math.round(finite(nested.x??raw.x,0)),
      y:Math.round(finite(nested.y??raw.y,0)),
      width,
      height,
      manualSize:explicitManual==null?!legacyDefault:!!explicitManual
    };
  }
  function syncTextElement(element){
    if(!element||typeof element!=='object')return element;
    const content=textElementContentOf(element),appearance=textElementAppearanceOf(element),geometry=textElementGeometryOf(element);
    element.elementType='text';element.content=content;element.appearance=appearance;element.geometry=geometry;
    element.text=content.text;element.textColor=appearance.textColor;element.textBackgroundColor=appearance.textBackgroundColor;element.textBackgroundOpacity=appearance.textBackgroundOpacity;element.textAlign=appearance.textAlign;element.fontSize=appearance.fontSize;element.fontFamily=appearance.fontFamily;element.fontWeight=appearance.fontWeight;element.fontStyle=appearance.fontStyle;element.underline=appearance.underline;element.strikeThrough=appearance.strikeThrough;element.lineHeight=appearance.lineHeight;element.letterSpacing=appearance.letterSpacing;
    element.x=geometry.x;element.y=geometry.y;element.width=geometry.width;element.height=geometry.height;element.manualSize=geometry.manualSize;
    return element;
  }
  function normalizeTextElement(raw={},options={}){
    const base=raw&&typeof raw==='object'?clone(raw):{};
    base.id=text(base.id||options.id||'','',120).trim()||(typeof options.idFactory==='function'?options.idFactory():'');
    return syncTextElement(base);
  }
  function normalizeTextElements(elements=[],options={}){
    const ids=new Set();
    return (Array.isArray(elements)?elements:[]).map((raw,index)=>{
      const element=normalizeTextElement(raw,{...options,id:raw&&raw.id,idFactory:()=>typeof options.idFactory==='function'?options.idFactory(index):`text-${index+1}`});
      if(!element.id||ids.has(element.id))element.id=typeof options.idFactory==='function'?options.idFactory(index):`text-${index+1}`;
      ids.add(element.id);return element;
    });
  }
  function updateTextElementContent(element,patch={}){if(!element)return null;element.content={...textElementContentOf(element),...patch};return syncTextElement(element)}
  function updateTextElementAppearance(element,patch={}){if(!element)return null;element.appearance={...textElementAppearanceOf(element),...patch};return syncTextElement(element)}
  function updateTextElementGeometry(element,patch={}){if(!element)return null;element.geometry={...textElementGeometryOf(element),...patch};return syncTextElement(element)}
  function createTextElement(input={},options={}){return normalizeTextElement({...input,id:input.id||(typeof options.idFactory==='function'?options.idFactory():'')},options)}

  global.KGGraphModel=Object.freeze({
    CARD_STYLES,TEXT_ALIGNS,FONT_SIZE_PRESETS,FONT_SIZES,LEGACY_FONT_SIZE_MAP,FONT_FAMILIES,FONT_WEIGHTS,FONT_STYLES,BORDER_STYLES,DEFAULT_APPEARANCE,CARD_STYLE_DEFAULTS,SIZE_DIMENSIONS,LEGACY_CARD_STYLE_ALIASES,DEFAULT_INTERACTION,
    clone,safeColor,contrastTextColor,dimensionsForSize,sizeForDimensions,fontSizeValue,lineHeightValue,canonicalCardStyle,defaultsForCardStyle,contentOf,appearanceOf,geometryOf,interactionOf,
    normalizeNode,normalizeNodes,normalizeGraph,syncLegacy,updateInteraction,updateContent,updateAppearance,resetAppearanceToCardStyle,updateGeometry,updateNode,updateNodes,
    findNode,createIndex,createNode,view,
    textElementContentOf,textElementAppearanceOf,textElementGeometryOf,syncTextElement,normalizeTextElement,normalizeTextElements,updateTextElementContent,updateTextElementAppearance,updateTextElementGeometry,createTextElement
  });
})(typeof window!=='undefined'?window:globalThis);
