import test from 'node:test';
import assert from 'node:assert/strict';
import {api,post,setCsrf,ApiError} from '../src/api.ts';

test('JSON login sends credentials and CSRF to the Python endpoint',async()=>{
  const original=globalThis.fetch;
  let request;
  globalThis.fetch=async(path,options)=>{request={path,...options};return new Response(JSON.stringify({user:{name:'demo',role:'player'},csrf:'new-token'}));};
  try{
    setCsrf('test-csrf');
    const response=await post('/api/auth/login',{name:'demo',password:'test-password'});
    assert.equal(response.user.name,'demo');
    assert.equal(request.path,'/api/auth/login');
    assert.equal(request.credentials,'same-origin');
    assert.equal(request.headers.get('X-CSRF-Token'),'test-csrf');
    assert.deepEqual(JSON.parse(request.body),{name:'demo',password:'test-password'});
  }finally{globalThis.fetch=original;}
});

test('file upload keeps multipart boundary generation in the browser',async()=>{
  const original=globalThis.fetch;
  let request;
  globalThis.fetch=async(path,options)=>{request={path,...options};return new Response('{"ok":true}');};
  try{
    const body=new FormData();body.append('file',new File(['print(1)'],'bot.py'));
    await api('/submit',{method:'POST',body});
    assert.equal(request.body,body);
    assert.equal(request.headers.has('Content-Type'),false);
    assert.equal(request.headers.get('X-CSRF-Token'),'test-csrf');
  }finally{globalThis.fetch=original;}
});

test('backend errors and accidental HTML responses are explained',async()=>{
  const original=globalThis.fetch;
  try{
    globalThis.fetch=async()=>new Response('{"error":"Sai mật khẩu"}',{status:401});
    await assert.rejects(api('/me'),error=>error instanceof ApiError&&error.status===401&&error.message==='Sai mật khẩu');
    globalThis.fetch=async()=>new Response('<html>proxy error</html>',{status:502});
    await assert.rejects(api('/me'),/JSON/);
  }finally{globalThis.fetch=original;}
});
