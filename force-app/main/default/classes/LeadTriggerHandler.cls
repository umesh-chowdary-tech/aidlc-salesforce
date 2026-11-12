/**
 * Called by LeadTrigger before insert and before update. Writes the
 * calculated score onto each Lead being saved. No SOQL and no DML: the
 * records are changed in memory and the platform saves them.
 */
public with sharing class LeadTriggerHandler {
  public static void beforeSave(List<Lead> leads) {
    if (leads == null) {
      return;
    }
    for (Lead record : leads) {
      if (record != null) {
        // Always overwrite, so a typed-in Score never survives a save.
        record.Score__c = LeadScoringService.score(record).total;
      }
    }
  }
}
