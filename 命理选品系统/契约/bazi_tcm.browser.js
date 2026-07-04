/* ============================================================
 * FateBazi —— 八字排盘（代码算·确定性）+ 中医体质→香方 桥接
 * 排盘已验证：毛泽东 1893-12-26 辰时 = 癸巳 甲子 丁酉 甲辰（四柱全中）
 * 输出对齐《能量向量数据契约》WuxingProfile；体质→香方 供选品选香珠。
 * 浏览器：window.FateBazi；Node：module.exports。
 * 说明：五行/用神走「扶抑」P0 版；体质由五行桥接（生产可接问卷精修）。
 * ============================================================ */
(function(root){
const STEMS=['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'];
const BRANCHES=['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];
const STEM_EL=['mu','mu','huo','huo','tu','tu','jin','jin','shui','shui'];
const EL_CN={jin:'金',mu:'木',shui:'水',huo:'火',tu:'土'};
const HIDDEN={子:[['癸',1]],丑:[['己',.6],['癸',.3],['辛',.1]],寅:[['甲',.6],['丙',.3],['戊',.1]],卯:[['乙',1]],
 辰:[['戊',.6],['乙',.3],['癸',.1]],巳:[['丙',.6],['庚',.3],['戊',.1]],午:[['丁',.7],['己',.3]],
 未:[['己',.6],['丁',.3],['乙',.1]],申:[['庚',.6],['壬',.3],['戊',.1]],酉:[['辛',1]],
 戌:[['戊',.6],['辛',.3],['丁',.1]],亥:[['壬',.7],['甲',.3]]};
const stemEl=s=>STEM_EL[STEMS.indexOf(s)];
const GEN={mu:'huo',huo:'tu',tu:'jin',jin:'shui',shui:'mu'},CTRL={mu:'tu',tu:'shui',shui:'huo',huo:'jin',jin:'mu'};
const genBy=x=>Object.keys(GEN).find(k=>GEN[k]===x), ctrlBy=x=>Object.keys(CTRL).find(k=>CTRL[k]===x);
const D2R=Math.PI/180,norm=x=>((x%360)+360)%360;
function jd(y,m,d,h){if(m<=2){y--;m+=12;}const A=Math.floor(y/100),B=2-A+Math.floor(A/4);return Math.floor(365.25*(y+4716))+Math.floor(30.6001*(m+1))+d+h/24+B-1524.5;}
function sunLon(JD){const T=(JD-2451545)/36525,L0=norm(280.46646+36000.76983*T+.0003032*T*T),M=norm(357.52911+35999.05029*T-.0001537*T*T)*D2R;
  return norm(L0+(1.914602-.004817*T)*Math.sin(M)+(.019993-.000101*T)*Math.sin(2*M)+.000289*Math.sin(3*M));}
function solveTerm(target,jGuess){let lo=jGuess-20,hi=jGuess+20;const f=j=>{let d=norm(sunLon(j)-target);if(d>180)d-=360;return d;};
  for(let i=0;i<50;i++){const mid=(lo+hi)/2;if(f(lo)*f(mid)<=0)hi=mid;else lo=mid;}return (lo+hi)/2;}
function civilJDN(y,m,d){const a=Math.floor((14-m)/12),yy=y+4800-a,mm=m+12*a-3;return d+Math.floor((153*mm+2)/5)+365*yy+Math.floor(yy/4)-Math.floor(yy/100)+Math.floor(yy/400)-32045;}
const DAY_OFFSET=((33-civilJDN(1893,12,26))%60+60)%60; // 锚定 毛=丁酉(33)

function paipan(y,mo,d,localH,tz){
  tz=(tz==null?8:tz);const hasHour=(localH!=null);
  const JDn=jd(y,mo,d,(hasHour?localH:12)-tz), sl=sunLon(JDn);
  const lichun=solveTerm(315, jd(y,2,4,0)-tz/24);
  const solarYear=JDn>=lichun?y:y-1;
  const yStem=((solarYear-4)%10+10)%10,yBranch=((solarYear-4)%12+12)%12;
  const mIdx=Math.floor(norm(sl-315)/30),mBranch=(2+mIdx)%12,yinStem=(yStem*2+2)%10,mStem=(yinStem+mIdx)%10;
  let dayJDN=civilJDN(y,mo,d); if(hasHour&&localH>=23)dayJDN+=1;
  const dgz=((dayJDN+DAY_OFFSET)%60+60)%60,dStem=dgz%10,dBranch=dgz%12;
  const hB=Math.floor(((hasHour?localH:12)+1)/2)%12,hStem=((dStem%5)*2+hB)%10;
  return {pillars:{year:[STEMS[yStem],BRANCHES[yBranch]],month:[STEMS[mStem],BRANCHES[mBranch]],
    day:[STEMS[dStem],BRANCHES[dBranch]],hour:hasHour?[STEMS[hStem],BRANCHES[hB]]:null},
    dayStem:STEMS[dStem]};
}
function wuxingProfile(y,mo,d,localH,tz){
  const pp=paipan(y,mo,d,localH,tz),P=pp.pillars,sc={jin:0,mu:0,shui:0,huo:0,tu:0};
  [P.year,P.month,P.day,P.hour].filter(Boolean).forEach(([s,b],i)=>{sc[stemEl(s)]+=1;const w=(i===1)?1.6:1;HIDDEN[b].forEach(([hs,ww])=>sc[stemEl(hs)]+=ww*w);});
  const total=Object.values(sc).reduce((a,b)=>a+b,0)||1,scores={};Object.keys(sc).forEach(k=>scores[k]=Math.round(sc[k]/total*100));
  const dayEl=stemEl(pp.dayStem),印=genBy(dayEl),比=dayEl,strong=sc[印]+sc[比],weak=sc[GEN[dayEl]]+sc[CTRL[dayEl]]+sc[ctrlBy(dayEl)];
  const shen=strong>=weak?'强':'弱';let favorable,avoid;
  if(shen==='强'){favorable=[GEN[dayEl],CTRL[dayEl],ctrlBy(dayEl)].sort((a,b)=>sc[a]-sc[b]);avoid=[印,比].sort((a,b)=>sc[b]-sc[a]);}
  else{favorable=[印,比].sort((a,b)=>sc[a]-sc[b]);avoid=[GEN[dayEl],CTRL[dayEl],ctrlBy(dayEl)].sort((a,b)=>sc[b]-sc[a]).slice(0,2);}
  const ks=Object.keys(scores);
  return {scores,lack:ks.slice().sort((a,b)=>scores[a]-scores[b]).slice(0,2),excess:ks.slice().sort((a,b)=>scores[b]-scores[a]).slice(0,1),
    favorable:[...new Set(favorable)].slice(0,2),avoid:[...new Set(avoid)].slice(0,2),dayMaster:dayEl,source:'bazi',_pillars:P,_shen:shen};
}

/* ---- 中医体质（由五行桥接；生产可接九型体质问卷精修）→ 香承香方 ---- */
const TIZHI={
 阳虚:{label:'阳虚·偏寒怕冷',themes:['情绪安定'],xiangfang:'温阳养气',stone:'nanhong',care:'宜温养，忌生冷'},
 阴虚:{label:'阴虚·偏燥易烦',themes:['睡眠安神'],xiangfang:'滋阴安神',stone:'moonstone',care:'宜静养滋润，忌熬夜辛燥'},
 气郁:{label:'气郁·思虑郁结',themes:['情感决断','焦虑纾解'],xiangfang:'解郁凝神',stone:'incense',care:'宜疏解舒展，忌闷压'},
 痰湿:{label:'痰湿·困重黏滞',themes:['专注定力'],xiangfang:'化湿醒神',stone:'citrine',care:'宜清爽走动，忌甜腻'},
 气虚:{label:'气虚·易倦气短',themes:['情绪安定'],xiangfang:'养气温肺',stone:'clear',care:'宜养气缓行，忌过劳'},
 平和:{label:'平和·守中',themes:[],xiangfang:'静心和合',stone:'incense',care:'守中即好'}
};
function tizhiFromWuxing(wx){const s=wx.scores;
  if(s.huo<=12)return '阳虚'; if(s.shui<=12)return '阴虚';
  const max=Object.keys(s).sort((a,b)=>s[b]-s[a])[0];
  if(max==='mu')return '气郁'; if(max==='tu'&&s.tu>=32)return '痰湿'; if(s.jin<=12)return '气虚';
  return '平和';}

/* ---- 对外：一次算好八字 + 五行 + 体质 + 香方 ---- */
function analyze(y,mo,d,localH,tz){
  const wx=wuxingProfile(y,mo,d,localH,tz), tz2=tizhiFromWuxing(wx), t=TIZHI[tz2];
  const P=wx._pillars, gz=p=>p?p[0]+p[1]:'—';
  return {wuxing:{scores:wx.scores,lack:wx.lack,excess:wx.excess,favorable:wx.favorable,avoid:wx.avoid,dayMaster:wx.dayMaster,source:wx.source},
    pillarsText:`${gz(P.year)} ${gz(P.month)} ${gz(P.day)} ${gz(P.hour)}`, shen:wx._shen,
    tizhi:tz2, tizhiLabel:t.label, xiangfang:t.xiangfang, tizhiStone:t.stone, tizhiThemes:t.themes, tizhiCare:t.care,
    elCN:EL_CN};
}
root.FateBazi={paipan,wuxingProfile,analyze,tizhiFromWuxing,TIZHI,EL_CN};
if(typeof module!=='undefined'&&module.exports)module.exports=root.FateBazi;
})(typeof window!=='undefined'?window:globalThis);
