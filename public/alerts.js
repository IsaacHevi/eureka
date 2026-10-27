// Keep notification contents generic: never send decrypted room data to the OS.
export function createAlerts({win = window, doc = document, onStatus = () => {}} = {}) {
  const baseTitle = doc.title;
  let preferences = {};
  try {preferences = JSON.parse(win.localStorage?.getItem('eureka-alerts') || '{}') || {};} catch {}
  let enabled = preferences.enabled === true, sound = preferences.sound === true, audio, registration, unread = 0;
  function savePreferences() {
    try {win.localStorage?.setItem('eureka-alerts', JSON.stringify({enabled, sound}));} catch {}
  }
  const active = new Set();
  function update() {
    const permission = win.Notification?.permission;
    onStatus({enabled: enabled && permission === 'granted', sound,
      blocked: permission === 'denied', supported: !!win.Notification});
  }
  function prepareAudio() {
    try {
      const Context = win.AudioContext || win.webkitAudioContext;
      if (!audio && Context) audio = new Context();
      if (audio?.state === 'suspended') audio.resume().catch(() => {});
    } catch { /* Audio can be unavailable without preventing chat. */ }
  }
  function tone() {
    if (!sound || !audio || audio.state !== 'running') return;
    try {
      const o = audio.createOscillator(), g = audio.createGain(), now = audio.currentTime;
      o.connect(g); g.connect(audio.destination); o.type = 'sine';
      o.frequency.setValueAtTime(660, now); o.frequency.setValueAtTime(880, now + .09);
      g.gain.setValueAtTime(.07, now); g.gain.exponentialRampToValueAtTime(.001, now + .25);
      o.start(); o.stop(now + .26);
      o.onended = () => { o.disconnect(); g.disconnect(); };
    } catch { /* Notification delivery must not break message rendering. */ }
  }
  function clear() {
    unread = 0; doc.title = baseTitle;
    for (const n of active) n.close(); active.clear();
    registration?.getNotifications({tag: 'eureka-message'}).then(list => list.forEach(n => n.close())).catch(() => {});
  }
  if ('serviceWorker' in win.navigator) {
    win.navigator.serviceWorker.register('/sw.js').then(r => {
      registration = r;
      if (r.active) return;
      return win.navigator.serviceWorker.ready.then(ready => {registration = ready;});
    }).catch(() => {});
  }
  doc.addEventListener('visibilitychange', () => {if (doc.visibilityState === 'visible' && doc.hasFocus()) clear();});
  win.addEventListener('focus', clear);
  doc.addEventListener('pointerdown', () => {if(sound) prepareAudio();});
  doc.addEventListener('keydown', () => {if(sound) prepareAudio();});
  update();
  return {
    async enable() {
      // Invoke both APIs before awaiting: permission and audio need a user gesture.
      sound = true; prepareAudio();
      let request;
      try {request = win.Notification ? win.Notification.requestPermission() : Promise.resolve('unsupported');}
      catch {request = Promise.resolve('denied');}
      tone(); update();
      const permission = await request.catch(() => 'denied');
      enabled = permission === 'granted'; savePreferences(); update(); return permission;
    },
    disable() {enabled = false; savePreferences(); clear(); update();},
    toggleSound() {sound = !sound;if(sound){prepareAudio();tone();}savePreferences();update();},
    clear,
    async incoming() {
      tone();
      if (doc.visibilityState === 'visible' && doc.hasFocus()) return;
      doc.title = `(${++unread}) ${baseTitle}`;
      if (!enabled || win.Notification?.permission !== 'granted') return;
      const options = {body:'New message in your private chat.', tag:'eureka-message', silent:true};
      try {
        if (registration?.active) {
          await registration.showNotification('Eureka', options);
        } else {
          const n = new win.Notification('Eureka', options); active.add(n);
          n.onclick = () => {win.focus();clear();};
          n.onclose = () => active.delete(n);
        }
      } catch { /* Unsupported notification APIs must not interrupt chat. */ }
    }
  };
}
