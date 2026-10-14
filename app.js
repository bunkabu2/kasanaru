(() => {
const POOL = Object.fromEntries(Object.entries(window.KASANARU_DECKS).map(([k, v]) => [k,
  v.split('\n').map(l => ({w: +l[0], t: l.slice(1).trim()})).filter(c => c.t)]));

const MODES = {
  asobi:  {name:'あそび', mk:'遊', sub:'みんなで、これからなにする？', talk:false, min:2, def:3},
  gohan:  {name:'ごはん', mk:'食', sub:'なに食べる？を、気持ちよく決める', talk:false, min:2, def:3},
  futari: {name:'ふたり', mk:'二', sub:'遠慮なしで、ふたりの予定を決める', talk:false, min:2, max:2, def:2},
  honne:  {name:'ほんね', mk:'話', sub:'全員が「話してもいい」お題だけが残る', talk:true, min:2, def:3},
};
const WHEN = [['今から','2〜3時間'],['今日のうちに','半日〜'],['こんどの休み','計画して']];
const V = {
  play:{yes:'やりたい', maybe:'ありかも', no:'パス'},
  talk:{yes:'話したい', maybe:'話せる', no:'パス'},
};
const MAX_ONLINE = 8;
const AV = ['var(--pink)','var(--blue)','var(--warn)','var(--both)','var(--ok)'];

/* ───────── 保存 ───────── */
const store = {
  get(k, d){ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} },
};
const NOTES = 'kasanaru.notes.v1', NAMES = 'kasanaru.names.v1', ME = 'kasanaru.me.v1';

/* ───────── 状態 ───────── */
const S = {
  screen:'home', mode:'asobi', names:store.get(NAMES, ['','','']), when:1, per:12, custom:'',
  cards:[], votes:[], rnd:[], counts:[], n:0, p:0, i:0, used:{}, tie:0, last:null,
  online:null, onlineErr:'',
};
let net = null;
const O = () => S.online;
const isHost = () => !!(S.online && S.online.role === 'host');
const roomParam = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);

const app = document.getElementById('app');
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shuffle = a => { for (let i = a.length-1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]] = [a[j],a[i]]; } return a; };
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const players = () => S.names.map((n, i) => String(n).trim() || `プレイヤー${i+1}`);
const words = () => MODES[S.mode].talk ? V.talk : V.play;
const today = () => { const d = new Date(); return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`; };
const cleanName = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 12);
const myName = () => cleanName(store.get(ME, '')) || 'わたし';
const newCode = () => Array.from({length:5}, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random()*32)]).join('');
const roomUrl = code => `${location.origin}${location.pathname}?room=${code}`;

function toast(msg){
  const t = document.getElementById('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => t.hidden = true, 2200);
}
function go(screen){ S.screen = screen; render(); window.scrollTo(0, 0); }

/* ───────── カードを配る ───────── */
function deal(){
  const m = MODES[S.mode];
  const custom = S.custom.split('\n').map(t => t.trim().slice(0, 60)).filter(Boolean).slice(0, S.per).map(t => ({t, w:0, mine:true}));
  const pool = POOL[S.mode].filter(c => m.talk || c.w <= S.when);
  const used = S.used[S.mode] || [];
  let fresh = pool.filter(c => !used.includes(c.t));
  if (fresh.length < S.per - custom.length) { fresh = pool; S.used[S.mode] = []; }
  const picked = shuffle(fresh.slice()).slice(0, Math.max(0, S.per - custom.length));
  S.used[S.mode] = (S.used[S.mode] || []).concat(picked.map(c => c.t));
  S.cards = shuffle(custom.concat(picked));
  S.rnd = S.cards.map(() => Math.random());
  S.votes = players().map(() => []);
  S.p = 0; S.i = 0; S.tie = 0;
}

/* ───────── 集計（誰の票かは持たず、カードごとの数だけを扱う） ───────── */
function countsFrom(voteSets){
  return S.cards.map((_, i) => {
    const vs = voteSets.map(v => v[i]);
    return {yes: vs.filter(v => v === 2).length, maybe: vs.filter(v => v === 1).length, no: vs.filter(v => v === 0).length};
  });
}
function tally(){
  const n = S.n;
  const rows = S.cards.map((c, i) => {
    const {yes = 0, maybe = 0, no = 0} = S.counts[i] || {};
    const score = yes*2 + maybe, mean = score / n;
    const spread = yes*(2-mean)**2 + maybe*(1-mean)**2 + no*mean**2;
    return {c, i, yes, maybe, no, score, spread, r:S.rnd[i] || 0};
  });
  const byScore = (a, b) => b.score - a.score || b.yes - a.yes || a.r - b.r;
  const hits = rows.filter(r => r.no === 0).sort(byScore);
  const near = rows.filter(r => r.no === 1).sort(byScore).slice(0, 3);
  const total = rows.reduce((a, r) => a + r.score, 0);
  const vibe = Math.round(total / (rows.length * n * 2) * 100);
  const split = rows.slice().sort((a, b) => b.spread - a.spread)[0];
  const tops = hits.filter(h => h.score === hits[0].score && h.yes === hits[0].yes);
  return {n, rows, hits, near, vibe, split, tops};
}
function finishLocal(){
  S.counts = countsFrom(S.votes); S.n = players().length; S.tie = 0;
  go('reveal');
}

/* ───────── オンライン：ホスト ───────── */
const pub = () => O().players.map(({id, name, i, done}) => ({id, name, i, done}));
const me = () => O().players.find(p => p.id === O().me);

function hostCreate(){
  const code = newCode();
  S.onlineErr = '';
  S.online = {role:'host', code, me:'host', players:[{id:'host', name:myName(), i:0, done:false}], phase:'lobby', round:0, ready:false, votes:{}};
  net = KasanaruNet.host(code, {
    open(){ if (O() && O().code === code) { O().ready = true; if (S.screen === 'lobby') render(); } },
    join(){},
    msg: hostMsg,
    leave: hostLeave,
    error(kind){
      if (!O() || O().code !== code) return;
      if (kind === 'taken') { net.close(); return hostCreate(); }
      failOnline(kind);
    },
  });
  go('lobby');
}

function hostMsg(id, m){
  const o = O(); if (!o || !m || typeof m !== 'object') return;
  const p = o.players.find(x => x.id === id);
  if (m.t === 'hello') {
    if (p) return;
    if (o.phase !== 'lobby') { net.send(id, {t:'reject', reason:'playing'}); return net.drop(id); }
    if (o.players.length >= MAX_ONLINE) { net.send(id, {t:'reject', reason:'full'}); return net.drop(id); }
    const name = cleanName(m.name) || 'ゲスト';
    o.players.push({id, name, i:0, done:false});
    net.send(id, {t:'welcome', you:id});
    broadcastLobby();
    toast(`${name}さんが入りました`);
    if (S.screen === 'lobby') render();
    return;
  }
  if (!p || o.phase !== 'play' || m.round !== o.round) return;
  if (m.t === 'prog') { p.i = Math.max(0, Math.min(S.cards.length, +m.i || 0)); broadcastProg(); }
  if (m.t === 'votes') {
    const v = Array.isArray(m.v) ? m.v : [];
    if (v.length !== S.cards.length || !v.every(x => x === 0 || x === 1 || x === 2)) return;
    o.votes[id] = v.slice(); p.done = true; p.i = S.cards.length;
    broadcastProg(); hostCheckDone();
  }
}

function hostLeave(id){
  const o = O(); if (!o) return;
  const p = o.players.find(x => x.id === id); if (!p) return;
  o.players = o.players.filter(x => x !== p);
  delete o.votes[id];
  toast(`${p.name}さんが抜けました`);
  if (o.phase === 'play' && o.players.length < 2) {
    o.phase = 'lobby'; broadcastLobby();
    toast('ひとりになったので、部屋にもどりました');
    return go('lobby');
  }
  if (o.phase === 'lobby') { broadcastLobby(); if (S.screen === 'lobby') render(); return; }
  broadcastProg();
  if (o.phase === 'play') hostCheckDone();
}

function broadcastLobby(){
  const o = O();
  net.broadcast({t:'lobby', players:pub(), mode:S.mode, when:S.when, per:S.per});
}
function broadcastProg(){ net.broadcast({t:'prog', players:pub()}); updateProg(); }

function startReason(){
  const n = O().players.length;
  if (n < 2) return 'あと1人以上そろうと始められます';
  if (S.mode === 'futari' && n !== 2) return 'ふたりモードは2人ちょうどで遊べます';
  return '';
}

function hostStart(){
  const o = O(); if (startReason()) return render();
  S.names = o.players.map(p => p.name);
  deal();
  S.votes = [[]]; S.p = 0;
  o.votes = {}; o.players.forEach(p => { p.i = 0; p.done = false; });
  o.phase = 'play'; o.round++;
  net.broadcast({t:'start', round:o.round, mode:S.mode, cards:S.cards, rnd:S.rnd, players:pub()});
  go('judge');
}

function hostCheckDone(){
  const o = O();
  if (o.phase !== 'play' || !o.players.every(p => p.done)) return;
  S.names = o.players.map(p => p.name);
  S.counts = countsFrom(o.players.map(p => o.votes[p.id]));
  S.n = o.players.length; S.tie = 0; o.phase = 'result';
  net.broadcast({t:'result', round:o.round, counts:S.counts, n:S.n, names:S.names});
  go('reveal');
}

/* ───────── オンライン：ゲスト ───────── */
function guestJoin(code){
  S.onlineErr = '';
  S.online = {role:'guest', code, me:null, players:[], phase:'connecting', round:0};
  net = KasanaruNet.join(code, {
    open(){ net.send({t:'hello', name:myName()}); },
    msg: guestMsg,
    closed(){ leaveOnline('ホストが部屋を閉じました'); },
    error(kind){ if (O() && O().code === code) failOnline(kind); },
  });
  go('lobby');
}

function guestMsg(m){
  const o = O(); if (!o || !m || typeof m !== 'object') return;
  if (m.t === 'welcome') { o.me = m.you; return; }
  if (m.t === 'reject') return failOnline(['full','kicked'].includes(m.reason) ? m.reason : 'playing');
  if (Array.isArray(m.players)) o.players = m.players.map(p => ({id:String(p.id), name:cleanName(p.name) || 'ゲスト', i:+p.i || 0, done:!!p.done}));
  if (m.t === 'lobby') {
    if (MODES[m.mode]) S.mode = m.mode;
    S.when = [0,1,2].includes(m.when) ? m.when : 1;
    S.per = [8,12,16].includes(m.per) ? m.per : 12;
    o.phase = 'lobby';
    if (S.screen === 'lobby') render(); else if (S.screen !== 'keep') go('lobby');
    return;
  }
  if (m.t === 'start' && MODES[m.mode] && Array.isArray(m.cards)) {
    S.mode = m.mode; o.round = m.round;
    S.cards = m.cards.map(c => ({t:String(c.t || '').slice(0, 80), w:[0,1,2].includes(c.w) ? c.w : 0, mine:!!c.mine}));
    S.rnd = Array.isArray(m.rnd) ? m.rnd.map(Number) : [];
    S.names = o.players.map(p => p.name);
    S.votes = [[]]; S.p = 0; S.i = 0; S.tie = 0; o.phase = 'play';
    return go('judge');
  }
  if (m.t === 'prog') return updateProg();
  if (m.t === 'result' && m.round === o.round && Array.isArray(m.counts)) {
    S.counts = m.counts; S.n = +m.n || 2; S.names = (m.names || []).map(cleanName); S.tie = 0; o.phase = 'result';
    return go('reveal');
  }
  if (m.t === 'tie') { S.tie = +m.n || 0; if (S.screen === 'result') render(); }
}

/* ───────── オンライン：共通 ───────── */
function sendProg(){
  if (isHost()) { me().i = S.i; broadcastProg(); }
  else net.send({t:'prog', round:O().round, i:S.i});
}
function submitVotes(){
  const v = S.votes[0].slice();
  if (isHost()) { O().votes.host = v; me().done = true; me().i = S.cards.length; go('wait'); broadcastProg(); hostCheckDone(); }
  else { net.send({t:'votes', round:O().round, v}); go('wait'); }
}
function updateProg(){
  if (S.screen === 'wait') return render();
  const el = document.getElementById('others');
  if (el) el.textContent = othersLine();
}
function othersLine(){
  const o = O(); if (!o) return '';
  return o.players.filter(p => p.id !== o.me).map(p => `${p.name} ${p.done ? '✓' : `${p.i}/${S.cards.length}`}`).join('・');
}
function closeNet(){ if (net) { const n = net; net = null; try { n.close(); } catch(e){} } }
function leaveOnline(msg){
  if (!S.online) return;
  closeNet(); S.online = null;
  if (msg) toast(msg);
  go('home');
}
function failOnline(kind){
  closeNet(); S.online = null;
  S.onlineErr = ({
    notfound:'部屋が見つかりませんでした。合言葉を確かめるか、ホストに部屋が開いたままか聞いてみてください。',
    network:'うまくつながりませんでした。電波のよい場所で、もう一度試してください。',
    unsupported:'このブラウザではオンラインで遊べません。Safari か Chrome の最新版で開いてください。',
    full:`この部屋はいっぱいです（${MAX_ONLINE}人まで）。`,
    kicked:'通信が途切れたため、ホストがこのラウンドから外しました。もう一度部屋に入ると次のラウンドから参加できます。',
    playing:'この部屋はゲームの途中です。ホストが「設定を変える」で部屋にもどると入れます。',
  })[kind] || 'つながりませんでした。';
  go('online');
}

/* ───────── 画面の部品 ───────── */
const dots = (w = 46) => `<div class="dots" style="width:${w}px"><i></i><i></i></div>`;
function playerList(showProg){
  const o = O();
  return `<div class="plist">${o.players.map((p, k) => `
    <div class="pitem"><span class="av" style="background:${AV[k % AV.length]}">${esc(p.name.slice(0, 1))}</span>
      <span class="nm">${esc(p.name)}${p.id === o.me ? ' <span class="small muted">（あなた）</span>' : ''}${p.id === 'host' ? ' <span class="small muted">ホスト</span>' : ''}</span>
      <span class="st ${showProg && p.done ? 'ok' : ''}">${showProg ? (p.done ? '選び終わった' : `${p.i} / ${S.cards.length}`) : ''}
        ${showProg && isHost() && !p.done && p.id !== 'host' ? `<button class="pill danger" data-kick="${esc(p.id)}">外す</button>` : ''}</span>
      ${showProg ? `<span class="pbar"><b class="${p.done ? 'full' : ''}" style="width:${(p.done ? 1 : p.i / S.cards.length) * 100}%"></b></span>` : ''}
    </div>`).join('')}</div>`;
}
const settingsLine = () => [MODES[S.mode].name, MODES[S.mode].talk ? '' : WHEN[S.when][0], `${S.per}枚`].filter(Boolean).join('・');

/* ───────── 画面 ───────── */
const SCREENS = {
home(){
  const notes = store.get(NOTES, []);
  return `
  <div class="bar"><div class="logo">${dots()}<h1>カサナル</h1></div>
    <button class="link" data-go="howto">あそびかた</button></div>
  <section class="hero">
    <p class="catch">こっそり選んで、<br><em>かさなったら、やる。</em></p>
    <p class="muted">一人ずつ「やりたい・ありかも・パス」をこっそり選ぶだけ。誰がパスしたかは出ません。全員の気持ちが重なったお題だけが残ります。</p>
  </section>
  <button class="online-btn" data-go="online">${dots()}
    <span><span class="t">それぞれのスマホで遊ぶ</span><br><span class="s">リンクか合言葉を送るだけ。離れていても、同時に選べます。</span></span>
  </button>
  <div class="label">1台のスマホを回して遊ぶ</div>
  <div class="modes">
    ${Object.entries(MODES).map(([k, m]) => `
      <button class="mode" data-mode="${k}">
        <span class="mk ${k}">${m.mk}</span>
        <span><span class="t">${m.name}</span><br><span class="s">${m.sub}</span></span>
        <span class="n mono">${POOL[k].length}枚</span>
      </button>`).join('')}
  </div>
  <div class="foot">
    <button class="chipbtn" data-go="notes">思い出ノート <span class="count">${notes.length}</span></button>
    <button class="chipbtn" data-go="howto">あそびかた</button>
  </div>`;
},

howto(){
  return `
  <div class="bar"><button class="link" data-go="home">← もどる</button><span class="label">あそびかた</span></div>
  <h2 class="display" style="font-size:24px">気まずい「次、なにする？」を、15分のゲームに。</h2>
  <ol class="steps">
    <li><div><b>集まり方を決める</b><span class="muted small">それぞれのスマホで遊ぶなら、一人が部屋をつくってリンクを送ります。1台で遊ぶなら、モードを選んでスマホを回します。</span></div></li>
    <li><div><b>こっそり選ぶ</b><span class="muted small">同じカードの束に「やりたい／ありかも／パス」。右・上・左のスワイプでも選べます。</span></div></li>
    <li><div><b>せーので、答え合わせ</b><span class="muted small">一人でもパスしたカードは消えます。残ったカードから、いちばん重なったお題が「これからやること」。</span></div></li>
    <li><div><b>実際にやって、ノートに残す</b><span class="muted small">決まったお題は思い出ノートに記録。やり終えたら「やった！」をつけましょう。</span></div></li>
  </ol>
  <div class="stat"><div class="k">ルールはひとつ</div><div class="d">誰が何を選んだかは、最後まで表示されません。オンラインでも、ほかの人のスマホに届くのはカードごとの合計だけです。</div></div>
  <button class="primary" data-go="home">はじめる</button>`;
},

online(){
  const ok = KasanaruNet.available();
  return `
  <div class="bar"><button class="link" data-go="home">← もどる</button><span class="label">それぞれのスマホで遊ぶ</span></div>
  <h2 class="display" style="font-size:24px">${roomParam ? '部屋に招待されています' : '部屋をつくるか、<br>合言葉で入る'}</h2>
  ${S.onlineErr ? `<p class="err">${esc(S.onlineErr)}</p>` : ''}
  ${ok ? '' : '<p class="err">このブラウザではオンラインで遊べません。Safari か Chrome の最新版で開いてください。</p>'}
  <div class="field"><label class="label" for="myname">あなたの名前</label>
    <input id="myname" value="${esc(store.get(ME, ''))}" placeholder="みんなに表示される名前" maxlength="12" autocomplete="nickname"></div>
  ${roomParam ? `
    <div class="field"><label class="label" for="code">合言葉</label>
      <input id="code" class="code-input" value="${esc(roomParam)}" maxlength="5" autocomplete="off" autocapitalize="characters"></div>
    <button class="primary" data-join ${ok ? '' : 'disabled'}>部屋に入る</button>
    <div class="or">または</div>
    <button class="ghost" data-create ${ok ? '' : 'disabled'}>自分で部屋をつくる</button>` : `
    <button class="primary" data-create ${ok ? '' : 'disabled'}>部屋をつくる</button>
    <div class="or">友達の部屋に入る</div>
    <div class="field"><label class="label" for="code">合言葉（5文字）</label>
      <input id="code" class="code-input" placeholder="ABC23" maxlength="5" autocomplete="off" autocapitalize="characters"></div>
    <button class="ghost" data-join ${ok ? '' : 'disabled'}>部屋に入る</button>`}
  <p class="small muted">スマホ同士を直接つないで遊びます。登録やログインはいりません。</p>`;
},

lobby(){
  const o = O();
  if (!o) return SCREENS.home();
  if (!isHost() && (!o.me || o.phase === 'connecting')) {
    return `
    <div class="bar"><button class="link" data-leave>やめる</button><span class="label mono">${esc(o.code)}</span></div>
    <div class="hand"><div class="big-dots"><i></i><i></i></div><p class="who" style="font-size:26px">つないでいます…</p>
      <p class="muted small">合言葉 <span class="mono">${esc(o.code)}</span> の部屋をさがしています。</p></div>`;
  }
  if (isHost()) {
    const reason = startReason(), url = roomUrl(o.code), m = MODES[S.mode];
    return `
    <div class="bar"><button class="link" data-leave>部屋を閉じる</button><span class="label">あなたの部屋</span></div>
    <div class="room">
      <span class="label">合言葉</span>
      <span class="code">${o.ready ? esc(o.code) : '・・・・・'}</span>
      ${o.ready ? `<span class="url">${esc(url)}</span>
        <div class="share">
          ${navigator.share ? '<button class="primary" data-share>リンクを送る</button>' : ''}
          <button class="ghost" data-copylink>リンクをコピー</button>
        </div>` : '<span class="small muted">部屋を準備しています…</span>'}
    </div>
    <div class="sec"><div class="label">集まっている人 <span class="mono">${o.players.length}</span> / ${MAX_ONLINE}</div>${playerList(false)}</div>
    <div class="sec"><div class="label">モード</div>
      <div class="seg small">${Object.entries(MODES).map(([k, x]) => `<button data-setmode="${k}" aria-pressed="${S.mode === k}">${x.name}</button>`).join('')}</div>
      <p class="small muted">${esc(m.sub)}</p></div>
    ${m.talk ? '' : `<div class="sec"><div class="label">いつやる？</div>
      <div class="seg">${WHEN.map((w, i) => `<button data-when="${i}" aria-pressed="${S.when === i}">${w[0]}<small>${w[1]}</small></button>`).join('')}</div></div>`}
    <div class="sec"><div class="label">カードの枚数</div>
      <div class="seg">${[8,12,16].map(n => `<button data-per="${n}" aria-pressed="${S.per === n}">${n}枚</button>`).join('')}</div></div>
    <details class="sec" ${S.custom ? 'open' : ''}><summary>じぶんたちのカードを足す</summary>
      <textarea id="custom" placeholder="1行に1枚">${esc(S.custom)}</textarea></details>
    ${reason ? `<p class="waitline">${reason}</p>` : ''}
    <button class="primary" data-ostart ${reason ? 'disabled' : ''}>全員にカードを配る</button>`;
  }
  return `
  <div class="bar"><button class="link" data-leave>部屋を出る</button><span class="label mono">${esc(o.code)}</span></div>
  <div class="hand" style="flex:none;padding-block:10px"><div class="big-dots"><i></i><i></i></div>
    <p class="who" style="font-size:24px">ホストがカードを<br>配るのを待っています</p>
    <p class="muted small">いまの設定：${esc(settingsLine())}</p></div>
  <div class="sec"><div class="label">集まっている人 <span class="mono">${o.players.length}</span></div>${playerList(false)}</div>
  <p class="status"><i></i>つながっています</p>`;
},

setup(){
  const m = MODES[S.mode], ns = S.names;
  return `
  <div class="bar"><button class="link" data-go="home">← もどる</button><span class="label">${m.name}モード</span></div>
  <h2 class="display" style="font-size:24px">${esc(m.sub)}</h2>
  <div class="sec">
    <div class="label">参加する人 <span class="mono">${ns.length}</span>人</div>
    <div class="players">
      ${ns.map((n, i) => `<div class="prow"><span class="no">${i+1}</span>
        <input id="name-${i}" data-name="${i}" value="${esc(n)}" placeholder="プレイヤー${i+1}" maxlength="12" autocomplete="off" aria-label="${i+1}人目の名前">
        ${!m.max && ns.length > m.min ? `<button class="x" data-del="${i}" aria-label="${i+1}人目を外す">×</button>` : ''}</div>`).join('')}
    </div>
    ${!m.max && ns.length < 10 ? `<button class="add" data-add>＋ 人を追加</button>` : ''}
  </div>
  ${m.talk ? '' : `<div class="sec"><div class="label">いつやる？</div>
    <div class="seg">${WHEN.map((w, i) => `<button data-when="${i}" aria-pressed="${S.when === i}">${w[0]}<small>${w[1]}</small></button>`).join('')}</div></div>`}
  <div class="sec"><div class="label">カードの枚数</div>
    <div class="seg">${[8,12,16].map(n => `<button data-per="${n}" aria-pressed="${S.per === n}">${n}枚<small>${n === 8 ? 'さくっと' : n === 12 ? 'ふつう' : 'じっくり'}</small></button>`).join('')}</div></div>
  <details class="sec" ${S.custom ? 'open' : ''}><summary>じぶんたちのカードを足す</summary>
    <textarea id="custom" placeholder="1行に1枚。例：\n${m.talk ? '最近いちばん驚いたこと' : 'みんなで髪を切りに行く'}">${esc(S.custom)}</textarea>
    <p class="small muted">書いたカードは必ず束に入ります。</p></details>
  <button class="primary" data-start>カードを配る</button>`;
},

hand(){
  const ps = players(), first = S.p === 0;
  return `
  <div class="bar"><button class="link" data-quit>やめる</button><span class="label mono">${S.p+1} / ${ps.length}人目</span></div>
  <div class="hand">
    <div class="big-dots"><i></i><i></i></div>
    <p class="muted">${first ? 'まずは' : 'おつかれさま！ スマホを渡してね'}</p>
    <p class="who">${esc(ps[S.p])}<span style="font-size:22px"> さんの番</span></p>
    <p class="muted small">${S.cards.length}枚のカードを、こっそり選びます。<br>前の人の答えは見えません。</p>
  </div>
  <button class="primary" data-begin>${esc(ps[S.p])} さんがはじめる</button>`;
},

judge(){
  const c = S.cards[S.i], w = words(), m = MODES[S.mode];
  const who = S.online ? myName() : players()[S.p];
  return `
  <div class="bar"><span class="who-chip"><i></i>${esc(who)}</span><span class="mono small muted">${S.i+1} / ${S.cards.length}${S.online ? ` <button class="link" data-leave style="margin-left:10px">出る</button>` : ''}</span></div>
  <div class="prog"><b style="width:${S.i / S.cards.length * 100}%"></b></div>
  <div class="stage">
    <div class="card" id="card">
      <div class="deck"><span>${m.name}</span><span class="mono">No.${String(S.i+1).padStart(2, '0')}</span></div>
      <div class="txt">${esc(c.t)}</div>
      <div class="tags">${c.mine ? '<span class="tag mine">じぶんたちのカード</span>' : m.talk ? '<span class="tag">話すお題</span>' : `<span class="tag">${WHEN[c.w][0]}</span>`}</div>
      <span class="stamp y">${w.yes}</span><span class="stamp n">${w.no}</span><span class="stamp m">${w.maybe}</span>
    </div>
  </div>
  <div class="votes">
    <button class="vbtn no" data-v="0"><span class="ic">×</span>${w.no}<small>← 左</small></button>
    <button class="vbtn maybe" data-v="1"><span class="ic">△</span>${w.maybe}<small>↑ 上</small></button>
    <button class="vbtn yes" data-v="2"><span class="ic">○</span>${w.yes}<small>右 →</small></button>
  </div>
  <div class="underline"><button class="link" data-undo ${S.i === 0 ? 'disabled style="visibility:hidden"' : ''}>← ひとつ戻る</button>
    <span class="small muted">あなたの答えは表示されません</span></div>
  ${S.online ? `<p class="waitline" id="others">${esc(othersLine())}</p>` : ''}`;
},

wait(){
  const o = O();
  return `
  <div class="bar"><button class="link" data-leave>${isHost() ? '部屋を閉じる' : '部屋を出る'}</button><span class="label mono">${esc(o.code)}</span></div>
  <div class="hand" style="flex:none;padding-block:16px"><div class="big-dots"><i></i><i></i></div>
    <p class="who" style="font-size:26px">みんなを待っています</p>
    <p class="muted small">全員が選び終わったら、せーので答え合わせ。</p></div>
  ${playerList(true)}
  ${isHost() ? '<p class="small muted">電波が切れて戻ってこない人は「外す」で、その人なしで答え合わせできます。</p>' : ''}`;
},

reveal(){
  return `<div class="reveal"><div class="merge"><i></i><i></i><i></i></div><p class="seeno">せーの…</p></div>`;
},

result(){
  const T = tally(), w = words(), m = MODES[S.mode], on = !!S.online, host = isHost();
  const meter = r => `<span class="meter" aria-label="${w.yes}${r.yes}・${w.maybe}${r.maybe}・パス${r.no}">${
    '<span class="y"></span>'.repeat(r.yes) + '<span class="m"></span>'.repeat(r.maybe) + '<span class="n"></span>'.repeat(r.no)}</span>`;
  const bar = `<div class="bar">${on ? `<button class="link" data-leave>${host ? '部屋を閉じる' : '部屋を出る'}</button>` : '<button class="link" data-go="home">ホーム</button>'}<span class="label">けっか</span></div>`;
  const again = on && !host
    ? '<p class="waitline">次のカードは、ホストが配ります。</p>'
    : `<div class="row2"><button class="${T.hits.length ? 'ghost' : 'primary'}" data-again>${T.hits.length ? 'もう一回' : 'カードを替えてもう一回'}</button>${host ? '<button class="ghost" data-tolobby>設定を変える</button>' : ''}</div>`;
  if (!T.hits.length) {
    return `${bar}
    <div class="empty">${dots(80)}
      <h2 class="display" style="font-size:24px;color:var(--ink)">今回は、かさならなかった。</h2>
      <p>どのカードにも、誰かのパスが入りました。<br>カードを替えて、もう一回やってみましょう。</p></div>
    ${T.near.length ? `<div class="label">おしかったカード（パスが1人だけ）</div>
      <div class="list">${T.near.map(r => `<div class="li"><span class="t">${esc(r.c.t)}</span>${meter(r)}</div>`).join('')}</div>` : ''}
    ${again}`;
  }
  const top = T.tops[S.tie % T.tops.length];
  const perfect = top.yes === T.n;
  const rest = T.hits.filter(h => h !== top);
  S.last = {card:top.c.t, mode:S.mode, players:players()};
  return `${bar}
  <section class="hit screen-in">
    <div class="orbs"><i></i><i></i></div>
    <p class="kicker">${perfect ? `全員が「${w.yes}」で一致！` : m.talk ? 'このお題で話そう' : 'かさなった！'}</p>
    <div class="card">
      <div class="deck"><span>${m.talk ? 'これから話すこと' : 'これから、やること'}</span><span class="mono">${T.n}人</span></div>
      <div class="txt">${esc(top.c.t)}</div>
      <div class="underline">${meter(top)}<span class="small muted mono">${w.yes} ${top.yes}・${w.maybe} ${top.maybe}</span></div>
    </div>
    ${T.tops.length > 1 ? `<p class="note">同点が${T.tops.length}枚。カサナルがひとつ選びました。${!on || host ? '<button class="link" data-tie style="color:var(--blue)">ほかの同点にする</button>' : ''}</p>` : ''}
  </section>
  <button class="primary" data-keep>${m.talk ? 'これで話す' : 'これにする'}</button>
  <div class="stats">
    <div class="stat"><div class="k">みんなのノリ度</div><div class="v">${T.vibe}<span class="small">%</span></div></div>
    <div class="stat"><div class="k">かさなったカード</div><div class="v">${T.hits.length}<span class="small"> / ${S.cards.length}枚</span></div></div>
    ${T.split && T.split.spread > 0 ? `<div class="stat" style="grid-column:1/-1"><div class="k">いちばん意見が割れたカード</div><div class="d">${esc(T.split.c.t)}</div></div>` : ''}
  </div>
  ${rest.length ? `<div class="label">ほかにかさなったカード</div>
  <div class="list">${rest.map(r => `<div class="li"><span class="t">${esc(r.c.t)}<br>${meter(r)}</span><button class="pick" data-pick="${r.i}">これにする</button></div>`).join('')}</div>` : ''}
  ${again}
  <button class="ghost" data-copy>結果をコピー</button>`;
},

keep(){
  const L = S.last, m = MODES[L.mode];
  return `
  <div class="bar"><button class="link" data-go="result">← けっかへ</button><span class="label">ノートに残す</span></div>
  <div class="entry">
    <div class="top"><span class="mono">${today()}</span><span>${m.name}</span></div>
    <div class="c">${esc(L.card)}</div>
    <div class="m">${L.players.map(esc).join('・')}</div>
  </div>
  <div class="sec"><label class="label" for="memo">ひとこと（あとで書いてもOK）</label>
    <textarea id="memo" placeholder="${m.talk ? '話してみて、意外だったこと' : 'どこで、どうだった？'}"></textarea></div>
  <button class="primary" data-save>思い出ノートに残す</button>
  <button class="ghost" data-go="${S.online ? 'result' : 'home'}">${S.online ? '残さずにもどる' : '残さずにホームへ'}</button>`;
},

notes(){
  const notes = store.get(NOTES, []);
  return `
  <div class="bar"><button class="link" data-go="home">← もどる</button><span class="label">思い出ノート</span></div>
  <h2 class="display" style="font-size:24px">10年後に読み返す、<br>みんなの「これから」。</h2>
  ${notes.length ? notes.map(n => `
    <article class="entry">
      <div class="top"><span class="mono">${esc(n.date)}</span><span>${esc((MODES[n.mode] || {}).name || '')}</span></div>
      <div class="c">${esc(n.card)}</div>
      <div class="m">${n.players.map(esc).join('・')}</div>
      ${n.memo ? `<div class="memo">${esc(n.memo)}</div>` : ''}
      <div class="acts">
        <button class="pill ${n.done ? 'done' : ''}" data-done="${esc(n.id)}">${n.done ? '✓ やった！' : 'まだ'}</button>
        <button class="pill danger" data-rm="${esc(n.id)}">けす</button>
      </div>
    </article>`).join('') : `
    <div class="empty">${dots(80)}
      <p>まだ何も残っていません。<br>ゲームで決まったお題を「これにする」で記録すると、ここに並びます。</p>
      <button class="ghost" data-go="home" style="width:auto">ゲームをはじめる</button></div>`}`;
},
};

/* ───────── 描画とイベント ───────── */
function render(){
  const s = S.screen;
  if (s === 'judge' && !S.cards[S.i]) S.screen = 'home';
  if ((s === 'result' || s === 'reveal') && !S.counts.length) S.screen = 'home';
  if (s === 'keep' && !S.last) S.screen = 'home';
  if ((s === 'lobby' || s === 'wait') && !S.online) S.screen = 'home';
  app.innerHTML = SCREENS[S.screen]();
  app.classList.remove('screen-in'); void app.offsetWidth; app.classList.add('screen-in');
  if (S.screen === 'judge') bindSwipe();
  if (S.screen === 'reveal') setTimeout(() => { if (S.screen === 'reveal') go('result'); }, reduce ? 300 : 1700);
}

function syncInputs(){
  app.querySelectorAll('[data-name]').forEach(el => S.names[+el.dataset.name] = el.value);
  const c = document.getElementById('custom'); if (c) S.custom = c.value;
  const n = document.getElementById('myname'); if (n) store.set(ME, cleanName(n.value));
}

app.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.name !== undefined) S.names[+t.dataset.name] = t.value;
  if (t.id === 'custom') S.custom = t.value;
  if (t.id === 'code') t.value = t.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});
app.addEventListener('change', e => { if (e.target.id === 'custom' && isHost()) broadcastLobby(); });

app.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  const d = b.dataset;
  if (d.go) { if (d.go === 'online') S.onlineErr = ''; return go(d.go); }
  if (d.mode) {
    S.mode = d.mode; const m = MODES[d.mode];
    const saved = store.get(NAMES, []);
    const n = m.max || Math.max(m.def, Math.min(saved.length, 10));
    S.names = Array.from({length:n}, (_, i) => saved[i] || '');
    return go('setup');
  }
  if (d.add !== undefined) { syncInputs(); S.names.push(''); render(); const ins = app.querySelectorAll('[data-name]'); ins[ins.length-1].focus(); return; }
  if (d.del !== undefined) { syncInputs(); S.names.splice(+d.del, 1); return render(); }
  if (d.when !== undefined) { syncInputs(); S.when = +d.when; if (isHost()) broadcastLobby(); return render(); }
  if (d.per) { syncInputs(); S.per = +d.per; if (isHost()) broadcastLobby(); return render(); }
  if (d.start !== undefined) {
    syncInputs();
    const keepNames = store.get(NAMES, []);
    S.names.forEach((n, i) => { if (n.trim()) keepNames[i] = n.trim(); });
    store.set(NAMES, keepNames.slice(0, 10));
    deal(); return go('hand');
  }
  if (d.quit !== undefined) return go('home');
  if (d.begin !== undefined) { S.i = 0; return go('judge'); }
  if (d.v) return vote(+d.v);
  if (d.undo !== undefined) {
    if (S.i > 0) { S.i--; S.votes[S.p].length = S.i; if (S.online) sendProg(); render(); }
    return;
  }
  if (d.tie !== undefined) { S.tie++; if (isHost()) net.broadcast({t:'tie', n:S.tie}); return render(); }
  if (d.pick) {
    S.last = {card:S.cards[+d.pick].t, mode:S.mode, players:players()};
    return go('keep');
  }
  if (d.keep !== undefined) return go('keep');
  if (d.again !== undefined) { if (isHost()) return hostStart(); deal(); return go('hand'); }
  if (d.copy !== undefined) return copyResult();
  if (d.save !== undefined) {
    const memo = (document.getElementById('memo') || {}).value || '';
    const notes = store.get(NOTES, []);
    notes.unshift({id:Date.now().toString(36), date:today(), mode:S.last.mode, card:S.last.card, players:S.last.players, memo:memo.trim(), done:false});
    store.set(NOTES, notes);
    toast('ノートに残しました');
    return go(S.online ? 'result' : 'notes');
  }
  if (d.done) {
    const notes = store.get(NOTES, []); const n = notes.find(x => x.id === d.done);
    if (n) { n.done = !n.done; store.set(NOTES, notes); }
    return render();
  }
  if (d.rm) {
    if (!b.classList.contains('arm')) { b.classList.add('arm'); b.textContent = 'もう一度押すと消えます'; setTimeout(() => { if (b.isConnected) { b.classList.remove('arm'); b.textContent = 'けす'; } }, 2500); return; }
    store.set(NOTES, store.get(NOTES, []).filter(x => x.id !== d.rm));
    toast('消しました'); return render();
  }
  /* オンライン */
  if (d.create !== undefined) { syncInputs(); return hostCreate(); }
  if (d.join !== undefined) {
    syncInputs();
    const code = (document.getElementById('code') || {}).value || '';
    if (code.length !== 5) { S.onlineErr = '合言葉は5文字です。'; return render(); }
    return guestJoin(code);
  }
  if (d.leave !== undefined) {
    if (!b.classList.contains('arm') && O() && !['lobby','connecting'].includes(O().phase)) { b.classList.add('arm'); b.textContent = 'もう一度押すと出ます'; return; }
    return leaveOnline(isHost() ? '部屋を閉じました' : '部屋を出ました');
  }
  if (d.setmode) { syncInputs(); S.mode = d.setmode; broadcastLobby(); return render(); }
  if (d.ostart !== undefined) { syncInputs(); return hostStart(); }
  if (d.tolobby !== undefined) { O().phase = 'lobby'; broadcastLobby(); return go('lobby'); }
  if (d.kick) {
    if (!b.classList.contains('arm')) { b.classList.add('arm'); b.textContent = 'もう一度で外す'; return; }
    net.send(d.kick, {t:'reject', reason:'kicked'}); net.drop(d.kick); return hostLeave(d.kick);
  }
  if (d.copylink !== undefined) return copyText(roomUrl(O().code), 'リンクをコピーしました');
  if (d.share !== undefined) {
    const url = roomUrl(O().code);
    navigator.share({title:'カサナル', text:`カサナルで一緒に「これからやること」を決めよう。合言葉は ${O().code}`, url}).catch(() => {});
  }
});

function vote(v, dir){
  if (S.screen !== 'judge' || vote.busy) return;
  S.votes[S.p][S.i] = v;
  const card = document.getElementById('card');
  const next = () => {
    vote.busy = false;
    if (S.screen !== 'judge') return;
    S.i++;
    if (S.online) { sendProg(); return S.i < S.cards.length ? render() : submitVotes(); }
    if (S.i < S.cards.length) return render();
    S.p++; S.i = 0;
    if (S.p < players().length) return go('hand');
    finishLocal();
  };
  if (reduce || !card) return next();
  vote.busy = true;
  card.classList.remove('drag');
  card.style.transform = '';
  card.classList.add(dir || (v === 2 ? 'fly-r' : v === 0 ? 'fly-l' : 'fly-u'));
  setTimeout(next, 200);
}

function bindSwipe(){
  const card = document.getElementById('card'); if (!card) return;
  const st = {y:card.querySelector('.stamp.y'), n:card.querySelector('.stamp.n'), m:card.querySelector('.stamp.m')};
  let x0, y0, dx = 0, dy = 0, on = false;
  card.addEventListener('pointerdown', e => { on = true; x0 = e.clientX; y0 = e.clientY; dx = dy = 0; card.classList.add('drag'); card.setPointerCapture(e.pointerId); });
  card.addEventListener('pointermove', e => {
    if (!on) return;
    dx = e.clientX - x0; dy = e.clientY - y0;
    card.style.transform = `translate(${dx}px,${Math.min(dy, 40)}px) rotate(${dx/18}deg)`;
    st.y.style.opacity = Math.max(0, Math.min(1, dx/90));
    st.n.style.opacity = Math.max(0, Math.min(1, -dx/90));
    st.m.style.opacity = Math.abs(dx) < 50 ? Math.max(0, Math.min(1, -dy/90)) : 0;
  });
  const end = () => {
    if (!on) return; on = false;
    if (dx > 90) return vote(2, 'fly-r');
    if (dx < -90) return vote(0, 'fly-l');
    if (dy < -90 && Math.abs(dx) < 60) return vote(1, 'fly-u');
    card.classList.remove('drag'); card.style.transform = '';
    Object.values(st).forEach(s => s.style.opacity = 0);
  };
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', end);
}

document.addEventListener('keydown', e => {
  if (S.screen !== 'judge' || e.target.closest('input,textarea')) return;
  if (e.key === 'ArrowRight') vote(2);
  if (e.key === 'ArrowLeft') vote(0);
  if (e.key === 'ArrowUp') { e.preventDefault(); vote(1); }
});

function copyText(text, okMsg){
  const fallback = () => {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch(e){}
    ta.remove(); toast(ok ? okMsg : 'コピーできませんでした');
  };
  try { navigator.clipboard.writeText(text).then(() => toast(okMsg), fallback); } catch(e) { fallback(); }
}
function copyResult(){
  const T = tally(), w = words(), m = MODES[S.mode];
  if (!T.hits.length) return copyText(`【カサナル／${m.name}】${T.n}人で${S.cards.length}枚を選んだけど、今回はかさならなかった！`, 'コピーしました');
  const top = T.tops[S.tie % T.tops.length];
  copyText(`【カサナル／${m.name}】${T.n}人で${S.cards.length}枚から選んだ結果\n${m.talk ? 'これから話すこと' : 'これから、やること'}：${top.c.t}\n（${w.yes}${top.yes}・${w.maybe}${top.maybe}／ノリ度${T.vibe}%）`, 'コピーしました');
}

window.addEventListener('pagehide', e => { if (!e.persisted) closeNet(); });

if (roomParam) S.screen = 'online';
render();
})();
