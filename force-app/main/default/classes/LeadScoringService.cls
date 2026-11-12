/**
 * Scores a Lead against the active Lead_Scoring_Rule__mdt records.
 *
 * The rules are loaded and checked once per transaction. A rule that is badly
 * configured is left out, written to the debug log and never raises an error,
 * so scoring cannot block a save.
 */
public with sharing class LeadScoringService {
  // The score range is part of the feature's definition (see the unit
  // design, guardrail 5), so it is not custom metadata.
  public static final Integer MIN_SCORE = 0;
  public static final Integer MAX_SCORE = 100;

  // API values of the Operator__c picklist.
  private static final String OP_EQUALS = 'Equals';
  private static final String OP_NOT_BLANK = 'Not Blank';
  private static final String OP_GREATER_THAN = 'Greater Than';

  /** DeveloperName -> reason, for rules left out or that failed while evaluating. */
  @TestVisible
  private static Map<String, String> skippedRules = new Map<String, String>();

  /** Times the rules were loaded in this transaction. */
  @TestVisible
  private static Integer ruleLoadCount = 0;

  private static List<Lead_Scoring_Rule__mdt> suppliedRules;
  private static List<CheckedRule> cachedRules;

  public class RuleMatch {
    @AuraEnabled
    public String ruleName; // DeveloperName of the rule
    @AuraEnabled
    public String label; // MasterLabel of the rule
    @AuraEnabled
    public Integer points;
  }

  public class ScoreResult {
    @AuraEnabled
    public Integer total; // kept between MIN_SCORE and MAX_SCORE
    @AuraEnabled
    public List<RuleMatch> matches; // matched rules, in rule-label order; never null
  }

  /** A rule that passed every check, ready to evaluate. Sorts by label, then name. */
  private class CheckedRule implements Comparable {
    public String name;
    public String label;
    public Schema.SObjectField field;
    public String fieldName;
    public String operator;
    public Integer points;
    public String textValue; // trimmed Value__c; null for Not Blank
    public Decimal numberValue; // Value__c as a number, when it is one

    public Integer compareTo(Object other) {
      CheckedRule that = (CheckedRule) other;
      Integer byLabel = LeadScoringService.sortKey(this.label)
        .compareTo(LeadScoringService.sortKey(that.label));
      return byLabel != 0
        ? byLabel
        : LeadScoringService.sortKey(this.name)
            .compareTo(LeadScoringService.sortKey(that.name));
    }
  }

  /**
   * Replaces the rules the service would query and clears the cache. Custom
   * metadata cannot be inserted in a test, so tests pass in-memory rows.
   */
  @TestVisible
  private static void setRulesForTest(List<Lead_Scoring_Rule__mdt> rules) {
    suppliedRules = rules == null ? new List<Lead_Scoring_Rule__mdt>() : rules;
    cachedRules = null;
    skippedRules = new Map<String, String>();
  }

  /** Scores one Lead against the active, well-configured rules. */
  public static ScoreResult score(Lead lead) {
    ScoreResult result = new ScoreResult();
    result.total = MIN_SCORE;
    result.matches = new List<RuleMatch>();
    if (lead == null) {
      return result;
    }

    Integer sum = 0;
    for (CheckedRule rule : getRules()) {
      if (ruleMatches(rule, lead)) {
        RuleMatch match = new RuleMatch();
        match.ruleName = rule.name;
        match.label = rule.label;
        match.points = rule.points;
        result.matches.add(match);
        sum += rule.points;
      }
    }
    result.total = Math.max(MIN_SCORE, Math.min(MAX_SCORE, sum));
    return result;
  }

  /**
   * API names of the Lead fields the active, well-configured rules read.
   * A caller that queries a Lead uses this to know which fields to select
   * before calling score().
   */
  public static Set<String> getScoredFieldNames() {
    Set<String> fieldNames = new Set<String>();
    for (CheckedRule rule : getRules()) {
      fieldNames.add(rule.fieldName);
    }
    return fieldNames;
  }

  private static List<CheckedRule> getRules() {
    if (cachedRules == null) {
      cachedRules = loadRules();
    }
    return cachedRules;
  }

  private static List<CheckedRule> loadRules() {
    ruleLoadCount++;
    List<Lead_Scoring_Rule__mdt> rows = suppliedRules;
    if (rows == null) {
      // System mode on purpose: this reads scoring configuration, not user
      // data, and must work for every user who can save a Lead. In user mode
      // a user without read access to the rule type would have the save fail.
      rows = [
        SELECT
          DeveloperName,
          MasterLabel,
          Lead_Field__c,
          Operator__c,
          Value__c,
          Points__c,
          Active__c
        FROM Lead_Scoring_Rule__mdt
        WHERE Active__c = TRUE
        WITH SYSTEM_MODE
        ORDER BY MasterLabel, DeveloperName
      ];
    }

    Map<String, Schema.SObjectField> leadFields = Schema.SObjectType.Lead.fields.getMap();
    List<CheckedRule> rules = new List<CheckedRule>();
    for (Lead_Scoring_Rule__mdt row : rows) {
      if (row == null || row.Active__c != true) {
        continue;
      }
      CheckedRule rule = checkRule(row, leadFields);
      if (rule != null) {
        rules.add(rule);
      }
    }
    rules.sort();
    return rules;
  }

  /** Returns the rule ready to evaluate, or null after recording why it was skipped. */
  private static CheckedRule checkRule(
    Lead_Scoring_Rule__mdt row,
    Map<String, Schema.SObjectField> leadFields
  ) {
    String name = row.DeveloperName;

    if (String.isBlank(row.Lead_Field__c)) {
      return skip(name, 'Lead Field is empty');
    }
    Schema.SObjectField field = leadFields.get(
      row.Lead_Field__c.trim().toLowerCase()
    );
    if (field == null) {
      return skip(
        name,
        'Lead Field "' + row.Lead_Field__c + '" is not a field on Lead'
      );
    }

    if (String.isBlank(row.Operator__c)) {
      return skip(name, 'Operator is empty');
    }
    String operator = row.Operator__c.trim();
    if (
      operator != OP_EQUALS &&
      operator != OP_NOT_BLANK &&
      operator != OP_GREATER_THAN
    ) {
      return skip(name, 'Operator "' + row.Operator__c + '" is not supported');
    }

    if (row.Points__c == null) {
      return skip(name, 'Points is empty');
    }

    CheckedRule rule = new CheckedRule();
    rule.name = name;
    rule.label = row.MasterLabel;
    rule.field = field;
    rule.fieldName = field.getDescribe().getName();
    rule.operator = operator;
    rule.points = row.Points__c.intValue();

    if (operator == OP_NOT_BLANK) {
      return rule;
    }

    if (String.isBlank(row.Value__c)) {
      return skip(name, 'Value is empty');
    }
    rule.textValue = row.Value__c.trim();
    rule.numberValue = parseNumber(rule.textValue);
    if (operator == OP_GREATER_THAN && rule.numberValue == null) {
      return skip(name, 'Value "' + row.Value__c + '" is not a number');
    }
    return rule;
  }

  private static CheckedRule skip(String ruleName, String reason) {
    noteSkipped(ruleName, reason);
    return null;
  }

  /** Records and logs a problem with a rule, once per rule per transaction. */
  private static void noteSkipped(String ruleName, String reason) {
    if (skippedRules.containsKey(ruleName)) {
      return;
    }
    skippedRules.put(ruleName, reason);
    System.debug(
      LoggingLevel.WARN,
      'Lead scoring: skipped rule ' + ruleName + ': ' + reason
    );
  }

  /**
   * True when the Lead matches the rule. Any failure while reading or
   * comparing (for example the field was not queried on this record) means
   * the rule adds nothing for this Lead; it never escapes.
   */
  private static Boolean ruleMatches(CheckedRule rule, Lead lead) {
    try {
      Object fieldValue = lead.get(rule.field);
      if (fieldValue == null || String.isBlank(String.valueOf(fieldValue))) {
        return false;
      }
      if (rule.operator == OP_NOT_BLANK) {
        return true;
      }

      Decimal fieldNumber = toNumber(fieldValue);
      if (rule.operator == OP_GREATER_THAN) {
        return fieldNumber != null && fieldNumber > rule.numberValue;
      }
      // Equals: as numbers when both sides are numbers, otherwise as text.
      if (fieldNumber != null && rule.numberValue != null) {
        return fieldNumber == rule.numberValue;
      }
      return String.valueOf(fieldValue).trim().equalsIgnoreCase(rule.textValue);
    } catch (Exception e) {
      noteSkipped(rule.name, e.getMessage());
      return false;
    }
  }

  /** The field value as a Decimal when it holds a number, otherwise null. */
  private static Decimal toNumber(Object fieldValue) {
    if (fieldValue instanceof Integer) {
      Decimal fromInteger = (Integer) fieldValue;
      return fromInteger;
    }
    if (fieldValue instanceof Long) {
      Decimal fromLong = (Long) fieldValue;
      return fromLong;
    }
    if (fieldValue instanceof Decimal) {
      return (Decimal) fieldValue;
    }
    if (fieldValue instanceof Double) {
      return Decimal.valueOf((Double) fieldValue);
    }
    return null;
  }

  /** The rule's Value as a Decimal, or null when it is not a number. */
  private static Decimal parseNumber(String text) {
    try {
      return Decimal.valueOf(text);
    } catch (Exception e) {
      return null;
    }
  }

  private static String sortKey(String text) {
    return text == null ? '' : text.toLowerCase();
  }
}
