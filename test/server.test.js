import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WebSocket} from 'ws';
import {createApp} from '../server.js';
async function setup(t, options){const app=createApp(options);await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());return `http://127.0.0.1:${app.server.address().port}`;}
async function client(url){const ws=new WebSocket(url.replace('http','ws'));const messages=[];const waiters=[];ws.on('message',raw=>{const m=JSON.parse(raw);const i=waiters.findIndex(x=>x.type===m.type);if(i>=0){waiters.splice(i,1)[0].resolve(m);}else messages.push(m);});await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});return {ws,send:m=>ws.send(JSON.stringify(m)),next:type=>{const i=messages.findIndex(x=>x.type===type);if(i>=0)return Promise.resolve(messages.splice(i,1)[0]);return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Timeout: '+type)),3000);waiters.push({type,resolve:m=>{clearTimeout(timeout);resolve(m);}});});}};}
const auth='a'.repeat(64),profile='encrypted-profile';
test('encrypted relay, late history, access control, creator deletion and missing room',async t=>{const url=await setup(t);const a=await client(url);a.send({type:'create',auth,profile});const room=await a.next('ready');assert.ok(room.owner);a.send({type:'message',data:'opaque-ciphertext'});assert.equal((await a.next('message')).data,'opaque-ciphertext');const bad=await client(url);bad.send({type:'join',id:room.id,auth:'b'.repeat(64),profile});assert.match((await bad.next('error')).message,/invalid/i);const b=await client(url);b.send({type:'join',id:room.id,auth,profile});const joined=await b.next('ready');assert.equal(joined.owner,undefined);assert.equal(joined.history[0].data,'opaque-ciphertext');b.send({type:'delete',owner:'wrong'});assert.match((await b.next('error')).message,/creator/);a.send({type:'delete',owner:room.owner});assert.match((await b.next('closed')).reason,/deleted/);const c=await client(url);c.send({type:'join',id:room.id,auth,profile});assert.match((await c.next('error')).message,/unavailable/);});
test('expiry closes rooms and static files have privacy headers',async t=>{const url=await setup(t,{ttl:50});const response=await fetch(url);assert.equal(response.status,200);assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.match(await response.text(),/Eureka/);const a=await client(url);a.send({type:'create',auth,profile});await a.next('ready');assert.match((await a.next('closed')).reason,/expired/);});

test('room and creator authority survive server replacement with shared storage',async t=>{
  const {MemoryRoomStore}=await import('../room-store.js');const store=new MemoryRoomStore();
  const first=createApp({store});await new Promise(r=>first.server.listen(0,'127.0.0.1',r));
  const a=await client(`http://127.0.0.1:${first.server.address().port}`);a.send({type:'create',auth,profile});
  const created=await a.next('ready');a.send({type:'message',data:'encrypted before restart'});await a.next('message');
  first.close();
  const second=await setup(t,{store});const returning=await client(second);
  returning.send({type:'join',id:created.id,auth,profile});const restored=await returning.next('ready');
  assert.equal(restored.expires,created.expires);assert.equal(restored.history[0].data,'encrypted before restart');
  const friend=await client(second);friend.send({type:'join',id:created.id,auth,profile});assert.equal((await friend.next('ready')).history.length,1);
  returning.send({type:'delete',owner:created.owner});assert.match((await friend.next('closed')).reason,/deleted/);
  const third=await setup(t,{store}), late=await client(third);late.send({type:'join',id:created.id,auth,profile});assert.match((await late.next('error')).message,/unavailable/);
});
