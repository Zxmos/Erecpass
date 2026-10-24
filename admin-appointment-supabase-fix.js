(function(){
'use strict';
async function getAdminClient(){
 const client=window.erecpassSupabase;
 if(!client?.auth) throw new Error('Supabase is not ready. Please refresh the app.');
 const au=await client.auth.getUser(); if(au.error) throw au.error;
 const user=au.data?.user; if(!user?.id) throw new Error('Admin login session has expired. Please log in again.');
 const pr=await client.from('profiles').select('id,role,active').eq('id',user.id).maybeSingle();
 if(pr.error) throw pr.error;
 if(pr.data?.role!=='admin'||pr.data?.active!==true) throw new Error('Please use an active Admin account.');
 return client;
}
window.updateApptStatus=async function(id,status){
 if(!id||!['Approved','Cancelled'].includes(status)) return;
 if(status==='Cancelled'&&!window.confirm('Cancel this appointment?\\nYou can’t undo this action.')) return;
 try{
  const client=await getAdminClient();
  const raw=String(id).trim();
  if(!/^\d+$/.test(raw)) throw new Error('Invalid appointment ID. Please refresh the list.');
  const appointmentId=Number(raw);
  const rpc=await client.rpc('admin_update_appointment_status',{p_appointment_id:appointmentId,p_status:status});
  if(rpc.error) throw rpc.error;
  if(!rpc.data) throw new Error('Appointment was not updated.');
  if(typeof window.renderAdminAppointmentsList==='function') await window.renderAdminAppointmentsList();
 }catch(e){
  console.error('[ERecPass] Admin appointment action failed:',e);
  alert('Could not '+(status==='Approved'?'approve':'cancel')+' appointment: '+(e?.message||'Please try again.'));
 }
};

window.deleteErecpassAppointment=async function(id){
 const client=await getAdminClient();
 const key=String(id??'').trim();
 if(!key) throw new Error('Invalid appointment ID. Please refresh the list.');
 const result=await client.rpc('admin_delete_appointment',{p_appointment_key:key});
 if(result.error) throw result.error;
 if(result.data!==true) throw new Error('Supabase did not confirm that the appointment was deleted.');
 // Refresh from the cloud so the deleted booking cannot be re-added from stale local state.
 if(typeof window.erecpassCloudHydrate==='function') await window.erecpassCloudHydrate();
 const byLegacy=await client.from('appointments').select('id').eq('legacy_id',key);
 if(byLegacy.error) throw byLegacy.error;
 let stillExists=(byLegacy.data||[]).length>0;
 if(!stillExists && /^\\d+$/.test(key)){
   const byId=await client.from('appointments').select('id').eq('id',Number(key));
   if(byId.error) throw byId.error;
   stillExists=(byId.data||[]).length>0;
 }
 if(stillExists) throw new Error('The appointment still appears in Supabase. Please refresh and try again.');
 return true;
};

})();
