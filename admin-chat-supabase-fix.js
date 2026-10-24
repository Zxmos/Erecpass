(function(){
'use strict';
function client(){return window.erecpassSupabase;}
function uid(){return client().auth.getUser().then(function(r){if(r.error)throw r.error;if(!r.data||!r.data.user)throw new Error('Admin login session is missing.');return r.data.user.id;});}
window.sendAdminChatMessage=async function(){
  var input=document.getElementById('adminChatInput');
  var body=(input&&input.value||'').trim();
  var targetId=null;
  try{targetId=sessionStorage.getItem('erecpassSelectedChatPatient')||null;}catch(e){}
  if(!targetId&&window.selectedChatPatientId)targetId=window.selectedChatPatientId;
  if(!targetId){alert('Please select a patient or staff first.');return;}
  if(!body)return;
  var sb=client();
  if(!sb){alert('Supabase is not ready. Please refresh.');return;}
  var button=input&&input.parentElement&&input.parentElement.querySelector('button');
  try{
    if(button)button.disabled=true;
    var adminId=await uid();
    var participantId=targetId;
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(participantId))){
      var p=await sb.from('patients').select('user_id').eq('id',participantId).maybeSingle();
      if(p.error)throw p.error;
      if(!p.data||!p.data.user_id)throw new Error('Selected patient is not linked to Supabase.');
      participantId=p.data.user_id;
    }
    var q=await sb.from('message_conversations').select('id').eq('patient_id',participantId).order('created_at',{ascending:true}).limit(1);
    if(q.error)throw q.error;
    var conversation=q.data&&q.data[0];
    if(!conversation){
      var created=await sb.from('message_conversations').insert({patient_id:participantId,subject:'ERecPass Support',status:'Open'}).select('id').single();
      if(created.error)throw created.error;
      conversation=created.data;
    }
    var sent=await sb.from('message_messages').insert({conversation_id:conversation.id,sender_id:adminId,body:body}).select('id').single();
    if(sent.error)throw sent.error;
    var up=await sb.from('message_conversations').update({status:'Open',updated_at:new Date().toISOString()}).eq('id',conversation.id);
    if(up.error)throw up.error;
    if(input)input.value='';
    if(typeof window.renderAdminPatientChatList==='function')await window.renderAdminPatientChatList();
    if(typeof window.renderAdminChatMessages==='function')await window.renderAdminChatMessages();
  }catch(e){
    console.error('[ERecPass] Admin Supabase reply failed:',e);
    alert('Hindi naipadala ang reply. '+(e&&e.message||'Pakisubukan ulit.'));
  }finally{if(button)button.disabled=false;}
};
})();