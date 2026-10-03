import { expect, test } from '@playwright/test';
import { getDatabase, closeConnections } from '@portfolio-pilot/db';
const url = process.env.APPROVAL_E2E_DATABASE_URL;
test.describe('approval cards',()=>{
 test.skip(!url,'Set APPROVAL_E2E_DATABASE_URL; run mock API on portfolio_m25_verify and Vite.');
 test.afterAll(async()=>{await closeConnections();});
 test('shows exact proposal, recovers after reload, approves once, rejects and cancels waiting runs',async({page,browser})=>{
  test.setTimeout(90000);
  const target=new URL(url!);if(target.hostname!=='127.0.0.1'||target.pathname!=='/portfolio_m25_verify')throw new Error('Dedicated loopback test DB required.');
  const db=await getDatabase(url!);const ids:string[]=[];let conversationId='';const bob=await browser.newContext();
  try {
   await page.goto('/assistant');await page.getByRole('button',{name:'Sign in as Alice Demo'}).click();
   const created=page.waitForResponse(r=>r.url().endsWith('/api/conversations')&&r.request().method()==='POST');
   await page.getByRole('button',{name:'New conversation',exact:true}).click();conversationId=(await(await created).json()).conversation.id;
   await expect(page.getByLabel('Conversation',{exact:true})).toHaveValue(conversationId);
   for(const decision of ['approve','reject','cancel'] as const){
    const id='m25-ui-'+crypto.randomUUID().slice(0,8),symbol='U25'+crypto.randomUUID().slice(0,8).toUpperCase();ids.push(id);
    await db.security.create({data:{id,symbol,exchangeMic:'XNAS',name:'Synthetic approval fixture'}});
    await page.locator('#chat-question').fill(`Add ${symbol} to my watchlist`);
    const started=page.waitForResponse(r=>r.url().endsWith('/runs')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'Send',exact:true}).click();const run=(await(await started).json()).run;
    const cards=page.getByRole('region',{name:'Proposed changes'});
    await expect(page.getByRole('heading',{name:'Exact proposed change'})).toBeVisible();
    await expect(cards).toContainText(symbol);await expect(cards).toContainText('XNAS');
    expect(await db.watchlistEntry.count({where:{securityId:id}})).toBe(0);
    if(decision==='approve'){
     await page.reload();await page.getByLabel('Conversation',{exact:true}).selectOption(conversationId);
     await expect(page.getByRole('button',{name:'Approve change'})).toBeVisible();
     const a=await db.approvalRequest.findFirstOrThrow({where:{runId:run.id}});
     const b=await bob.newPage();await b.goto('/assistant');await b.getByRole('button',{name:'Sign in as Bob Demo'}).click();
     await expect.poll(async()=> (await bob.request.get('/api/me')).status()).toBe(200);
     expect((await bob.request.post(`/api/approvals/${a.id}/approve`,{headers:{origin:'http://127.0.0.1:5173'},data:{argumentHash:a.argumentHash}})).status()).toBe(404);
     await page.getByRole('button',{name:'Approve change'}).click();
    }else if(decision==='reject')await page.getByRole('button',{name:'Reject change'}).click();
    else await page.getByRole('button',{name:'Cancel answer'}).click();
    await page.locator('#chat-question').fill('Next question');
    await expect(page.getByRole('button',{name:'Send',exact:true})).toBeEnabled({timeout:15000});
    expect(await db.watchlistEntry.count({where:{securityId:id}})).toBe(decision==='approve'?1:0);
    const row=await db.approvalRequest.findFirstOrThrow({where:{runId:run.id}});
    expect(row.status).toBe(decision==='approve'?'consumed':decision==='reject'?'rejected':'cancelled');
   }
   await page.setViewportSize({width:390,height:844});await expect(page.locator('body')).toHaveJSProperty('scrollWidth',390);
  }finally{
   await bob.close();
   if(conversationId)await db.conversation.deleteMany({where:{id:conversationId}});
   await db.watchlistEntry.deleteMany({where:{securityId:{in:ids}}});await db.security.deleteMany({where:{id:{in:ids}}});
   await db.outboxEvent.deleteMany({where:{payload:{path:['securityId'],string_starts_with:'m25-ui-'}}});
  }
 });
});
