/**
 * Serves the Lead Score Breakdown component: the stored score of a Lead and
 * the active scoring rules it matches, read as the current user.
 */
public with sharing class LeadScoreController {
  @TestVisible
  private static final String NOT_FOUND = 'This Lead was not found, or you do not have access to it.';
  @TestVisible
  private static final String NO_SCORE_ACCESS = 'You do not have access to the lead score. Ask your Salesforce admin for the Lead Scoring User permission set.';

  public class Breakdown {
    /** The stored Score__c, or null if the Lead was never scored. */
    @AuraEnabled
    public Integer total;
    /** The matched rules, sorted by label. */
    @AuraEnabled
    public List<LeadScoringService.RuleResult> rules;
    /** True when the matched rules do not produce the stored total. */
    @AuraEnabled
    public Boolean outOfDate;
  }

  @AuraEnabled(cacheable=true)
  public static Breakdown getBreakdown(Id leadId) {
    if (leadId == null || leadId.getSobjectType() != Lead.SObjectType) {
      throw error(NOT_FOUND);
    }
    if (!Schema.SObjectType.Lead.fields.Score__c.isAccessible()) {
      throw error(NO_SCORE_ACCESS);
    }

    Map<String, Schema.SObjectField> leadFields = Schema.SObjectType.Lead.fields.getMap();
    Set<String> readableFields = new Set<String>();
    for (String fieldName : LeadScoringService.getRuleFieldNames()) {
      if (leadFields.get(fieldName).getDescribe().isAccessible()) {
        readableFields.add(fieldName);
      }
    }

    Set<String> selectFields = new Set<String>{ 'Id', 'Score__c' };
    selectFields.addAll(readableFields);
    String soql =
      'SELECT ' +
      String.join(new List<String>(selectFields), ', ') +
      ' FROM Lead WHERE Id = :leadId LIMIT 1';

    List<Lead> rows;
    try {
      rows = Database.queryWithBinds(
        soql,
        new Map<String, Object>{ 'leadId' => leadId },
        AccessLevel.USER_MODE
      );
    } catch (Exception e) {
      // User mode refused the read (object, field or sharing access).
      // Return nothing about the Lead.
      System.debug(
        LoggingLevel.WARN,
        'Lead score breakdown query refused: ' + e.getMessage()
      );
      throw error(NOT_FOUND);
    }
    if (rows.isEmpty()) {
      throw error(NOT_FOUND);
    }

    Lead lead = rows[0];
    LeadScoringService.ScoreResult result = LeadScoringService.evaluate(
      lead,
      readableFields
    );
    Breakdown breakdown = new Breakdown();
    breakdown.total = lead.Score__c == null ? null : lead.Score__c.intValue();
    breakdown.rules = result.matchedRules;
    breakdown.outOfDate = breakdown.total != result.total;
    return breakdown;
  }

  private static AuraHandledException error(String message) {
    AuraHandledException e = new AuraHandledException(message);
    e.setMessage(message);
    return e;
  }
}
