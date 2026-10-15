const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const C=require("../src/launcher/config-ui.js");
const example=JSON.parse(fs.readFileSync(path.join(__dirname,"../config/launcher.config.example.json"),"utf8"));
function configured(){const c=structuredClone(example),m=C.newModel([]);m.name="Fixture";m.file="X:\\fixture\\model.gguf";c.models=[m];return c;}
test("safe example has empty roster, no runtime/helper, all integrations off",()=>{
 assert.equal(example.models.length,0);assert.equal(example.runtime.binary,"");assert.equal(example.monitoring.helper,"");assert.equal(example.monitoring.backend,"unavailable");assert.equal(example.opencode.enabled,false);
 assert.ok(Object.values(example.services).every(s=>!s.enabled));assert.equal(example.runtime.host,"127.0.0.1");
});
test("model cards and context choices are derived from the configuration",()=>{
 const c=configured();c.models[0].contexts.push({id:"16K",ctx_size:16384,tensor_split:"40,60"});
 const view=C.modelView(c.models[0]);assert.deepEqual(view.ctxModes,["8K","16K"]);assert.equal(view.splits["16K"],"40,60");assert.equal(view.name,c.models[0].name);
});
test("entry removal leaves input untouched and removes only the mapping",()=>{
 const c=configured();c.opencode.model_ids[c.models[0].id]="fixture-target";const before=structuredClone(c);
 const next=C.removeModel(c,c.models[0].id,null);assert.equal(next.models.length,0);assert.deepEqual(next.opencode.model_ids,{});assert.deepEqual(c,before);
 // Native production Store tests additionally verify that the file bytes survive removal.
});
test("active removal refuses before changing configuration",()=>{
 const c=configured();assert.throws(()=>C.removeModel(c,c.models[0].id,c.models[0].id),/Stop the active/);assert.equal(c.models.length,1);
});
test("duplicate IDs and invalid splits fail before persistence",()=>{
 const c=configured();c.models.push(structuredClone(c.models[0]));assert.throws(()=>C.validateDraft(c),/unique/);
 for(const split of ["NaN,1","1,Infinity","-1,1","0,0","1,","x,1","1"])assert.equal(C.splitValid(split,2),false,split);
 assert.equal(C.splitValid("25,75",2),true);assert.equal(C.splitValid("",0),true);
});
test("unknown telemetry remains unknown and histories never invent readings",()=>{
 assert.equal(C.cleanMetric(null),null);assert.equal(C.cleanMetric(NaN),null);assert.equal(C.cleanMetric(-1),null);assert.equal(C.cleanMetric(0),0);
 assert.deepEqual(C.sampleHistory([],null,1,null),[]);assert.deepEqual(C.sampleHistory([10],10,1,1),[10]);assert.deepEqual(C.sampleHistory([10],20,2,1),[10,20]);
});
test("browser preview is read-only and reports no fake running processes",async()=>{
 const window={NEXUS_EXAMPLE:example,open:()=>{}},ctx={window,structuredClone,document:{documentElement:{setAttribute(){}}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../src/launcher/bridge.jsx"),"utf8"),ctx);
 const B=window.Backend;assert.equal(B.isTauri,false);assert.equal((await B.getConfig()).status,"preview");assert.equal((await B.runtimeStatus()).active,null);
 await assert.rejects(B.saveConfig(example,0),/preview cannot run or save/);await assert.rejects(B.startModel("fixture","8K",""),/preview cannot run or save/);
});
test("Settings close invokes only the native current-window close command (mock IPC)",async()=>{
 const calls=[],window={__TAURI__:{core:{invoke:async(command,args)=>{calls.push({command,args});}},event:{listen:async()=>()=>{}}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../src/launcher/bridge.jsx"),"utf8"),{window,document:{documentElement:{setAttribute(){}}}});
 await window.Backend.winClose();assert.deepEqual(calls.map(c=>c.command),["win_close"]);
});
test("save uses the revision captured by its window and propagates failures (mock IPC)",async()=>{
 const calls=[],window={__TAURI__:{core:{invoke:async(command,args)=>{calls.push({command,args});throw new Error("write failure");}},event:{listen:async()=>()=>{}}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../src/launcher/bridge.jsx"),"utf8"),{window,document:{documentElement:{setAttribute(){}}}});
 await assert.rejects(window.Backend.saveConfig(example,7),/write failure/);assert.equal(calls[0].args.expectedRevision,7);
});


test("flag editor preserves separate tokens, negative values and rejects managed or duplicate flags",()=>{
 const tokens=C.appendFlag(["--threads","4"],"--flash-attn","on");
 assert.deepEqual(tokens,["--threads","4","--flash-attn","on"]);
 assert.deepEqual(C.flagRows(["--n-gpu-layers","-1","--jinja"]).map(r=>r.tokens),[["--n-gpu-layers","-1"],["--jinja"]]);
 assert.throws(()=>C.appendFlag([],"--port","9999"),/fields/);
 assert.throws(()=>C.appendFlag(tokens,"--threads","6"),/already/);
 assert.throws(()=>C.appendFlag([],"--threads 4"),/flag name/);
 assert.deepEqual(C.appendFlag([],"--chat-template-file","X:\\path with spaces\\template.jinja"),["--chat-template-file","X:\\path with spaces\\template.jinja"]);
});
test("appearance rebasing detects unrelated changes and does not mistake drafts for saved configuration",()=>{
 const saved=structuredClone(example),next=structuredClone(saved);next.appearance.motion="static";
 assert(C.sameExceptAppearance(saved,next));next.runtime.port=12345;assert(!C.sameExceptAppearance(saved,next));
});
test("help command quotes the user's executable without running it",()=>{
 assert.equal(C.helpCommand("X:\\it's mine\\llama-server.exe"),"& 'X:\\it''s mine\\llama-server.exe' --help");
});
test("rapid preference changes preview immediately and debounce to one latest save",async()=>{
 const previews=[],saves=[],statuses=[];
 const q=C.createAppearanceQueue({delay:10000,preview:a=>previews.push(a),save:async a=>{saves.push(a);return a;},onState:s=>statuses.push(s)});
 q.update("orange");q.update("violet");assert.deepEqual(previews,["orange","violet"]);assert.deepEqual(saves,[]);
 await q.flush();assert.deepEqual(saves,["violet"]);assert.equal(statuses.at(-1),"saved");q.dispose();
});
test("preference saves are serialized and flush includes a newer in-flight change",async()=>{
 let resolveFirst;const saves=[];
 const q=C.createAppearanceQueue({delay:10000,save:a=>{saves.push(a);return saves.length===1?new Promise(r=>resolveFirst=r):Promise.resolve(a);}});
 q.update("first");const first=q.flush();await Promise.resolve();q.update("newest");const second=q.flush();
 assert.deepEqual(saves,["first"]);resolveFirst("first");await Promise.all([first,second]);assert.deepEqual(saves,["first","newest"]);q.dispose();
});
test("preference persistence failures stay visible and can be retried",async()=>{
 let fail=true;const statuses=[];
 const q=C.createAppearanceQueue({delay:10000,save:async()=>{if(fail)throw Error("disk failed");return {};},onState:(s,e)=>statuses.push([s,e])});
 q.update("orange");await assert.rejects(q.flush(),/disk failed/);assert.equal(statuses.at(-1)[0],"error");
 fail=false;await q.flush();assert.equal(statuses.at(-1)[0],"saved");q.dispose();
});

test("named context creation keeps unique stable IDs and derives readable card labels",()=>{
 const m=configured().models[0],a=C.newContextProfile(m.contexts,16384,"Daily chat"),b=C.newContextProfile([...m.contexts,a],32768,"Daily chat");
 assert.equal(a.id,"Daily-chat");assert.equal(b.id,"Daily-chat-2");assert.equal(a.name,"Daily chat");assert.equal(a.tensor_split,"");assert.equal(a.cache_type_k,null);
 m.contexts.push(a);m.default_context=a.id;const stable=a.id;a.name="Work notes";
 const view=C.modelView(m);assert.equal(view.contextLabels[stable],"Work notes");assert.equal(view.defaultCtx,stable);assert.equal(view.contextLabels['8K'],'8K');
 assert.equal(C.formatTokens(16384),'16,384');assert.equal(C.contextSizeLabel(16384),'16K');
});
test("context creation rejects invalid sizes and removing a default selects a remaining profile",()=>{
 for(const n of [0,-1,1.5,NaN,Infinity,4294967296])assert.throws(()=>C.newContextProfile([],n),/whole-number/);
 const m=configured().models[0];assert.throws(()=>C.removeContextProfile(m,'8K'),/at least one/);
 const c=C.newContextProfile(m.contexts,12288,'Custom chat');m.contexts.push(c);m.default_context=c.id;
 const next=C.removeContextProfile(m,c.id);assert.equal(next.default_context,'8K');assert.equal(next.contexts.length,1);assert.equal(m.contexts.length,2);assert.equal(next.file,m.file);
 const cfg=configured();cfg.models[0].contexts[0].output_limit=10000;assert.throws(()=>C.validateDraft(cfg),/reply limit/);
});
test("CPU and RAM readouts preserve real zero and clear impossible or missing readings",()=>{
 assert.deepEqual(C.systemView({cpu:0,ram:16,ramTotal:64}),{cpu:0,ram:16,ramTotal:64,ramPct:25});
 assert.equal(C.systemView({cpu:120,ram:65,ramTotal:64}).cpu,null);assert.equal(C.systemView({cpu:40,ram:65,ramTotal:64}).ramPct,null);
 assert.deepEqual(C.systemView(null),{cpu:null,ram:null,ramTotal:null,ramPct:null});assert.equal(C.systemView({cpu:12,ram:0,ramTotal:64}).ramPct,0);
});

