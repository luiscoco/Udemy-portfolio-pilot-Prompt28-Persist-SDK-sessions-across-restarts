import { describe, it, expect, vi } from 'vitest';
import { applicationApprovalOptions, createApprovalTools, CHANGE_TOOL } from '../src/approval-tools.js';
import { applicationPolicyHooks } from '../src/policy-hooks.js';
import type { PortfolioToolContext } from '../src/tools/context.js';
import type { Options, PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk';
const change = { actionType:'watchlist.add' as const,arguments:{symbol:'AAPL',exchangeMic:'XNAS'} };
const fixture = () => ({ dataMode:'mock',data:{},approval:{ rules:async()=>[],authorize:vi.fn(async()=>true),execute:vi.fn(async()=>({mutationId:'receipt',applied:true})) } }) as unknown as PortfolioToolContext;
const hook = (extra: object = {}): PreToolUseHookInput => ({ hook_event_name:'PreToolUse',session_id:'fixture',transcript_path:'',cwd:'',tool_name:CHANGE_TOOL,tool_input:change,tool_use_id:'call',...extra });
describe('documented SDK approval integration', () => {
 it('does not preapprove mutations, switches from dontAsk and returns only exact validated input',async()=>{
  const context=fixture(),options:Options={permissionMode:'dontAsk',allowedTools:['mcp__portfolio__getQuotes'],canUseTool:async()=>({behavior:'deny',message:'deny'})};
  applicationApprovalOptions(options,context);
  expect(options.allowedTools).not.toContain(CHANGE_TOOL);expect(options.permissionMode).toBe('default');
  const info={signal:new AbortController().signal,mcpServer:{name:'portfolio',source:'sdk'},toolUseID:'call'};
  expect(await options.canUseTool!(CHANGE_TOOL,change,info)).toEqual({behavior:'allow',updatedInput:change});
  expect(await options.canUseTool!(CHANGE_TOOL,{...change,userId:'other'},info)).toMatchObject({behavior:'deny',interrupt:true});
  expect(await options.canUseTool!(CHANGE_TOOL,change,{...info,mcpServer:{name:'portfolio',source:'project'}})).toMatchObject({behavior:'deny'});
 });
 it('PreToolUse requests human permission and denies specialists and spoofed servers',async()=>{
  const hooks=applicationPolicyHooks({allowedTools:[]},{actorId:'owner',conversationId:'conversation',runId:'run'},()=>{});
  const callback=hooks.PreToolUse![0]!.hooks[0]!; const context={signal:new AbortController().signal};
  expect(await callback(hook(),'call',context)).toMatchObject({hookSpecificOutput:{permissionDecision:'ask'}});
  expect(await callback(hook({agent_id:'specialist'}),'call',context)).toMatchObject({hookSpecificOutput:{permissionDecision:'deny'}});
  expect(await callback(hook({mcp_server:{name:'portfolio',source:'project'}}),'call',context)).toMatchObject({hookSpecificOutput:{permissionDecision:'deny'}});
 });
 it('handler checks a separate receipt and rejects invalid arguments or cancellation',async()=>{
  const context=fixture(); const tool=createApprovalTools(context).find(t=>t.name==='proposeChange')!;
  expect((await tool.handler(change,undefined)).structuredContent).toEqual({mutationId:'receipt',applied:true});
  expect((await tool.handler({...change,arguments:{...change.arguments,shell:'bad'}},undefined)).isError).toBe(true);
  const controller=new AbortController();controller.abort();
  expect((await createApprovalTools({...context,signal:controller.signal}).find(t=>t.name==='proposeChange')!.handler(change,undefined)).isError).toBe(true);
  const denied=fixture();vi.mocked(denied.approval!.execute).mockRejectedValue(new Error('no receipt'));
  expect((await createApprovalTools(denied).find(t=>t.name==='proposeChange')!.handler(change,undefined)).isError).toBe(true);
 });
});
