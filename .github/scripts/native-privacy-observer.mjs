import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {resolve} from 'node:path';
const state=resolve(process.env.RUNNER_TEMP,'native-privacy-observer.private.json');
const backend=resolve('release/packages/backend');
const check=x=>{if(!x)throw Error('OBSERVER_GUARD_FAILED');};
const cli=args=>execFileSync(process.execPath,['node_modules/convex/bin/main.js',...args],{cwd:backend,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000,maxBuffer:2*1024*1024}).trim();
const query=(source,component)=>JSON.parse(cli(['run','--inline-query',source,...(component?['--component',component]:[])]));
const literal=JSON.stringify;
let phase='target';
try{
 check(cli(['dashboard','--no-open']).match(/https:\/\/dashboard\.convex\.dev\/d\/([a-z0-9-]+)/)?.[1]==='woozy-wren-368');
 if(process.argv[2]==='capture'){
  phase='unique-native-fixture';
  const fixture=query(`const invites=await ctx.db.query("betaInvites").order("desc").take(100);
const foundation=invites.filter(x=>typeof x.email==="string"&&x.email.includes("+pikar-foundation-"));
if(foundation.length!==1)throw Error("AMBIGUOUS");const original=foundation[0].email;const at=original.lastIndexOf("@");const local=original.slice(0,at).split("+pikar-foundation-")[0];const domain=original.slice(at);if(!local||domain!=="@gmail.com")throw Error("OWNER");
const users=await ctx.db.query("users").order("desc").take(100);const own=users.filter(x=>typeof x.email==="string"&&x.email.startsWith(local+"+pikar-native-signup-")&&x.email.endsWith(domain));
if(own.length!==1||Date.now()-own[0]._creationTime>7200000||typeof own[0].emailVerificationTime!=="number")throw Error("FRESHNESS");
const admission=invites.filter(x=>x.email===own[0].email);if(admission.length!==1||admission[0].redeemedUserId!==own[0]._id)throw Error("ADMISSION");
const tenantId=String(own[0]._id);const docs=await ctx.db.query("vaultDocuments").withIndex("by_tenant",q=>q.eq("tenantId",tenantId)).take(21);const receipts=await ctx.db.query("uploadReceipts").withIndex("by_tenant",q=>q.eq("tenantId",tenantId)).take(21);
if(docs.length<8||docs.length>20||receipts.length<1||receipts.length>20||docs.some(d=>d.status!=="ready"))throw Error("BOUND");
const blobs=[...new Set([...docs.flatMap(d=>[d.storageId,d.transcriptionStorageId].filter(Boolean)),...receipts.map(r=>r.storageId).filter(Boolean)])];if(blobs.length<1||blobs.length>40)throw Error("BOUND");for(const id of blobs)if(!await ctx.db.system.get("_storage",id))throw Error("BLOB_MISSING");
const entries=docs.map(d=>d.ragEntryId).filter(Boolean);if(entries.length<7||entries.some(id=>id.startsWith("smoke")))throw Error("INDEXING");return {userId:own[0]._id,tenantId,blobs,entries};`);
  phase='rag-capture';
  const rag=query(`const tenant=${literal(fixture.tenantId)};const records=[];for(const kind of ["ready","pending","replaced"]){const rows=await ctx.db.query("namespaces").withIndex("status_namespace_version",q=>q.eq("status.kind",kind).eq("namespace",tenant)).take(4);if(rows.length>3)throw Error("BOUND");records.push(...rows);}if(!records.length)throw Error("NAMESPACE_MISSING");const namespaces=records.map(x=>x._id);const dimensions=[...new Set(records.map(x=>x.dimension))];const entries=[];for(const namespaceId of namespaces){const rows=await ctx.db.query("entries").withIndex("namespaceId_status_key_version",q=>q.eq("namespaceId",namespaceId)).take(21);if(rows.length>20)throw Error("BOUND");entries.push(...rows);}if(${literal(fixture.entries)}.some(id=>!entries.some(e=>e._id===id)))throw Error("ENTRY_SCOPE");
const allChunks=await ctx.db.query("chunks").take(1001);if(allChunks.length>1000)throw Error("GLOBAL_CHUNK_BOUND");const chunks=allChunks.filter(c=>namespaces.includes(c.namespaceId));if(chunks.some(c=>c.state.kind!=="ready"))throw Error("CHUNKS");const vectors=[];for(const dimension of dimensions){if(![128,256,512,768,1024,1408,1536,2048,3072,4096].includes(dimension))throw Error("DIMENSION");const rows=await ctx.db.query("vectors_"+dimension).take(1001);if(rows.length>1000)throw Error("GLOBAL_VECTOR_BOUND");vectors.push(...rows.filter(v=>namespaces.includes(v.namespaceId)).map(v=>v._id));}const refs=[...entries.map(e=>e._id),...chunks.flatMap(c=>[c._id,c.contentId,c.state.embeddingId]),...vectors];return {namespaces,dimensions,identities:records.map(x=>[x._id,x.namespace,x._creationTime]),refs:[...new Set(refs)]};`,'rag');
  writeFileSync(state+'.tmp',JSON.stringify({fixture,rag}),{mode:0o600});renameSync(state+'.tmp',state);
  console.log(JSON.stringify({namespaceIdentityFingerprints:rag.identities.map(x=>createHash("sha256").update(JSON.stringify(x)).digest("hex")),captureCompleted:true,uniqueFreshNativeFixture:true,knownStoragePresent:true,readyRagReferencesCaptured:true,selectionLimitedToNewest100:true,readOnlyObserver:true}));
 }else{
  phase='wait-native-erasure';const {fixture,rag}=JSON.parse(readFileSync(state,'utf8'));let evidence;
  const deadline=Date.now()+300000;
  do{
   evidence=query(`const user=await ctx.db.get(${literal(fixture.userId)});const receipts=await ctx.db.query("uploadReceipts").withIndex("by_tenant",q=>q.eq("tenantId",${literal(fixture.tenantId)})).take(1);const docs=await ctx.db.query("vaultDocuments").withIndex("by_tenant",q=>q.eq("tenantId",${literal(fixture.tenantId)})).take(1);let storageAbsent=true;for(const id of ${literal(fixture.blobs)})if(await ctx.db.system.get("_storage",id))storageAbsent=false;return {userAbsent:user===null,receiptsAbsent:receipts.length===0,documentsAbsent:docs.length===0,knownStorageAbsent:storageAbsent};`);
   if(evidence.userAbsent){const r= query(`const namespaces=${literal(rag.namespaces)};let referencesAbsent=true;for(const id of ${literal(rag.refs)})if(await ctx.db.get(id))referencesAbsent=false;let namespacesAbsent=true;let allNamespaceEntriesAbsent=true;for(const id of namespaces){if(await ctx.db.get(id))namespacesAbsent=false;if((await ctx.db.query("entries").withIndex("namespaceId_status_key_version",q=>q.eq("namespaceId",id)).take(1)).length)allNamespaceEntriesAbsent=false;}const chunks=await ctx.db.query("chunks").take(1001);if(chunks.length>1000)throw Error("GLOBAL_CHUNK_BOUND");let allNamespaceVectorsAbsent=true;for(const dimension of ${literal(rag.dimensions)}){const rows=await ctx.db.query("vectors_"+dimension).take(1001);if(rows.length>1000)throw Error("GLOBAL_VECTOR_BOUND");if(rows.some(x=>namespaces.includes(x.namespaceId)))allNamespaceVectorsAbsent=false;}return {knownRagReferencesAbsent:referencesAbsent,knownNamespacesAbsent:namespacesAbsent,allNamespaceEntriesAbsent,allNamespaceChunksAbsent:!chunks.some(x=>namespaces.includes(x.namespaceId)),allNamespaceVectorsAbsent};`,'rag');Object.assign(evidence,r);if(Object.entries(evidence).every(([key,value])=>key==="knownNamespacesAbsent"||value)){if(!evidence.knownNamespacesAbsent)phase="empty-namespace-metadata-retained";break;}}
   await new Promise(resolve=>setTimeout(resolve,10000));
  }while(Date.now()<deadline);
  console.log(JSON.stringify({...evidence,readOnlyObserver:true,inFlightWorkVerified:false,providerCleanupVerified:false,retainedAuditBillingSecurityExceptions:true}));
  check(Object.values(evidence).every(Boolean));
 }
}catch{console.error(JSON.stringify({observerSucceeded:false,phase,privateDiagnosticsSuppressed:true}));process.exitCode=1;}
