/* Native IPC. Browser preview is visibly read-only and never simulates running services. */
(function(){
  const T=window.__TAURI__;
  const isTauri=!!T?.core?.invoke;
  const invoke=isTauri?T.core.invoke.bind(T.core):async()=>{throw new Error("This browser preview cannot run or save configuration. Use the native development app.");};
  window.Backend={
    isTauri,invoke,
    getConfig:()=>isTauri?invoke("get_config"):Promise.resolve({configuration:structuredClone(window.NEXUS_EXAMPLE),revision:0,status:"preview",error:"Read-only browser preview. Runtime controls and persistence require the native app.",config_path:"",previous_available:false}),
    saveConfig:(configuration,expectedRevision)=>invoke("save_config",{configuration,expectedRevision}),
    saveAppearance:appearance=>invoke("save_appearance",{appearance}),
    browseFile:(kind,currentPath)=>invoke("browse_file",{kind,currentPath:currentPath||""}),
    previewAppearance:appearance=>isTauri?T.event.emit("appearance-preview",appearance):Promise.resolve(),
    onAppearancePreview:async(fn)=>isTauri?T.event.listen("appearance-preview",e=>fn(e.payload)):()=>{},
    onAppearanceSaved:async(fn)=>isTauri?T.event.listen("appearance-saved",e=>fn(e.payload)):()=>{},
    onWindowClose:async(fn)=>isTauri?T.window.getCurrentWindow().onCloseRequested(fn):()=>{},
    openFlagReference:()=>isTauri?invoke("open_flag_reference"):Promise.resolve(window.open("https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md#usage","_blank","noopener")),
    recoverConfig:()=>invoke("recover_config"),
    onConfig:async(fn)=>isTauri?T.event.listen("config-changed",e=>fn(e.payload)):()=>{},
    onRuntime:async(fn)=>isTauri?T.event.listen("runtime-changed",fn):()=>{},
    pollGpus:async()=> (await invoke("gpu_poll")).map(r=>NexusConfig.gpuView(r,Date.now())),
    systemStats:async()=>{const s=await invoke("system_stats");return{cpu:s.cpuPct,ram:s.ramUsedGB,ramTotal:s.ramTotalGB};},
    runtimeStatus:()=>isTauri?invoke("runtime_status"):Promise.resolve({active:null,services:{open_web_ui:"disabled",tts:"disabled",stt:"disabled"}}),
    startModel:(modelId,ctxMode,tensorSplit)=>invoke("start_model",{modelId,ctxMode,tensorSplit:tensorSplit||null}),
    stopModel:()=>invoke("stop_model"),
    serviceStart:serviceId=>invoke("service_start",{serviceId}),
    serviceStop:serviceId=>invoke("service_stop",{serviceId}),
    openSettings:()=>isTauri?invoke("open_settings"):Promise.resolve(window.open("index.html?window=settings","ai-nexus-settings","width=900,height=760")),
    winClose:()=>isTauri?invoke("win_close"):Promise.resolve(window.close()),
    winMinimize:()=>invoke("win_minimize"),
    winCompact:on=>invoke("win_compact",{on}),
  };
  if(isTauri)document.documentElement.setAttribute("data-shell","native");
})();

