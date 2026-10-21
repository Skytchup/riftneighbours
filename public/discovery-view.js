import {showCondos} from './condo-view.js';
import {mountMap,visibleGroups} from './nearby-map.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let activeMap=null,chosenFilter='all';
export function disposeDiscovery(){activeMap?.destroy();activeMap=null}
export async function showNearby(o){
 if(o.scope==='condo')return showCondos(o);
 const {app,state,demo,scope,radius,api,valid}=o;
 const time=Math.floor(Date.now()/1000),available=state.user.available_until>time;
 let data;
 const gamesPromise=demo?Promise.resolve({games:o.demoGames}):state.user.area_id?api('games').catch(()=>({games:[],error:'Games could not load. Please refresh to retry.'})):Promise.resolve({games:[]});
 if(demo){
  data={self_status:available?'now':null,home:{name:'Your demo place',latitude:1.3508,longitude:103.8723},slot:'evening',unmapped:0,groups:[
   {id:'demo-a',name:'Demo Gardens (fictional)',address:'Sample location · demo only',latitude:1.353,longitude:103.876,distance:0.5,ready_count:1,usual_count:2,total_count:2},
   {id:'demo-b',name:'Demo Residences (fictional)',address:'Sample location · demo only',latitude:1.343,longitude:103.868,distance:1,ready_count:0,usual_count:1,total_count:1}
  ]};
 }else if(state.user.area_id){
  data=await api('discovery?scope='+scope+'&radius='+radius);
 }else data={home:null,slot:null,groups:[],unmapped:0};
 if(!valid())return;
 const nowCount=data.ready_total??(data.groups.reduce((n,g)=>n+g.ready_count,0)+(available?1:0)),usualCount=data.usual_total??(data.groups.reduce((n,g)=>n+g.usual_count,0)+(data.self_usual?1:0));
 const needsLocation=!data.home?.latitude;
 app.innerHTML=`<section class="discovery-overview"><div class="discovery-title"><h1>Who's nearby?</h1><div class="map-key"><span><i class="status-dot now"></i> ${nowCount} ready to play</span><span><i class="status-dot usual"></i> ${usualCount} usually available</span></div></div>
 <div class="discovery-controls"><div class="row"><label>Show<select id="map-filter"><option value="all">All players</option><option value="now">Ready to Play</option><option value="usual">Usually available</option></select></label><label>Within<select id="map-radius">${[2,5,10,20].map(r=>`<option value="${r}" ${r===radius?'selected':''}>${r} km</option>`).join('')}</select></label></div></div></section>
 <div class="discovery-layout"><div class="map-panel"><div id="nearby-map" aria-label="Map of nearby players by place"></div><div class="map-caption"><span><i class="status-dot now"></i> Ready to Play</span><span><i class="status-dot usual"></i> Usually available</span><span>Selected places · SGT</span></div></div><aside class="player-panel"><div class="row between"><h2>Nearby players</h2><button id="refresh-map" class="quiet">Refresh</button></div><div id="player-list"></div></aside></div>
 ${needsLocation?'<p class="map-note">Choose your selected place using OneMap in <a href="#profile">Profile</a> to centre the map and search by distance. Without a selected place, results stay within your neighbourhood.</p>':''}
 ${data.unmapped?'<p class="map-note">Some players do not yet have a map location.</p>':''}
 <p class="compact muted">See multiple players available but no game yet? Create a lobby to start discussing with others!</p>
 <div class="row between section games-heading"><h2>Nearby games</h2><button class="primary" id="suggest">Create a Game</button></div><div id="nearby-games-list"><p class="map-note" role="status">Loading games…</p></div>`;
 function gamesMarkup(games,error){return error?'<p class="notice">'+esc(error)+'</p>':games.length?'<div class="grid">'+games.map(o.lobbyCard).join('')+'</div>':'<div class="empty"><p>No games yet. Create a lobby and find a table together.</p></div>'}
 gamesPromise.then(result=>{
  if(!valid())return;const games=result.games||[];o.onGames(games);const list=app.querySelector('#nearby-games-list');if(!list)return;
  list.innerHTML=gamesMarkup(games,result.error);o.bindCards(list);
 });
 function draw(){
  const groups=visibleGroups(data,app.querySelector('#map-filter').value),list=app.querySelector('#player-list');
  list.innerHTML=groups.length?groups.map(g=>`<button type="button" class="player-location" data-map-location="${esc(g.id)}"><span class="row between"><strong>${esc(g.name)}</strong><small>${g.distance==null?'':g.distance+' km'}</small></span><span class="player-address">${esc(g.address)}</span><span class="player-line"><i class="status-dot now"></i>${g.ready_count} Ready to Play</span><span class="player-line"><i class="status-dot usual"></i>${g.usual_count} usually available</span></button>`).join(''):'<div class="empty player-empty"><h3>No players here yet.</h3><p>Try a wider radius, or mark yourself Ready to Play.</p><a href="#schedule">Edit my schedule →</a></div>';
  activeMap?.destroy();activeMap=mountMap(app.querySelector('#nearby-map'),{...data,radius,groups},id=>{list.querySelectorAll('[data-map-location]').forEach(el=>el.classList.toggle('selected',el.dataset.mapLocation===id))});
  list.querySelectorAll('[data-map-location]').forEach(button=>button.onclick=()=>activeMap.focus(button.dataset.mapLocation));
 }
 app.querySelector('#map-filter').value=chosenFilter;draw();
 app.querySelector('#map-filter').onchange=e=>{chosenFilter=e.target.value;draw()};
 app.querySelector('#map-radius').onchange=e=>o.onRadius(Number(e.target.value));
 app.querySelector('#refresh-map').onclick=o.onRefresh;

 app.querySelector('#suggest').onclick=o.onSuggest;
 app.querySelectorAll('[data-join]').forEach(button=>button.onclick=()=>o.onJoin(button.dataset.join));
}
