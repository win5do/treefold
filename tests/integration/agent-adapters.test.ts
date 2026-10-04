import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

test("TUI extension reports only the viewed root and disposes its observer", async () => {
  const root = await mkdtemp("/tmp/treefold-tui-extension-");
  const before = process.env.TREEFOLD_AGENT_HOOK;
  let dispose = () => {};
  try {
    const receipt = path.join(root, 'receipt');
    const callback = path.join(root, 'callback');
    await writeFile(callback, `#!/bin/sh\ncat > '${receipt}'\n`, {mode:0o700});
    process.env.TREEFOLD_AGENT_HOOK = callback;
    const extension = (await import(pathToFileURL(path.resolve('src/backend/src/agents/extensions/opencode.mjs')).href)).default;
    const route = {current:{type:'home',sessionID:''}};
    dispose = extension.setup({ui:{router:{current:()=>route.current}},data:{session:{get:(id:string)=>({id}),root:(id:string)=>id==='child'?'root':id}}});
    route.current = {type:'session',sessionID:'child'};
    await new Promise(resolve => setTimeout(resolve, 350));
    await expect(readFile(receipt, 'utf8')).rejects.toThrow();
    route.current = {type:'session',sessionID:'root'};
    await expect.poll(async () => readFile(receipt, 'utf8').catch(()=>'' )).toBe('{"session_id":"root"}');
    dispose();
    route.current = {type:'session',sessionID:'other'};
    await new Promise(resolve => setTimeout(resolve, 350));
    expect(await readFile(receipt, 'utf8')).toBe('{"session_id":"root"}');
  } finally {
    dispose();
    if (before === undefined) delete process.env.TREEFOLD_AGENT_HOOK;
    else process.env.TREEFOLD_AGENT_HOOK = before;
    await rm(root,{recursive:true,force:true});
  }
});
