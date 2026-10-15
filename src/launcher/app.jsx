/* The original dashboard shell and visual effects, driven by one configuration. */
function useConfiguration() {
  const [snapshot,setSnapshot]=React.useState(null),[error,setError]=React.useState("");
  React.useEffect(()=>{
    let alive=true,offs=[];
    Backend.getConfig().then(s=>alive&&setSnapshot(s)).catch(e=>alive&&setError(String(e)));
    const listen=(method,kind)=>method(s=>alive&&setSnapshot(old=>old&&old.revision>s.revision?old:{...s,changeKind:kind})).then(fn=>{if(alive)offs.push(fn);else fn();});
    listen(Backend.onConfig,"configuration");listen(Backend.onAppearanceSaved,"appearance");
    return()=>{alive=false;offs.forEach(fn=>fn());};
  },[]);
  return {snapshot,setSnapshot,error};
}
function useRuntimeStatus() {
  const [runtime,setRuntime]=React.useState({active:null,services:{}}),[error,setError]=React.useState("");
  React.useEffect(()=>{
    let alive=true,off,timer,fetching=false;
    const refresh=async()=>{if(fetching||!alive)return;fetching=true;try{const r=await Backend.runtimeStatus();if(alive){setRuntime(r);setError("");}}catch(e){if(alive){setError("Runtime status unavailable: "+String(e));setRuntime(old=>({...old,active:old.active?{...old.active,phase:"unknown"}:null,services:Object.fromEntries(Object.keys(old.services).map(id=>[id,"unknown"]))}));}}finally{fetching=false;}};
    refresh();timer=setInterval(refresh,2000);
    Backend.onRuntime(refresh).then(fn=>{if(alive)off=fn;else fn();});
    return()=>{alive=false;clearInterval(timer);off?.();};
  },[]);
  return {...runtime,error};
}
function ThemeShell({appearance:a,children,className="",win="open"}) {
  return <div className={"app app--"+a.form+" "+className} data-win={win} data-motion={a.motion} data-backdrop={a.backdrop} data-density={a.density} data-font={a.font} data-cardstyle={a.card_style} style={accentVars(a.accent_color,a.ink)}>
    <div className="appbg" aria-hidden="true"/>{children}
  </div>;
}
let logoSequence=0;
function LauncherLogo({size=16}) {
  const gid=React.useMemo(()=>"nexus-logo-"+(++logoSequence),[]);
  return <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true">
    <defs><linearGradient id={gid} x1="22" y1="20" x2="78" y2="80" gradientUnits="userSpaceOnUse"><stop stopColor="var(--accent)"/><stop offset="1" stopColor="var(--accent-2)"/></linearGradient></defs>
    <polyline points="22,58 50,30 78,58" stroke={"url(#"+gid+")"} strokeWidth="13" strokeLinejoin="round" strokeLinecap="round"/>
    <polyline points="30,75 50,53 70,75" stroke="var(--accent)" strokeWidth="9" strokeLinejoin="round" strokeLinecap="round" opacity=".45"/>
  </svg>;
}
function LogoTile({size=22}) {return <span className="tb-logo" style={{width:size,height:size}}><LauncherLogo size={Math.round(size*.62)}/></span>;}
function SystemReadouts({sample,compact=false}) {
  const s=NexusConfig.systemView(sample),meter=(label,value)=><span className="sysbar" role={value==null?"img":"meter"} aria-label={label+(value==null?" unavailable":"")} aria-valuemin={value==null?undefined:0} aria-valuemax={value==null?undefined:100} aria-valuenow={value==null?undefined:value}><i style={{width:(value??0)+"%"}}/></span>;
  return <span className={"system-readouts"+(compact?" hud-system":"")}>
    <span className="seg sys"><b>CPU</b>{meter("CPU usage",s.cpu)}<span className="system-value">{s.cpu==null?"--":Math.round(s.cpu)+"%"}</span></span>
    <span className="seg sys"><b>RAM</b>{meter("RAM usage",s.ramPct)}<span className="system-value">{s.ram==null?"--":s.ram.toFixed(1)+" / "+s.ramTotal.toFixed(1)+" GiB"}</span></span>
  </span>;
}
function MinTile({active,vramPct,vramGB,sys,onRestore,onSettings,onClose}) {
  const drag=Backend.isTauri?{"data-tauri-drag-region":true}:{};
  return <div className="mintile" {...drag}>
    <button className="mt-logo" onClick={onRestore} title="Restore AI Nexus"><LogoTile size={26}/></button>
    <div className="mt-id" {...drag}><b {...drag}>AI NEXUS</b><span {...drag} className={active?.phase==="running"?"on":""}>{active?active.id+" · "+active.phase:"all idle"}</span></div>
    <span className="mt-sep" {...drag}/><div className="mt-vram" {...drag}><div className="bar" {...drag}><i style={{width:(vramPct||0)+"%"}}/></div><span {...drag}>{vramGB==null?"VRAM --":vramGB+"G"}</span></div>
    <SystemReadouts sample={sys} compact/>
    <button className="gear-btn" onClick={onSettings} title="Settings"><Gear/></button>
    <button className="mt-restore" onClick={onRestore} title="Restore">⤢</button><button className="mt-restore" onClick={onClose} title="Close AI Nexus" aria-label="Close AI Nexus">×</button>
  </div>;
}
function App() {
  const {snapshot,error}=useConfiguration(),runtime=useRuntimeStatus();
  const [ctxByModel,setContexts]=React.useState({}),[request,setRequest]=React.useState(false),[servicePending,setServicePending]=React.useState({}),[notice,setNotice]=React.useState(null);
  const [live,setLive]=React.useState([]),[gpuError,setGpuError]=React.useState(""),[sys,setSys]=React.useState(null),[compact,setCompact]=React.useState(false);
  const [appearancePreview,setAppearancePreview]=React.useState(null);
  React.useEffect(()=>{let alive=true,off;Backend.onAppearancePreview(a=>alive&&setAppearancePreview(a)).then(fn=>{if(alive)off=fn;else fn();});return()=>{alive=false;off?.();};},[]);
  React.useEffect(()=>{if(snapshot?.changeKind!=="appearance")setAppearancePreview(null);},[snapshot]);
  const cfg=snapshot?.configuration,a=appearancePreview||cfg?.appearance,active=runtime.active;
  React.useEffect(()=>{
    if(!cfg)return;
    let alive=true,timer;
    const poll=async()=>{
      const results=await Promise.allSettled([
        cfg.monitoring.backend==="unavailable"?Promise.reject(new Error("No monitoring helper is supplied with this development copy.")):Backend.pollGpus(),
        Backend.isTauri?Backend.systemStats():Promise.resolve(null),
      ]);
      if(!alive)return;
      if(results[0].status==="fulfilled"){setLive(results[0].value);setGpuError("");}else{setLive([]);setGpuError(String(results[0].reason?.message||results[0].reason));}
      setSys(results[1].status==="fulfilled"?results[1].value:null);
      timer=setTimeout(poll,cfg.monitoring.poll_interval_ms);
    };
    poll();return()=>{alive=false;clearTimeout(timer);};
  },[cfg?.monitoring.backend,cfg?.monitoring.helper,cfg?.monitoring.nvidia_smi,cfg?.monitoring.poll_interval_ms]);
  const showError=e=>setNotice({kind:"err",msg:String(e?.message||e)});
  const settings=()=>Backend.openSettings().catch(showError);
  if(!snapshot)return <div className="loading-state">{error||"Loading isolated development configuration…"}</div>;
  const models=cfg.models.map(NexusConfig.modelView),activeModel=models.find(m=>m.id===active?.id);
  const states=Object.fromEntries(models.map(m=>[m.id,m.id===active?.id?active.phase:"stopped"]));
  const resolveSplit=(id,context)=>cfg.models.find(m=>m.id===id)?.contexts.find(c=>c.id===context)?.tensor_split||"";
  const start=async id=>{
    setRequest(true);try{
      const m=cfg.models.find(m=>m.id===id),ctx=ctxByModel[id]||m.default_context;
      const result=await Backend.startModel(id,ctx,resolveSplit(id,ctx));if(result.warning)setNotice({kind:"err",msg:result.warning});
    }catch(e){showError(e);}finally{setRequest(false);}
  };
  const stop=()=>Backend.stopModel().catch(showError);
  const service=async(id,startIt)=>{
    setServicePending(p=>({...p,[id]:startIt?"starting":"stopping"}));
    try{await(startIt?Backend.serviceStart(id):Backend.serviceStop(id));}catch(e){showError(e);}
    finally{setServicePending(p=>({...p,[id]:null}));}
  };
  const setTile=async value=>{try{if(Backend.isTauri)await Backend.winCompact(value);setCompact(value);}catch(e){showError(e);}};
  const validVram=live.length&&live.every(g=>g.vram!=null&&g.vramTotal>0);
  const used=validVram?live.reduce((sum,g)=>sum+g.vram,0):null,total=validVram?live.reduce((sum,g)=>sum+g.vramTotal,0):null;
  const pct=total?used/total*100:null;
  const drag=Backend.isTauri?{"data-tauri-drag-region":true}:{};
  return <ThemeShell appearance={a} win={compact?"tile":"open"}>
    {compact?<MinTile active={active} sys={sys} vramPct={pct} vramGB={used==null?null:(used/1024).toFixed(1)} onRestore={()=>setTile(false)} onSettings={settings} onClose={()=>Backend.winClose().catch(showError)}/>:
      <div className="win">
        {a.motion==="live"&&<CommandCenterFX accent={a.accent_color} runningId={active?.phase==="running"?active.id:null} splitFrac={null} gpuAct={live.map(g=>(g.util||0)/100)}/>}
        <div className="titlebar" {...drag}>
          <LogoTile/><span className="tb-title" {...drag}>AI <b {...drag}>NEXUS</b></span><span className="tb-sep"/><span className="tb-meta" {...drag}>development</span><span className="tb-spacer" {...drag}/>
          <div className="vram-pill"><b>VRAM</b><span>{used==null?"--":(used/1024).toFixed(1)+"/"+(total/1024).toFixed(1)+"G"}</span></div>
          <button className="gear-btn" title="Settings" onClick={settings}><Gear/></button>
          <div className="tb-ctrls"><button className="tb-dot mini" title="Minimize" aria-label="Minimize" onClick={()=>Backend.winMinimize().catch(showError)}/><button className="tb-dot widget" title="Compact HUD" aria-label="Compact HUD" onClick={()=>setTile(true)}/><button className="tb-dot close" title="Close AI Nexus" aria-label="Close AI Nexus" onClick={()=>Backend.winClose().catch(showError)}/></div>
        </div>
        {snapshot.status!=="ready"&&<div className="config-banner" role="status">{snapshot.error}<button className="btn" onClick={settings}>SETTINGS</button></div>}
        <div className="body">
          <GpuPanel liveGpus={live} form={a.form} onSettings={settings} motion={a.motion} accent={a.accent_color} error={gpuError} backend={cfg.monitoring.backend} pollMs={cfg.monitoring.poll_interval_ms}/>
          <ModelsPanel models={models} port={cfg.runtime.port} states={states} ctxByModel={ctxByModel} activeId={active?.id} busy={request||active?.phase==="starting"||!Backend.isTauri} form={a.form} motion={a.motion} resolveSplit={resolveSplit} onStart={start} onStop={stop} onCtx={(id,ctx)=>setContexts(c=>({...c,[id]:ctx}))} onSettings={settings}/>
          <ServicesPanel configuration={cfg.services} statuses={runtime.services} pending={servicePending} form={a.form} onStart={id=>service(id,true)} onStop={id=>service(id,false)} onSettings={settings}/>
        </div>
        <div className="statusbar">
          <span className="seg"><span className="live-dot"/>{live.length?"GPU monitoring live":"GPU unavailable"}</span><span className="ln"/>
          <SystemReadouts sample={sys}/><span className="ln"/>
          <span className="seg server-status">{activeModel?activeModel.name+" · "+(activeModel.contextLabels[active.context]||active.context)+" · "+active.phase:"llama-server idle"} · :{cfg.runtime.port}</span><span className="spacer"/>
          <span className="seg session-close-note">{runtime.error||"Closing stops this session."}</span>
        </div>
      </div>}
    {notice&&<div className={"notice notice--"+notice.kind} role="status" onClick={()=>setNotice(null)}><span className="notice-ic">!</span><span className="notice-msg">{notice.msg}</span><span className="notice-x">×</span></div>}
  </ThemeShell>;
}
ReactDOM.createRoot(document.getElementById("root")).render(new URLSearchParams(location.search).get("window")==="settings"?<SettingsWindow/>:<App/>);

