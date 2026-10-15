/* Optional controls use the same configuration as the backend. */
const SERVICE_LABELS={open_web_ui:"Open WebUI",tts:"Text to speech",stt:"Speech to text"};
function ServicesPanel({configuration,statuses,form,onStart,onStop,onSettings,pending}) {
  return <section className="services-zone">
    <div className="sec-h"><span className="t">Services</span><span className="line"/><span className="count">optional</span></div>
    <div className="services-list">
      {Object.entries(configuration).map(([id,s])=>{
        const status=statuses[id]||"stopped",busy=pending[id];
        const owned=status==="ready"||status==="not-ready";
        return <div className="svc" key={id}>
          <div className="svc-h"><b>{SERVICE_LABELS[id]}</b><span className="port">:{s.port}</span></div>
          <div className="svc-stat"><span className={"status-dot "+(status==="ready"?"up":"down")}/>{busy||status}</div>
          <div className="svc-acts">{!s.enabled?<button className="btn" onClick={onSettings}>CONFIGURE</button>:
            <button className={"btn "+(owned?"stop":"go")} disabled={!!busy||!Backend.isTauri} onClick={()=>owned?onStop(id):onStart(id)}>{owned?"STOP":"START"}</button>}</div>
        </div>;
      })}
    </div>
  </section>;
}

