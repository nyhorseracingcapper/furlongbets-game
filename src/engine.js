'use strict';
/* =============================================================================
 * Post Parade — server-authoritative race engine
 *   - Deterministic from a secret per-player/per-day seed (never sent to client)
 *   - Form-driven tick simulation -> Monte-Carlo true win/place/show chances
 *   - Pari-mutuel pools with NO TAKEOUT (pools pay out 100%)
 *   - Results are pre-rolled at card creation and only revealed as races are run
 * ========================================================================== */

/* ----------------------------- seeded RNG --------------------------------- */
function xmur3(str){let h=1779033703^str.length;for(let i=0;i<str.length;i++){
  h=Math.imul(h^str.charCodeAt(i),3432918353);h=(h<<13)|(h>>>19);}
  return function(){h=Math.imul(h^(h>>>16),2246822507);h=Math.imul(h^(h>>>13),3266489909);
    return (h^=h>>>16)>>>0;};}
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);
  t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function rngFromSeed(seedStr){const s=xmur3(String(seedStr));return mulberry32(s());}

function mkHelpers(rnd){
  const ri=(a,b)=>a+Math.floor(rnd()*(b-a+1));
  const pick=a=>a[Math.floor(rnd()*a.length)];
  const gauss=()=>{let u=0,v=0;while(u===0)u=rnd();while(v===0)v=rnd();
    return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);};
  return {ri,pick,gauss};
}

/* --------------------------- content pools -------------------------------- */
const NAME_A=["Midnight","Silver","Thunder","Lucky","Royal","Iron","Shadow","Golden","Wicked","Brave","Dixie","Stormy","Gallant","Velvet","Crimson","Coastal","Rapid","Noble","Smoke","Azure","Autumn","Diamond","Rebel","Granite","Holiday","Tiger","Montauk","Cosmic","Vanished","Quiet"];
const NAME_B=["Runner","Gallop","Bullet","Spirit","Baron","Comet","Star","Arrow","Majesty","Legacy","Thunder","Whisper","Crown","Flash","Glory","Secret","Express","Knight","Rocket","Monarch","Tempest","Heir","Blaze","Harbor","Fortune","Mischief","Cadence","Rush","Echo","Valor"];
const JOCK=["Varden","Calloway","Mercer","Dolan","Hartley","Benoit","Raskin","Teller","Okoye","Marsh","Delgado","Kincaid","Royce","Nunes","Sato","Briggs","Favreau","Ellison","Pryce","Vance"];
const TRN=["Hollister","Ashby","Maddox","Crane","Devlin","Whitlock","Ferraro","Granger","Bellamy","Noll","Trent","Ridley","Kemp","Osei","Vaughn","Larkin","Costa","Byrne","Hale","Maguire"];
const SILKS=["#d33","#2a7fd0","#e0a92b","#2fae5f","#9b59b6","#e8702a","#17a2b8","#d0507e","#5a7d2a","#c0392b","#34558b","#7f8c3a"];
const TRACKS=["Belmont","Saratoga","Keeneland","Santa Anita","Gulfstream","Churchill","Del Mar","Oaklawn"];
const SURF=[["Dirt","6f"],["Dirt","6½f"],["Dirt","7f"],["Dirt","1 mile"],["Dirt","1 1/16 mi"],["Turf","1 mile"],["Turf","1 1/8 mi"],["Turf","5½f"],["Tapeta","1 mile"],["Tapeta","6½f"]];
const CLASSES=["Md Sp Wt","Claiming $16k","Claiming $25k","Allowance N1X","Allowance N2X","Starter Opt. Clm","Listed Stakes","Grade 3 Stakes"];

/* --------------------------- economy / rules ------------------------------ */
const TK={win:0,place:0,show:0,exacta:0,trifecta:0,dd:0,p3:0,p4:0};          // NO TAKEOUT
const POOLBASE={win:26000,place:13000,show:7500,exacta:16000,trifecta:9500,dd:6500,p3:4200,p4:3000};
const SHARP=0.84;
const TICKS=54;
const START_BANKROLL=1000;
const NRACES=8;
const TYPES={
  win:{label:"Win",n:1,pool:"win"}, place:{label:"Place",n:1,pool:"place"}, show:{label:"Show",n:1,pool:"show"},
  exacta:{label:"Exacta",n:2,pool:"exacta"}, trifecta:{label:"Trifecta",n:3,pool:"trifecta"},
  dd:{label:"Daily Double",legs:2,pool:"dd"}, p3:{label:"Pick 3",legs:3,pool:"p3"}, p4:{label:"Pick 4",legs:4,pool:"p4"},
};

/* --------------------------- horse + race model --------------------------- */
function makeStyle(early,late){
  if(early>0.66&&late<0.45)return"E";
  if(early>0.58)return"EP";
  if(late>0.62&&early<0.5)return"S";
  if(late>0.5&&early<0.55)return"P";
  return early>=late?"EP":"P";
}
function makeHorse(pp,H){
  const {pick,gauss}=H, rnd=H.rnd, ri=H.ri;
  const cls=0.35+rnd()*0.6;
  const early=Math.min(1,Math.max(0,0.5+gauss()*0.3));
  const late=Math.min(1,Math.max(0,0.5+gauss()*0.3));
  const consistency=0.45+rnd()*0.5;
  const style=makeStyle(early,late);
  const form=[];for(let i=0;i<4;i++){const f=Math.max(1,Math.round(ri(1,10)-cls*5+gauss()*1.5));form.push(Math.min(12,f));}
  return {pp,name:pick(NAME_A)+" "+pick(NAME_B),jockey:pick(JOCK),trainer:pick(TRN),
    color:SILKS[(pp-1)%SILKS.length],cls,early,late,consistency,style,form,
    fig:Math.round(70+cls*32+gauss()*2),scratched:false};
}
function raceFactors(horses){
  let e=0,leadv=-1,second=-1,leadPP=null;
  for(const h of horses){const ev=(h.style==="E"?1:h.style==="EP"?0.6:h.style==="P"?0.2:0)*h.early;
    e+=ev;if(ev>leadv){second=leadv;leadv=ev;leadPP=h.pp;}else if(ev>second)second=ev;}
  const pressure=Math.min(1,Math.max(0,(e-0.9)/1.8));
  const lone=(leadv>0.55 && second<leadv*0.55);
  return {pressure,lone,leadPP};
}
function effort(style,p,F,isLone){
  let v;
  if(style==="E")  v=1.20-0.34*p - F.pressure*0.14*p + (isLone?0.10*(1-p):0);
  else if(style==="EP") v=1.12-0.16*p - F.pressure*0.07*p;
  else if(style==="P")  v=0.96+0.16*p-0.05*p*p + F.pressure*0.03*p;
  else                  v=0.80+0.52*p*p + F.pressure*0.12*p;
  return Math.max(0.55,v);
}
function runRace(horses,F,active,gauss,recordTL){
  const n=horses.length, dist=new Array(n).fill(0);
  const base=new Array(n),sig=new Array(n),dayForm=new Array(n),isLone=new Array(n);
  for(let i=0;i<n;i++){const h=horses[i];
    base[i]=1+(h.cls-0.5)*0.11; sig[i]=0.06+(1-h.consistency)*0.10;
    dayForm[i]=1+gauss()*(0.03+(1-h.consistency)*0.04); isLone[i]=(F.lone&&h.pp===F.leadPP);}
  const TL=recordTL?[]:null;
  for(let t=0;t<TICKS;t++){const p=(t+0.5)/TICKS;
    for(let i=0;i<n;i++){if(!active[i])continue;
      const e=effort(horses[i].style,p,F,isLone[i]);
      let v=base[i]*e*dayForm[i]*(1+gauss()*sig[i]); if(v<0)v=0; dist[i]+=v;}
    if(TL){const s=new Array(n);for(let i=0;i<n;i++)s[i]=dist[i];TL.push(s);}}
  const order=[];for(let i=0;i<n;i++)if(active[i])order.push(i);
  order.sort((a,b)=>dist[b]-dist[a]);
  return {dist,order,timeline:TL};
}
function monteCarlo(horses,F,active,gauss,iters){
  const n=horses.length,win=new Array(n).fill(0),plc=new Array(n).fill(0),shw=new Array(n).fill(0);
  for(let k=0;k<iters;k++){const r=runRace(horses,F,active,gauss,false),o=r.order;
    if(o[0]!=null)win[o[0]]++;
    for(let j=0;j<Math.min(2,o.length);j++)plc[o[j]]++;
    for(let j=0;j<Math.min(3,o.length);j++)shw[o[j]]++;}
  return {win:win.map(x=>x/iters),place:plc.map(x=>x/iters),show:shw.map(x=>x/iters)};
}
function dirichlet(n,rnd){const g=[];let s=0;for(let i=0;i<n;i++){const x=-Math.log(rnd());g.push(x);s+=x;}return g.map(x=>x/s);}

function buildRace(idx,H){
  const {ri,pick,gauss}=H, rnd=H.rnd;
  const n=ri(6,9);
  const horses=[],usedA=new Set(),usedB=new Set();
  for(let i=1;i<=n;i++){let h,t=0;
    do{h=makeHorse(i,H);t++;}while(t<12&&(usedA.has(h.name.split(" ")[0])||usedB.has(h.name.split(" ")[1])));
    usedA.add(h.name.split(" ")[0]);usedB.add(h.name.split(" ")[1]);horses.push(h);}
  const [surf,dist]=pick(SURF);
  const klass=CLASSES[Math.min(CLASSES.length-1,Math.max(0,Math.round((idx/7)*6+ri(-1,2))))];
  const active=horses.map(h=>!h.scratched);
  const F=raceFactors(horses);
  const probs=monteCarlo(horses,F,active,gauss,1600);
  const noise=dirichlet(n,rnd);
  const crowdWin=probs.win.map((p,i)=>Math.max(60,(SHARP*p+(1-SHARP)*noise[i])*POOLBASE.win));
  const psum=probs.place.reduce((a,b)=>a+b,0)||1, ssum=probs.show.reduce((a,b)=>a+b,0)||1;
  const crowdPlace=probs.place.map(p=>Math.max(40,(p/psum)*POOLBASE.place));
  const crowdShow=probs.show.map(p=>Math.max(30,(p/ssum)*POOLBASE.show));
  const ml=probs.win.map(p=>p>0?(1-TK.win)/p-1:99);                 // fair (no takeout) morning line
  const result=runRace(horses,F,active,gauss,true);                 // the race everyone watches (pre-rolled)
  return {idx,n,surf,dist,klass,horses,active,probs,
    crowd:{win:crowdWin,place:crowdPlace,show:crowdShow},
    ml,result};
}
function buildCard(seed,nraces){
  const rnd=rngFromSeed(seed), H=mkHelpers(rnd); H.rnd=rnd;
  const trackName=H.pick(TRACKS);
  const races=[];for(let i=0;i<(nraces||NRACES);i++)races.push(buildRace(i,H));
  return {trackName,races};
}

/* ------------------------------ odds helpers ------------------------------ */
function sum(a){return a.reduce((x,y)=>x+y,0);}
// live decimal WIN odds for a horse given current crowd + player stakes (no takeout)
function winOdds(race,i,playerWin){
  const pw=playerWin||[];
  const pool=sum(race.crowd.win)+sum(pw);
  const stake=race.crowd.win[i]+(pw[i]||0);
  if(stake<=0)return 99;
  return Math.max(0.05,(pool*(1-TK.win))/stake - 1);
}
function harv2(W,a,b){if(a===b)return 0;const d=1-W[a];return d<=0?0:W[a]*W[b]/d;}
function harv3(W,a,b,c){if(a===b||b===c||a===c)return 0;const d1=1-W[a],d2=1-W[a]-W[b];
  if(d1<=0||d2<=0)return 0;return W[a]*(W[b]/d1)*(W[c]/d2);}

/* ------------------------- single-race settlement ------------------------- */
// bets: {win:[perHorseStake], place:[], show:[], exactaCombos:{"a-b":stake}, trifectaCombos:{"a-b-c":stake}}
// returns board payoffs (per $2) + each winning bet's multiplier info
function settleRace(race, bets){
  const idxByPP={}; race.horses.forEach((h,i)=>idxByPP[h.pp]=i);
  const o=race.result.order, win=o[0], plc=o.slice(0,2), shw=o.slice(0,3);
  const pw=bets.win||[], pp=bets.place||[], ps=bets.show||[];
  // WIN
  const winPool=sum(race.crowd.win)+sum(pw), winNet=winPool*(1-TK.win);
  const winStake=race.crowd.win[win]+(pw[win]||0);
  const winMult=winStake>0?Math.max(1,winNet/winStake):1;
  // PLACE (two placers share pool after stakes returned)
  const placePool=sum(race.crowd.place)+sum(pp), placeNet=placePool*(1-TK.place);
  const plStake={}; plc.forEach(i=>plStake[i]=race.crowd.place[i]+(pp[i]||0));
  const plProfit=Math.max(0,placeNet - plc.reduce((a,i)=>a+plStake[i],0));
  const plMult={}; plc.forEach(i=>plMult[i]=plStake[i]>0?Math.max(1,(plStake[i]+plProfit/plc.length)/plStake[i]):1);
  // SHOW (top three)
  const showPool=sum(race.crowd.show)+sum(ps), showNet=showPool*(1-TK.show);
  const shStake={}; shw.forEach(i=>shStake[i]=race.crowd.show[i]+(ps[i]||0));
  const shProfit=Math.max(0,showNet - shw.reduce((a,i)=>a+shStake[i],0));
  const shMult={}; shw.forEach(i=>shMult[i]=shStake[i]>0?Math.max(1,(shStake[i]+shProfit/shw.length)/shStake[i]):1);
  // EXACTA
  const exKey=race.horses[win].pp+"-"+(plc[1]!=null?race.horses[plc[1]].pp:"");
  const exMult=comboMult("exacta",race,exKey,harv2(race.probs.win,win,plc[1]),bets.exactaCombos);
  // TRIFECTA
  const triKey=shw.map(i=>race.horses[i].pp).join("-");
  const triMult=comboMult("trifecta",race,triKey,harv3(race.probs.win,o[0],o[1],o[2]),bets.trifectaCombos);
  return {
    winPP:race.horses[win].pp, win2:winMult*2, winMult,
    placePPs:plc.map(i=>race.horses[i].pp), pl2:Object.fromEntries(plc.map(i=>[race.horses[i].pp,(plMult[i]||1)*2])), plMultByPP:Object.fromEntries(plc.map(i=>[race.horses[i].pp,plMult[i]||1])),
    showPPs:shw.map(i=>race.horses[i].pp), sh2:Object.fromEntries(shw.map(i=>[race.horses[i].pp,(shMult[i]||1)*2])), shMultByPP:Object.fromEntries(shw.map(i=>[race.horses[i].pp,shMult[i]||1])),
    exKey, exMult, ex2:exMult*2,
    triKey, triMult, tri2:triMult*2,
    orderPP:o.map(i=>race.horses[i].pp)
  };
}
function comboMult(type,race,key,p,playerCombos){
  const crowdPool=POOLBASE[type];
  const playerTotal=playerCombos?Object.values(playerCombos).reduce((a,b)=>a+b,0):0;
  const net=(crowdPool+playerTotal)*(1-TK[type]);
  const crowdCombo=Math.max(10,crowdPool*p);
  const playerCombo=(playerCombos&&playerCombos[key])||0;
  return Math.max(1,net/(crowdCombo+playerCombo));
}
// multi-race (dd/p3/p4) payoff multiplier given the winners of each leg and the pool
function multiMult(type, legWinProbs, playerStakeOnWinningCombo){
  const pool=POOLBASE[type], net=pool*(1-TK[type]);
  const p=legWinProbs.reduce((a,b)=>a*b,1);
  const crowdCombo=Math.max(8,pool*p);
  return Math.max(1, net/(crowdCombo+(playerStakeOnWinningCombo||0)));
}

/* ----------------- public card projection (safe for client) --------------- */
// strips results/probs/pools; includes display odds computed from current player stakes
function publicRace(race, playerBetsForRace){
  const pw=(playerBetsForRace&&playerBetsForRace.win)||[];
  return {
    idx:race.idx, n:race.n, surf:race.surf, dist:race.dist, klass:race.klass,
    horses:race.horses.map((h,i)=>({
      pp:h.pp, name:h.name, jockey:h.jockey, trainer:h.trainer, color:h.color,
      style:h.style, fig:h.fig, form:h.form, scratched:h.scratched,
      mlDec:round2(race.ml[i]), oddsDec:round2(winOdds(race,i,pw))
    }))
  };
}
function round2(x){return Math.round(x*100)/100;}

module.exports={
  rngFromSeed, buildCard, buildRace, settleRace, comboMult, multiMult,
  winOdds, harv2, harv3, publicRace, round2,
  TK, POOLBASE, TYPES, TICKS, START_BANKROLL, NRACES
};
