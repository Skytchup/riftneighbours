export const SLOTS = ['afternoon', 'evening', 'late'];
export function singaporeDate(now = new Date()) { return new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(now); }
export function singaporeDay(date) { return new Date(date+'T12:00:00+08:00').getUTCDay(); }
export function validDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(value)) && new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value; }
export function preferencesValid(items) { return Array.isArray(items) && items.length<=21 && items.every(x=>Number.isInteger(x.day)&&x.day>=0&&x.day<=6&&SLOTS.includes(x.slot)) && new Set(items.map(x=>x.day+':'+x.slot)).size===items.length; }
export function text(value,max=200) { return typeof value==='string' && value.trim().length>0 && value.trim().length<=max; }
// Prevent exact counts of one or two exposing an individual's routine.
export function privateCount(n) { return n < 3 ? (n ? 'A few' : 'No') : String(n); }
