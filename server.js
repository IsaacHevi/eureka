import http from 'node:http';
import { configuredStore } from './room-store.js';
import { readFile } from 'node:fs/promises';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { fileURLToPath } from 'node:url';

const DAY = 86400000;
const hash = s => createHash('sha256').update(s).digest();
const matches = (a,b) => typeof a === 'string' && timingSafeEqual(hash(a), hash(b));
export function createApp({ ttl = DAY, store = configuredStore() } = {}) {
  const rooms = new Map(), attempts = new Map();
  const send = (ws, data) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); };
  const broadcast = (room, data) => room.clients.forEach(ws => send(ws, data));
  function closeRoom(id, reason) {
    const room = rooms.get(id); if (!room) return;
    broadcast(room, {type:'closed', reason});
    room.clients.forEach(ws => ws.close(1000, reason));
    room.history.length = 0; rooms.delete(id);
  }
  function roster(room) { broadcast(room, {type:'presence', users:[...room.clients].map(ws => ({id:ws.memberId, profile:ws.profile}))}); }
  const server = http.createServer(async (req,res) => {
    const headers = {'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};
    const files = {'/':'index.html','/app.js':'app.js','/alerts.js':'alerts.js','/sw.js':'sw.js','/style.css':'style.css'};
    const path = files[req.url?.split('?')[0]];
    if (!path || req.method !== 'GET') {res.writeHead(404,headers);res.end();return;}
    try {const body = await readFile(new URL(`./public/${path}`,import.meta.url)); res.writeHead(200,{...headers,'Content-Type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html; charset=utf-8'});res.end(body);} catch {res.writeHead(500,headers);res.end();}
  });
  const wss = new WebSocketServer({server,maxPayload:32768});
  wss.on('connection',(ws,req) => {
    if (req.headers.origin && req.headers.origin !== `${req.socket.encrypted?'https':'http'}://${req.headers.host}` && req.headers.origin !== process.env.PUBLIC_ORIGIN) {ws.close(1008);return;}
    let roomId; let count=0, windowStart=Date.now();
    let pending = Promise.resolve();
    ws.on('message', raw => {
      pending = pending.then(async () => {
      try {
        if (Date.now()-windowStart>60000) {count=0;windowStart=Date.now();}
        if (++count>120) throw Error('Too many requests. Please wait a minute.');
        const m=JSON.parse(raw);
        if (m.type==='create' || m.type==='join') {
          if (roomId) throw Error('Already in a room.');
          const ip=req.socket.remoteAddress;
          let rate=attempts.get(ip); if (!rate || Date.now()>rate.until) {rate={count:0,until:Date.now()+60000};attempts.set(ip,rate);}
          if (++rate.count>30) throw Error('Too many join attempts. Try again shortly.');
          if (typeof m.auth!=='string' || !/^[a-f0-9]{64}$/.test(m.auth)) throw Error('Invalid invitation.');
          if (typeof m.profile!=='string' || m.profile.length>2048) throw Error('Invalid profile.');
          let room;
          if (m.type==='create') {
            if (rooms.size>=1000) throw Error('Server is full. Please try later.');
            const newId=randomBytes(12).toString('hex');
            const owner=randomBytes(32).toString('hex');
            const data={auth:m.auth,owner,expires:Date.now()+ttl,history:[],profile:m.profile};
            await store.create(newId,data);roomId=newId;
            room={...data,clients:new Set()};rooms.set(roomId,room);ws.ownerToken=owner;
          } else {
            if(typeof m.id!=='string'||! /^[a-f0-9]{24}$/.test(m.id)) throw Error('Invitation is invalid or the room has expired.');
            const data=await store.get(m.id);
            room=data ? {...data,clients:rooms.get(m.id)?.clients || new Set()} : null;
            if (!room) throw Object.assign(Error('This room is unavailable. It may have been deleted, expired, or lost during a server restart.'),{code:'ROOM_UNAVAILABLE'});
            if (!matches(m.auth,room.auth)) throw Error('Invalid invitation. Please copy the complete invitation link.');
            if (room.clients.size>=20) throw Error('This room already has 20 people.');
            roomId=m.id;rooms.set(roomId,room);
          }
          if (ws.readyState !== WebSocket.OPEN) return;
          ws.memberId=randomBytes(8).toString('hex');ws.profile=m.profile;room.clients.add(ws);
          send(ws,{type:'ready',id:roomId,memberId:ws.memberId,owner:ws.ownerToken,expires:room.expires,history:room.history,profile:room.profile});roster(room);
        } else {
          const room=rooms.get(roomId);if (!room || room.expires<=Date.now()) throw Error('Room has expired.');
          if(m.type==='message') {
            if(typeof m.data!=='string'||m.data.length>20000) throw Error('Message is too large.');
            if(room.history.length>=2000) throw Error('Room message limit reached.');
            const entry={type:'message',id:randomBytes(12).toString('hex'),data:m.data};await store.append(roomId,entry);room.history.push(entry);broadcast(room,entry);
          } else if(m.type==='delete') {
            if(!matches(m.owner,room.owner)) throw Error('Only the creator can delete this room.');
            await store.delete(roomId);closeRoom(roomId,'The creator deleted this room.');
          }
        }
      } catch(e) {send(ws,{type:'error',message:e.message || 'Invalid request.',code:e.code});}
      });
    });
    ws.on('close',()=>{const room=rooms.get(roomId);if(room){room.clients.delete(ws);roster(room);if(!room.clients.size)rooms.delete(roomId);}});
  });
  const timer=setInterval(()=>{for(const [id,r] of rooms)if(r.expires<=Date.now())closeRoom(id,'This room has expired.');for(const [ip,r]of attempts)if(r.until<Date.now())attempts.delete(ip);},1000);timer.unref();
  return {server,wss,close:()=>{clearInterval(timer);wss.clients.forEach(ws=>ws.terminate());wss.close();server.close();}};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const {server}=createApp();server.listen(Number(process.env.PORT)||3000,'0.0.0.0',()=>console.log('Eureka listening on port '+(process.env.PORT||3000)));}
