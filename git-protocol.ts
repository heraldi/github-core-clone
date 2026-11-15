// Compact Git object and smart-protocol primitives used by the forge.
import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';

export const ZERO_OID = '0'.repeat(40);
export type GitObjectType = 'commit' | 'tree' | 'blob' | 'tag';
export interface GitObject { readonly type: GitObjectType; readonly data: Buffer }
type Packet = { kind: 'data'; payload: Buffer; raw: Buffer } | { kind: 'flush' | 'delim' | 'response-end' };
const types: GitObjectType[] = ['commit','tree','blob','tag'];
const codes: Record<number, GitObjectType> = {1:'commit',2:'tree',3:'blob',4:'tag'};
const oidPattern = /^[0-9a-f]{40}$/;
const asBuffer = (x: Uint8Array) => Buffer.isBuffer(x) ? x : Buffer.from(x.buffer, x.byteOffset, x.byteLength);

/** Encode one data pkt-line, including its four ASCII-hex length bytes. */
export function encodePktLine(payload: string | Uint8Array): Buffer {
  const data = typeof payload === 'string' ? Buffer.from(payload) : asBuffer(payload);
  const size = data.length + 4;
  if (size > 0xffff) throw new Error('pkt-line exceeds the 4-hex-digit maximum');
  return Buffer.concat([Buffer.from(size.toString(16).padStart(4, '0')), data]);
}
export const pktLineFlush = () => Buffer.from('0000');
export const pktLineDelim = () => Buffer.from('0001');
export function encodePktLines(lines: ReadonlyArray<string | Uint8Array | 'flush' | 'delim' | 'response-end'>): Buffer {
  return Buffer.concat(lines.map(line => line === 'flush' ? pktLineFlush() : line === 'delim' ? pktLineDelim() : line === 'response-end' ? Buffer.from('0002') : encodePktLine(line)));
}

/** Decode a complete pkt-line stream; malformed and truncated lengths are rejected. */
export function decodePktLines(input: Uint8Array, options: {allowTrailing?: boolean} = {}): Packet[] {
  const b = asBuffer(input), out: Packet[] = [];
  let at = 0;
  while (at < b.length) {
    if (at + 4 > b.length) { if (options.allowTrailing) break; throw new Error('truncated pkt-line header'); }
    const text = b.toString('ascii', at, at + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(text)) { if (options.allowTrailing) break; throw new Error('invalid pkt-line length'); }
    const n = parseInt(text, 16); at += 4;
    if (n === 0) { out.push({kind:'flush'}); continue; }
    if (n === 1) { out.push({kind:'delim'}); continue; }
    if (n === 2) { out.push({kind:'response-end'}); continue; }
    if (n < 4 || at + n - 4 > b.length) { if (options.allowTrailing) break; throw new Error('truncated pkt-line payload'); }
    const raw = b.subarray(at - 4, at + n - 4);
    out.push({kind:'data', payload:b.subarray(at, at + n - 4), raw}); at += n - 4;
  }
  return out;
}

/** SHA-1 over Git's canonical `<type> <length>\\0<data>` object stream. */
export function hashObject(type: GitObjectType, data: Uint8Array): string {
  const bytes = asBuffer(data);
  return createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest('hex');
}

export interface TreeEntry { readonly mode: string; readonly name: string; readonly oid: string }
export interface CommitView { readonly tree: string; readonly parents: string[]; readonly author: string; readonly committer: string; readonly message: string; readonly extraHeaders: ReadonlyArray<readonly [string,string]> }
export interface TagView { readonly object: string; readonly type: GitObjectType; readonly tag: string; readonly tagger: string; readonly message: string }

/** Parse binary tree entries: ASCII mode/name/NUL followed by a raw 20-byte object id. */
export function parseTree(input: Uint8Array): TreeEntry[] {
  const b = asBuffer(input), entries: TreeEntry[] = [];
  for (let at = 0; at < b.length;) {
    const space = b.indexOf(32, at), nul = space < 0 ? -1 : b.indexOf(0, space + 1);
    if (space < 0 || nul < 0 || nul + 21 > b.length) throw new Error('malformed tree entry');
    const mode = b.toString('ascii', at, space), name = b.toString('utf8', space + 1, nul);
    if (!/^[0-7]+$/.test(mode) || !name) throw new Error('invalid tree mode or name');
    entries.push({mode,name,oid:b.subarray(nul + 1, nul + 21).toString('hex')}); at = nul + 21;
  }
  return entries;
}

/** Read commit headers and the uninterpreted commit message. */
export function parseCommit(input: Uint8Array): CommitView {
  const b = asBuffer(input), split = b.indexOf('\n\n'), header = b.subarray(0, split < 0 ? b.length : split).toString('utf8');
  const parents: string[] = [], extra: Array<[string,string]> = [];
  let tree = '', author = '', committer = '';
  for (const line of header.split('\n')) {
    if (line.startsWith(' ')) { if (extra.length) extra[extra.length - 1]![1] += `\n${line}`; continue; }
    const i = line.indexOf(' '), key = i < 0 ? line : line.slice(0,i), value = i < 0 ? '' : line.slice(i+1);
    if (key === 'tree') tree = value;
    else if (key === 'parent') parents.push(value);
    else if (key === 'author') author = value;
    else if (key === 'committer') committer = value;
    else if (key) extra.push([key,value]);
  }
  if (!oidPattern.test(tree) || parents.some(p => !oidPattern.test(p))) throw new Error('invalid commit tree or parent id');
  return {tree,parents,author,committer,message:split < 0 ? '' : b.subarray(split+2).toString('utf8'),extraHeaders:extra};
}

/** Parse the target and descriptive headers of an annotated tag. */
export function parseTag(input: Uint8Array): TagView {
  const b = asBuffer(input), split = b.indexOf('\n\n'), header = b.subarray(0, split < 0 ? b.length : split).toString('utf8');
  const fields = new Map<string,string>();
  for (const line of header.split('\n')) { const i=line.indexOf(' '); if (i > 0) fields.set(line.slice(0,i),line.slice(i+1)); }
  const object=fields.get('object')||'', type=fields.get('type') as GitObjectType;
  if (!oidPattern.test(object) || !types.includes(type)) throw new Error('malformed tag object');
  return {object,type,tag:fields.get('tag')||'',tagger:fields.get('tagger')||'',message:split<0?'':b.subarray(split+2).toString('utf8')};
}

/** Traverse commits, trees, and tags, returning ids (gitlinks are external submodules). */
export function collectReachable(roots: Iterable<string>, lookup: (oid:string)=>GitObject|undefined, options: {allowMissing?:boolean} = {}): Set<string> {
  const seen=new Set<string>(), todo=[...roots].filter(id=>oidPattern.test(id));
  while (todo.length) {
    const id=todo.pop()!; if (seen.has(id)) continue;
    const obj=lookup(id); if (!obj) { if(options.allowMissing) continue; throw new Error(`missing git object ${id}`); }
    seen.add(id);
    if(obj.type==='commit'){const c=parseCommit(obj.data);todo.push(c.tree,...c.parents);}
    else if(obj.type==='tree'){for(const e of parseTree(obj.data))if(e.mode!=='160000')todo.push(e.oid);}
    else if(obj.type==='tag')todo.push(parseTag(obj.data).object);
  }
  return seen;
}

function readSize(b:Buffer, cursor:{at:number}):number {
  if(cursor.at>=b.length)throw new Error('truncated pack object header');
  let v=b[cursor.at++]!, n=v&15, shift=4;
  while(v&128){if(cursor.at>=b.length||shift>56)throw new Error('bad pack size varint');v=b[cursor.at++]!;n+=(v&127)*2**shift;shift+=7;}
  return n;
}
function readOffset(b:Buffer,c:{at:number}):number {
  if(c.at>=b.length)throw new Error('truncated ofs-delta base');
  let v=b[c.at++]!, n=v&127;
  while(v&128){if(c.at>=b.length)throw new Error('truncated ofs-delta base');v=b[c.at++]!;n=(n+1)*128+(v&127);}
  return n;
}
function inflateOne(b:Buffer, at:number):{data:Buffer; next:number} {
  try { const result=inflateSync(b.subarray(at),{info:true}) as unknown as {buffer:Buffer;engine:{bytesWritten:number}}; return {data:result.buffer,next:at+result.engine.bytesWritten}; }
  catch(e){throw new Error(`invalid pack zlib stream: ${e instanceof Error?e.message:String(e)}`);}
}

/** Apply Git's delta opcodes to a base buffer and verify its encoded result size. */
function applyDelta(base:Buffer, delta:Buffer):Buffer {
  let at=0;
  const variable=()=>{let n=0,shift=0,v:number;do{if(at>=delta.length||shift>56)throw new Error('invalid delta varint');v=delta[at++]!;n+=(v&127)*2**shift;shift+=7;}while(v&128);return n;};
  const source=variable(),target=variable(); if(source!==base.length)throw new Error('delta base length mismatch');
  const out=Buffer.alloc(target);let written=0;
  while(at<delta.length){const op=delta[at++]!;
    if(op&128){let off=0,size=0;for(let i=0;i<4;i++)if(op&(1<<i)){if(at>=delta.length)throw new Error('truncated delta copy offset');off+=delta[at++]!*2**(8*i);}for(let i=0;i<3;i++)if(op&(16<<i)){if(at>=delta.length)throw new Error('truncated delta copy size');size+=delta[at++]!*2**(8*i);}if(!size)size=0x10000;if(off+size>base.length||written+size>target)throw new Error('delta copy exceeds bounds');base.copy(out,written,off,off+size);written+=size;
    }else{if(!op||at+op>delta.length||written+op>target)throw new Error('invalid delta insert');delta.copy(out,written,at,at+op);at+=op;written+=op;}}
  if(written!==target)throw new Error('delta result length mismatch');return out;
}

export interface PackReadResult {readonly version:number;readonly declaredCount:number;readonly objects:Map<string,GitObject>;readonly entries:unknown[];readonly trailer:string;readonly computedTrailer:string;readonly checksumOk:boolean;readonly deltaCount:number;readonly byteLength:number}

/** Read v2/v3 packs, expanding OFS/REF deltas and checking object ids and the trailer checksum. */
export function readPack(input:Uint8Array, options:{resolveBase?:(oid:string)=>GitObject|undefined}={}):PackReadResult {
  const b=asBuffer(input);if(b.length<32||b.toString('ascii',0,4)!=='PACK')throw new Error('invalid or truncated pack header');
  const version=b.readUInt32BE(4),count=b.readUInt32BE(8),end=b.length-20;if(version!==2&&version!==3)throw new Error(`unsupported pack version ${version}`);
  const trailer=b.subarray(end).toString('hex'),computed=createHash('sha1').update(b.subarray(0,end)).digest('hex');
  type Raw={offset:number;code:number;size:number;data:Buffer;baseOffset?:number;baseOid?:string;resolved?:GitObject;oid?:string};
  const raw:Raw[]=[], byOffset=new Map<number,Raw>();let at=12,deltaCount=0;
  for(let i=0;i<count;i++){
    const offset=at,first=b[at++];if(first===undefined)throw new Error('truncated pack object');const cursor={at:at-1};const size=readSize(b,cursor);at=cursor.at;const code=(first>>4)&7;const entry:Raw={offset,code,size,data:Buffer.alloc(0)};
    if(code===6){const c={at};const distance=readOffset(b,c);at=c.at;if(distance<=0||distance>offset)throw new Error('invalid ofs-delta distance');entry.baseOffset=offset-distance;deltaCount++;}
    else if(code===7){if(at+20>end)throw new Error('truncated ref-delta id');entry.baseOid=b.subarray(at,at+20).toString('hex');at+=20;deltaCount++;}
    else if(!codes[code])throw new Error(`invalid pack object type ${code}`);
    const z=inflateOne(b.subarray(0,end),at);at=z.next;if(z.data.length!==size)throw new Error('pack entry size does not match inflated data');entry.data=z.data;raw.push(entry);byOffset.set(offset,entry);
  }
  if(at!==end)throw new Error('unexpected bytes before pack checksum');
  const objects=new Map<string,GitObject>(), resolvedIds=new Map<string,Raw>(), resolving=new Set<Raw>();
  const resolve=(entry:Raw):GitObject=>{
    if(entry.resolved)return entry.resolved;if(resolving.has(entry))throw new Error('cyclic pack delta');resolving.add(entry);
    let type:GitObjectType,data:Buffer;
    if(entry.code===6||entry.code===7){let base:GitObject|undefined;
      if(entry.code===6){const found=byOffset.get(entry.baseOffset!);if(found)base=resolve(found);}
      else {const found=resolvedIds.get(entry.baseOid!);base=found?resolve(found):options.resolveBase?.(entry.baseOid!);}
      if(!base)throw new Error('unresolved pack delta base');type=base.type;data=applyDelta(base.data,entry.data);
    }else{type=codes[entry.code]!;data=entry.data;}
    const obj={type,data};const id=hashObject(type,data);entry.resolved=obj;entry.oid=id;objects.set(id,obj);resolvedIds.set(id,entry);resolving.delete(entry);return obj;
  };
  for(const entry of raw)resolve(entry);
  return {version,declaredCount:count,objects,entries:raw.map(e=>({offset:e.offset,type:e.resolved?.type,size:e.size,data:e.resolved?.data,oid:e.oid,delta:e.code===6?'ofs':e.code===7?'ref':null})),trailer,computedTrailer:computed,checksumOk:trailer===computed,deltaCount,byteLength:b.length};
}

function writeObjectHeader(type:GitObjectType,size:number):Buffer {
  const code=types.indexOf(type)+1,bytes:number[]=[];let first=(size&15)|(code<<4);size=Math.floor(size/16);
  if(size)first|=128;bytes.push(first);
  while(size){let v=size&127;size=Math.floor(size/128);if(size)v|=128;bytes.push(v);}
  return Buffer.from(bytes);
}

/** Make a plain-object pack (PACK v2, zlib objects, SHA-1 trailer). */
export function writePack(objects:Iterable<GitObject>):Buffer {
  const list=[...objects],head=Buffer.alloc(12);head.write('PACK',0,'ascii');head.writeUInt32BE(2,4);head.writeUInt32BE(list.length,8);
  const parts:Buffer[]=[head];
  for(const obj of list){const data=asBuffer(obj.data);if(!types.includes(obj.type))throw new Error('unknown Git object type');parts.push(writeObjectHeader(obj.type,data.length),deflateSync(data));}
  const body=Buffer.concat(parts),sum=createHash('sha1').update(body).digest();return Buffer.concat([body,sum]);
}
