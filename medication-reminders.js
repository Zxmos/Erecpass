/* ERecPass patient medication reminders: schedules live in Supabase. Android APK uses Capacitor Local Notifications so alerts can fire while the app is closed. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var sb = function () { return window.erecpassSupabase; };
  var user = null, patient = null, busy = false, timer = null, fired = new Set();
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]); }); };
  var dateString = function (d) { return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
  var makeDate = function (date, time) { var a=String(date).split('-').map(Number), b=String(time).slice(0,5).split(':').map(Number); return new Date(a[0],a[1]-1,a[2],b[0],b[1],0,0); };
  var hash = function (s) { var h=2166136261; for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);} return (h>>>0)%2147483646+1; };
  var plugin = function () { return window.ERecPassLocalNotifications || (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications) || null; };
  var notificationChannelId = 'erecpass-medication-reminders-v2';
  async function ensureNativeNotificationAccess(n) {
    var p = await n.checkPermissions();
    if (p.display !== 'granted') p = await n.requestPermissions();
    if (p.display !== 'granted') throw new Error('Notifications are blocked. Allow notifications for ERecPass in Android Settings.');
    if (typeof n.checkExactNotificationSetting === 'function' && typeof n.changeExactNotificationSetting === 'function') {
      var exact = await n.checkExactNotificationSetting();
      if (exact && exact.exact_alarm !== 'granted') {
        await n.changeExactNotificationSetting();
        exact = await n.checkExactNotificationSetting();
        if (exact && exact.exact_alarm !== 'granted') throw new Error('Allow ERecPass to set alarms and reminders in Android Settings, then return to ERecPass and tap Enable Alerts again.');
      }
    }
    if (typeof n.createChannel === 'function') {
      await n.createChannel({ id: notificationChannelId, name: 'Medication Reminders', description: 'Scheduled reminders to take prescribed medicine', importance: 5, visibility: 1, vibration: true, sound: 'erecpass_reminder.wav' });
    }
    return true;
  }

  function installUI() {
    var list=$('patientPrescriptionsList');
    if(!list || $('epMedicationReminderPanel')) return;
    var days=[['0','Sun'],['1','Mon'],['2','Tue'],['3','Wed'],['4','Thu'],['5','Fri'],['6','Sat']];
    var checks=days.map(function(d){return '<label class="flex items-center gap-1"><input type="checkbox" name="epReminderDay" value="'+d[0]+'" checked> '+d[1]+'</label>';}).join('');
    list.insertAdjacentHTML('afterend',
      '<section id="epMedicationReminderPanel" class="glass-card rounded-2xl p-4 mt-4 space-y-3">'+
      '<div class="flex items-center justify-between gap-2"><div><h2 class="font-tech text-sm text-white">Medication Reminders</h2><p class="text-xs text-slate-400 mt-1">Set an alert for your prescribed medicine.</p></div>'+
      '<button type="button" id="epReminderPermission" class="px-3 py-2 rounded-lg text-xs font-bold border border-cyan-400/40 text-cyan-200">Enable Alerts</button></div>'+
      '<form id="epReminderForm" class="space-y-3 border border-cyan-500/20 rounded-xl p-3">'+
      '<p class="text-xs text-slate-300">Enter the medicine and dosage exactly as prescribed. This reminder does not change your prescription.</p>'+
      '<label class="block text-xs text-slate-300">Medicine name *<input id="epReminderMedicine" required maxlength="160" class="w-full mt-1 rounded-lg p-2.5 text-sm border border-cyan-500/30 bg-slate-950 text-white" placeholder="Medicine name"></label>'+
      '<label class="block text-xs text-slate-300">Dosage<input id="epReminderDosage" maxlength="160" class="w-full mt-1 rounded-lg p-2.5 text-sm border border-cyan-500/30 bg-slate-950 text-white" placeholder="e.g. 1 tablet"></label>'+
      '<label class="block text-xs text-slate-300">Reminder time *<input id="epReminderTime" type="time" required class="w-full mt-1 rounded-lg p-2.5 text-sm border border-cyan-500/30 bg-slate-950 text-white"></label>'+
      '<div class="grid grid-cols-2 gap-2"><label class="text-xs text-slate-300">Start date *<input id="epReminderStart" type="date" required class="w-full mt-1 rounded-lg p-2.5 text-sm border border-cyan-500/30 bg-slate-950 text-white"></label>'+
      '<label class="text-xs text-slate-300">End date (optional)<input id="epReminderEnd" type="date" class="w-full mt-1 rounded-lg p-2.5 text-sm border border-cyan-500/30 bg-slate-950 text-white"></label></div>'+
      '<fieldset><legend class="text-xs text-slate-300 mb-2">Repeat on *</legend><div class="grid grid-cols-4 gap-2 text-xs text-slate-200">'+checks+'</div></fieldset>'+
      '<label class="block text-xs text-slate-300">Extra note (optional)<input id="epReminderNote" maxlength="500" class="w-full mt-1 rounded-lg p-2.5 text-sm border border-cyan-500/30 bg-slate-950 text-white" placeholder="Optional note"></label>'+
      '<button id="epReminderSave" type="submit" class="primary-btn w-full rounded-xl py-3 text-xs">Save Medication Reminder</button>'+
      '<p class="text-[10px] text-slate-400">Follow your clinician’s instructions. Reminders are not medical advice.</p></form>'+
      '<div><h3 class="font-tech text-xs text-white mb-2">Prescribed medicines</h3><p class="text-[11px] text-slate-400 mb-2">Medicines saved by the hospital appear here. Tap Set Reminder, then choose the time and repeat schedule prescribed by your clinician.</p><div id="epPrescribedMedicineList" class="space-y-2"><p class="text-xs text-slate-400">Loading prescriptions…</p></div></div>' +
      '<div><h3 class="font-tech text-xs text-white mb-2">Your saved reminders</h3><div id="epMedicationReminderList" class="space-y-2"><p class="text-xs text-slate-400">Loading…</p></div></div></section>');
    $('epReminderStart').value=dateString(new Date());
    $('epReminderForm').addEventListener('submit',saveReminder);
    $('epReminderPermission').addEventListener('click',enableAlerts);
    $('epMedicationReminderList').addEventListener('click',listAction);
    $('epPrescribedMedicineList').addEventListener('click',prescribedMedicineAction);
  }

  async function identity() {
    if(!sb() || !sb().auth) throw new Error('Supabase connection is not ready. Please refresh and try again.');
    var a=await sb().auth.getUser();
    if(a.error) throw a.error;
    if(!a.data || !a.data.user) throw new Error('Please log in to your patient account first.');
    var u=a.data.user;
    var p=await sb().from('patients').select('id,user_id,full_name,prescriptions').eq('user_id',u.id).maybeSingle();
    if(p.error) throw p.error;
    if(!p.data) throw new Error('Your patient profile is not linked to this account. Please contact the hospital.');
    user=u; patient=p.data;
    return {user:u,patient:p.data};
  }

  async function enableAlerts() {
    try {
      await identity();
      var n=plugin();
      if(n) {
        await ensureNativeNotificationAccess(n);
        await refresh();
        alert('Medication notifications are enabled. If Android opened Settings, allow notifications and alarms, return to ERecPass, and tap Enable Alerts again.');
      } else if('Notification' in window) {
        var permission=await Notification.requestPermission();
        if(permission!=='granted') { alert('Notification permission was not granted.'); return; }
        await refresh();
        alert('Browser alerts are enabled while the page is open. Use the updated Android APK for alerts while ERecPass is closed.');
      } else alert('This browser does not support notifications. Use the updated Android APK for medication alerts.');
    } catch(e) { console.error('[ERecPass reminders]',e); alert(e.message||'Could not enable alerts.'); }
  }

  async function saveReminder(e) {
    e.preventDefault();
    if(busy) return;
    var medicine=$('epReminderMedicine').value.trim(), dosage=$('epReminderDosage').value.trim();
    var time=$('epReminderTime').value, start=$('epReminderStart').value, end=$('epReminderEnd').value||null;
    var days=Array.from(document.querySelectorAll('input[name="epReminderDay"]:checked')).map(function(x){return Number(x.value);});
    if(!medicine||!time||!start||!days.length) { alert('Enter medicine, time, start date, and at least one repeat day.'); return; }
    if(end && end<start) { alert('End date cannot be earlier than start date.'); return; }
    busy=true; var b=$('epReminderSave'); if(b){b.disabled=true;b.textContent='SAVING…';}
    try {
      await identity();
      var result=await sb().from('medication_reminders').insert({
        patient_id:String(patient.id),patient_user_id:user.id,medication_name:medicine,dosage:dosage,
        reminder_time:time,start_date:start,end_date:end,repeat_days:days,
        instructions:$('epReminderNote').value.trim(),enabled:true,created_by:user.id
      });
      if(result.error) throw result.error;
      $('epReminderForm').reset(); $('epReminderStart').value=dateString(new Date());
      document.querySelectorAll('input[name="epReminderDay"]').forEach(function(x){x.checked=true;});
      await refresh(); alert('Medication reminder saved to your ERecPass account.');
    } catch(err) { console.error('[ERecPass reminders]',err); alert(err.message||'Could not save reminder. Check your connection.'); }
    finally { busy=false; if(b){b.disabled=false;b.textContent='Save Medication Reminder';} }
  }

  async function loadRows() {
    await identity();
    var r=await sb().from('medication_reminders')
      .select('id,medication_name,dosage,reminder_time,start_date,end_date,repeat_days,instructions,enabled')
      .eq('patient_user_id',user.id).order('created_at',{ascending:false});
    if(r.error) throw r.error;
    return r.data||[];
  }

  function renderPrescribedMedicines() {
    var list=$('epPrescribedMedicineList'); if(!list) return;
    var prescriptions=patient && Array.isArray(patient.prescriptions) ? patient.prescriptions : [];
    var visible=prescriptions.map(function(rx){
      if(typeof rx==='string') return {medicine:rx};
      return rx && typeof rx==='object' ? rx : {};
    }).filter(function(rx){return String(rx.medicine||rx.medication_name||rx.medicationName||rx.name||rx.drug_name||rx.drugName||'').trim();});
    if(!visible.length) {
      list.innerHTML='<p class="text-xs text-slate-400">No prescribed medicines have been saved to your patient record yet.</p>';
      return;
    }
    list.innerHTML=visible.map(function(rx){
      var medicine=String(rx.medicine||rx.medication_name||rx.medicationName||rx.name||rx.drug_name||rx.drugName||'').trim();
      var dosage=String(rx.dosage||rx.dose||rx.strength||'').trim();
      var duration=String(rx.days||rx.duration||rx.frequency||rx.instructions||'').trim();
      var active=rx.active!==false && String(rx.status||'').toLowerCase()!=='inactive';
      return '<article class="medicine-card rounded-xl p-3 flex items-start justify-between gap-3"><div class="min-w-0 flex-1"><strong class="block text-sm text-white break-words">'+esc(medicine)+'</strong><p class="text-xs text-slate-300 mt-1 break-words">'+esc([dosage,duration].filter(Boolean).join(' · ')||'Follow clinician instructions')+'</p><span class="inline-block mt-2 px-2 py-1 rounded text-[10px] '+(active?'bg-emerald-950 text-emerald-200':'bg-slate-800 text-slate-300')+'">'+(active?'Active prescription':'Inactive prescription')+'</span></div><button type="button" data-action="prefill-prescription" data-medicine="'+esc(medicine)+'" data-dosage="'+esc(dosage)+'" data-instructions="'+esc(String(rx.instructions||''))+'" '+(active?'':'disabled')+' class="rounded-lg px-2 py-2 text-[10px] border border-cyan-400/40 text-cyan-200 shrink-0">Set Reminder</button></article>';
    }).join('');
  }

  function fillReminderFromPrescription(detail) {
    if(!detail || !$('epReminderMedicine')) return;
    $('epReminderMedicine').value=String(detail.medicine||'');
    $('epReminderDosage').value=String(detail.dosage||'');
    if($('epReminderNote') && detail.instructions) $('epReminderNote').value=String(detail.instructions);
    if(!$('epReminderStart').value) $('epReminderStart').value=dateString(new Date());
    if(!$('epReminderTime').value) $('epReminderTime').focus();
    if($('epReminderForm')) $('epReminderForm').scrollIntoView({behavior:'smooth',block:'center'});
  }

  function prescribedMedicineAction(e) {
    var b=e.target.closest('button[data-action="prefill-prescription"]'); if(!b) return;
    fillReminderFromPrescription({medicine:b.dataset.medicine,dosage:b.dataset.dosage,instructions:b.dataset.instructions});
  }

  window.addEventListener('erecpass:prefill-medication-reminder',function(e){
    fillReminderFromPrescription(e.detail||{});
  });

  function render(rows) {
    renderPrescribedMedicines();
    var list=$('epMedicationReminderList'); if(!list) return;
    if(!rows.length){list.innerHTML='<p class="text-xs text-slate-400">No reminders yet. Add one above.</p>';return;}
    list.innerHTML=rows.map(function(r){
      var ds=(r.repeat_days||[]).map(Number).sort().map(function(n){return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][n];}).join(', ');
      return '<article class="medicine-card rounded-xl p-3 flex items-start justify-between gap-3"><div class="min-w-0 flex-1">'+
        '<strong class="block text-sm text-white">'+esc(r.medication_name)+'</strong><p class="text-xs text-slate-300 mt-1">'+esc(r.dosage||'Dosage not entered')+' · '+esc(String(r.reminder_time).slice(0,5))+'</p>'+
        '<p class="text-[11px] text-slate-400 mt-1">'+esc(ds)+' · From '+esc(r.start_date)+(r.end_date?' · Until '+esc(r.end_date):' · No end date')+'</p>'+
        (r.instructions?'<p class="text-[11px] text-slate-300 mt-1">'+esc(r.instructions)+'</p>':'')+
        '<span class="inline-block mt-2 px-2 py-1 rounded text-[10px] '+(r.enabled?'bg-emerald-950 text-emerald-200':'bg-slate-800 text-slate-300')+'">'+(r.enabled?'Active':'Paused')+'</span></div>'+
        '<div class="flex flex-col gap-2 shrink-0"><button type="button" data-action="toggle" data-id="'+esc(r.id)+'" data-enabled="'+String(!!r.enabled)+'" class="rounded-lg px-2 py-1 text-[10px] border border-cyan-400/40 text-cyan-200">'+(r.enabled?'Pause':'Resume')+'</button>'+
        '<button type="button" data-action="delete" data-id="'+esc(r.id)+'" class="rounded-lg px-2 py-1 text-[10px] bg-red-700 text-white">Delete</button></div></article>';
    }).join('');
  }

  async function listAction(e) {
    var b=e.target.closest('button[data-action]'); if(!b) return;
    try {
      await identity();
      if(b.dataset.action==='delete') {
        if(!confirm('Delete this medication reminder?')) return;
        var d=await sb().from('medication_reminders').delete().eq('id',b.dataset.id).eq('patient_user_id',user.id);
        if(d.error) throw d.error;
      } else {
        var u=await sb().from('medication_reminders').update({enabled:b.dataset.enabled!=='true',updated_at:new Date().toISOString()})
          .eq('id',b.dataset.id).eq('patient_user_id',user.id);
        if(u.error) throw u.error;
      }
      await refresh();
    } catch(err) { console.error('[ERecPass reminders]',err); alert(err.message||'Could not update reminder.'); }
  }

  async function scheduleNative(rows) {
    var n=plugin(); if(!n) return false;
    var perm=await n.checkPermissions(); if(perm.display!=='granted') return false;
    try {
      if (typeof n.createChannel === 'function') await n.createChannel({ id: notificationChannelId, name: 'Medication Reminders', description: 'Scheduled reminders to take prescribed medicine', importance: 5, visibility: 1, vibration: true, sound: 'erecpass_reminder.wav' });
      var pending=await n.getPending();
      var old=(pending.notifications||[]).filter(function(x){return x.extra&&x.extra.erecpassMedicationReminder===true;}).map(function(x){return {id:x.id};});
      if(old.length) await n.cancel({notifications:old});
    } catch(e) { console.warn('[ERecPass reminders] Could not clear old notifications',e); }
    var now=new Date(), jobs=[], horizon=30;
    rows.filter(function(r){return r.enabled;}).forEach(function(r){
      var days=new Set((r.repeat_days||[]).map(Number));
      for(var i=0;i<horizon;i++){
        var d=new Date(now.getFullYear(),now.getMonth(),now.getDate()+i), date=dateString(d);
        if(date<String(r.start_date) || (r.end_date&&date>String(r.end_date)) || !days.has(d.getDay())) continue;
        var at=makeDate(date,r.reminder_time);
        if(at<=now) continue;
        jobs.push({id:hash(r.id+'|'+date+'|'+String(r.reminder_time).slice(0,5)),
          title:'ERecPass Medication Reminder',
          body:r.medication_name+(r.dosage?' · '+r.dosage:'')+(r.instructions?' — '+r.instructions:''),
          channelId:notificationChannelId,
          schedule:{at:at,allowWhileIdle:true},
          extra:{erecpassMedicationReminder:true,reminderId:r.id,scheduledDate:date}});
      }
    });
    for(var j=0;j<jobs.length;j+=400) await n.schedule({notifications:jobs.slice(j,j+400)});
    return true;
  }

  function browserFallback(rows) {
    if(timer) clearInterval(timer); timer=null;
    if(!('Notification' in window)||Notification.permission!=='granted') return;
    function check(){
      var now=new Date(), date=dateString(now);
      rows.filter(function(r){return r.enabled;}).forEach(function(r){
        if(date<String(r.start_date)||(r.end_date&&date>String(r.end_date))||!(r.repeat_days||[]).map(Number).includes(now.getDay())) return;
        var at=makeDate(date,r.reminder_time);
        if(now<at||now-at>60000) return;
        var key=r.id+'|'+date+'|'+String(r.reminder_time).slice(0,5);
        if(fired.has(key)) return; fired.add(key);
        try { new Notification('ERecPass Medication Reminder',{body:r.medication_name+(r.dosage?' · '+r.dosage:''),tag:key}); } catch(e) {}
      });
    }
    check(); timer=setInterval(check,30000);
  }

  async function refresh() {
    installUI(); if(!$('epMedicationReminderList')) return;
    try {
      var rows=await loadRows(); render(rows);
      var native=await scheduleNative(rows);
      if(!native) browserFallback(rows); else if(timer){clearInterval(timer);timer=null;}
    } catch(e) {
      console.error('[ERecPass reminders]',e);
      if($('epMedicationReminderList')) $('epMedicationReminderList').innerHTML='<p class="text-xs text-rose-300">Unable to load reminders: '+esc(e.message||'Please refresh and try again.')+'</p>';
    }
  }

  document.addEventListener('click',function(e){
    var t=e.target.closest('#nav-medicines, [data-page="medicines"]');
    if(t) setTimeout(refresh,150);
  });
  document.addEventListener('DOMContentLoaded',function(){installUI();setTimeout(refresh,1500);});
  window.addEventListener('focus',function(){if($('epMedicationReminderPanel')) refresh();});
  document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible'&&$('epMedicationReminderPanel')) refresh();});
  window.refreshPatientMedicationReminders=refresh;
})();