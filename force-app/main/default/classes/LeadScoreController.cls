/**
 * Loads the score breakdown the leadScoreBreakdown component shows on a Lead
 * record page: the stored Score and the rules the Lead matches now.
 *
 * The Lead is read in user mode, so object permission, field-level security
 * and sharing are those of the running user.
 */
public with sharing class LeadScoreController {
  @TestVisible
  private static final String NOT_AVAILABLE_MESSAGE = 'This Lead is not available. It may have been deleted, or you may not have access to it.';
  @TestVisible
  private static final String NOT_READABLE_MESSAGE = 'The Lead score could not be read. Ask your admin to check that you have the Lead Scoring User permission set.';

  /**
   * The stored Score of the Lead and the rules it matches now, in rule-label
   * order. Throws an AuraHandledException with a readable message when the
   * Lead cannot be read.
   */
  @AuraEnabled(cacheable=true)
  public static LeadScoringService.ScoreResult getScoreBreakdown(Id leadId) {
    if (leadId == null) {
      throw readableError(NOT_AVAILABLE_MESSAGE);
    }

    // Field names come from the schema describe, never from user input.
    String soql =
      'SELECT ' +
      String.join(fieldsToSelect(), ', ') +
      ' FROM Lead WHERE Id = :leadId';
    List<Lead> rows;
    try {
      rows = (List<Lead>) Database.queryWithBinds(
        soql,
        new Map<String, Object>{ 'leadId' => leadId },
        AccessLevel.USER_MODE
      );
    } catch (QueryException e) {
      throw readableError(NOT_READABLE_MESSAGE);
    }

    if (rows.isEmpty()) {
      throw readableError(NOT_AVAILABLE_MESSAGE);
    }
    return toResult(rows[0]);
  }

  /**
   * The breakdown for a Lead that is already loaded: the matched rules, with
   * the stored Score as the total. A Lead with no stored Score (never saved
   * since the feature was deployed) keeps the total calculated now.
   */
  @TestVisible
  private static LeadScoringService.ScoreResult toResult(Lead record) {
    LeadScoringService.ScoreResult result = LeadScoringService.score(record);
    if (record.Score__c != null) {
      result.total = record.Score__c.intValue();
    }
    return result;
  }

  /**
   * Id, Score__c and each scored field the running user may read, once each.
   * A scored field the user may not read is left out, so its rule is not
   * listed rather than the whole breakdown failing.
   */
  private static List<String> fieldsToSelect() {
    Set<String> names = new Set<String>{ 'Id', 'Score__c' };
    Map<String, Schema.SObjectField> leadFields = Schema.SObjectType.Lead.fields.getMap();
    for (String name : LeadScoringService.getScoredFieldNames()) {
      Schema.SObjectField field = leadFields.get(name.toLowerCase());
      if (field != null && field.getDescribe().isAccessible()) {
        names.add(field.getDescribe().getName());
      }
    }
    return new List<String>(names);
  }

  /** An AuraHandledException whose message reaches the component and tests. */
  private static AuraHandledException readableError(String message) {
    AuraHandledException error = new AuraHandledException(message);
    error.setMessage(message);
    return error;
  }
}
