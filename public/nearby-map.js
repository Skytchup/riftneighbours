const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function visibleGroups(data,filter){return data.groups.map(g=>({...g,players:g.players.filter(p=>filter==='all'||p.status===filter)})).filter(g=>g.players.length)}
export function mountMap(element,data,onSelect){
 if(!window.L){element.innerHTML='<p class="notice">The map could not load. Use the player list below.</p>';return {destroy(){},focus(){}}}
 const L=window.L,hasHome=data.home?.latitude!=null&&data.home?.longitude!=null;
 const home=hasHome?[data.home.latitude,data.home.longitude]:[1.3521,103.8198];
 const map=L.map(element,{scrollWheelZoom:false,minZoom:11,maxZoom:18,maxBounds:[[1.144,103.535],[1.494,104.502]],maxBoundsViscosity:1}).setView(home,hasHome?14:11);
 L.tileLayer('https://www.onemap.gov.sg/maps/tiles/Default/{z}/{x}/{y}.png',{minZoom:11,maxZoom:18,attribution:'<img src="https://www.onemap.gov.sg/web-assets/images/logo/om_logo.png" alt="" style="height:20px;width:20px;vertical-align:middle"> <a href="https://www.onemap.gov.sg/" target="_blank" rel="noopener noreferrer">OneMap</a> © contributors | <a href="https://www.sla.gov.sg/" target="_blank" rel="noopener noreferrer">Singapore Land Authority</a>'}).addTo(map);
 const markers=new Map(),positions=[];
 if(hasHome){positions.push(home);const colour=data.self_status==='now'?'#177f70':data.self_status==='usual'?'#d69036':'#163b3b';L.circleMarker(home,{radius:data.self_status?10:6,color:colour,weight:3,fillColor:data.self_status?colour:'#fffaf1',fillOpacity:1}).addTo(map).bindPopup('Your condo · '+esc(data.home.name)+(data.self_status==='now'?'<br>You are Available Now':data.self_status==='usual'?'<br>Your schedule matches this slot':''))}
 for(const group of data.groups){
  const available=group.players.filter(p=>p.status==='now').length;
  const marker=L.marker([group.latitude,group.longitude],{icon:L.divIcon({className:'player-marker-wrap',html:`<span class="player-marker ${available?'is-now':'is-usual'}">${group.players.length}</span>`,iconSize:[42,42],iconAnchor:[21,42]}),title:group.name+' · '+group.players.length+' players',alt:group.name});
  marker.addTo(map).bindPopup(`<div class="map-popup"><strong>${esc(group.name)}</strong><p>${esc(group.address)}</p>${group.players.map(p=>`<div><span class="status-dot ${p.status}"></span> ${esc(p.username)} <small>${p.status==='now'?'Available now':'Usually available'}</small></div>`).join('')}</div>`,{maxWidth:280});
  marker.on('click',()=>onSelect(group.id));markers.set(group.id,marker);positions.push([group.latitude,group.longitude]);
 }
 if(positions.length>1)map.fitBounds(positions,{padding:[50,50],maxZoom:15});
 requestAnimationFrame(()=>map.invalidateSize());
 return {destroy(){map.remove()},focus(id){const marker=markers.get(id);if(marker){map.panTo(marker.getLatLng());marker.openPopup()}}};
}
