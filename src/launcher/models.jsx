/* AI LAUNCHER — model roster + cards */

function CtxToggle({ model, ctx, onChange, disabled }) {
  if (model.fixedCtx) {
    return (
      <div className="ctxseg fixed" title="fixed long-context (vision FT model)">
        <span>{model.fixedCtx}</span>
      </div>
    );
  }
  return (
    <div className="ctxseg" title="Choose a context profile">
      {model.ctxModes.map(m => (
        <button key={m} className={ctx === m ? "on" : ""}
          title={(model.contextLabels?.[m]||m)+" · "+NexusConfig.formatTokens(model.contexts.find(c=>c.id===m)?.ctx_size)+" tokens"} disabled={disabled}
          onClick={() => !disabled && onChange(m)}>{model.contextLabels?.[m]||m}</button>
      ))}
    </div>
  );
}

function ModelCard({ model, port, state, ctx, split, busy, form, motion, bloom, nodeRef, onStart, onStop, onCtx }) {
  const running = state === "running" || state === "unhealthy" || state === "unknown";
  const starting = state === "starting";
  const stopping = state === "stopping";

  return (
    <div ref={nodeRef} className={"mcard" + (running ? " running" : "") + (starting ? " starting" : "")
      + (stopping ? " stopping" : "") + (bloom ? " online" : "")}>
      <span className="mcard-glow" aria-hidden="true" />
      {bloom && motion === "live" && <span className="ignite-ring" />}
      <div className="main">
        <div className="mtitle">
          <span className="mname">{model.name}</span>
          <span className="badge tier">{model.tier}</span>
          {model.vision && <span className="badge vision">VISION</span>}
          {model.primary && <span className="badge primary">PRIMARY</span>}
        </div>
        <div className="mmeta">
          <span><b>{model.quant}</b></span>
          <span className="dot" />
          <span>{Number.isFinite(model.vramGB) ? model.vramGB.toFixed(1) + " GiB weights" : "weight size unset"}</span>
          <span className="dot" />
          <span>{model.desc}</span>
          {running && form !== "bar" && (
            <>
              <span className="dot" />
              <span style={{ color: "var(--accent)" }}>:{port} · split {split || "backend default"}</span>
            </>
          )}
        </div>
      </div>

      <div className="mright">
        {running ? (
          <span className="runbadge"><span className="pulse" />{state === "unhealthy" ? "Not ready" : state === "unknown" ? "Status unknown" : "Running"}</span>
        ) : (
          <CtxToggle model={model} ctx={ctx} onChange={onCtx} disabled={busy} />
        )}

        {running ? (
          <button className="btn stop" onClick={onStop}>STOP</button>
        ) : starting ? (
          <button className="btn stop" onClick={onStop}><span className="spin" />CANCEL</button>
        ) : stopping ? (
          <button className="btn stop" disabled>STOPPING</button>
        ) : (
          <button className="btn go" disabled={busy} onClick={onStart}>START</button>
        )}
      </div>
    </div>
  );
}

function ModelsPanel({ models, port, states, ctxByModel, activeId, busy, form, motion, bloomId, resolveSplit, onStart, onStop, onCtx, onSettings }) {
  const runningCount = Object.values(states).filter(s => s === "running").length;
  const rs = resolveSplit || ((id, mode) => "");

  // active (actually running) model floats to the top; others keep their order.
  const ordered = React.useMemo(() =>
    models.map((m, i) => ({ m, i }))
      .sort((a, b) => {
        const ar = states[a.m.id] === "running" ? 0 : 1;
        const br = states[b.m.id] === "running" ? 0 : 1;
        return ar - br || a.i - b.i;
      })
      .map(x => x.m),
    [states, models]);
  const orderKey = ordered.map(m => m.id).join(",");

  // FLIP: slide cards from their previous position to the new one (no library).
  const cardRefs = React.useRef({});
  const prevRects = React.useRef({});
  React.useLayoutEffect(() => {
    const refs = cardRefs.current;
    Object.keys(refs).forEach((id) => {
      const el = refs[id];
      if (!el) return;
      el.style.transition = "none";
      el.style.transform = "";
      const r = el.getBoundingClientRect();
      const prev = prevRects.current[id];
      if (motion === "live" && prev && (Math.abs(prev.top - r.top) > 0.5 || Math.abs(prev.left - r.left) > 0.5)) {
        el.style.transform = `translate(${prev.left - r.left}px, ${prev.top - r.top}px)`;
        el.getBoundingClientRect();                       // force reflow
        el.style.transition = "transform 380ms cubic-bezier(.4,0,.2,1)";
        el.style.transform = "";
      }
      prevRects.current[id] = r;
    });
  }, [orderKey, motion]);

  return (
    <section className="models-zone" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      {form !== "bar" && (
        <div className="sec-h">
          <span className="t">Models</span>
          <span className="line" />
          <span className="count">{runningCount ? "1 active · hot-swap" : "idle"} · :{port}</span>
        </div>
      )}
      <div className={"models-list scroll"}>
        {!ordered.length && <div className="empty-state"><b>Your model roster starts here</b><p>Add your llama.cpp executable and model files in Settings.</p><button className="btn go" onClick={onSettings}>OPEN SETTINGS</button></div>}
        {ordered.map(m => {
          const ctx = ctxByModel[m.id] || m.defaultCtx;
          return (
          <ModelCard key={m.id} model={m} port={port}
            nodeRef={(el) => { if (el) cardRefs.current[m.id] = el; else delete cardRefs.current[m.id]; }}
            state={states[m.id] || "stopped"}
            ctx={ctx}
            split={rs(m.id, ctx)}
            busy={busy}
            form={form}
            motion={motion}
            bloom={bloomId === m.id}
            onStart={() => onStart(m.id)}
            onStop={() => onStop(m.id)}
            onCtx={(c) => onCtx(m.id, c)} />
        );})}
      </div>
    </section>
  );
}

window.ModelsPanel = ModelsPanel;
