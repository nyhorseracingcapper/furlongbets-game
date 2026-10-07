'use strict';
/* Post Parade Daily — client. All money, odds and results are computed on the
   server; this file renders what the server returns and sends the player's bets. */

/* ------------------------------ helpers ---------------------------------- */
const root = document.getElementById('root');
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt = n => Math.round(n).toLocaleString();
const fmt2 = n => Number(n).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
let TOAST_T;
function toast(msg, err){ const t=$('toast'); t.textContent=msg; t.className='toast show'+(err?' err':'');
  clearTimeout(TOAST_T); TOAST_T=setTimeout(()=>t.className='toast',2400); }

let CSRF=null, ME=null, G=null, builder=null;

async function api(path, opts={}){
  const o={ method:opts.method||'GET', headers:{'Content-Type':'application/json'}, credentials:'same-origin' };
  if (o.method!=='GET'){ o.headers['X-CSRF-Token']=CSRF||''; o.body=JSON.stringify(opts.body||{}); }
  const res = await fetch('/api'+path, o);
  let data={}; try{ data=await res.json(); }catch(e){}
  if (!res.ok) throw Object.assign(new Error(data.error||'Request failed'), { status:res.status, data });
  return data;
}

/* ------------------------- odds formatting ------------------------------- */
const LADDER=[[0.05,"1/20"],[0.1,"1/10"],[0.2,"1/5"],[0.3,"3/10"],[0.4,"2/5"],[0.5,"1/2"],[0.6,"3/5"],[0.7,"7/10"],[0.8,"4/5"],[0.9,"9/10"],[1,"1/1"],[1.2,"6/5"],[1.4,"7/5"],[1.5,"3/2"],[1.6,"8/5"],[1.8,"9/5"],[2,"2/1"],[2.5,"5/2"],[3,"3/1"],[3.5,"7/2"],[4,"4/1"],[4.5,"9/2"],[5,"5/1"],[6,"6/1"],[7,"7/1"],[8,"8/1"],[9,"9/1"],[10,"10/1"],[12,"12/1"],[15,"15/1"],[20,"20/1"],[25,"25/1"],[30,"30/1"],[40,"40/1"],[50,"50/1"],[75,"75/1"],[99,"99/1"]];
function oddsStr(dec){ let best=LADDER[0]; for(const l of LADDER){ if(l[0]<=dec) best=l; else break; } return best[1]; }
const styleClass = s => s==="S"?"s":s==="P"?"p":s==="EP"?"ep":"";

/* ======================= canvas: stadium + horses ======================= */
function stadiumGeom(cx,cy,sx,rad){
  const straight=sx, turn=Math.PI*rad, perim=4*sx+2*turn;
  function at(d){ d=((d%perim)+perim)%perim;
    if(d<=straight)return {x:cx+d,y:cy+rad}; d-=straight;
    if(d<=turn){const th=(Math.PI/2)-(d/turn)*Math.PI; return {x:cx+sx+rad*Math.cos(th),y:cy+rad*Math.sin(th)};} d-=turn;
    if(d<=2*sx)return {x:cx+sx-d,y:cy-rad}; d-=2*sx;
    if(d<=turn){const th=(-Math.PI/2)-(d/turn)*Math.PI; return {x:cx-sx+rad*Math.cos(th),y:cy+rad*Math.sin(th)};} d-=turn;
    return {x:cx-sx+d,y:cy+rad}; }
  return {perim,at};
}
function rrp(ctx,x,y,w,h,r){r=Math.min(r,h/2,w/2);ctx.beginPath();ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
function arrowTri(ctx,x,y,dir,s){ctx.fillStyle="rgba(230,238,232,.45)";ctx.beginPath();
  ctx.moveTo(x+dir*s,y);ctx.lineTo(x-dir*s,y-s*0.68);ctx.lineTo(x-dir*s,y+s*0.68);ctx.closePath();ctx.fill();}
function drawStadium(ctx,cx,cy,sx,rad,bandW,isTurf,clearW,clearH,label){
  if(clearW)ctx.clearRect(0,0,clearW,clearH);
  const radOut=rad+bandW, DIRT="#4a3327", TURF="#355f3a", INFIELD="#0c131a", RAIL="#eef2f4";
  ctx.fillStyle=isTurf?TURF:DIRT; rrp(ctx,cx-(sx+radOut),cy-radOut,2*(sx+radOut),2*radOut,radOut);ctx.fill();
  ctx.fillStyle=INFIELD; rrp(ctx,cx-(sx+rad),cy-rad,2*(sx+rad),2*rad,rad);ctx.fill();
  ctx.strokeStyle=RAIL;ctx.lineWidth=2; rrp(ctx,cx-(sx+rad),cy-rad,2*(sx+rad),2*rad,rad);ctx.stroke();
  ctx.strokeStyle="rgba(255,255,255,.14)";ctx.lineWidth=1.3; rrp(ctx,cx-(sx+radOut),cy-radOut,2*(sx+radOut),2*radOut,radOut);ctx.stroke();
  const am=Math.max(5,bandW*0.3);
  arrowTri(ctx,cx+sx*0.25,cy+rad+bandW*0.5,1,am);
  arrowTri(ctx,cx-sx*0.25,cy-rad-bandW*0.5,-1,am);
  if(label){ctx.fillStyle="#c6d2c9";ctx.font="700 10px Oswald, sans-serif";ctx.textAlign="left";ctx.textBaseline="alphabetic";
    ctx.fillText(label,cx-(sx+radOut),cy-radOut-5);}
  const yIn=cy+rad, yBot=cy+radOut, yLab=yBot+13;
  ctx.strokeStyle=RAIL;ctx.lineWidth=2.4;ctx.beginPath();ctx.moveTo(cx,yIn);ctx.lineTo(cx,yBot);ctx.stroke();
  ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(cx,yBot);ctx.lineTo(cx,yLab-5);ctx.stroke();
  ctx.fillStyle="#9fb0a6";ctx.font="700 9px Oswald, sans-serif";ctx.textAlign="center";ctx.textBaseline="alphabetic";ctx.fillText("WIRE",cx,yLab+3);
}
function drawDot(ctx,x,y,color,num,leader,rr){
  rr=rr||9;
  if(leader){ctx.beginPath();ctx.arc(x,y,rr+3,0,7);ctx.strokeStyle="#ffce6b";ctx.lineWidth=2;ctx.stroke();}
  ctx.beginPath();ctx.arc(x,y,rr,0,7);ctx.fillStyle=color;ctx.fill();
  ctx.lineWidth=1.3;ctx.strokeStyle="rgba(255,255,255,.78)";ctx.stroke();
  ctx.font=`700 ${Math.round(rr*1.18)}px Oswald, sans-serif`;ctx.textAlign="center";ctx.textBaseline="middle";
  ctx.lineWidth=2.6;ctx.strokeStyle="rgba(0,0,0,.55)";ctx.strokeText(num,x,y+0.5);
  ctx.fillStyle="#fff";ctx.fillText(num,x,y+0.5);
}
// data: {timeline:[tick][i], horses:[{pp,color}], surf}
function drawRunningLine(cv, data){
  const ctx=cv.getContext("2d"), W=cv.clientWidth||600;
  const TL=data.timeline, n=data.horses.length, TICKS=TL.length;
  const cols=W<560?1:3, miniW=W/cols, miniH=cols===1?120:Math.min(156,miniW*0.46), H=cols===1?miniH*3:miniH;
  cv.width=W*devicePixelRatio;cv.height=H*devicePixelRatio;
  ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);ctx.clearRect(0,0,W,H);
  const isTurf=(data.surf||'').toLowerCase().indexOf('turf')>=0;
  const maxFinal=Math.max(...TL[TICKS-1]);
  [["1ST CALL",0.30],["2ND CALL",0.62],["FINISH",1.0]].forEach((c,ci)=>{
    const col=cols===1?0:ci,row=cols===1?ci:0,bx=col*miniW,by=row*miniH;
    const cx=bx+miniW/2, cy=by+miniH*0.5;
    const bandW=Math.min(Math.max(10,5+n*2.3),miniH*0.26);
    const rad=Math.min(miniH*0.5-bandW-18,miniH*0.30);
    const sx=Math.max(12,miniW*0.5-(rad+bandW)-12);
    drawStadium(ctx,cx,cy,sx,rad,bandW,isTurf,0,0,c[0]);
    const ti=Math.min(TICKS-1,Math.round(c[1]*(TICKS-1)));
    let lead=-1,best=-1;for(let i=0;i<n;i++){if(TL[ti][i]>best){best=TL[ti][i];lead=i;}}
    for(let i=0;i<n;i++){ const cf=Math.max(0,Math.min(1,TL[ti][i]/maxFinal));
      const rl=rad+(i+1)/(n+1)*bandW, g=stadiumGeom(cx,cy,sx,rl);
      const p=g.at((0.045+cf*(1-0.045))*g.perim);
      drawDot(ctx,p.x,p.y,data.horses[i].color,data.horses[i].pp,i===lead,Math.max(6,bandW*0.5)); }
  });
}

/* live race animation driven by the server's timeline */
let ANIM=null;
function animateRace(cv, data, onDone){
  const ctx=cv.getContext("2d");
  const H=360; function size(){cv.width=cv.clientWidth*devicePixelRatio;cv.height=H*devicePixelRatio;
    ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);} size();
  const W=cv.clientWidth, cx=W/2, cy=H/2;
  const TL=data.timeline, n=data.horses.length, TICKS=TL.length;
  const maxFinal=Math.max(...TL[TICKS-1]);
  const isTurf=(data.surf||'').toLowerCase().indexOf('turf')>=0;
  const bandW=Math.min(Math.max(26,10+n*6),H*0.42);
  const rad=Math.min(H*0.5-bandW-16,H*0.33);
  const sx=Math.max(24,W*0.5-(rad+bandW)-18);
  const startS=0.045;
  const laneGeom=i=>stadiumGeom(cx,cy,sx,rad+(i+1)/(n+1)*bandW);
  const ptUnder=(cf,i)=>{const g=laneGeom(i);const p=g.at((startS+cf*(1-startS))*g.perim);return [p.x,p.y];};
  const drawBG=()=>drawStadium(ctx,cx,cy,sx,rad,bandW,isTurf,W,H,null);
  const lerp=(e,i)=>{const tf=e*(TICKS-1),ti=Math.max(0,Math.floor(tf)),fr=tf-ti;
    return TL[ti][i]+(TL[Math.min(TICKS-1,ti+1)][i]-TL[ti][i])*fr;};
  const reduce=matchMedia("(prefers-reduced-motion:reduce)").matches, DUR=6200, t0=performance.now();
  const callPts=[[0.25,"1/4"],[0.5,"1/2"],[0.72,"STR"]]; let called={};
  const dotR=Math.max(7,Math.min(12,bandW*0.42));
  function frame(now){
    const prog=reduce?1:Math.max(0,Math.min(1,(now-t0)/DUR)), e=prog;
    drawBG();
    const order=[]; for(let i=0;i<n;i++) order.push([i,lerp(e,i)/maxFinal]);
    order.sort((a,b)=>b[1]-a[1]); const lead=order.length?order[0][0]:-1;
    for(let i=0;i<n;i++){ const cf=Math.max(0,Math.min(1,lerp(e,i)/maxFinal)); const [x,y]=ptUnder(cf,i);
      drawDot(ctx,x,y,data.horses[i].color,data.horses[i].pp,i===lead,dotR); }
    for(const [cp,lab] of callPts){ if(e>=cp&&!called[lab]){ called[lab]=1;
      const names=order.slice(0,3).map(o=>"#"+data.horses[o[0]].pp);
      const nm=data.horses[order[0][0]].name;
      $('callt').textContent = lab==="1/4" ? `Away cleanly — ${nm} (${names[0]}) breaks on top, ${names[1]} and ${names[2]} in behind.`
        : lab==="1/2" ? `To the half — ${names[0]} leads, ${names[1]} applying pressure.`
        : `Into the stretch — ${names[0]} in command, ${names[1]} rallying!`;
      $('callq').textContent=lab; }}
    if(prog<1){ ANIM=requestAnimationFrame(frame); } else finish();
  }
  function finish(){
    drawBG();
    data.orderIdx.forEach((i,k)=>{ const cf=k===0?1:Math.max(0.88,1-(TL[TICKS-1][data.orderIdx[0]]-TL[TICKS-1][i])/TL[TICKS-1][data.orderIdx[0]]*5);
      const [x,y]=ptUnder(Math.min(1,cf),i); drawDot(ctx,x,y,data.horses[i].color,data.horses[i].pp,k===0,dotR); });
    const w=data.horses[data.orderIdx[0]];
    const margin=data.margins[w.pp]!=null?0:0; const secPP=data.orderPP[1];
    const close=(data.margins[secPP]||0)<0.4;
    if(close && $('photo')){ $('photo').hidden=false; setTimeout(()=>{ if($('photo'))$('photo').hidden=true; onDone(); },1200); }
    else setTimeout(onDone, 500);
    if($('callt')){ $('callt').textContent=`${w.name} (#${w.pp}) wins it${close?' in a photo!':'!'}`; $('callq').textContent="FIN"; }
    const sk=$('skip'); if(sk) sk.style.display="none";
  }
  const sk=$('skip'); if(sk) sk.onclick=()=>{ if(ANIM)cancelAnimationFrame(ANIM); finish(); };
  ANIM=requestAnimationFrame(frame);
}

/* ============================ AUTH SCREEN ================================ */
function renderAuth(mode){
  mode=mode||'login';
  root.innerHTML=`<div class="authwrap"><div class="authcard">
    <div class="logo"><span class="dot"></span><h1>POST&nbsp;PARADE</h1></div>
    <div class="tag">Daily handicapping contest · furlongbets</div>
    <div class="tabs"><button data-m="login" class="${mode==='login'?'on':''}">Log in</button>
      <button data-m="signup" class="${mode==='signup'?'on':''}">Sign up</button></div>
    <div class="autherr" id="autherr"></div>
    <div class="field"><label>Username</label><input id="u" autocomplete="username" maxlength="20" placeholder="3–20 letters, numbers, _"></div>
    <div class="field"><label>Password</label><input id="p" type="password" autocomplete="${mode==='signup'?'new-password':'current-password'}" placeholder="at least 8 characters">
      ${mode==='signup'?'<div class="hint">Pick something unique — this is just a game login.</div>':''}</div>
    <button class="btn primary go" id="go">${mode==='signup'?'Create account & play':'Log in'}</button>
    <div class="authfoot">One free card per day · no takeout · compete for the highest all-time total.<br>Play money only — no real wagering, no cash value.</div>
  </div></div>`;
  root.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>renderAuth(b.dataset.m));
  const go=()=>submitAuth(mode);
  $('go').onclick=go;
  $('p').onkeydown=e=>{ if(e.key==='Enter')go(); };
  $('u').onkeydown=e=>{ if(e.key==='Enter')$('p').focus(); };
  $('u').focus();
}
async function submitAuth(mode){
  const username=$('u').value.trim(), password=$('p').value;
  const err=$('autherr'); err.className='autherr';
  try{
    const data=await api('/auth/'+(mode==='signup'?'signup':'login'),{method:'POST',body:{username,password}});
    ME=data.user; CSRF=data.csrf; await loadGame();
  }catch(e){ err.textContent=e.message; err.className='autherr show'; }
}

/* ============================== TOP BAR ================================= */
function topbar(){
  const pl = G ? (G.bankroll - G.startBankroll) : 0;
  return `<div class="topbar">
    <div class="brand"><span class="dot"></span>
      <div style="line-height:1.1"><b>POST&nbsp;PARADE</b><br><span>furlongbets · daily contest</span></div></div>
    <div class="sp"></div>
    <div class="meterbox">
      ${G&&!G.finished?`<div class="meter"><div class="k">Today P/L</div><div class="v sm" style="color:${pl>0?'var(--win)':pl<0?'var(--loss)':'var(--fg)'}">${pl>=0?'+':''}${fmt(pl)}</div></div>
      <div class="meter"><div class="k">Chips</div><div class="v">${fmt(G.bankroll)}</div></div>`:''}
      <button class="btn ghost sm" id="nav-lb">Leaderboard</button>
      <div class="meter" style="text-align:left"><div class="k">Signed in</div><div class="v sm">${esc(ME.username)}</div></div>
      <button class="btn ghost sm" id="nav-out">Log out</button>
    </div></div>`;
}
function wireTop(){
  $('nav-lb').onclick=showLeaderboard;
  $('nav-out').onclick=async()=>{ try{ await api('/auth/logout',{method:'POST'}); }catch(e){} ME=null;G=null; renderAuth('login'); };
}

/* ============================ GAME LOADING ============================== */
async function loadGame(){
  G = await api('/game/today');
  if (G.finished) return renderDone();
  builder = freshBuilder('win');
  renderBet();
}

/* ------------------------------ bet view -------------------------------- */
function raceHead(){ const r=G.race;
  return `<div class="rhead"><span class="rn">Race ${r.idx+1}</span>
    <span class="cond">${esc(G.trackName)} · ${esc(r.klass)}</span>
    <span class="pill"><b>${esc(r.dist)}</b> ${esc(r.surf)}</span>
    <span class="pill">${r.n} runners</span>
    <span class="pill">Race ${r.idx+1} of ${G.nraces}</span></div>`;
}
function programHTML(){ const r=G.race; let rows="";
  r.horses.forEach((h,i)=>{ const inslip=builderHas(h.pp);
    rows+=`<div class="horse${h.scratched?' scratched':''}${inslip?' inslip':''}" data-pp="${h.pp}">
      <div class="saddle" style="background:${h.color}">${h.pp}</div>
      <div class="hinfo"><div class="hname">${esc(h.name)}</div>
        <div class="hsub"><span class="style ${styleClass(h.style)}">${h.style}</span>
          <span>${esc(h.jockey)} · ${esc(h.trainer)}</span><span class="form">${h.form.join("-")}</span></div></div>
      <div class="hstat"><div class="odds mono">${h.scratched?'SCR':oddsStr(h.oddsDec)}</div>
        <div class="ml">ML ${oddsStr(h.mlDec)} · Fig <span class="sfig">${h.fig}</span></div></div>
      <div class="selnum">${inslip||''}</div></div>`; });
  return `<div class="panel"><div class="ph"><h2>Program</h2><span class="hint">tap a runner to bet</span></div><div class="prog">${rows}</div></div>`;
}
function renderBet(){
  root.innerHTML = topbar() + `<div class="wrap">${raceHead()}<div class="grid">${programHTML()}${slipHTML()}</div></div>`;
  wireTop(); wireBet();
}

/* ---------------------------- bet builder ------------------------------- */
const TYPES={ win:{label:"Win",n:1}, place:{label:"Place",n:1}, show:{label:"Show",n:1},
  exacta:{label:"Exacta",n:2}, trifecta:{label:"Trifecta",n:3},
  dd:{label:"Daily Double",legs:2}, p3:{label:"Pick 3",legs:3}, p4:{label:"Pick 4",legs:4} };
const AMOUNTS=[2,5,10,20,50];
function freshBuilder(type){ const T=TYPES[type];
  if(T.legs){const legs=[];for(let i=0;i<T.legs;i++)legs.push(new Set());return {type,legs,amount:2};}
  if(T.n>1){const pos=[];for(let i=0;i<T.n;i++)pos.push(new Set());return {type,pos,box:false,boxSet:new Set(),focus:0,amount:2};}
  return {type,picks:[],amount:2};
}
function exoticCombos(b,k){ const sets=b.box?Array(k).fill([...b.boxSet]):b.pos.map(s=>[...s]);
  if(sets.some(s=>!s.length))return []; const out=[];
  (function rec(d,used,cur){ if(d===k){out.push(cur.slice());return;}
    for(const pp of sets[d]){ if(used.has(pp))continue; used.add(pp);cur.push(pp);rec(d+1,used,cur);cur.pop();used.delete(pp);} })(0,new Set(),[]);
  return out; }
function builderCost(){ const b=builder,T=TYPES[b.type];
  if(T.legs){let c=1;for(const s of b.legs){if(!s.size)return 0;c*=s.size;}return c*b.amount;}
  if(T.n===1)return b.picks.length===1?b.amount:0;
  return exoticCombos(b,T.n).length*b.amount; }
function builderHas(pp){ const b=builder;if(!b)return false;const T=TYPES[b.type];
  if(T.legs)return b.legs[0].has(pp)?'1':false;
  if(T.n>1){ if(b.box)return b.boxSet.has(pp)?'B':false;
    const ps=[];b.pos.forEach((s,k)=>{if(s.has(pp))ps.push(k+1);});return ps.length?ps.join('·'):false;}
  return b.picks.indexOf(pp)>=0?'✓':false; }
function pos(k){return k===1?"1st":k===2?"2nd":k===3?"3rd":k+"th";}
function slipHTML(){ const b=builder,T=TYPES[b.type];
  let types="";for(const k in TYPES){ const dis=TYPES[k].legs&&(G.race.idx+TYPES[k].legs>G.nraces);
    types+=`<button class="type${b.type===k?' on':''}" data-type="${k}" ${dis?'disabled style="opacity:.3"':''}>${TYPES[k].label}</button>`; }
  let bd="";
  if(T.legs){ bd+=`<div class="bhint">Pick one or more in <b>each leg</b> (races ${G.race.idx+1}–${G.race.idx+T.legs}). More picks = more combos.</div><div class="legs">`;
    for(let L=0;L<T.legs;L++){ const lastRace=(L===0); const sel=b.legs[L];
      let chips=""; const horses = L===0?G.race.horses:null;
      if(horses){ horses.forEach(h=>{chips+=`<button class="nch${sel.has(h.pp)?' on':''}" data-leg="${L}" data-pp="${h.pp}" ${h.scratched?'disabled':''}>${h.pp}</button>`;}); }
      else { chips=`<span style="color:var(--dim);font-size:11.5px">runners shown when you reach Race ${G.race.idx+L+1}</span>`; }
      bd+=`<div class="leg"><div class="lh"><span>Leg ${L+1} — <b>Race ${G.race.idx+L+1}</b></span><span>${sel.size||0} picked</span></div><div class="legchips">${chips}</div></div>`; }
    bd+=`</div>`;
  } else if(T.n===1){ const p=b.picks[0]; const h=p?G.race.horses.find(x=>x.pp===p):null;
    bd+=`<div class="bhint">${h?`<b>#${p}</b> ${esc(h.name)}`:`Tap one runner to back it to <b>${T.label.toLowerCase()}</b>.`}</div>`;
  } else {
    bd+=`<div class="bhint">Pick one <b>or more</b> for <b>each finishing spot</b>. e.g. 2 in 1st <b>over</b> 4 in 2nd. Tapping the program adds to the highlighted spot.</div>`;
    bd+=`<div class="boxrow"><div class="switch${b.box?' on':''}" id="boxsw"><i></i></div><span>Box — one group, any order</span></div>`;
    if(b.box){ const sel=b.boxSet;let chips="";G.race.horses.forEach(h=>{chips+=`<button class="nch${sel.has(h.pp)?' on':''}" data-posx="box" data-pp="${h.pp}" ${h.scratched?'disabled':''}>${h.pp}</button>`;});
      bd+=`<div class="leg"><div class="lh"><span><b>Box</b> — any order</span><span>${sel.size} picked</span></div><div class="legchips">${chips}</div></div>`;
    } else { bd+=`<div class="legs">`;
      for(let k=0;k<T.n;k++){ const sel=b.pos[k],foc=b.focus===k; let chips="";
        G.race.horses.forEach(h=>{chips+=`<button class="nch${sel.has(h.pp)?' on':''}" data-posx="${k}" data-pp="${h.pp}" ${h.scratched?'disabled':''}>${h.pp}</button>`;});
        bd+=`<div class="leg${foc?' focus':''}" data-focus="${k}"><div class="lh"><span>${pos(k+1)} spot — <b>${sel.size||0}</b></span><span>${[...sel].map(p=>'#'+p).join(' ')||'any'}</span></div><div class="legchips">${chips}</div></div>`;}
      bd+=`</div>`; }
  }
  let amts="";AMOUNTS.forEach(a=>{amts+=`<button class="amt${b.amount===a?' on':''}" data-amt="${a}">${a}</button>`;});
  const cost=builderCost();
  const combos=(TYPES[b.type].n>1&&!TYPES[b.type].legs)?exoticCombos(b,TYPES[b.type].n).length:0;
  const est = cost<=0 ? 'build your bet above' : (combos?`${combos} combo${combos>1?'s':''} · pays pari-mutuel`:'pays pari-mutuel after the race');
  let tks="";const staged=G.staged||[];
  if(staged.length)staged.forEach(t=>{tks+=`<div class="tk"><div><div class="tkt">${esc(t.label)}</div><div class="tkd">${esc(t.detail)}</div></div><div class="tkc mono">${fmt(t.cost)}</div></div>`;});
  else tks=`<div class="emptyslip">No tickets yet. Build one and press <b>Place</b>.</div>`;
  const totalStaged=staged.reduce((a,t)=>a+t.cost,0);
  return `<div class="panel slip"><div class="ph"><h2>Bet Slip</h2><span class="hint">$2 base · chips</span></div>
    <div class="types">${types}</div>
    <div class="builder">${bd}<div class="amts">${amts}</div>
      <div class="costline"><span class="est">${est}</span><span>Cost <b class="mono">${fmt(cost)}</b></span></div>
      <button class="addbtn" id="placebtn" ${cost<=0||cost>G.bankroll?'disabled':''}>Place — ${fmt(cost)} chips</button></div>
    <div class="tickets">${tks}</div>
    <div class="slipfoot"><div class="row"><span>Staged this race</span><span class="v mono">${fmt(totalStaged)}</span></div>
      <button class="btn primary" style="width:100%" id="postbtn" ${staged.length?'':''}>Go to Post ▸</button></div></div>`;
}
function wireBet(){
  root.querySelectorAll('.type').forEach(b=>b.onclick=()=>{ if(b.disabled)return; builder=freshBuilder(b.dataset.type); renderBet(); });
  root.querySelectorAll('.horse').forEach(row=>row.onclick=()=>{ const pp=+row.dataset.pp; const h=G.race.horses.find(x=>x.pp===pp); if(h.scratched)return; addToBuilder(pp); renderBet(); });
  root.querySelectorAll('.nch').forEach(c=>c.onclick=()=>{ if(c.disabled)return; const pp=+c.dataset.pp;
    if(c.dataset.leg!==undefined){const s=builder.legs[+c.dataset.leg];s.has(pp)?s.delete(pp):s.add(pp);}
    else{const w=c.dataset.posx; if(w==='box'){const s=builder.boxSet;s.has(pp)?s.delete(pp):s.add(pp);} else {const k=+w;const s=builder.pos[k];s.has(pp)?s.delete(pp):s.add(pp);builder.focus=k;}}
    renderBet(); });
  root.querySelectorAll('[data-focus]').forEach(L=>L.onclick=ev=>{ if(ev.target.closest('.nch'))return; builder.focus=+L.dataset.focus; renderBet(); });
  const bx=$('boxsw'); if(bx)bx.onclick=()=>{builder.box=!builder.box;renderBet();};
  root.querySelectorAll('.amt').forEach(a=>a.onclick=()=>{builder.amount=+a.dataset.amt;renderBet();});
  const pb=$('placebtn'); if(pb)pb.onclick=placeBet;
  const post=$('postbtn'); if(post)post.onclick=goToPost;
}
function addToBuilder(pp){ const b=builder,T=TYPES[b.type];
  if(T.legs){const s=b.legs[0];s.has(pp)?s.delete(pp):s.add(pp);return;}
  if(T.n===1){b.picks=[pp];return;}
  const set=b.box?b.boxSet:b.pos[b.focus]; set.has(pp)?set.delete(pp):set.add(pp); }

async function placeBet(){
  const b=builder,T=TYPES[b.type]; const cost=builderCost();
  if(cost<=0||cost>G.bankroll)return;
  const body={type:b.type,amount:b.amount};
  if(T.legs)body.legs=b.legs.map(s=>[...s]);
  else if(T.n===1)body.picks=[b.picks[0]];
  else { body.box=b.box; if(b.box)body.boxSet=[...b.boxSet]; else body.spots=b.pos.map(s=>[...s]); }
  try{
    const d=await api('/game/bet',{method:'POST',body});
    G.bankroll=d.bankroll; G.staged=d.staged;
    if(d.race) G.race.horses=d.race;    // refreshed odds
    builder=freshBuilder(b.type); renderBet(); toast('Ticket placed');
  }catch(e){ toast(e.message,true); }
}

/* ------------------------------ run race -------------------------------- */
async function goToPost(){
  let d;
  try{ d=await api('/game/run',{method:'POST'}); }
  catch(e){ toast(e.message,true); return; }
  const r=d.result;
  // index->pp and colors (r.ppOrder[i] === horses[i].pp)
  const horses=r.ppOrder.map(pp=>{ const h=d.horses.find(x=>x.pp===pp); return {pp,color:h.color,name:h.name}; });
  const orderIdx=r.orderPP.map(pp=>r.ppOrder.indexOf(pp));
  const animData={ timeline:r.timeline, horses, surf:r.surf, orderPP:r.orderPP, orderIdx, margins:r.margins };
  root.innerHTML = topbar() + `<div class="wrap">${raceHeadRun(d)}
    <div class="trackwrap"><canvas id="track" height="360"></canvas><div class="photo" id="photo" hidden>PHOTO</div></div>
    <div class="call"><span class="q" id="callq">POST</span><span id="callt">They're in the gate…</span></div>
    <div class="racebuttons"><button class="btn ghost" id="skip">Skip to finish</button></div></div>`;
  wireTop();
  animateRace($('track'), animData, ()=>renderResults(d, animData));
}
function raceHeadRun(d){ return `<div class="rhead"><span class="rn">Race ${d.raceIdx}</span><span class="cond">${esc(G.trackName)}</span>
  <span class="pill">${esc(d.result.surf)}</span></div>`; }

function renderResults(d, animData){
  const pay=d.payoffs, order=d.result.orderPP, margins=d.result.margins;
  const byPP={}; animData.horses.forEach(h=>byPP[h.pp]=h);
  let rows="";
  order.forEach((pp,k)=>{ const h=byPP[pp];
    const wp=k===0?fmt2(pay.win2):"", pl=(pay.pl2[pp]!=null)?fmt2(pay.pl2[pp]):"", sh=(pay.sh2[pp]!=null)?fmt2(pay.sh2[pp]):"";
    rows+=`<tr class="${k===0?'win':''}"><td class="fin">${k+1}</td>
      <td><span class="saddle" style="background:${h.color};width:22px;height:22px;font-size:12px;display:inline-grid;vertical-align:middle">${pp}</span>
        <b style="margin-left:7px">${esc(h.name)}</b>
        <div class="hsub" style="margin-left:29px">${k===0?'winner':(margins[pp]||0).toFixed(1)+' back'}</div></td>
      <td class="pay">${wp}</td><td class="pay">${pl}</td><td class="pay">${sh}</td></tr>`; });
  const board=`<div class="panel"><div class="ph"><h2>Race ${d.raceIdx} — Official</h2><span class="hint">$2 payoffs</span></div>
    <table class="board"><tr><th></th><th>Runner</th><th style="text-align:right">Win</th><th style="text-align:right">Pl</th><th style="text-align:right">Sh</th></tr>${rows}</table>
    <div class="payoffs"><h3>Exotic Payoffs ($2)</h3>
      <div class="exrow"><span class="c">Exacta ${pay.exKey}</span><span class="p">${fmt2(pay.ex2)}</span></div>
      <div class="exrow"><span class="c">Trifecta ${pay.triKey}</span><span class="p">${fmt2(pay.tri2)}</span></div></div></div>`;
  let staked=0,ret=0,sk="";
  d.settled.forEach(s=>{ if(!s.alive){staked+=s.cost;ret+=s.payout;}
    sk+=`<div class="stk ${s.hit?'hit':'miss'}"><div class="d"><div class="tt">${esc(s.label)}</div><div class="dd">${esc(s.detail)}${s.note?' · '+esc(s.note):''}</div></div>
      <div class="r">${s.alive?'LIVE ▸':(s.payout>0?'+'+fmt(s.payout):'—')}</div></div>`; });
  if(!d.settled.length)sk=`<div class="emptyslip">No tickets on this race.</div>`;
  const netR=ret-staked;
  const settle=`<div class="panel"><div class="ph"><h2>Your Tickets</h2></div><div class="settle">${sk}</div>
    <div class="netbar"><span>This race</span><span class="v mono ${netR>0?'pos':netR<0?'neg':''}">${netR>=0?'+':''}${fmt(netR)}</span></div></div>`;
  const runline=`<div class="panel" style="margin-bottom:14px"><div class="ph"><h2>Running Line</h2>
      <span class="hint">${(d.result.surf||'').toLowerCase().indexOf('turf')>=0?'turf':'main track'} · position at each call</span></div>
    <div class="trackwrap" style="padding:12px 8px 6px"><canvas id="runline" style="width:100%;display:block"></canvas></div></div>`;
  const nextLabel = d.finished ? 'See your result & the leaderboard' : `Next: Race ${d.raceIdx+1} ▸`;
  root.innerHTML = topbar() + `<div class="wrap">${raceHeadRun(d)}${runline}<div class="results">${board}${settle}</div>
    <div class="racebuttons" style="margin-top:14px"><button class="btn primary" id="nextbtn">${nextLabel}</button></div></div>`;
  G.bankroll=d.bankroll;
  wireTop();
  drawRunningLine($('runline'), animData);
  $('nextbtn').onclick=async()=>{ if(d.finished){ await loadGame(); } else { await loadGame(); window.scrollTo({top:0,behavior:'smooth'}); } };
}

/* ------------------------------ done view ------------------------------- */
async function renderDone(){
  let lb; try{ lb=await api('/game/leaderboard'); }catch(e){ lb={allTime:[],today:[],myRank:'—',players:0}; }
  const score = G.score!=null ? G.score : G.bankroll;
  const net = score - G.startBankroll;
  root.innerHTML = topbar() + `<div class="wrap">
    <div class="panel"><div class="bigmsg">
      <h2>Today's card is in the books</h2>
      <p>You finished with <b style="color:var(--amber)">${fmt(score)}</b> chips${net>=0?` — up <b style="color:var(--win)">${fmt(net)}</b>`:` — down <b style="color:var(--loss)">${fmt(-net)}</b>`} from the ${fmt(G.startBankroll)} start. That score is locked into your all-time total. Come back tomorrow for a fresh card.</p>
      <div class="statrow">
        <div class="stat"><div class="k">Today's score</div><div class="v">${fmt(score)}</div></div>
        <div class="stat"><div class="k">All-time total</div><div class="v">${fmt(ME?ME.totalScore:0)}</div></div>
        <div class="stat"><div class="k">Your rank</div><div class="v">#${lb.myRank||'—'}</div></div>
      </div>
      <div class="racebuttons"><button class="btn primary" id="seelb">View leaderboard</button></div>
    </div></div>
    <div class="foot">Next card unlocks at midnight (${tzName()}). <b>Post Parade</b> is a free play-money game — no real wagering, no cash value.</div>
  </div>`;
  wireTop();
  $('seelb').onclick=showLeaderboard;
  // refresh ME totals
  try{ const me=await api('/auth/me'); ME=me.user; }catch(e){}
}
function tzName(){ try{ return Intl.DateTimeFormat().resolvedOptions().timeZone; }catch(e){ return 'local time'; } }

/* ----------------------------- leaderboard ------------------------------ */
async function showLeaderboard(){
  let lb; try{ lb=await api('/game/leaderboard'); }catch(e){ toast('Could not load leaderboard',true); return; }
  const allRows = lb.allTime.map((u,i)=>`<tr class="${ME&&u.username===ME.username?'me':''}">
    <td class="lbrank ${i<3?'g'+(i+1):''}">${i+1}</td><td>${esc(u.username)}</td>
    <td class="num">${fmt(u.total_score)}</td><td class="num">${u.days_played}</td><td class="num">${fmt(u.best_day)}</td></tr>`).join('')
    || `<tr><td colspan="5" style="color:var(--dim);text-align:center;padding:18px">No finished cards yet — be the first.</td></tr>`;
  const dayRows = lb.today.map((u,i)=>`<tr class="${ME&&u.username===ME.username?'me':''}">
    <td class="lbrank ${i<3?'g'+(i+1):''}">${i+1}</td><td>${esc(u.username)}</td><td class="num">${fmt(u.score)}</td></tr>`).join('')
    || `<tr><td colspan="3" style="color:var(--dim);text-align:center;padding:18px">No one has finished today's card yet.</td></tr>`;
  root.innerHTML = topbar() + `<div class="wrap">
    <div class="rhead"><span class="rn">Leaderboard</span><span class="cond">${lb.players||0} players · you're #${lb.myRank||'—'} all-time</span></div>
    <div class="lb">
      <div class="panel"><div class="ph"><h2>All-Time Total</h2><span class="hint">sum of every daily score</span></div>
        <table class="lbtable"><tr><th>#</th><th>Player</th><th class="num">Total</th><th class="num">Days</th><th class="num">Best</th></tr>${allRows}</table></div>
      <div class="panel"><div class="ph"><h2>Today</h2><span class="hint">best scores on today's card</span></div>
        <table class="lbtable"><tr><th>#</th><th>Player</th><th class="num">Score</th></tr>${dayRows}</table></div>
    </div>
    <div class="racebuttons" style="margin-top:14px"><button class="btn primary" id="back">${G&&!G.finished?'Back to my card':'Back'}</button></div>
  </div>`;
  wireTop();
  $('back').onclick=()=>{ if(G&&!G.finished) renderBet(); else renderDone(); };
}

/* -------------------------------- boot ---------------------------------- */
(async function boot(){
  try{
    const me=await api('/auth/me'); CSRF=me.csrf;
    if(me.user){ ME=me.user; await loadGame(); }
    else renderAuth('login');
  }catch(e){ renderAuth('login'); }
})();
