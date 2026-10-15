/* GPU interface retained; absent or stale samples never become measurements. */
function Gear({size=16}) {
  return <svg width={size} height={size} viewBox="-12 -12 24 24" aria-hidden="true" className="gear-svg">
    {[0,1,2,3,4,5,6,7].map(i=><rect key={i} x="-2.3" y="-11.6" width="4.6" height="5.4" rx="1.5" transform={"rotate("+i*45+")"} fill="currentColor"/>)}
    <circle r="7.7" fill="currentColor"/><circle r="3.4" fill="var(--surface-2)"/>
  </svg>;
}
function HeatDot({temp}) {return <span className="heat" style={{background:Number.isFinite(temp)?tempColorRaw(temp):"var(--text-faint)"}}/>;}
function GpuCard({live,asGB,onToggleUnit,motion,accent,compact}) {
  const pct=live.vramTotal>0&&live.vram!=null?Math.min(100,live.vram/live.vramTotal*100):null;
  const metric=(v,suffix)=>v==null?"--":Math.round(v)+suffix;
  const vram=v=>v==null?"--":fmtVRAM(v,asGB);
  if(compact)return <div className="gpu-row">
    <span className="gpu-idx">GPU{live.idx}</span><div className="gpu-row-id"><span className="gpu-name">{live.name}</span></div>
    <div className="gpu-row-temp"><HeatDot temp={live.temp}/><span>{metric(live.temp,"°C")}</span></div>
    <div className="gpu-row-meters"><span>{metric(live.pwr,"W")} · {vram(live.vram)} / {vram(live.vramTotal)}</span></div>
  </div>;
  return <div className="gpu-card">
    <div className="topline"><span className="gpu-idx">GPU{live.idx}</span><div className="gpu-id">
      <span className="gpu-name">{live.name}</span><span className="gpu-sub">{vram(live.vramTotal)} total VRAM</span>
    </div></div>
    <div className="gpu-graph"><GpuSparkline value={live.util} sampleAt={live.sampleAt} accent={accent} live={motion==="live"}/>
      <span className="gpu-graph-k">GPU LOAD · ACTUAL SAMPLES</span><span className="gpu-graph-v">{metric(live.util,"%")}</span></div>
    <div className="gpu-stats">
      <span className="stat-k">Temp</span><div className="stat-line"><HeatDot temp={live.temp}/><span className="stat-temp">{metric(live.temp,"°C")}</span><small>Hotspot {metric(live.hotspot,"°C")}</small></div>
      <span className="stat-k">Power</span><div className="stat-line"><span className="num">{metric(live.pwr," W")}</span></div>
      <span className="stat-k">VRAM</span><div><div className="stat-line"><span className="num vram-num" onClick={onToggleUnit} title="Switch MB / GB">{vram(live.vram)} / {vram(live.vramTotal)}</span><small>{pct==null?"--":Math.round(pct)+"%"}</small></div><div className="meter"><i className={"vram-fill"+(pct>88?" warn":"")} style={{width:(pct||0)+"%"}}/></div></div>
    </div>
  </div>;
}
function GpuPanel({liveGpus,form,onSettings,motion,accent,error,backend,pollMs}) {
  const [asGB,setAsGB]=React.useState(true);
  return <section className="gpu-zone">
    <div className="sec-h"><span className="t">GPU Status</span><span className="line"/><span className="count">{liveGpus.length?backend+" · "+pollMs/1000+"s poll":"unavailable"}</span></div>
    <div className="gpu-grid">{liveGpus.length?liveGpus.map(g=><GpuCard key={g.idx+g.name} live={g} asGB={asGB} onToggleUnit={()=>setAsGB(v=>!v)} compact={form==="bar"} motion={motion} accent={accent}/>):
      <div className="gpu-card gpu-unavailable"><span className="gpu-name">GPU monitoring unavailable</span><p>{error||"No monitoring helper is supplied with this development copy."}</p><span className="gpu-sub">No measurements are being displayed.</span></div>}
    </div>
  </section>;
}

