/* Device-local prototype. All customer examples are fictional. */
window.OA = (() => {
 const localDate = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bahrain',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const dateOffset = (date,n) => {const d=new Date(date+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10)};
 const id = () => crypto.randomUUID?.() || Date.now().toString(36)+Math.random().toString(36).slice(2);
 const seed = () => {const date=localDate();return {schema:1,lang:null,business:'Sweet Studio',capacity:150,pickupHours:{start:'09:00',end:'21:00'},products:[{id:'cheese',en:'Cheesecake cups',ar:'أكواب تشيز كيك',aliases:['cheesecake cups','cheesecake cup','cheesecake','cup cheesecake','تشيز كيك','تشيزكيك'],unitEn:'cups',unitAr:'كوب',batch:12,packaging:[{nameEn:'Dessert cup',nameAr:'كوب حلى',qty:1},{nameEn:'Lid',nameAr:'غطاء',qty:1},{nameEn:'Spoon',nameAr:'ملعقة',qty:1}]},{id:'brownie',en:'Brownie boxes',ar:'بوكس براونيز',aliases:['brownie boxes','brownies box','brownie box','brownies','brownie','براونيز'],unitEn:'boxes',unitAr:'بوكس',batch:6,packaging:[{nameEn:'Brownie box',nameAr:'علبة براونيز',qty:1},{nameEn:'Label',nameAr:'ملصق',qty:1}]},{id:'velvet',en:'Red velvet cups',ar:'أكواب ريد فلفت',aliases:['red velvet cups','red velvet','ريد فلفت'],unitEn:'cups',unitAr:'كوب',batch:12,packaging:[{nameEn:'Dessert cup',nameAr:'كوب حلى',qty:1},{nameEn:'Lid',nameAr:'غطاء',qty:1},{nameEn:'Spoon',nameAr:'ملعقة',qty:1}]}],orders:[{id:'sample-sara',customer:'Sara',items:[{productId:'cheese',quantity:20,note:''},{productId:'brownie',quantity:4,note:'Gift ribbon / شريط هدية'}],date,time:'14:00',notes:'Call on arrival / الاتصال عند الوصول',status:'confirmed',source:'text',revision:1,createdAt:new Date().toISOString()},{id:'sample-noor',customer:'Noor',items:[{productId:'velvet',quantity:15,note:''},{productId:'cheese',quantity:5,note:''}],date,time:'16:30',notes:'Office celebration / حفلة المكتب',status:'prepped',source:'image',revision:1,createdAt:new Date().toISOString()},{id:'sample-hessa',customer:'Hessa',items:[{productId:'brownie',quantity:12,note:''}],date,time:'18:00',notes:'Name card: Hessa / بطاقة باسم حصة',status:'confirmed',source:'voice',revision:1,createdAt:new Date().toISOString()},{id:'sample-ali',customer:'Ali',items:[{productId:'cheese',quantity:24,note:''}],date:dateOffset(date,1),time:'11:00',notes:'',status:'confirmed',source:'manual',revision:1,createdAt:new Date().toISOString()}],drafts:[],plans:{},history:[],sampleData:true};};
 const key='orderat-prototype-v1';
 const load=()=>{try{const s=JSON.parse(localStorage.getItem(key)); if(s?.schema===1&&Array.isArray(s.orders)&&Array.isArray(s.products)){if(!s.pickupHours)s.pickupHours={start:'09:00',end:'21:00'};return s;}}catch{}return seed()};
 const save=s=>localStorage.setItem(key,JSON.stringify(s));
 return {localDate,dateOffset,id,seed,key,load,save};
})();
Object.assign(OA, (()=>{
 const clone=x=>JSON.parse(JSON.stringify(x));
 const clean=s=>String(s||'').toLowerCase().replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[\u064B-\u065F]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/\s+/g,' ').trim();
 const rx=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const count=o=>o.items.reduce((n,i)=>n+Number(i.quantity||0),0);
 const valid=o=>Boolean(o.customer?.trim()&&o.date&&o.time&&o.items?.length&&o.items.every(i=>i.productId&&Number.isInteger(Number(i.quantity))&&Number(i.quantity)>0));
 function totals(s,date){const orders=s.orders.filter(o=>o.date===date&&o.status!=='cancelled'&&valid(o));const map=new Map();for(const o of orders)for(const i of o.items){if(!map.has(i.productId))map.set(i.productId,0);map.set(i.productId,map.get(i.productId)+i.quantity)}return [...map].map(([id,quantity])=>{const p=s.products.find(p=>p.id===id),batch=Math.max(1,p?.batch||1);return {product:p,quantity,batches:Math.ceil(quantity/batch),make:Math.ceil(quantity/batch)*batch,extra:Math.ceil(quantity/batch)*batch-quantity}})}
 function packaging(s,orders){const map=new Map();for(const o of orders)for(const i of o.items){const p=s.products.find(p=>p.id===i.productId);for(const pack of p?.packaging||[]){const key=clean(pack.nameEn||pack.nameAr);const v=map.get(key)||{nameEn:pack.nameEn,nameAr:pack.nameAr,quantity:0};v.quantity+=i.quantity*pack.qty;map.set(key,v)}}return [...map.values()]}
 function invalidate(s,dates){for(const d of new Set(dates.filter(Boolean)))if(s.plans[d])s.plans[d].dirty=true;}
 function parse(text,s,reference=OA.localDate()){
  const raw=String(text).trim(),str=clean(raw),out={id:OA.id(),customer:'',date:'',time:'',items:[],notes:raw,source:'text',raw,createdAt:new Date().toISOString(),flags:[]};
  const colon=raw.match(/^([^:\n]{1,40})[:：]/),named=raw.match(/(?:my name is|i am|i'm|ismi|اسمي|انا|أنا)\s+([^,،.\n]{1,30})/i);out.customer=(colon?.[1]||named?.[1]||'').trim();
  const iso=str.match(/\b(20\d{2}-\d{2}-\d{2})\b/);if(iso&&!isNaN(Date.parse(iso[1])))out.date=iso[1];
  else if(/tomorrow|بكره|بكرة|غدا|غداً/.test(str))out.date=OA.dateOffset(reference,1);
  else if(/today|اليوم/.test(str))out.date=reference;
  else{const days=[['sunday','الاحد'],['monday','الاثنين'],['tuesday','الثلاثاء'],['wednesday','الاربعاء'],['thursday','الخميس'],['friday','الجمعة'],['saturday','السبت']];const n=days.findIndex(a=>a.some(v=>str.includes(v)));if(n>=0){const now=new Date(reference+'T12:00:00Z').getUTCDay();let delta=(n-now+7)%7;if(/next|القادم|الجاي/.test(str)&&delta===0)delta=7;out.date=OA.dateOffset(reference,delta)}}
  const timeWords='am|pm|a\\.m\\.|p\\.m\\.|صباحا|صباحًا|صباح|الصبح|مساء|مساءً|مسا|العصر|المغرب|الظهر|الليل|بالليل|ص|م';
  const tm=str.match(new RegExp('(?:\\bat\\s*|الساعة\\s*|الساعه\\s*|@\\s*)(\\d{1,2})(?::(\\d{2}))?\\s*(?:('+timeWords+'))?(?![\\u0600-\\u06FFa-zA-Z])','i'))||str.match(new RegExp('\\b(\\d{1,2})(?::(\\d{2}))?\\s*('+timeWords+')(?![\\u0600-\\u06FFa-zA-Z])','i'));
  if(tm){let h=Number(tm[1]),m=Number(tm[2]||0),amp=tm[3]||'';const isPm=/pm|p\.m|مساء|مسا|العصر|المغرب|الظهر|الليل|^م$/.test(amp),isAm=/am|a\.m|صباح|الصبح|^ص$/.test(amp);if(h>=0&&h<=23&&m<60){if(amp){if(isPm&&h>=1&&h<=11)h+=12;if(isAm&&h===12)h=0}else if(h>=1&&h<=11){h+=12}out.time=String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')}}
  if(out.time&&s.pickupHours&&(out.time<s.pickupHours.start||out.time>s.pickupHours.end))out.flags.push('outside-hours');
  const changes=/instead|change|make (?:it|them)|increase|update|not\s+\d|بدل|تخلي|خليها|مو\s*\d|زيد|تعديل/.test(str);
  const names={سارة:'sara',ساره:'sara',نور:'noor',حصة:'hessa',حصه:'hessa',علي:'ali'};const canonical=x=>names[clean(x)]||clean(x);
  const recent=s.orders.filter(o=>o.status!=='cancelled'&&(Date.now()-Date.parse(o.createdAt))<=14*86400000&&(canonical(o.customer)===canonical(out.customer)||(!out.customer&&str.includes(clean(o.customer)))));
  if(changes&&recent.length===1){const old=recent[0];out.customer=old.customer;out.date=out.date||old.date;out.time=out.time||old.time;out.items=clone(old.items);out.matchId=old.id;out.matchRevision=old.revision;
   const q=str.match(/(?:make (?:it|them)|to|تخليها|تخليه|خليها|خليه|الى)\s*(\d+)/)?.[1]||str.match(/(\d+)\s*(?:instead|not|بدل|مو)/)?.[1];
   const found=s.products.filter(p=>[p.en,p.ar,...p.aliases||[]].some(a=>a&&str.includes(clean(a))));
   const target=found.length===1?out.items.find(i=>i.productId===found[0].id):(out.items.length===1?out.items[0]:null);
   if(q&&target)target.quantity=Number(q);else if(q&&out.items.length>1){out.flags.push('ambiguous-change');out.proposedQuantity=Number(q)}
   out.flags.push('review-change');return out;
  }
  if(changes)out.flags.push('unmatched-change');
  let consumed=[];
  const unitWords='علبة|بوكس|كيس|قطعة|حبة|كوب|box|cup|pcs?|pc';
  for(const p of s.products){const aliases=[...new Set([p.en,p.ar,...p.aliases||[]].filter(Boolean).map(clean))].sort((a,b)=>b.length-a.length);let found=false;for(const a of aliases){const m=str.match(new RegExp('(?:^|[\\s,:،;و])([0-9]+)\\s*(?:x|×)?\\s*(?:(?:'+unitWords+')\\s*)?'+rx(a)+'(?=$|[\\s,.،;])','i'));if(m){out.items.push({productId:p.id,quantity:Number(m[1]),note:''});consumed.push(m[0]);found=true;break}}if(!found&&aliases.some(a=>str.includes(a))){out.items.push({productId:p.id,quantity:'',note:''});out.flags.push('quantity');const hit=aliases.find(a=>str.includes(a));if(hit)consumed.push(hit)}}
  let residual=str;for(const c of consumed)residual=residual.replace(c,' ');
  if(tm)residual=residual.replace(tm[0],' ');
  if(iso)residual=residual.replace(iso[0],' ');
  residual=residual.replace(/tomorrow|بكره|بكرة|غدا|غداً|today|اليوم|الساعة|الساعه|@|\bat\b|am|pm|a\.m\.|p\.m\.|صباحا|صباحًا|صباح|الصبح|مساء|مساءً|مسا|العصر|المغرب|الظهر|الليل|بالليل|\bnext\b|القادم|الجاي/gi,' ');
  const itemRx=new RegExp('(\\d+)\\s*(?:x|×)?\\s*(?:'+unitWords+')?\\s*([\\u0600-\\u06FFa-zA-Z][\\u0600-\\u06FFa-zA-Z\\s]{1,20})','gi');
  let im,addedUnknown=false;
  if(!changes)while((im=itemRx.exec(residual))){let name=im[2].replace(/\s+(و|and|,|،)\s*$/i,'').trim().replace(/\s+/g,' ');if(name.length<2)continue;name=name.split(' ').slice(0,3).join(' ');out.items.push({productId:'',quantity:Number(im[1]),note:'',raw:name});addedUnknown=true}
  if(addedUnknown)out.flags.push('unmatched-product');
  if(!out.customer)out.flags.push('customer');if(!out.date)out.flags.push('date');if(!out.time)out.flags.push('time');if(!out.items.length)out.flags.push('items');return out;
 }
 function commit(s,draft){if(!valid(draft))throw new Error('incomplete');const copy=clone(draft);let old=null;if(draft.matchId){old=s.orders.find(o=>o.id===draft.matchId);if(!old||old.revision!==draft.matchRevision)throw new Error('stale');}
  if(s.history.some(h=>h.captureId===draft.id))throw new Error('duplicate');
  const order={id:old?.id||OA.id(),customer:copy.customer.trim(),items:copy.items.map(i=>({...i,quantity:Number(i.quantity)})),date:copy.date,time:copy.time,notes:copy.notes||'',status:'confirmed',source:copy.source||'manual',revision:(old?.revision||0)+1,createdAt:old?.createdAt||new Date().toISOString()};
  if(old){s.orders[s.orders.findIndex(o=>o.id===old.id)]=order;}else s.orders.push(order);
  s.drafts=s.drafts.filter(d=>d.id!==draft.id);invalidate(s,[order.date,old?.date]);s.history.unshift({id:OA.id(),captureId:draft.id,orderId:order.id,kind:old?'changed':'created',before:old?clone(old):null,after:clone(order),at:new Date().toISOString()});return order;
 }
 return {clone,clean,count,valid,totals,packaging,invalidate,parse,commit};
})());
