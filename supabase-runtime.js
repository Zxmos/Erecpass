
(function(){
  const cache=new Map(),K={P:'erecpass_db_patients',S:'erecpass_db_staff',A:'erecpass_db_admin_accounts',N:'erecpass_db_announcements',B:'erecpass_db_appointments',C:'erecpass_db_chats',L:'erecpass_db_logs',X:'erecpass_db_session',G:'erecpass_db_agreement',E:'erecpass_db_emergencynums',T:'erecpass_db_app_settings'};
  [K.P,K.S,K.A,K.N,K.B,K.C,K.L].forEach(k=>cache.set(k,'[]'));cache.set(K.T,'{}');cache.set(K.G,JSON.stringify({text:'Welcome to ERecPass. Please keep your account secure and use this portal only for authorized hospital services.',photo:''}));cache.set(K.E,JSON.stringify({barangay:'0917-123-4567',national:'911'}));
  let role='anon',user=null,loading=false,channel=null,queue=Promise.resolve();
  const sb=()=>window.erecpassSupabase,putSettings=v=>cache.set(K.T,JSON.stringify(v||{})),parse=(s,d=[])=>{try{return JSON.parse(s||'null')??d}catch{return d}},put=(k,v)=>cache.set(k,typeof v==='string'?v:JSON.stringify(v)),err=(s,e)=>console.error('[ERecPass cloud] '+s,e);
  const patient=p=>({id:p.id,user_id:p.user_id,fullName:p.full_name,email:p.email,sim:p.sim,photo:p.photo,ageCategory:p.age_category,guardianNum:p.guardian_num,status:p.status,labResults:p.lab_results||[],prescriptions:p.prescriptions||[],doctorNotes:p.doctor_notes||'',online:!!p.online,active:p.active!==false});
  const staff=s=>({id:s.id,user_id:s.user_id,name:s.name,email:s.email,role:s.role_title,task:s.task,available:s.available,schedule:s.schedule,active:s.active!==false});
  const appt=a=>({id:a.legacy_id||a.id,patientId:a.patient_id,patientName:a.patient_name,doctor:a.doctor,date:a.appointment_date,reason:a.reason,status:a.status,created_by:a.created_by});
  const ann=a=>({id:a.legacy_id||a.id,text:a.body,photo:a.photo,date:a.published_on});
  const msg=m=>({id:m.legacy_id||m.id,user_id:m.user_id,fullName:m.full_name,email:m.email,message:m.message,reply:m.admin_reply,status:m.status,date:m.created_at});
  async function hydrate(){
    if(!sb())throw Error('Supabase client did not initialize');
    loading=true;
    try{
      const publicSettingsRes=await sb().from('app_settings').select('setting_key,setting_value').in('setting_key',['system_branding','system_agreement','emergency_numbers']);
      if(!publicSettingsRes.error){
        const rows=publicSettingsRes.data||[];
        const map=Object.fromEntries(rows.map(x=>[x.setting_key,x.setting_value||{}]));
        const branding=map.system_branding||{};
        putSettings(branding);
        put(K.G,map.system_agreement||{text:'Welcome to ERecPass. Please keep your account secure and use this portal only for authorized hospital services.',photo:''});
        put(K.E,map.emergency_numbers||{barangay:'0917-123-4567',national:'911'});
        if(window.applySystemLogo) window.applySystemLogo(branding.logo_url||branding.logo||'');
      } else {
        err('read public branding',brandingRes.error);
      }
      const sr=await sb().auth.getSession();if(sr.error)throw sr.error;
      const u=sr.data.session?.user;
      if(!u){role='anon';user=null;[K.P,K.S,K.A,K.N,K.B,K.C,K.L].forEach(k=>put(k,'[]'));put(K.X,null);return}
      user=u;
      const pr=await sb().from('profiles').select('id,full_name,role,active').eq('id',u.id).maybeSingle();
      if(pr.error)throw pr.error;
      if(!pr.data||pr.data.active===false){await sb().auth.signOut();role='anon';user=null;put(K.X,null);throw Error('Account is inactive or has no profile')}
      role=pr.data.role||'patient';
      const tables=['patients','staff','appointments','announcements','help_center_messages','activity_logs'];
      const rs=await Promise.all(tables.map(t=>sb().from(t).select('*')));
      rs.forEach((r,i)=>{if(r.error)err('read '+tables[i],r.error)});
      const ps=(rs[0].error?[]:rs[0].data||[]).map(patient),ss=(rs[1].error?[]:rs[1].data||[]).map(staff);
      put(K.P,ps);put(K.S,ss);put(K.B,(rs[2].error?[]:rs[2].data||[]).map(appt));put(K.N,(rs[3].error?[]:rs[3].data||[]).map(ann));put(K.C,(rs[4].error?[]:rs[4].data||[]).map(msg));put(K.L,(rs[5].error?[]:rs[5].data||[]).map(x=>({id:x.id,timestamp:x.created_at,text:x.event_text})));put(K.A,[]);
      const data=role==='patient'?(ps.find(p=>p.user_id===u.id)||{id:u.id,user_id:u.id,email:u.email,fullName:pr.data.full_name}):role==='staff'?(ss.find(s=>s.user_id===u.id)||{id:u.id,user_id:u.id,email:u.email,name:pr.data.full_name}):{id:u.id,user_id:u.id,email:u.email,name:pr.data.full_name,fullName:pr.data.full_name};
      if(typeof currentSession!=='undefined'){
        currentSession={role,data};
        put(K.X,currentSession);
        // Restore the already-open portal after cloud hydration finishes.
        // This prevents the admin Patient List from staying blank when the
        // portal was opened before Supabase finished loading its records.
        if(role==='admin' && typeof window.refreshAdminPortal==='function') window.refreshAdminPortal();
        if(role==='staff' && typeof window.refreshStaffPortal==='function') window.refreshStaffPortal();
        if(role==='patient' && typeof window.refreshPatientPortal==='function') window.refreshPatientPortal();
      }
      if(channel)await sb().removeChannel(channel);
      channel=sb().channel('erecpass-sync-'+u.id);
      ['patients','staff','appointments','announcements','help_center_messages','activity_logs','app_settings'].forEach(t=>channel.on('postgres_changes',{event:'*',schema:'public',table:t},()=>{if(!loading)hydrate().catch(e=>err('realtime refresh',e))}));
      channel.subscribe();
    }finally{loading=false}
  }
  async function persist(k,oldRaw,newRaw,attempt=0){
    if(!sb()||!user)return;
    const old=parse(oldRaw),a=parse(newRaw),client=sb();
    try{
      if(k===K.P){
        if(role==='patient'){
          const before=new Map(old.map(p=>[String(p.id),p]));
          for(const p of a){
            const o=before.get(String(p.id));
            if(o&&JSON.stringify([o.fullName,o.sim,o.photo,o.ageCategory,o.guardianNum,o.labResults,o.prescriptions,o.doctorNotes])!==JSON.stringify([p.fullName,p.sim,p.photo,p.ageCategory,p.guardianNum,p.labResults,p.prescriptions,p.doctorNotes])&&(p.user_id===user.id||p.id===user.id)){
              const r=await client.rpc('update_own_patient_profile',{
                p_full_name:p.fullName??null,p_sim:p.sim??null,p_photo:p.photo??null,
                p_age_category:p.ageCategory??null,p_guardian_num:p.guardianNum??null,
                p_lab_results:p.labResults??null,p_prescriptions:p.prescriptions??null,
                p_doctor_notes:p.doctorNotes??null
              });if(r.error)throw r.error;
            }
          }
          const vr=await client.from('patients').select('id').eq('user_id',user.id).maybeSingle();
          if(vr.error)throw vr.error;
          if(!vr.data)throw Error('Patient record was not verified in Supabase');
        }else if(role==='admin'||role==='staff'){
          const rows=a.map(p=>({
            id:String(p.id),user_id:p.user_id||p.auth_user_id||null,full_name:p.fullName||p.full_name||p.name||'',
            email:p.email||'',sim:p.sim||'',photo:p.photo||'',age_category:p.ageCategory||p.age_category||'',
            guardian_num:p.guardianNum||p.guardian_num||'',status:p.status||'Green',
            lab_results:p.labResults||p.lab_results||[],prescriptions:p.prescriptions||[],
            doctor_notes:p.doctorNotes||p.doctor_notes||'',online:!!p.online,active:p.active!==false
          }));
          if(rows.length){
            const r=await client.from('patients').upsert(rows,{onConflict:'id'});
            if(r.error)throw r.error;
            const ids=rows.map(x=>x.id);
            const vr=await client.from('patients').select('id').in('id',ids);
            if(vr.error)throw vr.error;
            if((vr.data||[]).length!==ids.length)throw Error('Patient record save could not be verified');
          }
          const keep=new Set(a.map(p=>String(p.id)));
          const del=old.filter(p=>!keep.has(String(p.id))).map(p=>String(p.id));
          if(del.length&&role==='admin'){
            const r=await client.from('patients').delete().in('id',del);if(r.error)throw r.error;
          }
        }
      }else if(k===K.S&&role==='admin'){
        const rows=a.map(s=>({id:String(s.id),user_id:s.user_id||null,name:s.name||s.fullName||'',email:s.email||'',role_title:s.role||s.role_title||'',task:s.task||'',available:s.available!==false,schedule:s.schedule||'',active:s.active!==false}));
        if(rows.length){
          const r=await client.from('staff').upsert(rows,{onConflict:'id'});if(r.error)throw r.error;
          const vr=await client.from('staff').select('id').in('id',rows.map(x=>x.id));if(vr.error)throw vr.error;
          if((vr.data||[]).length!==rows.length)throw Error('Staff save could not be verified');
        }
        const keep=new Set(a.map(x=>String(x.id))),del=old.filter(x=>!keep.has(String(x.id))).map(x=>String(x.id));
        if(del.length){const r=await client.from('staff').delete().in('id',del);if(r.error)throw r.error}
      }else if(k===K.B){
        const rows=a.map(x=>({legacy_id:String(x.id),patient_id:String(x.patientId||x.patient_id||''),patient_name:x.patientName||x.patient_name||'',doctor:x.doctor||'',appointment_date:x.date||x.appointment_date||null,reason:x.reason||'',status:x.status||'Pending Approval',created_by:user.id}));
        if(rows.length){
          const r=await client.from('appointments').upsert(rows,{onConflict:'legacy_id'});if(r.error)throw r.error;
          const vr=await client.from('appointments').select('legacy_id').in('legacy_id',rows.map(x=>x.legacy_id));if(vr.error)throw vr.error;
          if((vr.data||[]).length!==rows.length)throw Error('Appointment save could not be verified');
        }
        const keep=new Set(a.map(x=>String(x.id))),del=old.filter(x=>!keep.has(String(x.id))).map(x=>String(x.id));
        if(del.length&&role==='admin'){const r=await client.from('appointments').delete().in('legacy_id',del);if(r.error)throw r.error}
      }else if(k===K.N&&role==='admin'){
        const rows=a.map(x=>({legacy_id:String(x.id),body:x.text||x.body||'',photo:x.photo||'',published_on:x.date||x.published_on||null,created_by:user.id}));
        if(rows.length){
          const r=await client.from('announcements').upsert(rows,{onConflict:'legacy_id'});if(r.error)throw r.error;
          const vr=await client.from('announcements').select('legacy_id').in('legacy_id',rows.map(x=>x.legacy_id));if(vr.error)throw vr.error;
          if((vr.data||[]).length!==rows.length)throw Error('Announcement save could not be verified');
        }
        const keep=new Set(a.map(x=>String(x.id))),del=old.filter(x=>!keep.has(String(x.id))).map(x=>String(x.id));
        if(del.length){const r=await client.from('announcements').delete().in('legacy_id',del);if(r.error)throw r.error}
      }else if(k===K.C){
        for(const x of a){
          if(!x.message&&!x.text)continue;
          const id=String(x.id||crypto.randomUUID());
          const r=await client.from('help_center_messages').upsert({legacy_id:id,user_id:x.user_id||user.id,full_name:x.fullName||x.full_name||currentSession?.data?.fullName||currentSession?.data?.name||'',email:x.email||user.email||'',message:x.message||x.text||'',admin_reply:x.reply||x.admin_reply||'',status:x.status||'New'},{onConflict:'legacy_id'});
          if(r.error)throw r.error;
        }
      }else if(k===K.T&&role==='admin'){
        const v=parse(newRaw,{});
        const r=await client.from('app_settings').upsert({setting_key:'system_branding',setting_value:v,updated_by:user.id,updated_at:new Date().toISOString()},{onConflict:'setting_key'});
        if(r.error)throw r.error;
        const vr=await client.from('app_settings').select('setting_value').eq('setting_key','system_branding').maybeSingle();
        if(vr.error)throw vr.error;
        if(JSON.stringify(vr.data?.setting_value||{})!==JSON.stringify(v))throw Error('System branding save could not be verified');
      }else if(k===K.G&&role==='admin'){
        const v=parse(newRaw,{});
        const r=await client.from('app_settings').upsert({setting_key:'system_agreement',setting_value:v,updated_by:user.id,updated_at:new Date().toISOString()},{onConflict:'setting_key'});
        if(r.error)throw r.error;
        const vr=await client.from('app_settings').select('setting_value').eq('setting_key','system_agreement').maybeSingle();
        if(vr.error)throw vr.error;
        if(JSON.stringify(vr.data?.setting_value||{})!==JSON.stringify(v))throw Error('Agreement save could not be verified');
      }else if(k===K.E&&role==='admin'){
        const v=parse(newRaw,{});
        const r=await client.from('app_settings').upsert({setting_key:'emergency_numbers',setting_value:v,updated_by:user.id,updated_at:new Date().toISOString()},{onConflict:'setting_key'});
        if(r.error)throw r.error;
        const vr=await client.from('app_settings').select('setting_value').eq('setting_key','emergency_numbers').maybeSingle();
        if(vr.error)throw vr.error;
        if(JSON.stringify(vr.data?.setting_value||{})!==JSON.stringify(v))throw Error('Emergency numbers save could not be verified');
      }else if(k===K.L){
        const seen=new Set(old.map(x=>String(x.timestamp)+'|'+String(x.text)));
        for(const x of a.filter(x=>!seen.has(String(x.timestamp)+'|'+String(x.text)))){
          const r=await client.from('activity_logs').insert({actor_id:user.id,event_text:String(x.text||'Activity')});
          if(r.error)throw r.error;
        }
      }
    }catch(e){
      err('write '+k,e);
      window.dispatchEvent(new CustomEvent('erecpass-cloud-error',{detail:{key:k,message:e.message||String(e),attempt:attempt+1}}));
      if(attempt<2 && sb() && user){
        await new Promise(r=>setTimeout(r,700*(attempt+1)));
        return persist(k,oldRaw,newRaw,attempt+1);
      }
      throw e;
    }
  }
  window.epStore={getItem(k){return cache.has(String(k))?cache.get(String(k)):null},setItem(k,v){k=String(k);const old=cache.get(k)??null,n=String(v);cache.set(k,n);if(![K.X,K.A].includes(k)&&user){queue=queue.then(()=>persist(k,old,n)).catch(e=>{err('write queue',e);throw e})}},removeItem(k){k=String(k);const old=cache.get(k);cache.delete(k);if(k!==K.X&&k!==K.T&&old!==undefined&&user)queue=queue.then(()=>persist(k,old,'[]')).catch(e=>{err('remove',e);throw e})},clear(){cache.clear()},key(i){return [...cache.keys()][i]??null},get length(){return cache.size},_put:put};
  window.erecpassCloudFlush=()=>queue;
  window.erecpassCloudHydrate=hydrate;
  const profileFor=async u=>{const r=await sb().from('profiles').select('id,full_name,role,active').eq('id',u.id).single();if(r.error)throw r.error;if(r.data.active===false)throw Error('This account is deactivated');return r.data};
  // The old SMS button only generated a code in this browser; it did not send a real SMS.
  // Keep the existing control, but do not block account creation on a fake verification step.
  window.sendSimCode=function(){
    alert('SMS verification is not connected yet. You can continue registration and verify your account through the email confirmation link.');
  };
  window.handleRegister=async function(e){
    e?.preventDefault();
    const fullName=document.getElementById('regFullName')?.value.trim();
    const email=document.getElementById('regEmail')?.value.trim().toLowerCase();
    const sim=document.getElementById('regSim')?.value.trim();
    const password=document.getElementById('regPassword')?.value||'';
    const confirm=document.getElementById('regConfirmPassword')?.value||'';
    if(!fullName||!email||!sim||!password){alert('Complete all required fields.');return}
    if(password!==confirm){alert('Passwords do not match!');return}
    if(password.length<8){alert('Use a password with at least 8 characters.');return}
    if(!/[#!?]/.test(password)){alert('Password must contain at least one symbol: # ! ?');return}
    if(!sb()?.auth){alert('Connection to the account service is not ready. Refresh the page and try again.');return}
    const submit=document.querySelector('#registerForm button[type="submit"]');
    if(submit){submit.disabled=true;submit.textContent='CREATING ACCOUNT…'}
    try{
      const r=await sb().auth.signUp({email,password,options:{data:{full_name:fullName,sim,role:'patient'}}});
      if(r.error)throw r.error;
      if(r.data.session){
        const p=await profileFor(r.data.user);
        await hydrate();
        hideAuthPages();
        launchPortalByRole(p.role);
        alert('Account created successfully.');
      }else{
        document.getElementById('registerForm')?.reset();
        showLogin();
        alert('Registration successful. Check your email for the confirmation link before logging in.');
      }
    }catch(x){
      const message=x?.message||'Registration failed.';
      if(/already registered|already been registered|user already exists/i.test(message)){
        alert('This email already has an account. Please use Login or Forgot Password.');
      }else{
        alert('Could not create account: '+message);
      }
    }finally{
      if(submit){submit.disabled=false;submit.textContent='CREATE ACCOUNT'}
    }
  };
  window.handleLogin=async function(e){e?.preventDefault();const email=document.getElementById('loginEmail')?.value.trim().toLowerCase(),password=document.getElementById('loginPassword')?.value||'';try{const r=await sb().auth.signInWithPassword({email,password});if(r.error)throw r.error;const p=await profileFor(r.data.user);if(p.role!=='patient'){await sb().auth.signOut();throw Error('This account is not a patient account')}await hydrate();if(currentSession?.data?.active===false){await sb().auth.signOut();throw Error('This patient account is deactivated')}hideAuthPages();launchPortalByRole('patient')}catch(x){alert(x.message||'Login failed')}};
  window.handleStaffLogin=async function(e){e?.preventDefault();const email=document.getElementById('staffLoginName')?.value.trim().toLowerCase(),password=document.getElementById('staffLoginPassword')?.value||'';if(!email?.includes('@')){alert('Enter the staff email address in this field.');return}try{const r=await sb().auth.signInWithPassword({email,password});if(r.error)throw r.error;const p=await profileFor(r.data.user);if(p.role!=='staff'){await sb().auth.signOut();throw Error('This account does not have the staff role')}await hydrate();if(currentSession?.data?.active===false){await sb().auth.signOut();throw Error('This staff account is deactivated')}hideAuthPages();launchPortalByRole('staff')}catch(x){alert(x.message||'Staff login failed')}};
  window.handleAdminLogin=async function(e){
    e?.preventDefault();
    const email=document.getElementById('adminLoginUser')?.value.trim().toLowerCase();
    const password=document.getElementById('adminLoginPassword')?.value||'';
    if(!email?.includes('@')){alert('Enter the email address assigned to your Admin account.');return}
    if(!password){alert('Enter your Admin password.');return}
    if(!sb()?.auth){alert('Connection to the account service is not ready. Refresh the page and try again.');return}
    try{
      const r=await sb().auth.signInWithPassword({email,password});
      if(r.error)throw r.error;
      const p=await profileFor(r.data.user);
      if(p.role!=='admin'){
        await sb().auth.signOut();
        throw Error('This email is registered, but it is not assigned the Admin role yet. Contact the system owner to securely enable Admin access.');
      }
      await hydrate();
      hideAuthPages();
      launchPortalByRole('admin');
    }catch(x){alert(x.message||'Admin login failed. Check the email and password, or use Forgot Password.')}
  };
  window.logout=async function(){try{if(sb())await sb().auth.signOut()}catch(e){err('sign out',e)}if(channel&&sb())await sb().removeChannel(channel);channel=null;user=null;role='anon';currentSession=null;put(K.X,null);putSettings({});[K.P,K.S,K.A,K.N,K.B,K.C,K.L].forEach(k=>put(k,[]));['patientApp','staffApp','adminApp'].forEach(id=>document.getElementById(id)?.classList.add('hidden'));showLogin()};
  const oldOnload=window.onload;window.onload=function(e){let result;try{if(typeof oldOnload==='function')result=oldOnload.call(this,e)}catch(x){err('original startup',x)};Promise.resolve().then(()=>hydrate()).catch(x=>err('startup cloud sync (page remains usable)',x));return result};
  document.addEventListener('DOMContentLoaded',()=>{const i=document.getElementById('staffLoginName');if(i){i.type='email';i.placeholder='Enter staff email'}const l=document.querySelector('#staffLoginForm label');if(l)l.textContent='Staff Email';const a=document.getElementById('adminLoginUser');if(a)a.placeholder='Admin email'});

  window.openErecpassForgotPassword=function(){
    epModal('erecpassForgotModal','Forgot Password',
      '<p style="color:#8fb9b5;font-size:11px">Enter your registered email. Supabase will send a secure password-reset link.</p>'+
      '<label>Email</label><input id="epResetEmail" type="email" placeholder="patient@example.com">'+
      '<div class="erecpass-added-actions"><button type="button" onclick="sendErecpassPasswordReset()">Send to Email</button></div>'+
      '<div id="epResetStep" style="margin-top:12px"></div>');
  };
  window.sendErecpassPasswordReset=async function(){
    const email=document.getElementById('epResetEmail')?.value.trim().toLowerCase();
    if(!email){alert('Enter your registered email.');return}
    try{
      const redirectTo=window.location.origin+window.location.pathname;
      const r=await sb().auth.resetPasswordForEmail(email,{redirectTo});
      if(r.error)throw r.error;
      const step=document.getElementById('epResetStep');
      if(step)step.innerHTML='<p style="color:#8fb9b5;font-size:11px">If the account exists, Supabase will email a secure reset link. Open the link on this device to choose a new password.</p>';
    }catch(e){alert(e.message||'Could not send the password-reset email')}
  };
  window.verifyErecpassPasswordReset=async function(){
    const p1=document.getElementById('epResetNewPass')?.value||'';
    const p2=document.getElementById('epResetNewPass2')?.value||'';
    if(!p1||p1!==p2){alert('Passwords do not match.');return}
    if(!/[#!?]/.test(p1)){alert('Password must contain at least one symbol: # ! ?');return}
    try{
      const r=await sb().auth.updateUser({password:p1});if(r.error)throw r.error;
      document.getElementById('erecpassForgotModal')?.classList.remove('active');
      alert('Password updated in Supabase Auth. You can now log in.');
      await sb().auth.signOut();
    }catch(e){alert('Open the secure reset link from your email first. '+(e.message||''))}
  };
  sb()?.auth.onAuthStateChange((event)=>{
    if(event==='PASSWORD_RECOVERY'){
      window.openErecpassForgotPassword();
      const step=document.getElementById('epResetStep');
      if(step)step.innerHTML='<label>New Password</label><input id="epResetNewPass" type="password" autocomplete="new-password">'+
        '<label>Confirm Password</label><input id="epResetNewPass2" type="password" autocomplete="new-password">'+
        '<div class="erecpass-added-actions"><button type="button" onclick="verifyErecpassPasswordReset()">Update Password</button></div>';
    }
  });

  window.addEventListener('erecpass-cloud-error',e=>{
    console.error('Cloud save failed:',e.detail);
    if(e.detail?.attempt>=3){
      const msg='Cloud save failed. Please check your connection and try again. Nothing was removed from this screen.';
      if(typeof epModal==='function') epModal('erecpassCloudErrorModal','Save Error','<p style="color:#8fb9b5;font-size:12px">'+msg+'</p>');
      else alert(msg);
    }
  });
})();
