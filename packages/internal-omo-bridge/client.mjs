import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { invariant } from './policy.mjs';
export class PrivateOmoClient {
  constructor({ nodeExecutable, runtimeCli, secret, allowedRoots, stateRoot, omoExecutable, timeoutMs=30_000 }) { this.nodeExecutable=nodeExecutable; this.runtimeCli=runtimeCli; this.secret=secret; this.allowedRoots=allowedRoots; this.stateRoot=stateRoot; this.omoExecutable=omoExecutable; this.timeoutMs=timeoutMs; }
  async call(request) {
    invariant(typeof this.nodeExecutable==='string'&&typeof this.runtimeCli==='string','ERR_OMO_RUNTIME','Runtime executable and CLI are required');
    return await new Promise((resolve,reject)=>{
      const child=spawn(this.nodeExecutable,[this.runtimeCli],{stdio:['pipe','pipe','pipe'],windowsHide:true,env:{...process.env,SHIPPING_OMO_SHARED_SECRET:this.secret,SHIPPING_OMO_ALLOWED_ROOTS:this.allowedRoots.join(process.platform==='win32'?';':':'),SHIPPING_OMO_STATE_ROOT:this.stateRoot,SHIPPING_OMO_EXECUTABLE:this.omoExecutable,OMO_DISABLE_POSTHOG:'true'}});
      let stderr=''; const timer=setTimeout(()=>{ child.kill('SIGTERM'); reject(Object.assign(new Error('Private OMO RPC timed out'),{code:'ERR_OMO_TIMEOUT'})); },this.timeoutMs);
      child.stderr.on('data',(chunk)=>{ stderr+=String(chunk); if(stderr.length>64*1024) stderr=stderr.slice(-64*1024); });
      const lines=readline.createInterface({input:child.stdout,crlfDelay:Infinity}); let settled=false;
      lines.on('line',(line)=>{ if(settled||!line.trim()) return; try{ const response=JSON.parse(line); settled=true; clearTimeout(timer); child.stdin.end(); child.kill('SIGTERM'); if(!response.ok){ const error=Object.assign(new Error(response.error?.message??'Private OMO RPC failed'),{code:response.error?.code??'ERR_OMO_RPC'}); reject(error); } else resolve(response.result); } catch(error){ settled=true; clearTimeout(timer); reject(Object.assign(new Error(`Invalid private OMO RPC response: ${error.message}`),{code:'ERR_OMO_PROTOCOL'})); }});
      child.on('error',(error)=>{ if(!settled){settled=true;clearTimeout(timer);reject(Object.assign(error,{code:'ERR_OMO_UNAVAILABLE'}));} });
      child.on('exit',(code)=>{ if(!settled){settled=true;clearTimeout(timer);reject(Object.assign(new Error(`Private OMO RPC exited ${code}: ${stderr.trim()}`),{code:'ERR_OMO_UNAVAILABLE'}));} });
      child.stdin.end(`${JSON.stringify(request)}\n`);
    });
  }
  probe(id='probe'){ return this.call({rpc:'shipping-omo/rpc-v1',id,action:'probe'}); }
  execute(envelope,id='execute'){ return this.call({rpc:'shipping-omo/rpc-v1',id,action:'execute',...envelope}); }
  cancel(envelope,id='cancel'){ return this.call({rpc:'shipping-omo/rpc-v1',id,action:'cancel',...envelope}); }
}
