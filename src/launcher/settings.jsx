/* AI LAUNCHER — in-app Settings: accent wheel (hue + sat/brightness) + ink + motion */

function HueRing({ h, s, v, onHue }) {
  const ref = React.useRef(null);
  const ORBIT = 63;
  const hex = rgbToHex(hsvToRgb({ h, s, v }));

  const setFromPointer = (e) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let ang = Math.atan2(e.clientX - cx, -(e.clientY - cy)) * 180 / Math.PI;
    if (ang < 0) ang += 360;
    onHue(ang);
  };
  const onDown = (e) => {
    e.preventDefault();
    setFromPointer(e);
    const mv = (ev) => setFromPointer(ev);
    const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="hue-ring" ref={ref} onPointerDown={onDown}>
      <div className="hue-track" />
      <div className="hue-knob" style={{ transform: `rotate(${h}deg) translateY(-${ORBIT}px)` }} />
      <div className="ring-core" style={{ background: hex }}>
        <span className="ring-hex">{hex.toUpperCase()}</span>
      </div>
    </div>
  );
}

function SvSlider({ label, kind, value, h, s, onChange }) {
  // value 0..100; kind: "sat" | "val"
  const track = kind === "sat"
    ? `linear-gradient(90deg, hsl(${h} 0% 62%), hsl(${h} 90% 52%))`
    : `linear-gradient(90deg, #05080c, hsl(${h} ${Math.round(s*100)}% 52%))`;
  return (
    <label className="sv-row">
      <span className="sv-k">{label}</span>
      <span className="sv-track" style={{ background: track }}>
        <input type="range" min="0" max="100" value={Math.round(value)}
          onChange={(e) => onChange(parseInt(e.target.value, 10))} />
      </span>
      <span className="sv-v">{Math.round(value)}</span>
    </label>
  );
}

// snazzy sliding 2-way toggle (animated thumb)
function SlideToggle({ options, value, onChange }) {
  const idx = Math.max(0, options.findIndex(o => o.value === value));
  return (
    <div className="slidetog" data-idx={idx}>
      <span className="slidetog-thumb" style={{ transform: `translateX(${idx * 100}%)` }} />
      {options.map(o => (
        <button key={o.value} className={value === o.value ? "on" : ""}
          onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

const ACCENT_PRESETS = [
  { id: "Orange", hex: "#E87D2F" },
  { id: "Teal",   hex: "#23d3c0" },
  { id: "Cyan",   hex: "#43cfe2" },
  { id: "Violet", hex: "#9b7bff" },
  { id: "Lime",   hex: "#9ed24f" },
  { id: "Rose",   hex: "#f25c8a" },
];

/* Detached Settings reuses the dashboard's controls, colors and motion. */
function Field({label,value,onChange,type="text",disabled=false,placeholder="",help}) {
  const helpId=React.useId();
  return <label className="nexus-field"><span>{label}</span><input aria-label={label} aria-describedby={help?helpId:undefined} type={type} value={value??""} placeholder={placeholder} disabled={disabled} onChange={e=>onChange(type==="number"?(e.target.value===""?null:Number(e.target.value)):e.target.value)}/>{help&&<small id={helpId}>{help}</small>}</label>;
}
function PathField({label,value,onChange,kind,disabled=false,placeholder=""}) {
  const [busy,setBusy]=React.useState(false),[error,setError]=React.useState("");
  const id=React.useId(),onChangeRef=React.useRef(onChange),mounted=React.useRef(true);
  onChangeRef.current=onChange;
  React.useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const browse=async()=>{setBusy(true);setError("");try{
    const selected=await Backend.browseFile(kind,value);
    if(mounted.current&&selected!==null&&selected!==undefined)onChangeRef.current(selected);
  }catch(e){if(mounted.current)setError(String(e?.message||e));}
  finally{if(mounted.current)setBusy(false);}};
  return <div className="nexus-field path-field">
    <label htmlFor={id}>{label}</label>
    <div className="path-input-row"><input id={id} type="text" value={value??""} placeholder={placeholder} disabled={disabled||busy} onChange={e=>{setError("");onChange(e.target.value);}}/>
      <button type="button" className="btn path-browse" aria-label={"Browse for "+label} disabled={disabled||busy||!Backend.isTauri} title={Backend.isTauri?"Choose an existing file":"Browsing requires the native Windows app"} onClick={browse}>{busy?"CHOOSING…":"BROWSE…"}</button>
    </div>{error&&<span className="inline-error" role="alert">{error}</span>}
  </div>;
}
function Choice({label,value,values,onChange,disabled=false}) {
  return <label className="nexus-field"><span>{label}</span><select aria-label={label} value={value??""} disabled={disabled} onChange={e=>onChange(e.target.value)}>{values.map(v=><option key={typeof v==="string"?v:v.value} value={typeof v==="string"?v:v.value}>{typeof v==="string"?v:v.label}</option>)}</select></label>;
}
const JsonValidity = React.createContext(()=>{});
function JsonField({label,value,onApply,help}) {
  const [text,setText]=React.useState(JSON.stringify(value,null,2)),[error,setError]=React.useState("");
  const report = React.useContext(JsonValidity);
  React.useEffect(()=>{report(label,!!error);return()=>report(label,false);},[label,error,report]);
  React.useEffect(()=>{setText(JSON.stringify(value,null,2));setError("");},[JSON.stringify(value)]);
  return <div className="nexus-field"><span>{label}</span>{help&&<small>{help}</small>}<textarea value={text} spellCheck="false" rows="6" onChange={e=>{
    setText(e.target.value);try{onApply(JSON.parse(e.target.value));setError("");}catch(x){setError("Enter valid JSON before saving.");}
  }}/>{error&&<span className="inline-error" role="alert">{error}</span>}</div>;
}
/* Common options are guidance, never automatically selected tuning. */
const COMMON_FLAGS = [
  {name:"--n-gpu-layers",title:"GPU layers",hint:"Choose a layer count supported by your build and memory budget.",placeholder:"Layer count",needsValue:true},
  {name:"--flash-attn",title:"Flash Attention",hint:"Choose on, off or auto when your backend supports it.",placeholder:"on / off / auto",needsValue:true},
  {name:"--threads",title:"CPU threads",hint:"CPU worker count during generation.",placeholder:"Thread count",needsValue:true},
  {name:"--batch-size",title:"Prompt batch size",hint:"Maximum logical prompt batch. Larger values can use more memory.",placeholder:"Token count",needsValue:true},
  {name:"--ubatch-size",title:"Physical batch size",hint:"Smaller processing batches can reduce peak memory use.",placeholder:"Token count",needsValue:true},
  {name:"--jinja",title:"Chat template engine",hint:"Enable Jinja chat templates when needed by your supplied build.",placeholder:"No value",needsValue:false},
];
function FlagEditor({label,value,onChange,binary,scope}) {
  const [name,setName]=React.useState(""),[argument,setArgument]=React.useState(""),[search,setSearch]=React.useState(""),[error,setError]=React.useState("");
  const rows=NexusConfig.flagRows(value),known=COMMON_FLAGS.find(f=>f.name===name);
  const matching=COMMON_FLAGS.filter(f=>(f.name+" "+f.title+" "+f.hint).toLowerCase().includes(search.toLowerCase()));
  const add=()=>{try{
    if(known?.needsValue&&!argument.trim())throw new Error("Enter a value for "+name+".");
    onChange(NexusConfig.appendFlag(value,name,argument));setName("");setArgument("");setError("");
  }catch(e){setError(e.message);}};
  return <section className="flag-editor" aria-label={label}>
    <div className="flag-heading"><b>{label}</b><span className="settings-note">{scope==="runtime"?"Applies to every model":"For this model"}</span></div>
    {!rows.length?<p className="settings-note">No extra flags. Options already set in the form do not need to be added here.</p>:
      <div className="flag-list">{rows.map(row=><div className="flag-row" key={row.start}><code>{row.tokens.map(t=>/\s/.test(t)?JSON.stringify(t):t).join(" ")}</code><button className="btn" aria-label={"Remove "+row.tokens[0]} onClick={()=>onChange(value.filter((_,i)=>i<row.start||i>=row.end))}>REMOVE</button></div>)}</div>}
    <div className="flag-add">
      <Field label="Flag name" value={name} placeholder="--threads" onChange={v=>{setName(v);setError("");}}/>
      <Field label="Flag value" value={argument} placeholder={known?.placeholder||"Optional; one argument"} onChange={setArgument}/>
      <button className="btn go" disabled={!name.trim()} onClick={add}>ADD FLAG</button>
    </div>
    {error&&<p className="inline-error" role="alert">{error}</p>}
    <details className="flag-guide">
      <summary>Find a flag · common options and documentation</summary>
      <p className="settings-note">Choose an option to fill the editor, then enter your value and add it. Flags vary by llama.cpp build. Check your executable's help before using them.</p>
      <Field label="Search flag guide" value={search} onChange={setSearch} placeholder="GPU, attention, threads…"/>
      <div className="flag-catalog">{matching.map(f=><div className="flag-reference" key={f.name}><div><b>{f.title}</b><code>{f.name}</code><p>{f.hint}</p></div><button className="btn" onClick={()=>{setName(f.name);setArgument("");setError("");}}>USE FLAG</button></div>)}</div>
      {!matching.length&&<p className="settings-note">No matching common option. The full reference includes more flags.</p>}
      <div className="flag-docs"><button className="btn" onClick={()=>Backend.openFlagReference().catch(e=>setError(String(e)))}>OPEN LLAMA.CPP REFERENCE ↗</button><p className="settings-note">For the exact options in your build, run this command yourself. AI Nexus does not execute it:</p><code className="help-command">{NexusConfig.helpCommand(binary)}</code></div>
    </details>
    <details className="flag-advanced"><summary>Advanced · raw argument tokens</summary><JsonField label={label+" (JSON token array)"} value={value} onApply={tokens=>{if(!Array.isArray(tokens)||!tokens.every(t=>typeof t==="string"))throw Error();onChange(tokens);}} help="One string per argument. Values containing spaces stay one argument. Model paths, contexts, cache types, devices, sampling and ports are managed by their form fields."/></details>
  </section>;
}

function AppearanceEditor({value:a,onChange}) {
  const hsv=rgbToHsv(hexToRgb(a.accent_color)),push=next=>onChange({...a,...next});
  return <div className="settings-columns">
    <div className="settings-card"><div className="settings-sec">Accent</div><div className="ring-wrap"><HueRing h={hsv.h} s={hsv.s} v={hsv.v} onHue={h=>push({accent_color:rgbToHex(hsvToRgb({...hsv,h}))})}/></div>
      <SvSlider label="Saturation" kind="sat" value={hsv.s*100} h={hsv.h} s={hsv.s} onChange={p=>push({accent_color:rgbToHex(hsvToRgb({...hsv,s:p/100}))})}/>
      <SvSlider label="Brightness" kind="val" value={hsv.v*100} h={hsv.h} s={hsv.s} onChange={p=>push({accent_color:rgbToHex(hsvToRgb({...hsv,v:p/100}))})}/>
      <div className="preset-row">{ACCENT_PRESETS.map(p=><button key={p.id} title={p.id} className={"preset"+(a.accent_color.toLowerCase()===p.hex.toLowerCase()?" on":"")} style={{background:p.hex}} onClick={()=>push({accent_color:p.hex})}/>)}</div>
      <div className="settings-sec">Button text</div><SlideToggle value={a.ink} onChange={ink=>push({ink})} options={[{value:"black",label:"Black"},{value:"white",label:"White"}]}/>
      <div className="settings-sec">Motion</div><SlideToggle value={a.motion} onChange={motion=>push({motion})} options={[{value:"static",label:"Static"},{value:"live",label:"Live"}]}/>
      <p className="settings-note">Live animates the ambient dashboard. Measurements always come from actual samples.</p>
    </div>
    <div className="settings-card">
      <Choice label="Dashboard layout" value={a.form} values={["standard","panel","bar"]} onChange={form=>push({form})}/>
      <Choice label="Card style" value={a.card_style} values={["flat","outlined","glow"]} onChange={card_style=>push({card_style})}/>
      <Choice label="Backdrop" value={a.backdrop} values={["ember","mesh","topo","grid","scan","void"]} onChange={backdrop=>push({backdrop})}/>
      <Choice label="Typography" value={a.font} values={["grotesk","geist","mono"]} onChange={font=>push({font})}/>
      <Choice label="Density" value={a.density} values={["comfortable","compact"]} onChange={density=>push({density})}/>
      <p className="settings-note">Font families use local availability and system fallbacks in this development copy.</p>
    </div>
  </div>;
}
function ContextSizeControl({value,onChange}) {
  const [custom,setCustom]=React.useState(!NexusConfig.CONTEXT_SIZES.includes(value));
  const options=[...NexusConfig.CONTEXT_SIZES.map(size=>({value:String(size),label:NexusConfig.contextSizeLabel(size)+" · "+NexusConfig.formatTokens(size)+" tokens"})),{value:"custom",label:"Custom size"}];
  return <div className="context-size-control">
    <Choice label="Context size" value={custom?"custom":String(value)} values={options} onChange={v=>{setCustom(v==="custom");if(v!=="custom")onChange(Number(v));}}/>
    {custom&&<Field label="Custom context size (tokens)" type="number" value={value} onChange={onChange} help="Use a positive whole number. Longer contexts use more memory."/>}
  </div>;
}
function ContextProfilesEditor({model:m,onChange}) {
  const [editing,setEditing]=React.useState(null),[adding,setAdding]=React.useState(false),[error,setError]=React.useState("");
  const [size,setSize]=React.useState(16384),[name,setName]=React.useState("16K");
  const profile=m.contexts.find(c=>c.id===editing);
  const pushProfile=next=>onChange({...m,contexts:m.contexts.map(c=>c.id===editing?{...c,...next}:c)});
  const beginAdd=()=>{const value=NexusConfig.CONTEXT_SIZES.find(n=>!m.contexts.some(c=>c.ctx_size===n))||16384;setSize(value);setName(NexusConfig.contextSizeLabel(value));setAdding(true);setEditing(null);setError("");};
  const create=()=>{try{const c=NexusConfig.newContextProfile(m.contexts,size,name);onChange({...m,contexts:[...m.contexts,c]});setAdding(false);setEditing(c.id);setError("");}catch(e){setError(e.message);}};
  const updateSize=value=>{if(name===NexusConfig.contextSizeLabel(size))setName(NexusConfig.contextSizeLabel(value));setSize(value);setError("");};
  const sizeError=profile&&(!Number.isInteger(profile.ctx_size)||profile.ctx_size<=0||profile.ctx_size>4294967295);
  const limitError=profile?.output_limit!=null&&profile.output_limit>profile.ctx_size;
  return <section className="context-profiles" aria-label="Context profiles">
    <div className="context-heading"><div><h3>Context profiles</h3><p>Choose how many tokens the model can use. Longer contexts use more memory.</p></div><button type="button" className="btn" onClick={beginAdd}>ADD PROFILE</button></div>
    <div className="context-profile-list">{m.contexts.map(c=><div className={"context-profile-row"+(c.id===editing?" editing":"")} key={c.id}>
      <button type="button" className="context-profile-select" aria-label={"Edit profile "+NexusConfig.contextLabel(c)} aria-expanded={c.id===editing} onClick={()=>{setEditing(editing===c.id?null:c.id);setAdding(false);setError("");}}>
        <b>{NexusConfig.contextLabel(c)}</b><span>{NexusConfig.formatTokens(c.ctx_size)} tokens{c.tensor_split?" · custom GPU split":""}{c.cache_type_k||c.cache_type_v?" · custom cache":""}</span>
      </button>
      {m.default_context===c.id?<span className="context-default">DEFAULT</span>:<button type="button" className="btn context-default-action" aria-label={"Use "+NexusConfig.contextLabel(c)+" by default"} onClick={()=>onChange({...m,default_context:c.id})}>SET DEFAULT</button>}
    </div>)}</div>
    {adding&&<div className="context-profile-editor context-create" role="group" aria-label="New context profile">
      <h4>New profile</h4><div className="settings-columns"><Field label="Profile name" value={name} onChange={v=>{setName(v);setError("");}} placeholder="Daily use, Long chat…"/><ContextSizeControl key="new" value={size} onChange={updateSize}/></div>
      <p className="settings-note">GPU split and cache use the backend defaults until you change them.</p>
      {error&&<p className="inline-error" role="alert">{error}</p>}
      <div className="context-editor-actions"><button type="button" className="btn go" onClick={create}>CREATE PROFILE</button><button type="button" className="btn" onClick={()=>setAdding(false)}>CANCEL</button></div>
    </div>}
    {profile&&!adding&&<div className="context-profile-editor" role="group" aria-label="Edit context profile">
      <div className="context-editor-heading"><h4>Edit {NexusConfig.contextLabel(profile)}</h4><button type="button" className="btn" onClick={()=>setEditing(null)}>DONE</button></div>
      <div className="settings-columns"><Field label="Profile name" value={profile.name??profile.id} onChange={name=>pushProfile({name})}/><ContextSizeControl key={profile.id} value={profile.ctx_size} onChange={ctx_size=>pushProfile({ctx_size,...(NexusConfig.contextLabel(profile)===NexusConfig.contextSizeLabel(profile.ctx_size)?{name:NexusConfig.contextSizeLabel(ctx_size)}:{})})}/></div>
      {sizeError&&<p className="inline-error" role="alert">Enter a positive whole-number token count.</p>}
      {limitError&&<p className="inline-error" role="alert">The OpenCode reply limit is larger than this context. Change it under Advanced options.</p>}
      <details className="context-advanced" open={limitError||undefined}><summary>Advanced options · GPU split, cache and OpenCode</summary>
        <div className="settings-columns"><Field label="Tensor split" value={profile.tensor_split} onChange={tensor_split=>pushProfile({tensor_split})} placeholder="Use backend default" help="Comma-separated values in your selected device order."/>
          <Field label="OpenCode reply limit (optional)" type="number" value={profile.output_limit} onChange={output_limit=>pushProfile({output_limit})} help="Used only when OpenCode sync is enabled. Leave blank to keep its current limit."/>
          <Choice label="Key cache type" value={profile.cache_type_k||""} values={[{value:"",label:"Backend default"},"f16","bf16","q8_0","q4_0","q4_1","q5_0","q5_1","iq4_nl"]} onChange={v=>pushProfile({cache_type_k:v||null})}/>
          <Choice label="Value cache type" value={profile.cache_type_v||""} values={[{value:"",label:"Backend default"},"f16","bf16","q8_0","q4_0","q4_1","q5_0","q5_1","iq4_nl"]} onChange={v=>pushProfile({cache_type_v:v||null})}/>
        </div>
      </details>
      <div className="context-editor-actions"><span className="settings-note">Changes are kept when you save Settings.</span><button type="button" className="btn context-remove" disabled={m.contexts.length<2} onClick={()=>{try{onChange(NexusConfig.removeContextProfile(m,profile.id));setEditing(null);setError("");}catch(e){setError(e.message);}}}>REMOVE PROFILE</button></div>
    </div>}
    {!editing&&!adding&&<p className="settings-note context-overview-note">Click a profile to edit it. The default is selected when you open the dashboard.</p>}
  </section>;
}
function ModelEditor({model:m,onChange,active,binary}) {
  const push=next=>onChange({...m,...next});
  return <div className="settings-card">
    {active&&<p className="config-banner">Stop this active entry in the dashboard before editing or removing it.</p>}
    <fieldset disabled={active}>
      <div className="settings-columns">
        <Field label="Stable ID" value={m.id} onChange={id=>push({id})}/>
        <Field label="Display name" value={m.name} onChange={name=>push({name})}/>
        <Field label="Description" value={m.description} onChange={description=>push({description})}/>
        <Field label="Tier label" value={m.tier} onChange={tier=>push({tier})}/>
        <Field label="Quantization label" value={m.quant} onChange={quant=>push({quant})}/>
        <Field label="Weight size (GiB, optional)" type="number" value={m.weights_gb} onChange={weights_gb=>push({weights_gb})}/>
      </div>
      <PathField label="Model file" kind="model" value={m.file} onChange={file=>push({file})} placeholder="Choose your GGUF file or enter its absolute path"/>
      <PathField label="Vision projector (optional)" kind="projector" value={m.mmproj} onChange={mmproj=>push({mmproj})}/>
      <PathField label="Draft / MTP model (optional)" kind="draft" value={m.draft_file} onChange={draft_file=>push({draft_file})}/>
      <label className="check"><input type="checkbox" checked={m.primary} onChange={e=>push({primary:e.target.checked})}/>Mark as primary</label>
      <ContextProfilesEditor key={m.id} model={m} onChange={onChange}/>
      <div className="settings-sec">Sampling and advanced flags</div>
      <div className="settings-columns">
        <Field label="Temperature" type="number" value={m.sampling.temp} onChange={temp=>push({sampling:{...m.sampling,temp}})}/>
        <Field label="Top-p" type="number" value={m.sampling.top_p} onChange={top_p=>push({sampling:{...m.sampling,top_p}})}/>
        <Field label="Top-k" type="number" value={m.sampling.top_k} onChange={top_k=>push({sampling:{...m.sampling,top_k}})}/>
      </div>
      <FlagEditor label="Model flags" value={m.flags} binary={binary} scope="model" onChange={flags=>push({flags})}/>
    </fieldset>
  </div>;
}
function useAppearanceAutosave(snapshot,onSaved) {
  const [value,setValue]=React.useState(()=>window.NEXUS_EXAMPLE.appearance);
  const [state,setState]=React.useState("idle"),[error,setError]=React.useState("");
  const valueRef=React.useRef(value),stateRef=React.useRef(state),callback=React.useRef(onSaved),queue=React.useRef(null);
  callback.current=onSaved;
  if(!queue.current)queue.current=NexusConfig.createAppearanceQueue({
    save:a=>Backend.saveAppearance(a),preview:a=>Backend.previewAppearance(a),
    onSaved:s=>callback.current({...s,changeKind:"appearance"}),
    onState:(next,message)=>{stateRef.current=next;setState(next);setError(message||"");},
  });
  React.useEffect(()=>{
    if(snapshot&&!["saving","error"].includes(stateRef.current)){valueRef.current=snapshot.configuration.appearance;setValue(valueRef.current);}
  },[snapshot]);
  React.useEffect(()=>()=>queue.current.dispose(),[]);
  return {value,valueRef,state,error,flush:()=>queue.current.flush(),change:a=>{
    valueRef.current=a;setValue(a);
    if(Backend.isTauri)queue.current.update(a);else{setState("preview");setError("");}
  }};
}
function SettingsWindow() {
  const {snapshot,setSnapshot,error:loadError}=useConfiguration(),runtime=useRuntimeStatus();
  const [draft,setDraft]=React.useState(null),[baseRevision,setBaseRevision]=React.useState(0),[dirty,setDirty]=React.useState(false),[tab,setTab]=React.useState("Models"),[selected,setSelected]=React.useState(0),[message,setMessage]=React.useState(""),[busy,setBusy]=React.useState(false);
  const [jsonErrors,setJsonErrors]=React.useState({}),[reloadEpoch,setReloadEpoch]=React.useState(0);
  const draftRef=React.useRef(null),baselineRef=React.useRef(null),revisionRef=React.useRef(0),dirtyRef=React.useRef(false),allowClose=React.useRef(false);
  const reportJson=React.useCallback((id,invalid)=>setJsonErrors(old=>old[id]===invalid?old:{...old,[id]:invalid}),[]);
  const invalidJson=Object.values(jsonErrors).some(Boolean);
  const acceptAppearance=s=>{
    if(NexusConfig.sameExceptAppearance(baselineRef.current,s.configuration)){
      revisionRef.current=s.revision;setBaseRevision(s.revision);baselineRef.current=s.configuration;
      if(draftRef.current){draftRef.current={...draftRef.current,appearance:s.configuration.appearance};setDraft(draftRef.current);}
    }
    setSnapshot(old=>old&&old.revision>s.revision?old:s);
  };
  const appearance=useAppearanceAutosave(snapshot,acceptAppearance);
  React.useEffect(()=>{
    if(!snapshot)return;
    if(!dirtyRef.current){
      draftRef.current=structuredClone(snapshot.configuration);setDraft(draftRef.current);
      baselineRef.current=snapshot.configuration;revisionRef.current=snapshot.revision;setBaseRevision(snapshot.revision);
    }else if(snapshot.changeKind==="appearance"&&NexusConfig.sameExceptAppearance(baselineRef.current,snapshot.configuration)){
      baselineRef.current=snapshot.configuration;revisionRef.current=snapshot.revision;setBaseRevision(snapshot.revision);
      draftRef.current={...draftRef.current,appearance:snapshot.configuration.appearance};setDraft(draftRef.current);
    }
  },[snapshot,dirty]);
  const close=async()=>{try{await appearance.flush();allowClose.current=true;await Backend.winClose();}catch(e){setMessage("Appearance could not be saved: "+String(e?.message||e));}};
  const closeRef=React.useRef(close);closeRef.current=close;
  React.useEffect(()=>{
    let alive=true,off;
    Backend.onWindowClose(e=>{if(!allowClose.current){e.preventDefault();closeRef.current();}}).then(fn=>{if(alive)off=fn;else fn();});
    return()=>{alive=false;off?.();};
  },[]);
  if(!draft||!snapshot)return <div className="loading-state">{loadError||"Loading Settings…"}</div>;
  const update=next=>{draftRef.current=next;setDraft(next);dirtyRef.current=true;setDirty(true);setMessage("");};
  const reload=()=>{setReloadEpoch(e=>e+1);draftRef.current=structuredClone(snapshot.configuration);setDraft(draftRef.current);baselineRef.current=snapshot.configuration;revisionRef.current=snapshot.revision;setBaseRevision(snapshot.revision);dirtyRef.current=false;setDirty(false);setMessage("");};
  const save=async()=>{
    setBusy(true);try{
      if(invalidJson)throw new Error("Repair invalid JSON before saving.");
      await appearance.flush();
      const configuration={...draftRef.current,appearance:appearance.valueRef.current};
      NexusConfig.validateDraft(configuration);
      const s=await Backend.saveConfig(configuration,revisionRef.current);
      draftRef.current=structuredClone(s.configuration);baselineRef.current=s.configuration;revisionRef.current=s.revision;
      setSnapshot(s);setDraft(draftRef.current);setBaseRevision(s.revision);dirtyRef.current=false;setDirty(false);
      setMessage("Configuration saved. Both windows now use it.");
    }catch(e){setMessage(String(e?.message||e));}finally{setBusy(false);}
  };
  const recover=async()=>{setBusy(true);try{await appearance.flush();const s=await Backend.recoverConfig();setSnapshot(s);dirtyRef.current=false;setDirty(false);setReloadEpoch(e=>e+1);setMessage("Previous configuration restored.");}catch(e){setMessage(String(e));}finally{setBusy(false);}};

  const m=draft.models[selected],activeId=runtime.active?.id;
  const r=draft.runtime,setRuntime=next=>update({...draft,runtime:{...r,...next}});
  return <JsonValidity.Provider value={reportJson}><ThemeShell appearance={appearance.value} className="nexus-settings">
    <div className="settings-window">
      <div className="settings-h"><span className="settings-gear"><Gear/></span><b>AI Nexus · Settings</b><span className="tb-spacer"/><span className="settings-note">{dirty||invalidJson?"Unsaved model/runtime changes":appearance.state==="saving"?"Saving appearance…":appearance.state==="saved"?"Preferences saved":"No unsaved changes"}</span><button className="settings-x" title="Close Settings; processes remain running" onClick={close}>✕</button></div>
      {snapshot.status!=="ready"&&<div className="config-banner">{snapshot.error}</div>}
      {dirty&&snapshot.revision!==baseRevision&&<div className="config-banner">Configuration changed in another window. Reload before saving.</div>}
      <div className="settings-tabs" role="tablist">{["Models","Runtime","Appearance","Integrations"].map(t=><button key={t} role="tab" aria-selected={tab===t} className={tab===t?"on":""} onClick={()=>setTab(t)}>{t}</button>)}</div>
      <div className="settings-content scroll" key={reloadEpoch}>
        {tab==="Models"&&<>
          <div className="model-roster"><button className="btn go" onClick={()=>{const models=[...draft.models,NexusConfig.newModel(draft.models)];update({...draft,models});setSelected(models.length-1);}}>ADD MODEL</button>
            {draft.models.map((entry,i)=><button key={i} className={"roster-entry"+(selected===i?" on":"")} onClick={()=>setSelected(i)}>{entry.name||entry.id}{activeId===entry.id?" · active":""}</button>)}
          </div>
          {m?<><ModelEditor model={m} binary={r.binary} active={m.id===activeId} onChange={next=>update({...draft,models:draft.models.map((entry,i)=>i===selected?next:entry)})}/>
            <div className="remove-entry"><button className="btn stop" disabled={m.id===activeId} onClick={()=>{try{update(NexusConfig.removeModel(draft,m.id,activeId));setSelected(Math.max(0,selected-1));}catch(e){setMessage(String(e));}}}>REMOVE ENTRY</button><span className="settings-note">Removes the configuration entry only. Model and auxiliary files stay on disk.</span></div>
          </>:<div className="empty-state"><b>No model entries yet</b><p>Add a model, paste its file path, and choose a context profile. Nothing is downloaded.</p></div>}
        </>}
        {tab==="Runtime"&&<div className="settings-card">
          {activeId&&<p className="config-banner">Stop the active model before changing runtime settings.</p>}
          <fieldset disabled={!!activeId}>
            <Choice label="User-supplied llama.cpp backend build" value={r.backend||""} values={[{value:"",label:"Select a build"},{value:"cuda",label:"CUDA"},{value:"hip",label:"HIP"},{value:"vulkan",label:"Vulkan"}]} onChange={backend=>setRuntime({backend:backend||null})}/>
            <PathField label="llama-server executable" kind="runtime" value={r.binary} onChange={binary=>setRuntime({binary})} placeholder="Choose llama-server.exe or enter its absolute path"/>
            <p className="settings-note">The executable and its runtime libraries are supplied by you. Device IDs and options must match that build. No automatic GPU tuning is applied.</p>
            <div className="settings-columns">
              <Choice label="Loopback host" value={r.host} values={["127.0.0.1","localhost","::1"]} onChange={host=>setRuntime({host})}/>
              <Field label="Inference port" type="number" value={r.port} onChange={port=>setRuntime({port})}/>
              <Field label="Device IDs (comma-separated, optional)" value={r.devices.join(",")} onChange={devices=>setRuntime({devices:devices.split(",").map(x=>x.trim()).filter(Boolean)})}/>
              <Field label="Main GPU index in selected devices (optional)" type="number" value={r.main_gpu} onChange={main_gpu=>setRuntime({main_gpu})}/>
            </div>
            <FlagEditor label="Runtime flags" value={r.extra_args} binary={r.binary} scope="runtime" onChange={extra_args=>setRuntime({extra_args})}/>
          </fieldset>
          <div className="settings-sec">GPU monitoring</div>
          <Choice label="Monitoring source" value={draft.monitoring.backend} values={["unavailable","amd-adlx","nvidia-smi"]} onChange={backend=>update({...draft,monitoring:{...draft.monitoring,backend}})}/>
          <Field label="User-supplied AMD helper path" value={draft.monitoring.helper} onChange={helper=>update({...draft,monitoring:{...draft.monitoring,helper}})}/>
          <Field label="User-supplied nvidia-smi path" value={draft.monitoring.nvidia_smi} onChange={nvidia_smi=>update({...draft,monitoring:{...draft.monitoring,nvidia_smi}})}/>
          <Field label="Poll interval (ms)" type="number" value={draft.monitoring.poll_interval_ms} onChange={poll_interval_ms=>update({...draft,monitoring:{...draft.monitoring,poll_interval_ms}})}/>
          <p className="settings-note">No monitoring helper is included in this development copy.</p>
        </div>}
        {tab==="Appearance"&&<><div className="appearance-live-note"><span className="live-dot"/>Changes apply live and save automatically.</div>{appearance.error&&<div className="appearance-error" role="alert">{appearance.error}<button className="btn" onClick={()=>appearance.flush().catch(()=>{})}>RETRY</button></div>}<AppearanceEditor value={appearance.value} onChange={appearance.change}/></>}
        {tab==="Integrations"&&<div className="settings-card">
          <p className="settings-note">Optional services and OpenCode synchronization start disabled. Configure only separate service executables and configuration files that you intend this development copy to use.</p>
          <JsonField label="Optional services (JSON)" value={draft.services} onApply={services=>{if(!services||Array.isArray(services)||typeof services!=="object")throw Error();update({...draft,services});}} help='Each service has enabled, port, health_url, and start_command: {"program":"absolute executable path","args":[],"cwd":null,"env":{}}. Native validation checks paths and ports.'/>
          <JsonField label="OpenCode mapping (JSON)" value={draft.opencode} onApply={opencode=>{if(!opencode||Array.isArray(opencode)||typeof opencode!=="object")throw Error();update({...draft,opencode});}} help="Map launcher model IDs to entries in your separate OpenCode provider. Failed synchronization is reported while inference remains running."/>
        </div>}
      </div>
      <div className="settings-footer">
        <span className="settings-note" title={snapshot.config_path}>{message||(appearance.state==="error"?"Appearance could not be saved. Open Appearance to retry.":tab==="Appearance"?"Appearance saves automatically. Model and runtime edits use Save changes.":"Closing Settings keeps processes running. Unsaved model/runtime edits are discarded.")}</span>
        {snapshot.previous_available&&<button className="btn" disabled={busy||!Backend.isTauri} onClick={recover}>RESTORE PREVIOUS</button>}
        <button className="btn" disabled={busy} onClick={reload}>RELOAD</button><button className="btn go" disabled={busy||!dirty||invalidJson||!Backend.isTauri||snapshot.revision!==baseRevision} onClick={save}>{busy?"SAVING…":"SAVE CHANGES"}</button>
      </div>
    </div>
  </ThemeShell></JsonValidity.Provider>;
}



