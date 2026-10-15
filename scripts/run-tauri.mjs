// Run the existing installed Tauri CLI against this project without installing packages.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const toolRequire=createRequire(process.env.AI_NEXUS_BUILD_TOOLS
  ? join(resolve(process.env.AI_NEXUS_BUILD_TOOLS),"package.json") : import.meta.url);
const metadataPath=toolRequire.resolve("@tauri-apps/cli/package.json");
const metadata=JSON.parse(readFileSync(metadataPath,"utf8"));
const cli=join(dirname(metadataPath),typeof metadata.bin==="string"?metadata.bin:metadata.bin.tauri);
const child=spawn(process.execPath,[cli,...process.argv.slice(2)],{
  cwd:root,stdio:"inherit",
  env:{...process.env,CARGO_TARGET_DIR:join(root,".build","desktop"),CARGO_NET_OFFLINE:"true"},
});
child.on("error",e=>{console.error("Existing Tauri tool could not start: "+e.message);process.exitCode=1;});
child.on("exit",code=>{process.exitCode=code??1;});

