/**
 * Entry point for Lead trigger events. Holds no scoring logic itself.
 */
public with sharing class LeadTriggerHandler {
  /** Before insert and before update: set Score__c on the records being saved. */
  public static void beforeSave(List<Lead> newLeads) {
    LeadScoringService.score(newLeads);
  }
}
