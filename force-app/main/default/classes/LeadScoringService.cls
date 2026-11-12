/**
 * Calculates a Lead's score from the active Lead_Scoring_Rule__mdt records.
 *
 * The score is the sum of the points of every active rule the Lead matches,
 * kept between 0 and 100. A badly configured rule is skipped and logged,
 * never thrown, so it can never block a save.
 */
public with sharing class LeadScoringService {
  public static final String OP_EQUALS = 'Equals';
  public static final String OP_NOT_BLANK = 'Not Blank';
  public static final String OP_GREATER_THAN = 'Greater Than';
  public static final Integer MIN_SCORE = 0;
  public static final Integer MAX_SCORE = 100;

  private static final Set<String> OPERATORS = new Set<String>{
    OP_EQUALS,
    OP_NOT_BLANK,
    OP_GREATER_THAN
  };

  /** One rule a Lead matched, as shown in the breakdown. */
  public class RuleResult {
    @AuraEnabled
    public String ruleName;
    @AuraEnabled
    public String label;
    @AuraEnabled
    public Integer points;
  }

  /** The score for one Lead and the rules that produced it. */
  public class ScoreResult {
    public Integer total;
    public List<RuleResult> matchedRules;
  }

  /** When not null, replaces the custom metadata records. Tests only. */
  @TestVisible
  private static List<Lead_Scoring_Rule__mdt> rulesOverride;

  /** Rule name to the reason it was skipped, for tests and debugging. */
  @TestVisible
  private static Map<String, String> skippedRules = new Map<String, String>();

  private static Map<String, Schema.SObjectField> leadFieldMap;

  /** Sets Score__c on each Lead in memory. No SOQL, no DML. */
  public static void score(List<Lead> leads) {
    List<Rule> rules = loadRules();
    for (Lead lead : leads) {
      lead.Score__c = evaluate(lead, rules).total;
    }
  }

  /** Score and matched rules for one Lead, using every valid active rule. */
  public static ScoreResult evaluate(Lead lead) {
    return evaluate(lead, loadRules());
  }

  /**
   * As evaluate(lead), but only rules whose Lead field is in fieldNames
   * (canonical API names) are used.
   */
  public static ScoreResult evaluate(Lead lead, Set<String> fieldNames) {
    List<Rule> rules = new List<Rule>();
    for (Rule rule : loadRules()) {
      if (fieldNames.contains(rule.fieldName)) {
        rules.add(rule);
      }
    }
    return evaluate(lead, rules);
  }

  /** Canonical API names of the Lead fields read by valid active rules. */
  public static Set<String> getRuleFieldNames() {
    Set<String> names = new Set<String>();
    for (Rule rule : loadRules()) {
      names.add(rule.fieldName);
    }
    return names;
  }

  private static ScoreResult evaluate(Lead lead, List<Rule> rules) {
    ScoreResult result = new ScoreResult();
    result.matchedRules = new List<RuleResult>();
    Integer sum = 0;
    for (Rule rule : rules) {
      Boolean matched = false;
      try {
        matched = rule.matches(lead.get(rule.fieldName));
      } catch (Exception e) {
        skip(rule.name, 'could not be evaluated: ' + e.getMessage());
      }
      if (matched) {
        sum += rule.points;
        RuleResult line = new RuleResult();
        line.ruleName = rule.name;
        line.label = rule.label;
        line.points = rule.points;
        result.matchedRules.add(line);
      }
    }
    result.total = Math.max(MIN_SCORE, Math.min(MAX_SCORE, sum));
    return result;
  }

  private static List<Rule> loadRules() {
    List<Lead_Scoring_Rule__mdt> records = rulesOverride != null
      ? rulesOverride
      : Lead_Scoring_Rule__mdt.getAll().values();
    List<Rule> rules = new List<Rule>();
    for (Lead_Scoring_Rule__mdt record : records) {
      if (record.Active__c != true) {
        continue;
      }
      String name = String.isNotBlank(record.DeveloperName)
        ? record.DeveloperName
        : record.MasterLabel;
      String reason = invalidReason(record);
      if (reason != null) {
        skip(name, reason);
        continue;
      }
      rules.add(
        new Rule(
          record,
          name,
          getLeadFields().get(record.Lead_Field__c.trim().toLowerCase())
        )
      );
    }
    rules.sort();
    return rules;
  }

  private static String invalidReason(Lead_Scoring_Rule__mdt record) {
    if (String.isBlank(record.Lead_Field__c)) {
      return 'Lead Field is empty';
    }
    if (
      !getLeadFields().containsKey(record.Lead_Field__c.trim().toLowerCase())
    ) {
      return 'Lead Field "' + record.Lead_Field__c + '" is not a field on Lead';
    }
    if (String.isBlank(record.Operator__c)) {
      return 'Operator is empty';
    }
    if (!OPERATORS.contains(record.Operator__c)) {
      return 'Operator "' +
        record.Operator__c +
        '" is not one of Equals, Not Blank, Greater Than';
    }
    if (record.Points__c == null) {
      return 'Points is empty';
    }
    if (record.Operator__c != OP_NOT_BLANK && String.isBlank(record.Value__c)) {
      return 'Value is empty';
    }
    if (
      record.Operator__c == OP_GREATER_THAN &&
      parseNumber(record.Value__c.trim()) == null
    ) {
      return 'Value "' + record.Value__c + '" is not a number';
    }
    return null;
  }

  private static void skip(String ruleName, String reason) {
    skippedRules.put(ruleName, reason);
    System.debug(
      LoggingLevel.WARN,
      'Lead scoring skipped rule ' + ruleName + ': ' + reason + '.'
    );
  }

  private static Map<String, Schema.SObjectField> getLeadFields() {
    if (leadFieldMap == null) {
      leadFieldMap = Schema.SObjectType.Lead.fields.getMap();
    }
    return leadFieldMap;
  }

  private static Decimal parseNumber(String text) {
    try {
      return Decimal.valueOf(text);
    } catch (TypeException e) {
      return null;
    }
  }

  /** A number held by a numeric field, or null for any other value. */
  private static Decimal toNumber(Object value) {
    if (
      value instanceof Integer ||
      value instanceof Long ||
      value instanceof Double ||
      value instanceof Decimal
    ) {
      return Decimal.valueOf(String.valueOf(value));
    }
    return null;
  }

  /** A validated rule. */
  private class Rule implements Comparable {
    String name;
    String label;
    String fieldName;
    String operator;
    String value;
    Decimal threshold;
    Integer points;

    Rule(
      Lead_Scoring_Rule__mdt record,
      String name,
      Schema.SObjectField field
    ) {
      this.name = name;
      this.label = String.isNotBlank(record.MasterLabel)
        ? record.MasterLabel
        : name;
      this.fieldName = field.getDescribe().getName();
      this.operator = record.Operator__c;
      this.value = record.Value__c == null ? null : record.Value__c.trim();
      this.threshold = operator == OP_GREATER_THAN ? parseNumber(value) : null;
      this.points = record.Points__c.intValue();
    }

    Boolean matches(Object fieldValue) {
      if (fieldValue == null || String.isBlank(String.valueOf(fieldValue))) {
        return false;
      }
      if (operator == OP_NOT_BLANK) {
        return true;
      }
      if (operator == OP_EQUALS) {
        return String.valueOf(fieldValue).trim().equalsIgnoreCase(value);
      }
      Decimal number = toNumber(fieldValue);
      return number != null && number > threshold;
    }

    public Integer compareTo(Object other) {
      Rule that = (Rule) other;
      Integer byLabel = label.compareTo(that.label);
      return byLabel != 0 ? byLabel : name.compareTo(that.name);
    }
  }
}
