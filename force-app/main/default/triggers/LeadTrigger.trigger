trigger LeadTrigger on Lead(before insert, before update) {
  LeadTriggerHandler.beforeSave(Trigger.new);
}
