/* AI LAUNCHER — Live-mode command-center FX
   Canvas layers (neural mesh + data-path conduits) and the GPU throughput sparkline.
   Everything here only mounts when Motion = Live, so Static stays calm and cheap. */

const { useRef: fxUseRef, useEffect: fxUseEffect } = React;

function _rgb(hex) {
  const c = hexToRgb(hex || "#E87D2F");
  return [c.r, c.g, c.b];
}
// cubic bezier point
function _bez(p, a, c1, c2, b) {
  const u = 1 - p, uu = u * u, uuu = uu * u, pp = p * p, ppp = pp * p;
  return {
    x: uuu * a.x + 3 * uu * p * c1.x + 3 * u * pp * c2.x + ppp * b.x,
    y: uuu * a.y + 3 * uu * p * c1.y + 3 * u * pp * c2.y + ppp * b.y,
  };
}

/* ── full-window canvas overlay: ambient neural mesh + active data conduits ── */
function CommandCenterFX({ accent, runningId, splitFrac, gpuAct }) {
  const bgRef = fxUseRef(null);
  const fgRef = fxUseRef(null);
  const S = fxUseRef({ nodes: [], w: 0, h: 0 }).current;
  const props = fxUseRef({});
  props.current = { accent, runningId, splitFrac, gpuAct };

  fxUseEffect(() => {
    const bg = bgRef.current, fg = fgRef.current;
    if (!bg || !fg) return;
    const bx = bg.getContext("2d"), fx = fg.getContext("2d");
    const host = bg.parentNode;
    let raf;

    function resize() {
      const r = host.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      S.w = r.width; S.h = r.height;
      for (const c of [bg, fg]) {
        c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
        c.style.width = r.width + "px"; c.style.height = r.height + "px";
        c.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      const N = Math.max(18, Math.min(50, Math.round((r.width * r.height) / 24000)));
      S.nodes = Array.from({ length: N }, () => ({
        x: Math.random() * r.width, y: Math.random() * r.height,
        vx: (Math.random() - 0.5) * 0.13, vy: (Math.random() - 0.5) * 0.13,
        r: 0.8 + Math.random() * 1.5, ph: Math.random() * 6.28,
      }));
    }
    resize();
    const ro = new ResizeObserver(resize); ro.observe(host);

    function frame(ts) {
      const P = props.current;
      const [R, G, B] = _rgb(P.accent);
      const rgb = R + "," + G + "," + B;
      const act = P.gpuAct && P.gpuAct.length ? Math.min(1, P.gpuAct.reduce((a,b)=>a+b,0) / P.gpuAct.length + 0.04) : 0.05;

      /* neural mesh (behind UI, shows in negative space) */
      bx.clearRect(0, 0, S.w, S.h);
      const nodes = S.nodes, speed = 0.35 + act * 1.25;
      for (const n of nodes) {
        n.x += n.vx * speed; n.y += n.vy * speed;
        if (n.x < -12) n.x = S.w + 12; else if (n.x > S.w + 12) n.x = -12;
        if (n.y < -12) n.y = S.h + 12; else if (n.y > S.h + 12) n.y = -12;
      }
      const D = 128, lineBase = 0.045 + act * 0.11;
      bx.lineWidth = 1;
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j], dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
          if (d2 < D * D) {
            const al = (1 - Math.sqrt(d2) / D) * lineBase;
            bx.strokeStyle = "rgba(" + rgb + "," + al + ")";
            bx.beginPath(); bx.moveTo(a.x, a.y); bx.lineTo(b.x, b.y); bx.stroke();
          }
        }
      }
      for (const n of nodes) {
        const tw = 0.6 + 0.4 * Math.sin(ts * 0.0013 + n.ph);
        bx.fillStyle = "rgba(" + rgb + "," + (0.16 + act * 0.2) * tw + ")";
        bx.beginPath(); bx.arc(n.x, n.y, n.r, 0, 6.2832); bx.fill();
      }

      /* active data conduits (above UI, screen-blended glow) */
      fx.clearRect(0, 0, S.w, S.h);
      if (P.runningId) {
        const cb = fg.getBoundingClientRect();
        const card = document.querySelector(".mcard.running");
        const gpus = [...document.querySelectorAll(".gpu-card, .gpu-row")];
        if (card && gpus.length) {
          const cr = card.getBoundingClientRect();
          const src = { x: cr.left - cb.left + Math.min(140, cr.width * 0.22), y: cr.top - cb.top + 2 };
          gpus.forEach((gp, gi) => {
            const frac = P.splitFrac ? (P.splitFrac[gi] ?? 0.5) : 0.5;
            if (frac <= 0.02) return;
            const gr = gp.getBoundingClientRect();
            const dst = { x: gr.left - cb.left + gr.width * 0.5, y: gr.top - cb.top + gr.height - 4 };
            const midY = (src.y + dst.y) / 2;
            const c1 = { x: src.x, y: midY }, c2 = { x: dst.x, y: midY };
            // conduit line
            fx.strokeStyle = "rgba(" + rgb + "," + (0.13 + frac * 0.14) + ")";
            fx.lineWidth = 1.5;
            fx.beginPath(); fx.moveTo(src.x, src.y);
            fx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, dst.x, dst.y); fx.stroke();
            // flowing packets (model → GPU = dispatch)
            const K = Math.round(4 + frac * 9), sp = 0.0002;
            for (let k = 0; k < K; k++) {
              const p = ((ts * sp) + k / K + gi * 0.17) % 1;
              const pt = _bez(p, src, c1, c2, dst);
              const fade = Math.sin(Math.PI * p);
              const rad = 1.4 + 2.1 * fade;
              fx.fillStyle = "rgba(" + rgb + "," + (0.7 + 0.3 * frac) * fade + ")";
              fx.beginPath(); fx.arc(pt.x, pt.y, rad, 0, 6.2832); fx.fill();
              // hot core
              fx.fillStyle = "rgba(255,255,255," + (0.5 * fade * fade) + ")";
              fx.beginPath(); fx.arc(pt.x, pt.y, Math.max(0.6, rad * 0.42), 0, 6.2832); fx.fill();
            }
            // GPU intake pulse
            const pulse = Math.sin(ts * 0.005 + gi * 1.7) * 0.5 + 0.5;
            const grd = fx.createRadialGradient(dst.x, dst.y, 0, dst.x, dst.y, 9 + 6 * pulse);
            grd.addColorStop(0, "rgba(" + rgb + "," + (0.22 + 0.22 * pulse) * frac + ")");
            grd.addColorStop(1, "rgba(" + rgb + ",0)");
            fx.fillStyle = grd;
            fx.beginPath(); fx.arc(dst.x, dst.y, 9 + 6 * pulse, 0, 6.2832); fx.fill();
          });
        }
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return (
    <>
      <canvas className="fx-bg" ref={bgRef} aria-hidden="true" />
      <canvas className="fx-fg" ref={fgRef} aria-hidden="true" />
    </>
  );
}

/* Utilization history advances only when a real sample arrives. */
function GpuSparkline({value,sampleAt,accent,live}) {
  const ref=fxUseRef(null),data=fxUseRef([]),last=fxUseRef(null);
  fxUseEffect(()=>{
    data.current=NexusConfig.sampleHistory(data.current,value,sampleAt,last.current);
    last.current=sampleAt;
    const cv=ref.current;if(!cv)return;
    const cx=cv.getContext("2d"),r=cv.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2);
    const W=Math.round(r.width*dpr),H=Math.round(r.height*dpr);
    cv.width=W;cv.height=H;cx.clearRect(0,0,W,H);
    const d=data.current;if(!d.length)return;
    const [rr,g,b]=_rgb(accent),x=i=>W*(i+64-d.length)/63,y=v=>H-(v/100)*H*.86-H*.07;
    cx.beginPath();d.forEach((v,i)=>i?cx.lineTo(x(i),y(v)):cx.moveTo(x(i),y(v)));
    cx.strokeStyle="rgba("+rr+","+g+","+b+",.92)";cx.lineWidth=1.4*dpr;cx.lineJoin="round";cx.stroke();
    cx.fillStyle=accent;cx.beginPath();cx.arc(Math.min(W-2*dpr,x(d.length-1)),y(d.at(-1)),2*dpr,0,Math.PI*2);cx.fill();
  },[value,sampleAt,accent,live]);
  return <canvas className="gpu-spark" ref={ref} aria-hidden="true"/>;
}
Object.assign(window,{CommandCenterFX,GpuSparkline});

