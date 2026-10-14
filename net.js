/*
 * 通信レイヤー。ホスト1台にゲストがつながる星型。
 *   PeerNet  … PeerJS（WebRTC）でスマホ同士を直接つなぐ本番用
 *   LocalNet … 同じブラウザのタブ同士を BroadcastChannel でつなぐテスト用（?net=local）
 * どちらも同じ形のオブジェクトを返す:
 *   host(code, h) → { send(to, data), broadcast(data), drop(to), close() }
 *     h.open(), h.join(id), h.msg(id, data), h.leave(id), h.error(kind)
 *   join(code, h) → { send(data), close() }
 *     h.open(), h.msg(data), h.closed(), h.error(kind)
 * error(kind) の kind: 'taken' | 'notfound' | 'network' | 'unsupported'
 */
(() => {
const PREFIX = 'kasanaru-v1-';

const PeerNet = {
  available: () => typeof window.Peer === 'function',

  host(code, h) {
    const peer = new Peer(PREFIX + code);
    const conns = new Map();
    let opened = false;
    peer.on('open', () => { opened = true; h.open(); });
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
    peer.on('error', e => {
      if (e.type === 'unavailable-id') return h.error('taken');
      if (e.type === 'browser-incompatible') return h.error('unsupported');
      if (!opened || e.type === 'server-error' || e.type === 'socket-error') h.error('network');
    });
    peer.on('connection', conn => {
      conn.on('open', () => { conns.set(conn.peer, conn); h.join(conn.peer); });
      conn.on('data', d => h.msg(conn.peer, d));
      const gone = () => { if (conns.delete(conn.peer)) h.leave(conn.peer); };
      conn.on('close', gone);
      conn.on('error', gone);
    });
    return {
      send(to, data) { const c = conns.get(to); if (c && c.open) c.send(data); },
      broadcast(data) { conns.forEach(c => { if (c.open) c.send(data); }); },
      drop(to) { const c = conns.get(to); conns.delete(to); if (c) setTimeout(() => c.close(), 300); },
      close() { conns.clear(); peer.destroy(); },
    };
  },

  join(code, h) {
    const peer = new Peer();
    let conn = null, done = false;
    const fail = kind => { if (!done) { done = true; h.error(kind); } };
    const timer = setTimeout(() => fail('notfound'), 15000);
    peer.on('open', () => {
      conn = peer.connect(PREFIX + code, {reliable: true});
      conn.on('open', () => { clearTimeout(timer); done = true; h.open(); });
      conn.on('data', d => h.msg(d));
      conn.on('close', () => { if (done) h.closed(); });
    });
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
    peer.on('error', e => {
      if (e.type === 'peer-unavailable') { clearTimeout(timer); return fail('notfound'); }
      if (e.type === 'browser-incompatible') return fail('unsupported');
      if (!done) { clearTimeout(timer); fail('network'); }
    });
    return {
      send(data) { if (conn && conn.open) conn.send(data); },
      close() { clearTimeout(timer); done = false; peer.destroy(); },
    };
  },
};

const LocalNet = {
  available: () => typeof BroadcastChannel === 'function',

  host(code, h) {
    const ch = new BroadcastChannel(PREFIX + code), me = 'host';
    const conns = new Set();
    ch.onmessage = ({data: m}) => {
      if (m.to !== me) return;
      if (m.type === 'connect') { conns.add(m.from); ch.postMessage({type:'accept', from:me, to:m.from}); h.join(m.from); }
      if (m.type === 'data' && conns.has(m.from)) h.msg(m.from, m.data);
      if (m.type === 'bye' && conns.delete(m.from)) h.leave(m.from);
    };
    setTimeout(() => h.open(), 50);
    return {
      send(to, data) { ch.postMessage({type:'data', from:me, to, data}); },
      broadcast(data) { conns.forEach(to => ch.postMessage({type:'data', from:me, to, data})); },
      drop(to) { conns.delete(to); ch.postMessage({type:'bye', from:me, to}); },
      close() { conns.forEach(to => ch.postMessage({type:'bye', from:me, to})); ch.close(); },
    };
  },

  join(code, h) {
    const ch = new BroadcastChannel(PREFIX + code), me = 'g' + Math.random().toString(36).slice(2, 8);
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; h.error('notfound'); } }, 1500);
    ch.onmessage = ({data: m}) => {
      if (m.to !== me) return;
      if (m.type === 'accept' && !done) { clearTimeout(timer); done = true; h.open(); }
      if (m.type === 'data') h.msg(m.data);
      if (m.type === 'bye') h.closed();
    };
    ch.postMessage({type:'connect', from:me, to:'host'});
    return {
      send(data) { ch.postMessage({type:'data', from:me, to:'host', data}); },
      close() { clearTimeout(timer); ch.postMessage({type:'bye', from:me, to:'host'}); ch.close(); },
    };
  },
};

window.KasanaruNet = /[?&]net=local\b/.test(location.search) ? LocalNet : PeerNet;
})();
