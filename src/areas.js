// Singapore's 55 planning areas. Source: SLA OneMap planning-area names.
// https://www.onemap.gov.sg/apidocs/planningarea
// These are neighbourhood choices, not a condominium register or distance bands.
const names = [
 'Ang Mo Kio','Bedok','Bishan','Boon Lay','Bukit Batok','Bukit Merah',
 'Bukit Panjang','Bukit Timah','Central Water Catchment','Changi','Changi Bay',
 'Choa Chu Kang','Clementi','Downtown Core','Geylang','Hougang','Jurong East',
 'Jurong West','Kallang','Lim Chu Kang','Mandai','Marina East','Marina South',
 'Marine Parade','Museum','Newton','North-Eastern Islands','Novena','Orchard',
 'Outram','Pasir Ris','Paya Lebar','Pioneer','Punggol','Queenstown','River Valley',
 'Rochor','Seletar','Sembawang','Sengkang','Serangoon','Simpang','Singapore River',
 'Southern Islands','Straits View','Sungei Kadut','Tampines','Tanglin','Tengah',
 'Toa Payoh','Tuas','Western Islands','Western Water Catchment','Woodlands','Yishun'
];
export const planningAreas = names.map(name => ({
 id:'sg-pa-'+name.toLowerCase().replace(/[^a-z0-9]+/g,'-'),
 name,neighbourhood:name,kind:'neighbourhood'
}));
export function locationChoices(stored) {
 const choices=new Map(planningAreas.map(a=>[a.id,a]));
 for(const a of stored) choices.set(a.id,{...a,kind:a.id.startsWith('sg-pa-')?'neighbourhood':'condo'});
 return [...choices.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
