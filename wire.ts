// Deterministic scenario data shared by the forge and its conformance suite.
const SEED = 0x6a09e667f3bcc909n;
const MASK = 0xffffffffffffffffn;
const adjectives = 'amber brisk calm crisp eager faint gentle happy idle jolly keen lively mellow nimble open plain quick quiet rapid soft steady tidy upbeat vivid warm witty young zesty'.split(' ');
const nouns = 'acorn badger canyon cedar comet coral delta ember falcon glade harbor indigo juniper kettle lantern meadow nebula orchid pebble quartz raven saffron thistle umber violet willow yarrow zephyr'.split(' ');
const descriptions = ['a small service with a sharp edge','notes and experiments, kept until they are not','the tooling behind the thing','a reference implementation, for reading','what the prototype became','fixtures, generators and the odd benchmark','the parts that must not break','a sandbox for the next idea'];
function mix(x: bigint): bigint { x=(x+0x9e3779b97f4a7c15n)&MASK; x=((x^(x>>30n))*0xbf58476d1ce4e5b9n)&MASK; x=((x^(x>>27n))*0x94d049bb133111ebn)&MASK; return x^(x>>31n); }
function rng(label: string) {
  let h=0xcbf29ce484222325n;
  for (const c of label) h=((h^BigInt(c.charCodeAt(0)))*0x100000001b3n)&MASK;
  let state=mix(SEED^h)||SEED;
  return () => { let x=state; x^=x>>12n; x^=(x<<25n)&MASK; x^=x>>27n; state=x&MASK; return Number(((x*0x2545f4914f6cdd1dn)&MASK)>>32n); };
}
function pick<T>(next:()=>number, a:readonly T[]):T{const limit=0x100000000-(0x100000000%a.length);let n:number;do{n=next();}while(n>=limit);return a[n%a.length]!;}
function users(){
  const first='ada bram cora dmitri elena felix greta hugo iris jonas kira lars mira nico olga pavel quinn rosa sven tess ulla vito wren yara zane'.split(' ');
  const last='anders bauer costa dahl eriksen fischer garcia holm iversen jansen keller lind moreau novak olsen peters quist rossi sato turi ulrich vega weber xu yilmaz zimmer'.split(' ');
  const next=rng('users'),used=new Set<string>();
  return Array.from({length:12},(_,i)=>{const f=pick(next,first),l=pick(next,last);let login=f+l,n=2;while(used.has(login))login=`${f}${l}-${n++}`;used.add(login);return {id:1000+i,login,name:`${f} ${l}`,email:`${login}@example.invalid`};});
}
function repos(owner:string,count:number,firstId:number,label:string){
  const next=rng(label),used=new Set<string>();return Array.from({length:count},(_,i)=>{const base=`${pick(next,adjectives)}-${pick(next,nouns)}`;let name=base,n=2;while(used.has(name))name=`${base}-${n++}`;used.add(name);return {id:firstId+i,owner,name,fullName:`${owner}/${name}`,description:pick(next,descriptions),private:i%7===3,defaultBranch:'main'};});
}
export function buildScenario(){
  const all=users(), viewer=all[0]!, stranger=all[2]!, orgNext=rng('org');
  const org=`${pick(orgNext,adjectives)}-${pick(orgNext,nouns)}-org`;
  return {seed:'6a09e667f3bcc909',viewer,teammate:all[1]!,stranger,users:all,org,
    repos:repos(viewer.login,30,5000,'repos.viewer'),orgRepos:repos(org,6,6000,'repos.org'),strangerRepos:repos(stranger.login,3,7000,'repos.stranger'),
    labels:['bug','enhancement','documentation','question','good first issue','help wanted'],branches:['main','develop','release/1.0'],filePaths:[],blobs:[],commits:[],issues:[],pulls:[]};
}
