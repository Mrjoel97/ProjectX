import {createHash} from "node:crypto";
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {resolve} from 'node:path';
const state=resolve(process.env.RUNNER_TEMP,'production-native-observer.private.json');
const backend=resolve('release/packages/backend');
const check=x=>{if(!x)throw Error('OBSERVER_GUARD_FAILED');};
const cli=args=>{try{return execFileSync(process.execPath,['node_modules/convex/bin/main.js',...args],{cwd:backend,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000,maxBuffer:2*1024*1024}).trim();}catch(error){const message=String(error.stderr??'').toLowerCase();failureCode=error.code==='ETIMEDOUT'?'CLI_TIMEOUT':message.includes('pagination')||message.includes('paginate')?'CLI_PAGINATION':message.includes('syntaxerror')?'CLI_SYNTAX':message.includes('not a function')?'CLI_METHOD_UNAVAILABLE':message.includes('read limit')||message.includes('too many bytes')?'CLI_READ_LIMIT':message.includes('index')&&message.includes('not found')?'CLI_INDEX_MISSING':'CLI_OTHER';throw Error('PRIVATE_CLI_FAILED');}};
const failureCodes=['AMBIGUOUS','OWNER','FRESHNESS','ACCOUNT_VERIFICATION','USER_VERIFICATION_METADATA','ADMISSION','BOUND','BLOB_MISSING','INDEXING','NAMESPACE_MISSING','ENTRY_SCOPE','GLOBAL_CHUNK_BOUND','CHUNKS','DIMENSION','GLOBAL_VECTOR_BOUND','SCAN_DEADLINE','SCAN_PAGE_BOUND','SCAN_CURSOR','OWN_REFERENCE_BOUND'];
let failureCode='UNCLASSIFIED';
const query=(source,component)=>{const result=JSON.parse(cli(['run','--inline-query',source,...(component?['--component',component]:[])]));if(result?.failure){failureCode=failureCodes.includes(result.failure)?result.failure:'UNCLASSIFIED';throw Error('OBSERVER_GUARD_FAILED');}return result;};
const literal=JSON.stringify;
function scanOwnRagRows(namespaces,dimensions,deadline){
 const refs=[],counts={chunks:0,vectors:0};
 for(const dimension of dimensions)check([128,256,512,768,1024,1408,1536,2048,3072,4096].includes(dimension));
 for(const table of ['chunks',...dimensions.map(d=>'vectors_'+d)]){
  let cursor=null,done=false;const seen=new Set();
  for(let page=0;page<200;page++){
   if(Date.now()>deadline){failureCode='SCAN_DEADLINE';check(false);}
   phase=table==='chunks'?'rag-chunk-page':'rag-vector-page';
   const result=query(`const p=await ctx.db.query(${literal(table)}).paginate({cursor:${literal(cursor)},numItems:100});if(p.page.length>100)return {failure:"SCAN_PAGE_BOUND"};const rows=p.page.filter(r=>${literal(namespaces)}.includes(r.namespaceId));if(${literal(table)}==="chunks"&&rows.some(r=>r.state.kind!=="ready"))return {failure:"CHUNKS"};return {ownCount:rows.length,refs:rows.flatMap(r=>${literal(table)}==="chunks"?[r._id,r.contentId,r.state.embeddingId]:[r._id]),isDone:p.isDone,cursor:p.continueCursor};`,'rag');
   refs.push(...result.refs);counts[table==='chunks'?'chunks':'vectors']+=result.ownCount;
   if(refs.length>3000){failureCode='OWN_REFERENCE_BOUND';check(false);}
   if(result.isDone){done=true;break;}
   if(!result.cursor||seen.has(result.cursor)){failureCode='SCAN_CURSOR';check(false);}seen.add(result.cursor);cursor=result.cursor;
  }
  if(!done){failureCode='SCAN_PAGE_BOUND';check(false);}
 }
 return {refs:[...new Set(refs)],counts};
}
let phase='target';
try{
 check(['capture','verify','diagnose'].includes(process.argv[2]));
 check(cli(['dashboard','--no-open']).match(/https:\/\/dashboard\.convex\.dev\/d\/([a-z0-9-]+)/)?.[1]==='opulent-octopus-494');
 if(process.argv[2]==='diagnose'){
 phase='pagination-capability';const capability=query('const p=await ctx.db.query("chunks").paginate({cursor:null,numItems:100});return {paginationSupported:true,pageCount:p.page.length,complete:p.isDone,cursorString:typeof p.continueCursor==="string"};','rag');console.log(JSON.stringify(capability));
 }else if(process.argv[2]==='capture'){
  phase='unique-native-fixture';
  const fixture=query(`const email=${literal("joel.feruzi+pikar-production-"+createHash("sha256").update("39050363444").digest("hex").slice(0,24)+"@gmail.com")};const own=await ctx.db.query("users").withIndex("email",q=>q.eq("email",email)).take(2);if(own.length!==1||Date.now()-own[0]._creationTime>7200000||own[0]._creationTime>Date.now())return {failure:"FRESHNESS"};const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify([own[0]._id,own[0].email,own[0]._creationTime])));const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");if(hash!=="2d22a9ce4fac7c4aec251681f5fe74c3a4a6bb4dcb9d8a37253b3e6efcb76c5c")return {failure:"OWNER"};
const accounts=await ctx.db.query("authAccounts").withIndex("userIdAndProvider",q=>q.eq("userId",own[0]._id).eq("provider","password")).take(2);if(accounts.length!==1||accounts[0].emailVerified!==own[0].email)return {failure:"ACCOUNT_VERIFICATION"};
if(!Number.isFinite(own[0].emailVerificationTime)||own[0].emailVerificationTime<own[0]._creationTime||own[0].emailVerificationTime>Date.now())return {failure:"USER_VERIFICATION_METADATA"};
const admission=await ctx.db.query("betaInvites").withIndex("by_email",q=>q.eq("email",own[0].email)).take(2);if(admission.length!==1||admission[0].redeemedUserId!==own[0]._id)return {failure:"ADMISSION"};
const tenantId=String(own[0]._id);const resetFence=await ctx.db.query("authRevocations").withIndex("by_userId",q=>q.eq("userId",tenantId)).unique();const liveSessions=await ctx.db.query("authSessions").withIndex("userId",q=>q.eq("userId",own[0]._id)).take(21);if(liveSessions.length>20)return {failure:"BOUND"};const recoveryRevocationStateVerified=resetFence?.requireLiveSession===true&&resetFence.expiresAt>Date.now();const recoverySessionsPostdateRequest=liveSessions.length>0&&liveSessions.every(s=>s._creationTime>=Date.parse("2026-10-17T16:49:33.411Z"));const docs=await ctx.db.query("vaultDocuments").withIndex("by_tenant",q=>q.eq("tenantId",tenantId)).take(21);const receipts=await ctx.db.query("uploadReceipts").withIndex("by_tenant",q=>q.eq("tenantId",tenantId)).take(21);
if(docs.length!==8||receipts.length!==1||receipts.some(r=>r.state!=="complete"||!r.storageId)||docs.some(d=>d.status!=="ready"))return {failure:"BOUND"};
const blobs=[...new Set([...docs.flatMap(d=>[d.storageId,d.transcriptionStorageId].filter(Boolean)),...receipts.map(r=>r.storageId).filter(Boolean)])];if(blobs.length<1||blobs.length>40)return {failure:"BOUND"};for(const id of blobs)if(!await ctx.db.system.get("_storage",id))return {failure:"BLOB_MISSING"};
const entries=docs.map(d=>d.ragEntryId).filter(Boolean);if(entries.length<7||entries.some(id=>id.startsWith("smoke")))return {failure:"INDEXING"};return {userId:own[0]._id,tenantId,blobs,entries,recoveryRevocationStateVerified,recoverySessionsPostdateRequest};`);
  phase='rag-namespace-capture';
  const rag=query(`const tenant=${literal(fixture.tenantId)};const records=[];for(const kind of ["ready","pending","replaced"]){const rows=await ctx.db.query("namespaces").withIndex("status_namespace_version",q=>q.eq("status.kind",kind).eq("namespace",tenant)).take(4);if(rows.length>3)return {failure:"BOUND"};records.push(...rows);}if(!records.length)return {failure:"NAMESPACE_MISSING"};const namespaces=records.map(x=>x._id);const dimensions=[...new Set(records.map(x=>x.dimension))];const entries=[];for(const namespaceId of namespaces){const rows=await ctx.db.query("entries").withIndex("namespaceId_status_key_version",q=>q.eq("namespaceId",namespaceId)).take(21);if(rows.length>20)return {failure:"BOUND"};entries.push(...rows);}if(${literal(fixture.entries)}.some(id=>!entries.some(e=>e._id===id)))return {failure:"ENTRY_SCOPE"};
return {namespaces,dimensions,identities:records.map(x=>[x._id,x.namespace,x._creationTime]),refs:entries.map(e=>e._id)};`,'rag');
  const scanned=scanOwnRagRows(rag.namespaces,rag.dimensions,Date.now()+180000);rag.refs=[...new Set([...rag.refs,...scanned.refs])];
  writeFileSync(state+'.tmp',JSON.stringify({fixture,rag}),{mode:0o600});renameSync(state+'.tmp',state);
  console.log(JSON.stringify({passwordAccountVerified:true,userVerificationMetadataVerified:true,recoveryRevocationStateVerified:fixture.recoveryRevocationStateVerified,recoverySessionsPostdateRequest:fixture.recoverySessionsPostdateRequest,earlierPlaintextRejectionAssertionsQualified:false,captureCompleted:true,uniqueFreshNativeFixture:true,knownStoragePresent:true,readyRagReferencesCaptured:true,exactDigestSelectionVerified:true,exactIndexedIdentityVerified:true,readOnlyObserver:true}));
 }else{
  phase='wait-native-erasure';const {fixture,rag}=JSON.parse(readFileSync(state,'utf8'));let evidence;
  const deadline=Date.now()+300000;
  do{
   evidence=query(`const user=await ctx.db.get(${literal(fixture.userId)});const receipts=await ctx.db.query("uploadReceipts").withIndex("by_tenant",q=>q.eq("tenantId",${literal(fixture.tenantId)})).take(1);const docs=await ctx.db.query("vaultDocuments").withIndex("by_tenant",q=>q.eq("tenantId",${literal(fixture.tenantId)})).take(1);let storageAbsent=true;for(const id of ${literal(fixture.blobs)})if(await ctx.db.system.get("_storage",id))storageAbsent=false;const fence=await ctx.db.query("authRevocations").withIndex("by_userId",q=>q.eq("userId",${literal(fixture.tenantId)})).unique();const sessions=await ctx.db.query("authSessions").withIndex("userId",q=>q.eq("userId",${literal(fixture.userId)})).take(1);const accounts=await ctx.db.query("authAccounts").withIndex("userIdAndProvider",q=>q.eq("userId",${literal(fixture.userId)})).take(1);return {authSessionsAbsent:sessions.length===0,authAccountsAbsent:accounts.length===0,deletedFenceRetained:fence?.state==="deleted",ragCleanupComplete:fence?.ragCleanup?.state==="complete",userAbsent:user===null,receiptsAbsent:receipts.length===0,documentsAbsent:docs.length===0,knownStorageAbsent:storageAbsent};`);
   if(evidence.userAbsent){const r= query(`const namespaces=${literal(rag.namespaces)};let referencesAbsent=true;for(const id of ${literal(rag.refs)})if(await ctx.db.get(id))referencesAbsent=false;let namespacesAbsent=true;let allNamespaceEntriesAbsent=true;for(const id of namespaces){if(await ctx.db.get(id))namespacesAbsent=false;if((await ctx.db.query("entries").withIndex("namespaceId_status_key_version",q=>q.eq("namespaceId",id)).take(1)).length)allNamespaceEntriesAbsent=false;}let allNamespaceVersionsAbsent=true;for(const kind of ["ready","pending","replaced"]){if((await ctx.db.query("namespaces").withIndex("status_namespace_version",q=>q.eq("status.kind",kind).eq("namespace",${literal(fixture.tenantId)})).take(1)).length)allNamespaceVersionsAbsent=false;}return {allNamespaceVersionsAbsent,knownRagReferencesAbsent:referencesAbsent,knownNamespacesAbsent:namespacesAbsent,allNamespaceEntriesAbsent};`,'rag');Object.assign(evidence,r);if(Object.values(evidence).every(Boolean)){const scanned=scanOwnRagRows(rag.namespaces,rag.dimensions,Math.min(deadline,Date.now()+180000));evidence.allNamespaceChunksAbsent=scanned.counts.chunks===0;evidence.allNamespaceVectorsAbsent=scanned.counts.vectors===0;if(evidence.allNamespaceChunksAbsent&&evidence.allNamespaceVectorsAbsent)break;}}
   await new Promise(resolve=>setTimeout(resolve,10000));
  }while(Date.now()<deadline);
  console.log(JSON.stringify({...evidence,readOnlyObserver:true,inFlightWorkVerified:false,providerCleanupVerified:false,retainedAuditBillingSecurityExceptions:true}));
  check(Object.values(evidence).every(Boolean));
 }
}catch{console.error(JSON.stringify({observerSucceeded:false,phase,failureCode,privateDiagnosticsSuppressed:true}));process.exitCode=1;}
