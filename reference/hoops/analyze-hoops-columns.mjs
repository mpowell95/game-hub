import { readFileSync } from 'fs';
const f=process.argv[2]||'/tmp/claude-0/-home-user-game-hub/debe9678-0661-5132-8665-c2dfba450c22/scratchpad/grid.json';
const {AIM_MAX,CURVE,ROWV,MINS,MAXS,WREST,AIMS,BOARD_W,grid}=JSON.parse(readFileSync(f,'utf8'));
console.log(`boardW ${BOARD_W}X  aimMax ${AIM_MAX}  hoop row v=${ROWV}X  speed ${MINS}-${MAXS}  wallRest ${WREST}${CURVE!==undefined?'  aimCurve '+CURVE:'  aimCurve 2 (default)'}`);
console.log(`\nEach row is ONE power. Columns are aim -1 .. +1. Digit = hoop it went in, . = no basket.\n`);
const glyph=v=>v?String(v):'.';

const meanAim=new Map(), allByHoop=new Map();
let liveRows=0;
for(const {power,row} of grid){
  const scored=row.filter(Boolean).length;
  if(scored) liveRows++;
  // inversions among scoring samples, left to right: 0 = perfectly ordered
  const seq=[]; row.forEach((h,i)=>{ if(h) seq.push(h); });
  let inv=0; for(let i=0;i<seq.length;i++) for(let j=i+1;j<seq.length;j++) if(seq[j]<seq[i]) inv++;
  const pairs=seq.length*(seq.length-1)/2;
  const order=pairs?(1-inv/pairs):null;   // 1.0 = every pair in left-to-right order
  row.forEach((h,i)=>{ if(h){ const aim=-1+(2*i)/(AIMS-1); (allByHoop.get(h)??allByHoop.set(h,[]).get(h)).push(aim);} });
  console.log(`p${power.toFixed(2)}  ${row.map(v=>v?String(v):'.').join('')}   ${String(scored).padStart(2)} in, ${new Set(seq).size} hoops${order!==null?`, order ${order.toFixed(2)}`:''}`);
}
console.log(`\npowers that score at all: ${liveRows} of ${grid.length}  (a dead dial is a spec failure on its own)`);
let clean=0;
for(const {row} of grid){
  const by=new Map();
  row.forEach((h,i)=>{ if(h) (by.get(h)??by.set(h,[]).get(h)).push(-1+(2*i)/(AIMS-1)); });
  if(by.size<5) continue;
  let ok=true,prev=-Infinity;
  for(const h of [...by.keys()].sort((x,y)=>x-y)){
    const arr=by.get(h), m=arr.reduce((s,v)=>s+v,0)/arr.length;
    if(m<prev) ok=false; prev=m;
  }
  if(ok) clean++;
}
console.log(`powers where aim picks the column cleanly (5+ hoops, mean aim strictly increasing): ${clean} of ${grid.length}`);
console.log(`\nmean aim per hoop - these must INCREASE left to right for aim to pick a column:`);
const ks=[...allByHoop.keys()].sort((a,b)=>a-b);
let mono=true, prev=-Infinity;
for(const h of ks){
  const a=allByHoop.get(h), m=a.reduce((x,y)=>x+y,0)/a.length;
  const sd=Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/a.length);
  if(m<prev) mono=false; prev=m;
  console.log(`   hoop ${h}: mean aim ${m>=0?' ':''}${m.toFixed(2)}   spread +/-${sd.toFixed(2)}   ${a.length} hits`);
}
console.log(`\nmean aim increases with hoop number: ${mono?'YES - aim selects the column':'NO'}`);
