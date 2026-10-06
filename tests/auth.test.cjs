const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
function access(profile, hasUser=true, personal=false) {
  const exports={};
  const source=ts.transpileModule(fs.readFileSync('lib/auth/context.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  const supabase={auth:{getUser:async()=>({data:{user:hasUser?{id:'verified-user'}:null}})},from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:profile,error:null})})};
  vm.runInNewContext(source,{exports,require:id=>{
    if(id==='react')return{cache:fn=>fn};
    if(id==='next/navigation')return{redirect:path=>{throw new Error(path)}};
    if(id==='@/lib/supabase/server')return{createClient:async()=>supabase};
    throw new Error(id);
  }});
  return personal ? exports.requirePersonalAccess : exports.requireAccess;
}
test('verified active administrator can access globally without a headquarters',async()=>{
  const context=await access({is_active:true,headquarters_id:null,app_roles:{code:'admin'}})();
  assert.equal(context.isAdmin,true);
});
test('inactive, missing, unknown-role and unassigned profiles fail closed',async()=>{
  for(const profile of [null,{is_active:false,app_roles:{code:'admin'}},{is_active:true,headquarters_id:null,app_roles:{code:'reader'}},{is_active:true,headquarters_id:'site',app_roles:{code:'unexpected'}}]) await assert.rejects(access(profile)(),/sign-in/);
  await assert.rejects(access({is_active:true,app_roles:{code:'admin'}},false)(),/sign-in/);
});
test('personal-only volunteer can use own portal, never the operational dashboard', async()=>{
  const profile={is_active:true,headquarters_id:'site',app_roles:{code:'volunteer'}};
  assert.equal((await access(profile,true,true)()).roleCode,'volunteer');
  await assert.rejects(access(profile)(),/dashboard\/personal/);
  await assert.rejects(access({...profile,is_active:false},true,true)(),/sign-in/);
  await assert.rejects(access({...profile,headquarters_id:null},true,true)(),/sign-in/);
});
