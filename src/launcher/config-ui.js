/* Pure configuration presentation helpers; no model roster or filesystem operations. */
(function(root) {
  function modelView(m) {
    return { ...m, desc:m.description, vision:!!m.mmproj, vramGB:m.weights_gb,
      ctxModes:m.contexts.map(c=>c.id), defaultCtx:m.default_context,
      contextLabels:Object.fromEntries(m.contexts.map(c=>[c.id,contextLabel(c)])),
      splits:Object.fromEntries(m.contexts.map(c=>[c.id,c.tensor_split])) };
  }
  function removeModel(config,id,activeId) {
    if (activeId===id) throw new Error("Stop the active model before removing its entry.");
    return {...config, models:config.models.filter(m=>m.id!==id),
      opencode:{...config.opencode,model_ids:Object.fromEntries(Object.entries(config.opencode.model_ids).filter(([key])=>key!==id))}};
  }
  function newModel(models) {
    let n=1;while(models.some(m=>m.id==="model-"+n))n++;
    return {id:"model-"+n,name:"New model",description:"",tier:"",quant:"",primary:false,weights_gb:null,
      file:"",mmproj:"",draft_file:"",contexts:[{id:"8K",ctx_size:8192,tensor_split:"",output_limit:null,cache_type_k:null,cache_type_v:null}],
      default_context:"8K",flags:[],sampling:{temp:0.7,top_p:0.95,top_k:40}};
  }
  const CONTEXT_SIZES=[8192,16384,32768,65536,131072];
  function contextLabel(c) {return c.name?.trim()||c.id;}
  function formatTokens(size) {return Number.isInteger(size)&&size>0?size.toLocaleString("en-US"):"--";}
  function contextSizeLabel(size) {return Number.isInteger(size)&&size>0?(size%1024===0?size/1024+"K":formatTokens(size)):"Custom";}
  function newContextProfile(contexts,size,name="") {
    if(!Number.isInteger(size)||size<=0||size>4294967295)throw new Error("Enter a positive whole-number token count.");
    const label=name.trim()||contextSizeLabel(size);
    if(label.length>160||/[\x00-\x1F\x7F]/.test(label))throw new Error("Use a shorter profile name without control characters.");
    const base=(label.replace(/[^A-Za-z0-9_.-]+/g,"-").replace(/^[^A-Za-z0-9]+|[-.]+$/g,"")||"profile").slice(0,100);
    let id=base,n=2;while(contexts.some(c=>c.id===id)){const suffix="-"+n++;id=base.slice(0,100-suffix.length)+suffix;}
    return {id,name:label,ctx_size:size,tensor_split:"",output_limit:null,cache_type_k:null,cache_type_v:null};
  }
  function removeContextProfile(model,id) {
    if(model.contexts.length<2)throw new Error("Keep at least one context profile.");
    const contexts=model.contexts.filter(c=>c.id!==id);
    if(contexts.length===model.contexts.length)throw new Error("That profile no longer exists.");
    return {...model,contexts,default_context:model.default_context===id?contexts[0].id:model.default_context};
  }
  function systemView(sample) {
    let cpu=cleanMetric(sample?.cpu);if(cpu>100)cpu=null;
    const ram=cleanMetric(sample?.ram),total=cleanMetric(sample?.ramTotal);
    const validRam=ram!==null&&total!==null&&total>0&&ram<=total;
    return {cpu,ram:validRam?ram:null,ramTotal:validRam?total:null,ramPct:validRam?ram/total*100:null};
  }
  function splitValid(text,count) {
    if (!text.trim()) return true;
    const parts=text.split(",").map(s=>s.trim());
    const values=parts.map(Number),sum=values.reduce((a,b)=>a+b,0);
    return parts.every(Boolean)&&values.every(n=>Number.isFinite(n)&&n>=0)&&Number.isFinite(sum)&&sum>0&&(!count||values.length===count);
  }
  function validateDraft(config) {
    const ids=new Set();
    for(const m of config.models) {
      if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(m.id)||ids.has(m.id))throw new Error("Model IDs must be valid and unique.");
      ids.add(m.id);
      if(!m.name.trim()||!m.file.trim())throw new Error("Each model needs a name and model-file path.");
      const contexts=new Set();
      for(const c of m.contexts) {
        if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(c.id)||contexts.has(c.id)||!Number.isInteger(c.ctx_size)||c.ctx_size<=0||c.ctx_size>4294967295)throw new Error("Context IDs must be valid and unique; sizes must be positive whole numbers.");
        contexts.add(c.id);
        if(c.name!=null&&(typeof c.name!=="string"||c.name.length>160||/[\x00-\x1F\x7F]/.test(c.name)))throw new Error("Use a shorter profile name without control characters.");
        if(c.output_limit!=null&&(!Number.isInteger(c.output_limit)||c.output_limit<=0||c.output_limit>c.ctx_size))throw new Error("The reply limit must fit within the context size.");
        if(!splitValid(c.tensor_split,config.runtime.devices.length))throw new Error("Invalid tensor split: use finite, nonnegative values matching selected devices.");
      }
      if(!contexts.has(m.default_context))throw new Error("Choose an existing default context.");
    }
    return config; // Native persistence also validates file availability and all other fields.
  }
  function cleanMetric(v) {return typeof v==="number"&&Number.isFinite(v)&&v>=0?v:null;}
  function gpuView(r,at) { return {idx:r.index,name:r.name,temp:cleanMetric(r.temp),hotspot:cleanMetric(r.hotspotTemp),
    pwr:cleanMetric(r.powerW),vram:cleanMetric(r.vramUsedMB),vramTotal:cleanMetric(r.vramTotalMB),util:cleanMetric(r.utilPct),sampleAt:at}; }
  function sampleHistory(history,value,stamp,lastStamp) {
    if(stamp===lastStamp||!Number.isFinite(value))return history;
    return [...history,Math.max(0,Math.min(100,value))].slice(-64);
  }

  const MANAGED_FLAGS = new Set(["--model","-m","--mmproj","-md","--model-draft","--alias","--port","--host","--ctx-size","-c","--tensor-split","-ts","--device","--main-gpu","-mg","--temp","--top-p","--top-k","-ctk","-ctv","--cache-type-k","--cache-type-v"]);
  function flagRows(tokens) {
    const rows=[];
    tokens.forEach((token,index)=>{
      if(/^--?[A-Za-z]/.test(token)||!rows.length)rows.push({start:index,end:index+1,tokens:[token]});
      else {rows.at(-1).tokens.push(token);rows.at(-1).end=index+1;}
    });
    return rows;
  }
  function appendFlag(tokens,name,value="") {
    name=name.trim();
    if(!/^--?[A-Za-z][A-Za-z0-9-]*$/.test(name))throw new Error("Use a flag name such as --threads.");
    if(MANAGED_FLAGS.has(name))throw new Error("Set this option in the model, context or runtime fields instead.");
    if(tokens.some(t=>t.split("=")[0]===name))throw new Error("That flag is already in this list. Remove it before replacing it.");
    if(value.includes("\0"))throw new Error("Flag values cannot contain a NUL character.");
    return [...tokens,name,...(value.trim()?[value.trim()]:[])];
  }
  function sameExceptAppearance(a,b) {
    if(!a||!b)return false;
    const omit=c=>{const {appearance,...other}=c;return other;};
    return JSON.stringify(omit(a))===JSON.stringify(omit(b));
  }
  function helpCommand(binary) {return binary?"& '"+binary.replace(/'/g,"''")+"' --help":"llama-server.exe --help";}
  // Serialize saves and debounce rapid gestures; a flush includes the newest change.
  function createAppearanceQueue({save,preview,onSaved,onState,delay=300}) {
    let desired,version=0,committed=0,timer=null,flight=null;
    const clear=()=>{if(timer){clearTimeout(timer);timer=null;}};
    const flush=()=>{
      clear();
      if(flight)return flight.then(()=>version>committed?flush():undefined);
      if(version===committed)return Promise.resolve();
      const at=version,value=desired;
      flight=Promise.resolve().then(()=>save(value)).then(snapshot=>{
        committed=at;onSaved?.(snapshot);onState?.(version===committed?"saved":"saving");return snapshot;
      }).catch(e=>{onState?.("error",String(e?.message||e));throw e;}).finally(()=>{flight=null;});
      return flight.then(snapshot=>version>committed?flush().then(()=>snapshot):snapshot);
    };
    return {
      update(value){desired=value;version++;onState?.("saving");Promise.resolve(preview?.(value)).catch(e=>onState?.("error",String(e)));clear();timer=setTimeout(()=>flush().catch(()=>{}),delay);},
      flush,dispose:clear,
    };
  }

  const api={modelView,removeModel,newModel,CONTEXT_SIZES,contextLabel,formatTokens,contextSizeLabel,newContextProfile,removeContextProfile,systemView,splitValid,validateDraft,cleanMetric,gpuView,sampleHistory,flagRows,appendFlag,sameExceptAppearance,helpCommand,createAppearanceQueue};
  root.NexusConfig=api;if(typeof module!=="undefined")module.exports=api;
})(typeof window!=="undefined"?window:globalThis);


