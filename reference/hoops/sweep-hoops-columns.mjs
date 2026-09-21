import { BOARDS } from '../../skeeball/js/boards.js';
import { engineFor, loadEngine } from '../../skeeball/js/engines.js';
import { writeFileSync } from 'fs';
const X = 1.00/6.875, COLS=7, PITCH=1.30, RIM=0.5;
const BOARD_W=(COLS-1)*PITCH+2*RIM;
const arg=k=>process.argv.find(a=>a.startsWith('--'+k+'='))?.split('=')[1];
const AIM_MAX=Number(arg('aim')??0.45), CURVE=arg('curve')?Number(arg('curve')):undefined;
const ROWV=Number(arg('rowv')??9.2875);
const MINS=arg('mins')?Number(arg('mins')):undefined, MAXS=arg('maxs')?Number(arg('maxs')):undefined;
const WREST=arg('wallrest')?Number(arg('wallrest')):undefined;
const POWERS=21, AIMS=41;
const base=BOARDS.find(b=>b.id==='basketball');
const board=structuredClone({...base,cups:undefined,arrangement:undefined});
board.id='c4hoops'; delete board.cups; delete board.arrangement;
const g=board.geom;
g.boardW=X*BOARD_W; g.aimMax=AIM_MAX; if(CURVE!==undefined) g.aimCurve=CURVE;
if(MINS!==undefined) g.minSpeed=MINS; if(MAXS!==undefined) g.maxSpeed=MAXS;
if(WREST!==undefined) g.mat.wallRest=WREST;
g.holes={};
for(let i=0;i<COLS;i++) g.holes['h'+(i+1)]={u:X*((i-(COLS-1)/2)*PITCH),v:X*ROWV,r:X*RIM,collarH:X*0.875,value:i+1};
await loadEngine('basketball');
const {physics:{simulateThrow}}=engineFor('basketball');
const grid=[];
for(let p=0;p<POWERS;p++){
  const power=p/(POWERS-1), row=[];
  for(let a=0;a<AIMS;a++){
    const aim=-1+(2*a)/(AIMS-1);
    let r; try{r=simulateThrow(board,{power,aim});}catch{row.push(0);continue;}
    const h=r&&r.outcome&&r.outcome.hole;
    row.push(h&&g.holes[h]?Number(h.slice(1)):0);
  }
  grid.push({power,row});
}
writeFileSync(arg('out')||'/tmp/claude-0/-home-user-game-hub/debe9678-0661-5132-8665-c2dfba450c22/scratchpad/grid.json',
  JSON.stringify({AIM_MAX,CURVE,ROWV,MINS:g.minSpeed,MAXS:g.maxSpeed,WREST:g.mat.wallRest,POWERS,AIMS,BOARD_W,grid}));
console.log('done aim',AIM_MAX,'curve',CURVE,'rowv',ROWV);
