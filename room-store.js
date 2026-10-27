// Storage contains ciphertext and access credentials only, never invitation secrets.
const copy = value => value ? structuredClone(value) : null;
export class MemoryRoomStore {
  rooms = new Map();
  async get(id) {
    const room = this.rooms.get(id);
    if (!room || room.expires <= Date.now()) {this.rooms.delete(id);return null;}
    return copy(room);
  }
  async create(id, room) {this.rooms.set(id, copy(room));}
  async append(id, entry) {
    const room = this.rooms.get(id);
    if (room?.expires <= Date.now()) {this.rooms.delete(id);throw Error('Room has expired.');}
    if (!room) throw Error('Room has expired.');
    if (room.history.length >= 2000) throw Error('Room message limit reached.');
    room.history.push(entry);this.rooms.set(id, room);
  }
  async delete(id) {this.rooms.delete(id);}
}
export class SupabaseRoomStore {
  constructor({url, token, fetchImpl = fetch}) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw Error('Room storage URL must use HTTPS without embedded credentials.');
    this.url = parsed.origin; this.token = token; this.fetch = fetchImpl;
  }
  async request(path, {method='GET', body, prefer} = {}) {
    try {
      const headers = {apikey:this.token,'Content-Type':'application/json'};
      // Legacy service-role keys are JWTs. New secret keys use the apikey header only.
      if(this.token.startsWith('eyJ')) headers.Authorization = `Bearer ${this.token}`;
      if(prefer) headers.Prefer = prefer;
      const response = await this.fetch(`${this.url}/rest/v1/${path}`, {
        method, headers, body:body === undefined ? undefined : JSON.stringify(body),
        signal:AbortSignal.timeout(10000)
      });
      if (!response.ok) throw Error();
      const text=await response.text();return text ? JSON.parse(text) : null;
    } catch {throw Error('Room storage is temporarily unavailable. Please try again.');}
  }
  async get(id) {
    const rows = await this.request(`eureka_rooms?id=eq.${encodeURIComponent(id)}&expires=gt.${Date.now()}&select=data,expires,history`);
    const row = rows[0];return row ? {...row.data,expires:Number(row.expires),history:row.history} : null;
  }
  async create(id, room) {
    const {expires,history,...data} = room;
    await this.request('eureka_rooms', {method:'POST',body:{id,data,expires,history},prefer:'return=minimal'});
  }
  async append(id, entry) {
    const result = await this.request('rpc/eureka_append_message', {method:'POST',body:{room_id:id,entry}});
    if(result==='expired') throw Error('Room has expired.');
    if(result==='full') throw Error('Room message limit reached.');
    if(result!=='ok') throw Error('Room storage is temporarily unavailable. Please try again.');
  }
  async delete(id) {await this.request(`eureka_rooms?id=eq.${encodeURIComponent(id)}`,{method:'DELETE',prefer:'return=minimal'});}
}
export function configuredStore() {
  const url=process.env.SUPABASE_URL, token=process.env.SUPABASE_SECRET_KEY;
  if (url || token) {
    if (!url || !token) throw Error('Set both SUPABASE_URL and SUPABASE_SECRET_KEY.');
    return new SupabaseRoomStore({url,token});
  }
  if (process.env.RENDER) throw Error('Persistent room storage is required on Render. Set SUPABASE_URL and SUPABASE_SECRET_KEY.');
  return new MemoryRoomStore();
}
