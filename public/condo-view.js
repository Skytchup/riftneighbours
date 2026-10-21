const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const slots=[['morning','Morning','6 am–12 pm'],['lunch','Lunch break','12–2 pm'],['afternoon','Afternoon','2–6 pm'],['evening','Evening','6–9 pm'],['late','Late evening','9 pm–midnight']];
let selectedId=null,queryText='';
function demoData(o){
 const home={id:o.state.user.area_id||'demo-east',name:'Sample Gardens (fictional)',address:'Demo location',is_home:true,available_now:1,usual_people:5};
 return {home,favourites:[home,...(o.state.condo_favourites??[{id:'demo-favourite',name:'Sample Court (fictional)',address:'Demo location',available_now:0,usual_people:3}]).filter(a=>a.id!==home.id)],can_walk:true,nearby:[{id:'demo-walk',name:'Sample Residences (fictional)',address:'Demo location',available_now:2,usual_people:4,walk:{minutes:8,estimated:false}},{id:'demo-favourite',name:'Sample Court (fictional)',address:'Demo location',available_now:0,usual_people:3,walk:{minutes:12,estimated:true}}]};
}
const status=area=>area.available_now>0?`<span class="condo-status now">${area.available_now} ready to play</span>`:`<span class="condo-status usual">${area.usual_people||0} with usual availability</span>`;
function condoCard(area){return `<button class="condo-card" type="button" data-open-condo="${esc(area.id)}"><span class="row between"><strong>${esc(area.name)}</strong></span><span class="condo-address">${esc(area.address)}</span><span class="row between">${status(area)}${area.walk?`<span class="walk-label">${area.walk.estimated?'≈ ':''}${area.walk.minutes} min walk${area.walk.estimated?' · estimate':''}</span>`:''}</span></button>`}
export async function showCondos(o){
 const {app,demo,api,valid,state}=o;
 const data=demo?demoData(o):await api('condos');if(!valid())return;
 if(!selectedId)selectedId=data.home?.id||data.favourites[0]?.id||null;
 app.innerHTML=`<section class="condo-search"><h1>Locations &amp; Availability</h1><form id="condo-search-form" class="row"><label class="condo-search-label"><span class="sr-only">Search places</span><input id="condo-query" type="search" minlength="3" maxlength="100" placeholder="Place name or postal code" value="${esc(queryText)}" required autocomplete="off"></label><button class="primary" type="submit">Search</button></form><div id="condo-search-results" aria-live="polite"></div></section>
 <section class="condo-section"><div class="row between"><h2>My Places</h2><small class="muted">Your saved locations</small></div><div class="condo-cards">${data.favourites.length?data.favourites.map(condoCard).join(''):'<p class="map-note">Search for a location to add to My Places, or <a href="#profile">choose a meeting place</a>.</p>'}</div></section>
 <section id="condo-schedule" class="condo-schedule-panel" aria-live="polite"><p class="map-note">Select a place to see usual availability.</p></section>
 <section class="condo-section closest-condos"><div class="row between"><h2>Places within walking distance</h2><span class="walk-badge">About 15 min on foot</span></div><p class="map-note">${data.nearby.some(a=>a.available_now>0)?'Ready to Play comes first.':data.nearby.length?'No one is ready to play nearby. These places have the most usual availability.':'Nearby places with shared availability will appear here.'}</p>${!data.can_walk?'<p class="notice">Choose your selected place using OneMap in <a href="#profile">Profile</a> to find places within walking distance.</p>':data.nearby.length?`<div class="condo-cards">${data.nearby.map(condoCard).join('')}</div>`:'<div class="empty"><p>No places with shared availability were found within a 15-minute walk.</p></div>'}<p class="compact muted">${data.home?'Distances from your current location: '+esc(data.home.name)+'. ':''}Walking times are distance estimates, not route directions.</p></section>`;

 let scheduleRequest=0;
 const known=new Map([...data.favourites,...data.nearby].map(a=>[a.id,a]));
 async function select(id,openAvailability=false){
  selectedId=id;const request=++scheduleRequest,panel=app.querySelector('#condo-schedule');
  panel.innerHTML='<p class="map-note">Loading usual availability…</p>';
  try{
   const schedule=demo?{area:known.get(id)||{id,name:'Sample Place (fictional)'},cells:slots.flatMap(([slot],i)=>days.map((_,day)=>({slot,day,count:(day+i)%3===0?i+2:0})))}:await api('condos/'+encodeURIComponent(id)+'/schedule');
   if(!valid()||request!==scheduleRequest)return;
   const max=Math.max(1,...schedule.cells.map(c=>c.count));let favourite=data.favourites.some(a=>a.id===id);
   panel.innerHTML=`<div class="row between"><div><h2>${esc(schedule.area.name)}</h2><p class="map-note">Usual availability · Singapore time</p></div><div class="row"><button id="toggle-condo-favourite" >${favourite?'Remove from My Places':'Add to My Places'}</button>${favourite?'<button id="edit-place-availability" class="primary" type="button" aria-expanded="false" aria-controls="place-availability-editor">Update my Availability at this location</button>':''}</div></div><div class="condo-timetable-scroll"><table class="condo-timetable"><caption class="sr-only">Total people usually available by day and time</caption><thead><tr><th scope="col"></th>${days.map(day=>`<th scope="col">${day}</th>`).join('')}</tr></thead><tbody>${slots.map(([slot,label,time])=>`<tr><th scope="row">${label}<small>${time}</small></th>${days.map((day,index)=>{const count=schedule.cells.find(c=>c.day===index&&c.slot===slot)?.count||0;return `<td><span class="condo-count ${count?'has-people':''}" style="--density:${0.15+count/max*0.7}" aria-label="${day} ${label}: ${count} people">${count}</span></td>`}).join('')}</tr>`).join('')}</tbody></table></div><p class="compact muted">Anonymous totals only · Includes your saved schedule · No names or individual schedules</p>`;
   panel.querySelector('#toggle-condo-favourite').onclick=async event=>{
    event.target.disabled=true;
    try{if(!demo){await api('condos/favourites',favourite?'DELETE':'PUT',{area_id:id});const fresh=await api('me');if(!valid())return;Object.assign(state,fresh);}else{const saved=state.condo_favourites??data.favourites.filter(a=>!a.is_home);state.condo_favourites=favourite?saved.filter(a=>a.id!==id):[...saved,schedule.area];state.my_places=state.condo_favourites;o.persist()}o.onRefresh()}
    catch(error){o.toast(error.message);event.target.disabled=false}
   };
   function openEditor(){
    const editButton=panel.querySelector('#edit-place-availability');
    if(panel.querySelector('#place-availability-editor')){panel.querySelector('#place-availability-editor').remove();editButton?.setAttribute('aria-expanded','false');return}
    editButton?.setAttribute('aria-expanded','true');
    const records=state.location_preferences||state.preferences.map(p=>({...p,area_id:state.user.area_id}));
    const selected=records.filter(p=>p.area_id===id).map(({day,slot})=>({day,slot}));
    const editor=document.createElement('section');editor.id='place-availability-editor';
    editor.innerHTML=`<h3>Your availability at ${esc(schedule.area.name)}</h3><p class="compact muted">Select your usual free times · Singapore time</p><div class="schedule"><span></span>${days.map(day=>`<span class="day">${day}</span>`).join('')}${slots.map(([slot,label,time])=>`<span class="slotlabel">${label}<br>${time}</span>${days.map((day,index)=>{const active=selected.some(p=>p.day===index&&p.slot===slot);return `<button type="button" data-availability-day="${index}" data-availability-slot="${slot}" aria-label="${day} ${label}" aria-pressed="${active}">${active?'✓':'·'}</button>`}).join('')}`).join('')}</div><p class="notice">Your schedule adds to anonymous player counts at this place; your individual timetable stays private. Preferences stop contributing after 60 days unless you save them again.</p><div class="row"><button id="save-place-availability" class="primary" type="button">${favourite?'Save availability':'Add to My Places & save availability'}</button><button id="cancel-place-availability" type="button">Cancel</button></div>`;
    panel.querySelector('.condo-timetable-scroll').before(editor);
    editor.querySelectorAll('[data-availability-day]').forEach(button=>button.onclick=()=>{const day=Number(button.dataset.availabilityDay),slot=button.dataset.availabilitySlot,index=selected.findIndex(p=>p.day===day&&p.slot===slot);if(index<0)selected.push({day,slot});else selected.splice(index,1);button.setAttribute('aria-pressed',String(index<0));button.textContent=index<0?'✓':'·'});
    editor.querySelector('#cancel-place-availability').onclick=()=>{editor.remove();editButton?.setAttribute('aria-expanded','false')};
    editor.querySelector('#save-place-availability').onclick=async saveEvent=>{
     editor.querySelectorAll('button').forEach(button=>button.disabled=true);
     try{
      if(!favourite){
       if(!demo)await api('condos/favourites','PUT',{area_id:id});
       if(!valid())return;
       favourite=true;data.favourites.push(schedule.area);
       state.my_places=[...(state.my_places||[]).filter(p=>p.id!==id),schedule.area];state.availability_locations=state.my_places;
       panel.querySelector('#toggle-condo-favourite').textContent='Remove from My Places';
       editor.querySelector('#save-place-availability').textContent='Save availability';
      }
      if(!demo)await api('preferences','PUT',{area_id:id,preferences:selected});if(!valid())return;
      if(!demo){const fresh=await api('me');if(!valid())return;Object.assign(state,fresh)}

      state.location_preferences=[...records.filter(p=>p.area_id!==id),...selected.map(p=>({...p,area_id:id}))];if(id===state.user.area_id)state.preferences=selected;
      o.persist();o.toast('Availability saved.');o.onRefresh();
     }catch(error){o.toast(error.message);editor.querySelectorAll('button').forEach(button=>button.disabled=false)}
    };
   }
   panel.querySelector('#edit-place-availability')?.addEventListener('click',openEditor);
   if(openAvailability||!favourite)openEditor();
   app.querySelectorAll('[data-open-condo]').forEach(button=>{const current=button.dataset.openCondo===id;button.classList.toggle('selected',current);button.setAttribute('aria-pressed',String(current))});
  }catch(error){if(valid()&&request===scheduleRequest)panel.innerHTML=`<p class="notice error">${esc(error.message)}</p>`}
 }
 function bindCards(root){root.querySelectorAll('[data-open-condo]').forEach(button=>button.onclick=()=>select(button.dataset.openCondo))}
 bindCards(app);
 const form=app.querySelector('#condo-search-form');
 form.onsubmit=async event=>{
  event.preventDefault();queryText=app.querySelector('#condo-query').value.trim();const results=app.querySelector('#condo-search-results'),button=form.querySelector('button');button.disabled=true;results.textContent='Searching places…';
  try{
   const found=demo?{results:[...known.values()].filter(a=>a.name.toLowerCase().includes(queryText.toLowerCase())).map(a=>({...a,saved:true}))}:await api('condos/search?q='+encodeURIComponent(queryText));
   if(!valid())return;
   results.innerHTML=(found.message?`<p class="map-note">${esc(found.message)}</p>`:'')+(found.results.length?found.results.map((a,index)=>`<button type="button" class="location-result" data-search-index="${index}"><strong>${esc(a.name)}</strong><span>${esc(a.address)}</span><small>Set your availability &amp; view player counts →</small></button>`).join(''):'<p class="map-note">No matches. Try a development name or postal code.</p>')+'<p class="compact muted">Search data: OneMap / Singapore Land Authority. Results include homes, workplaces and public places.</p>';
   results.querySelectorAll('[data-search-index]').forEach(resultButton=>resultButton.onclick=async()=>{
    const choice=found.results[Number(resultButton.dataset.searchIndex)];resultButton.disabled=true;
    try{const area=choice.saved?choice:(await api('condos/select','POST',{query:queryText,id:choice.id})).area;known.set(area.id,area);await select(area.id,true)}catch(error){o.toast(error.message)}finally{resultButton.disabled=false}
   });
   const first=results.querySelector('[data-search-index]');if(first)await first.onclick();
  }catch(error){if(valid())results.innerHTML=`<p class="notice error">${esc(error.message)}</p>`}finally{button.disabled=false}
 };
 if(selectedId)await select(selectedId);
}
