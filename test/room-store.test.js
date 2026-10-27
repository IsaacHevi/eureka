import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {MemoryRoomStore, SupabaseRoomStore} from '../room-store.js';

test('Postgres schema persists ciphertext, atomically appends, enforces expiry and deletion',async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec('create role anon; create role authenticated; create role service_role;');
  const schema=await readFile(new URL('../supabase/setup.sql',import.meta.url),'utf8');
  await db.exec(schema.split('-- Cleanup runs')[0]);
  // Exercise the real database functions through the adapter's REST contract.
  const fetchImpl=async(url,options)=>{
    assert.equal(options.headers.apikey,'test-server-key');
    const path=new URL(url), body=options.body?JSON.parse(options.body):null;
    let data;
    if(path.pathname.endsWith('/rpc/eureka_append_message')){
      data=(await db.query('select public.eureka_append_message($1,$2::jsonb) as result',[body.room_id,JSON.stringify(body.entry)])).rows[0].result;
    }else if(options.method==='POST'){
      await db.query('insert into eureka_rooms(id,data,expires,history) values($1,$2,$3,$4)',[body.id,body.data,body.expires,JSON.stringify(body.history)]);
      return new Response(null,{status:201});
    }else if(options.method==='DELETE'){
      await db.query('delete from eureka_rooms where id=$1',[path.searchParams.get('id').slice(3)]);
      return new Response(null,{status:204});
    }else{
      data=(await db.query('select data,expires,history from eureka_rooms where id=$1 and expires>$2',[path.searchParams.get('id').slice(3),Number(path.searchParams.get('expires').slice(3))])).rows;
    }
    return Response.json(data);
  };
  const options={url:'https://example.supabase.co',token:'test-server-key',fetchImpl};
  const store=new SupabaseRoomStore(options), id='a'.repeat(24);
  const room={auth:'access',owner:'creator',expires:Date.now()+86400000,history:[],profile:'encrypted profile'};
  await store.create(id,room);
  await Promise.all(Array.from({length:12},(_,i)=>store.append(id,{id:String(i),data:'ciphertext-'+i})));
  // A brand new storage adapter sees the original room, credentials and all history.
  const restarted=new SupabaseRoomStore(options), recovered=await restarted.get(id);
  assert.equal(recovered.owner,room.owner);assert.equal(recovered.auth,room.auth);assert.equal(recovered.expires,room.expires);
  assert.equal(recovered.history.length,12);assert.equal(new Set(recovered.history.map(x=>x.id)).size,12);
  assert.equal((await db.query("select has_table_privilege('anon','public.eureka_rooms','select') as allowed")).rows[0].allowed,false);
  await restarted.delete(id);assert.equal(await store.get(id),null);
  await store.create(id,{...room,expires:Date.now()-1000});assert.equal(await store.get(id),null);await assert.rejects(store.append(id,{data:'late'}),/expired/);
  assert.equal((await db.query('select count(*) as count from eureka_rooms')).rows[0].count,0);
});
test('storage failures never fall back to empty rooms or expose credentials',async()=>{
  const store=new SupabaseRoomStore({url:'https://example.supabase.co',token:'never-print-me',fetchImpl:async()=>new Response('never-print-me',{status:503})});
  await assert.rejects(store.get('a'.repeat(24)),{message:'Room storage is temporarily unavailable. Please try again.'});
});
test('memory-only development storage expires rooms',async()=>{
  const store=new MemoryRoomStore();await store.create('a',{expires:Date.now()-1,history:[]});assert.equal(await store.get('a'),null);
});
