import {showCondos} from './condo-view.js';
import {mountMap,visibleGroups} from './nearby-map.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clock=value=>new Intl.DateTimeFormat('en-SG',{timeZone:'Asia/Singapore',hour:'numeric',minute:'2-digit'}).format(new Date(value*1000));
let activeMap=null,chosenFilter='all';
export function disposeDiscovery(){activeMap?.destroy();activeMap=null}
export async function showNearby(o){
 if(o.scope==='condo')return showCondos(o);
 const {app,state,demo,scope,radius,api,valid}=o;
 const time=Math.floor(Date.now()/1000),available=state.user.available_until>time;
 let data,games=[],gamesError='';
 if(demo){
  data={self_status:available?'now':null,home:{name:'Your demo condo',latitude:1.3508,longitude:103.8723},slot:'evening',unmapped:0,groups:[
   {id:'demo-a',name:'Demo Gardens (fictional)',address:'Sample location · demo only',latitude:1.353,longitude:103.876,distance:0.5,ready_count:1,usual_count:2,total_count:2},
   {id:'demo-b',name:'Demo Residences (fictional)',address:'Sample location · demo only',latitude:1.343,longitude:103.868,distance:1,ready_count:0,usual_count:1,total_count:1}
  ]};games=o.demoGames;
 }else if(state.user.area_id){
  data=await api('discovery?scope='+scope+'&radius='+radius);
  try{games=(await api('games')).games}catch{gamesError='Games could not load. The player map is still available.'}
 }else data={home:null,slot:null,groups:[],unmapped:0};
 if(!valid())return;
 o.onGames(games);
 const nowCount=data.groups.reduce((n,g)=>n+g.ready_count,0),usualCount=data.groups.reduce((n,g)=>n+g.usual_count,0);
 const needsLocation=!data.home?.latitude;
 app.innerHTML=`<div class="row between nearby-toolbar"><div class="scope"><button data-scope="area" aria-pressed="${scope==='area'}">Neighbourhood</button><button data-scope="condo" aria-pressed="${scope==='condo'}">Condo / estate</button></div><div class="row"><a class="button quiet" href="#schedule">My schedule</a></div></div>
 <section class="discovery-overview"><div class="discovery-title"><h1>Who's nearby?</h1><div class="map-key"><span><i class="status-dot now"></i> ${nowCount} ready to play</span><span><i class="status-dot usual"></i> ${usualCount} usually available</span></div></div><div class="presence-control"><button id="available-now" class="${available?'is-active':'primary'}" aria-pressed="${available}">${available?'✓ Ready to Play':'Ready to Play'}</button><small>${available?'Until '+clock(state.user.available_until)+' SGT · click to stop':'Let neighbours know · lasts 2 hours'}</small></div>
 <div class="discovery-controls"><div class="row"><label>Show<select id="map-filter"><option value="all">All players</option><option value="now">Ready to Play</option><option value="usual">Usually available</option></select></label><label>Within<select id="map-radius">${[2,5,10,20].map(r=>`<option value="${r}" ${r===radius?'selected':''}>${r} km</option>`).join('')}</select></label></div></div></section>
 <div class="discovery-layout"><div class="map-panel"><div id="nearby-map" aria-label="Map of nearby players by condo"></div><div class="map-caption"><span><i class="status-dot now"></i> Ready to Play</span><span><i class="status-dot usual"></i> Usually available</span><span>Condo locations · SGT</span></div></div><aside class="player-panel"><div class="row between"><h2>Nearby players</h2><button id="refresh-map" class="quiet">Refresh</button></div><div id="player-list"></div></aside></div>
 ${needsLocation?'<p class="map-note">Choose your condo using OneMap in <a href="#profile">Profile</a> to centre the map and search by distance. Without a condo location, results stay within your neighbourhood.</p>':''}
 ${data.unmapped?'<p class="map-note">Some players do not yet have a map location.</p>':''}
 <p class="compact muted">${data.slot?'Amber matches the current '+esc(data.slot)+' slot in saved schedules.':'There is no scheduled slot before 2 pm; only Ready to Play appears.'} Scheduled availability is a preference, not a confirmation. Counts exclude you.</p>
 <div class="row between section games-heading"><h2>Nearby games</h2><button class="primary" id="suggest">Suggest a game +</button></div>${gamesError?`<p class="notice">${esc(gamesError)}</p>`:games.length?`<div class="grid">${games.map(g=>`<article class="card"><span class="tag">${g.venue==='decide'?'Venue to decide':g.venue==='shared'?'Shared space offered':'Café suggested'}</span><h3>${esc(g.title)}</h3><p>${esc(g.date)} · ${esc(g.slot)}</p>${o.deckTags(g)}<button class="full" data-join="${esc(g.id)}">${g.user_id===state.user.id?'Manage game':'Ask to join'}</button></article>`).join('')}</div>`:'<div class="empty"><p>No games yet. Suggest a time and find a table together.</p></div>'}`;
 function draw(){
  const groups=visibleGroups(data,app.querySelector('#map-filter').value),list=app.querySelector('#player-list');
  list.innerHTML=groups.length?groups.map(g=>`<button type="button" class="player-location" data-map-location="${esc(g.id)}"><span class="row between"><strong>${esc(g.name)}</strong><small>${g.distance==null?'':g.distance+' km'}</small></span><span class="player-address">${esc(g.address)}</span><span class="player-line"><i class="status-dot now"></i>${g.ready_count} Ready to Play</span><span class="player-line"><i class="status-dot usual"></i>${g.usual_count} usually available</span></button>`).join(''):'<div class="empty player-empty"><h3>No players here yet.</h3><p>Try a wider radius, or mark yourself Ready to Play.</p><a href="#schedule">Edit my schedule →</a></div>';
  activeMap?.destroy();activeMap=mountMap(app.querySelector('#nearby-map'),{...data,groups},id=>{list.querySelectorAll('[data-map-location]').forEach(el=>el.classList.toggle('selected',el.dataset.mapLocation===id))});
  list.querySelectorAll('[data-map-location]').forEach(button=>button.onclick=()=>activeMap.focus(button.dataset.mapLocation));
 }
 app.querySelector('#map-filter').value=chosenFilter;draw();
 app.querySelector('#map-filter').onchange=e=>{chosenFilter=e.target.value;draw()};
 app.querySelector('#map-radius').onchange=e=>o.onRadius(Number(e.target.value));
 app.querySelector('#refresh-map').onclick=o.onRefresh;
 app.querySelectorAll('[data-scope]').forEach(button=>button.onclick=()=>o.onScope(button.dataset.scope));
 async function update(body){
  if(!state.user.area_id){o.onProfile();return}
  try{const result=demo?{available_until:body.available===undefined?state.user.available_until:body.available?time+7200:0,share_map:body.share_map===undefined?state.user.share_map:body.share_map?1:0}:await api('presence','PUT',body);Object.assign(state.user,result);o.persist();o.onRefresh()}
  catch(error){o.toast(error.message);if(valid()){app.querySelector('#available-now').disabled=false}}
 }
 app.querySelector('#available-now').onclick=e=>{e.currentTarget.disabled=true;update({available:!available})};
 app.querySelector('#suggest').onclick=o.onSuggest;
 app.querySelectorAll('[data-join]').forEach(button=>button.onclick=()=>o.onJoin(button.dataset.join));
}
