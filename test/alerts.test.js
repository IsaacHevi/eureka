import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAlerts} from '../public/alerts.js';
function fixture({permission='granted',supported=true}={}) {
  const displayed=[], events={}, docEvents={}, sounds=[];
  const doc={title:'Eureka',visibilityState:'hidden',hasFocus:()=>false,addEventListener:(name,fn)=>docEvents[name]=fn};
  class Notification {
    static permission=permission;
    static async requestPermission(){return this.permission;}
    constructor(title,options){this.title=title;this.options=options;this.closed=false;displayed.push(this);}
    close(){this.closed=true;}
  }
  class AudioContext {
    state='running';currentTime=0;destination={};
    createOscillator(){return {connect(){},disconnect(){},frequency:{setValueAtTime(){}},start(){sounds.push('tone');},stop(){}};}
    createGain(){return {connect(){},disconnect(){},gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}}};}
  }
  const win={navigator:{},Notification:supported?Notification:undefined,AudioContext,addEventListener:(name,fn)=>events[name]=fn,focus(){events.focus();}};
  const alerts=createAlerts({win,doc});return {alerts,displayed,events,docEvents,doc,sounds,win};
}
test('background notifications are generic; focus clears badges and closes popups',async()=>{
  const f=fixture();await f.alerts.enable();await f.alerts.incoming();assert.equal(f.displayed.length,1);
  assert.deepEqual(f.displayed[0].options,{body:'New message in your private chat.',tag:'eureka-message',silent:true});
  assert.equal(f.doc.title,'(1) Eureka');assert.equal(f.sounds.length,2);
  f.displayed[0].onclick();assert.equal(f.doc.title,'Eureka');assert.equal(f.displayed[0].closed,true);
});
test('focused chat plays sound without popup; mute and disabled alerts are respected',async()=>{
  const f=fixture();await f.alerts.enable();f.doc.visibilityState='visible';f.doc.hasFocus=()=>true;
  await f.alerts.incoming();assert.equal(f.displayed.length,0);assert.equal(f.sounds.length,2);
  f.alerts.toggleSound();await f.alerts.incoming();assert.equal(f.sounds.length,2);
  f.alerts.disable();f.doc.visibilityState='hidden';await f.alerts.incoming();assert.equal(f.displayed.length,0);assert.equal(f.doc.title,'(1) Eureka');
});
test('denied or unsupported notifications still allow sound and unread badges',async()=>{
  for(const options of [{permission:'denied'},{supported:false}]){
    const f=fixture(options);await f.alerts.enable();await f.alerts.incoming();assert.equal(f.displayed.length,0);assert.equal(f.sounds.length,2);assert.equal(f.doc.title,'(1) Eureka');
  }
});
test('service worker notifications are used when available and closed on reset',async()=>{
  const f=fixture(),shown=[],closed=[];const reg={active:{},showNotification:async(...args)=>shown.push(args),getNotifications:async()=>[{close:()=>closed.push(true)}]};
  f.win.navigator.serviceWorker={register:async()=>reg};
  const alerts=createAlerts({win:f.win,doc:f.doc});await alerts.enable();await alerts.incoming();assert.equal(shown.length,1);assert.equal(f.displayed.length,0);alerts.clear();await Promise.resolve();assert.equal(closed.length,1);
});
