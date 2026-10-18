const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const slots=[['afternoon','Afternoon','2–6 pm'],['evening','Evening','6–9 pm'],['late','Late evening','9 pm–midnight']];
let selectedId=null,queryText='';
function demoData(o){
 const home={id:o.state.user.area_id||'demo-east',name:'Sample Gardens (fictional)',address:'Demo location',is_home:true,available_now:1,usual_people:5};
 return {home,favourites:[home,...(o.state.condo_favourites??[{id:'demo-favourite',name:'Sample Court (fictional)',address:'Demo location',available_now:0,usual_people:3}]).filter(a=>a.id!==home.id)],can_walk:true,nearby:[{id:'demo-walk',name:'Sample Residences (fictional)',address:'Demo location',available_now:2,usual_people:4,walk:{minutes:8,estimated:false}},{id:'demo-favourite',name:'Sample Court (fictional)',address:'Demo location',available_now:0,usual_people:3,walk:{minutes:12,estimated:true}}]};
}
const status=area=>area.available_now>0?`<span class="condo-status now">${area.available_now} available now</span>`:`<span class="condo-status usual">${area.usual_people||0} with usual availability</span>`;
function condoCard(area){return `<button class="condo-card" type="button" data-open-condo="${esc(area.id)}"><span class="row between"><strong>${esc(area.name)}</strong>${area.is_home?'<span class="tag">Your condo</span>':''}</span><span class="condo-address">${esc(area.address)}</span><span class="row between">${status(area)}${area.walk?`<span class="walk-label">${area.walk.estimated?'≈ ':''}${area.walk.minutes} min walk${area.walk.estimated?' · estimate':''}</span>`:''}</span></button>`}
export async function showCondos(o){
 const {app,demo,api,valid,state}=o;
 const data=demo?demoData(o):await api('condos');if(!valid())return;
 if(!selectedId)selectedId=data.home?.id||data.favourites[0]?.id||null;
 app.innerHTML=`<div class="row between nearby-toolbar"><div class="scope"><button data-scope="area" aria-pressed="false">Neighbourhood</button><button data-scope="condo" aria-pressed="true">Condo / estate</button></div><a class="button quiet" href="#schedule">My schedule</a></div>
 <section class="condo-search"><h1>Find a condo.</h1><form id="condo-search-form" class="row"><label class="condo-search-label"><span class="sr-only">Search condos</span><input id="condo-query" type="search" minlength="3" maxlength="100" placeholder="Condo name or postal code" value="${esc(queryText)}" required autocomplete="off"></label><button class="primary" type="submit">Search</button></form><div id="condo-search-results" aria-live="polite"></div></section>
 <section class="condo-section"><div class="row between"><h2>Favourite condos</h2><small class="muted">Your condo is always included</small></div><div class="condo-cards">${data.favourites.length?data.favourites.map(condoCard).join(''):'<p class="map-note">Search for a condo to save a favourite, or <a href="#profile">choose your own condo</a>.</p>'}</div></section>
 <section id="condo-schedule" class="condo-schedule-panel" aria-live="polite"><p class="map-note">Select a condo to see usual availability.</p></section>
 <section class="condo-section closest-condos"><div class="row between"><h2>Closest condos around me</h2><span class="walk-badge">About 15 min on foot</span></div><p class="map-note">${data.nearby.some(a=>a.available_now>0)?'Available now comes first.':data.nearby.length?'No one is available now nearby. These condos have the most usual availability.':'Nearby condos with shared availability will appear here.'}</p>${!data.can_walk?'<p class="notice">Choose your condo using OneMap in <a href="#profile">Profile</a> to find places within walking distance.</p>':data.nearby.length?`<div class="condo-cards">${data.nearby.map(condoCard).join('')}</div>`:'<div class="empty"><p>No condos with shared availability were found within a 15-minute walk.</p></div>'}<p class="compact muted">Walking times use OneMap routes when available. “≈” means an estimate from distance.</p></section>`;
 app.querySelectorAll('[data-scope]').forEach(button=>button.onclick=()=>o.onScope(button.dataset.scope));
 let scheduleRequest=0;
 const known=new Map([...data.favourites,...data.nearby].map(a=>[a.id,a]));
 async function select(id){
  selectedId=id;const request=++scheduleRequest,panel=app.querySelector('#condo-schedule');
  panel.innerHTML='<p class="map-note">Loading usual availability…</p>';
  try{
   const schedule=demo?{area:known.get(id)||{id,name:'Sample Condo (fictional)'},cells:slots.flatMap(([slot],i)=>days.map((_,day)=>({slot,day,count:(day+i)%3===0?i+2:0})))}:await api('condos/'+encodeURIComponent(id)+'/schedule');
   if(!valid()||request!==scheduleRequest)return;
   const max=Math.max(1,...schedule.cells.map(c=>c.count)),home=schedule.area.id===data.home?.id,favourite=data.favourites.some(a=>a.id===id);
   panel.innerHTML=`<div class="row between"><div><h2>${esc(schedule.area.name)}</h2><p class="map-note">Usual availability · Singapore time</p></div><button id="toggle-condo-favourite" ${home?'disabled':''}>${home?'★ Your condo':favourite?'★ Remove favourite':'☆ Add favourite'}</button></div><div class="condo-timetable-scroll"><table class="condo-timetable"><caption class="sr-only">Total people usually available by day and time</caption><thead><tr><th scope="col"></th>${days.map(day=>`<th scope="col">${day}</th>`).join('')}</tr></thead><tbody>${slots.map(([slot,label,time])=>`<tr><th scope="row">${label}<small>${time}</small></th>${days.map((day,index)=>{const count=schedule.cells.find(c=>c.day===index&&c.slot===slot)?.count||0;return `<td><span class="condo-count ${count?'has-people':''}" style="--density:${0.15+count/max*0.7}" aria-label="${day} ${label}: ${count} people">${count}</span></td>`}).join('')}</tr>`).join('')}</tbody></table></div><p class="compact muted">Anonymous totals only · Includes you if you share condo counts · No names or individual schedules</p>${schedule.area.id===state.user.area_id&&!state.user.share_condo?'<p class="map-note">Your schedule is private here. Enable condo aggregate counts in <a href="#profile">Profile</a> to include it.</p>':''}`;
   panel.querySelector('#toggle-condo-favourite').onclick=async event=>{
    event.target.disabled=true;
    try{if(!demo)await api('condos/favourites',favourite?'DELETE':'PUT',{area_id:id});else{const saved=state.condo_favourites??data.favourites.filter(a=>!a.is_home);state.condo_favourites=favourite?saved.filter(a=>a.id!==id):[...saved,schedule.area];o.persist()}o.onRefresh()}
    catch(error){o.toast(error.message);event.target.disabled=false}
   };
   app.querySelectorAll('[data-open-condo]').forEach(button=>{const current=button.dataset.openCondo===id;button.classList.toggle('selected',current);button.setAttribute('aria-pressed',String(current))});
  }catch(error){if(valid()&&request===scheduleRequest)panel.innerHTML=`<p class="notice error">${esc(error.message)}</p>`}
 }
 function bindCards(root){root.querySelectorAll('[data-open-condo]').forEach(button=>button.onclick=()=>select(button.dataset.openCondo))}
 bindCards(app);
 const form=app.querySelector('#condo-search-form');
 form.onsubmit=async event=>{
  event.preventDefault();queryText=app.querySelector('#condo-query').value.trim();const results=app.querySelector('#condo-search-results'),button=form.querySelector('button');button.disabled=true;results.textContent='Searching condos…';
  try{
   const found=demo?{results:[...known.values()].filter(a=>a.name.toLowerCase().includes(queryText.toLowerCase())).map(a=>({...a,saved:true}))}:await api('condos/search?q='+encodeURIComponent(queryText));
   if(!valid())return;
   results.innerHTML=(found.message?`<p class="map-note">${esc(found.message)}</p>`:'')+(found.results.length?found.results.map((a,index)=>`<button type="button" class="location-result" data-search-index="${index}"><strong>${esc(a.name)}</strong><span>${esc(a.address)}</span><small>View anonymous availability →</small></button>`).join(''):'<p class="map-note">No matches. Try a development name or postal code.</p>')+'<p class="compact muted">Search data: OneMap / Singapore Land Authority. Results include buildings of all types.</p>';
   results.querySelectorAll('[data-search-index]').forEach(resultButton=>resultButton.onclick=async()=>{
    const choice=found.results[Number(resultButton.dataset.searchIndex)];resultButton.disabled=true;
    try{const area=choice.saved?choice:(await api('condos/select','POST',{query:queryText,id:choice.id})).area;known.set(area.id,area);await select(area.id)}catch(error){o.toast(error.message)}finally{resultButton.disabled=false}
   });
  }catch(error){if(valid())results.innerHTML=`<p class="notice error">${esc(error.message)}</p>`}finally{button.disabled=false}
 };
 if(selectedId)await select(selectedId);
}
