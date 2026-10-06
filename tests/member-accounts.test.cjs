const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, mocks={}) {
  const module={exports:{}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {module,exports:module.exports,require:id=>mocks[id] ?? require(id),FormData,console});
  return module.exports;
}
function form(values) { const data=new FormData(); for(const [key,value] of Object.entries(values))data.set(key,value); return data; }
const model=load('lib/members/import.ts');
const sites=[{id:'site-1',name:'Valencia'},{id:'site-2',name:'Navarra'}];
test('people import normalizes email, maps columns and ignores role/password fields',()=>{
  const table={headers:['Nombre','Correo','Sede','Contraseña','Rol'],rows:[['Persona Uno',' ONE@example.org ','Valencia','unsafe','admin']]};
  const mapping=table.headers.map(model.suggestMemberTarget);
  assert.equal(mapping.join(','),'name,email,site,ignore,ignore');
  const [p]=model.mapMembers(table,mapping,'',sites);
  assert.equal(p.email,'one@example.org'); assert.equal(p.role,'volunteer'); assert.equal(p.site,'site-1');
  assert.equal(p.password,undefined);
});
test('people import rejects duplicate/missing emails, duplicate mappings, ambiguous sites and repeated people by clothing',()=>{
  const t={headers:['Nombre','Correo'],rows:[['Persona Uno','one@example.org']]};
  const run=(rows,columns=['name','email'],defaultSite='site-1',available=sites)=>model.mapMembers({...t,rows},columns,defaultSite,available);
  assert.throws(()=>run([['Persona','']]),/correo/);
  assert.throws(()=>run([t.rows[0],['Otra persona','ONE@EXAMPLE.ORG']]),/repetido/);
  assert.throws(()=>run(t.rows,['email','email']),/columna/);
  assert.throws(()=>run(t.rows,['name','email'],'Valencia',[...sites,{id:'site-3',name:'Valencia'}]),/ambigua/);
  assert.throws(()=>run(t.rows,['name','email'],'missing'),/sede/);
  assert.equal(run(t.rows)[0].site,'site-1');
  assert.throws(()=>run(Array.from({length:501},()=>t.rows[0])));
});

function authHarness(options={}) {
  const calls=[];
  const auth={
    signInWithOtp:async args=>{calls.push(['request',args]);return{error:options.requestError??null};},
    resetPasswordForEmail:async email=>{calls.push(['recover',email]);return{error:options.requestError??null};},
    verifyOtp:async args=>{calls.push(['verify',args]);return{error:options.verifyError??null,data:{session:options.verifyError?null:{access_token:'SECRET'}}};},
    updateUser:async args=>{calls.push(['update',args]);return{error:options.updateError??null};},
    signOut:async args=>{calls.push(['signout',args]);return{error:null};}
  };
  return {calls,...load('app/auth/code/actions.ts',{'@/lib/supabase/code-auth':{createCodeAuthClient:()=>({auth})}})};
}
const valid={email:' PERSON@example.org ',mode:'activate',code:'12345678',password:'a-long-test-password',repeat:'a-long-test-password'};
test('activation never signs up public users and does not reveal unknown emails or rate limits',async()=>{
  const a=authHarness(), b=authHarness({requestError:{status:400,code:'otp_disabled'}}),c=authHarness({requestError:{status:429}});
  const responses=await Promise.all([a,b,c].map(h=>h.requestAccessCode(undefined,form(valid))));
  assert.equal(responses[0].success,responses[1].success);assert.equal(responses[0].success,responses[2].success);
  assert.equal(a.calls[0][1].options.shouldCreateUser,false); assert.equal(a.calls[0][1].email,'person@example.org');
  const recovery=authHarness();await recovery.requestAccessCode(undefined,form({...valid,mode:'recover'}));
  assert.equal(recovery.calls[0][0],'recover');
});
test('password validation happens before consuming any OTP',async()=>{
  for(const changes of [{repeat:'mismatch'},{password:'short',repeat:'short'},{code:'abc'},{email:'bad'},{mode:'admin'}]){
    const h=authHarness();assert.ok((await h.setPasswordWithCode(undefined,form({...valid,...changes}))).error);assert.equal(h.calls.length,0);
  }
});
test('bad OTP never updates passwords; correct email/recovery tokens update only the verified session and revoke refresh tokens',async()=>{
  const bad=authHarness({verifyError:{message:'bad'}});assert.ok((await bad.setPasswordWithCode(undefined,form(valid))).error);
  assert.equal(bad.calls.length,1);
  for(const [mode,type] of [['activate','email'],['recover','recovery']]){
    const h=authHarness();const result=await h.setPasswordWithCode(undefined,form({...valid,mode}));
    assert.ok(result.success);assert.equal(h.calls.map(c=>c[0]).join(','),'verify,update,signout');
    assert.equal(h.calls[0][1].type,type);assert.equal(h.calls[2][1].scope,'global');
    assert.doesNotMatch(JSON.stringify(result),/SECRET|access_token|refresh_token|password/);
  }
});
test('password update failure requires a new code and still disposes of the verification session',async()=>{
  const h=authHarness({updateError:{message:'private configuration'}});
  const result=await h.setPasswordWithCode(undefined,form(valid));
  assert.match(result.error,/Solicita otro código/);assert.doesNotMatch(result.error,/private/);
  assert.equal(h.calls.at(-1)[0],'signout');
});

function provisionHarness({done=false,existing=false,createError=false,mailError=false,finishError=false}={}) {
  const calls=[];
  const supabase={rpc:async(name,args)=>{
    calls.push([name,args]);
    if(name==='claim_member_provision')return{data:{done,email:'member@example.org',profile_id:existing?'existing':null,request_id:'approved',token:'lease'},error:null};
    return{error:finishError?{message:'offline'}:null};
  }};
  const helper=load('lib/members/provision.ts',{
    '@/lib/supabase/admin':{createAdminClient:()=>({auth:{admin:{createUser:async args=>{calls.push(['create',args]);return{data:{user:createError?null:{id:'new'}},error:createError?{}:null};}}}})},
    '@/lib/supabase/code-auth':{createCodeAuthClient:()=>({auth:{signInWithOtp:async args=>{calls.push(['email',args]);return{error:mailError?{}:null};}}})}
  });
  return{calls,run:()=>helper.provisionMember(supabase,'request')};
}
test('provisioning requires a DB claim, creates no temporary password and uses only trusted app metadata',async()=>{
  const h=provisionHarness();assert.ok((await h.run()).success);
  assert.equal(h.calls.map(c=>c[0]).join(','),'claim_member_provision,create,email,finish_member_provision');
  const create=h.calls.find(c=>c[0]==='create')[1];assert.equal(create.email_confirm,false);assert.equal(create.password,undefined);
  assert.equal(create.user_metadata,undefined);assert.equal(create.app_metadata.iae_provision_request,'approved');
  assert.equal(h.calls.find(c=>c[0]==='email')[1].options.shouldCreateUser,false);
});
test('existing and completed requests never recreate users; SMTP failure is retryable without deleting accounts',async()=>{
  const done=provisionHarness({done:true});await done.run();assert.equal(done.calls.length,1);
  const existing=provisionHarness({existing:true});await existing.run();assert.ok(!existing.calls.some(c=>c[0]==='create'));
  const failed=provisionHarness({mailError:true});assert.match((await failed.run()).error,/Cuenta creada/);
  assert.equal(failed.calls.at(-1)[1].p_sent,false);
  const creation=provisionHarness({createError:true});assert.ok((await creation.run()).error);assert.ok(!creation.calls.some(c=>c[0]==='email'));
  const unknown=provisionHarness({finishError:true});assert.match((await unknown.run()).error,/sin confirmar/);
});
