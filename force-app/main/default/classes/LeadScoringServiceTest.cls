/**
 * Tests for LeadScoringService. Every test supplies its own rules through the
 * setRulesForTest seam (except orgRulesAreReadWithoutTheSeam, which asserts
 * only the range) and builds its own Leads. Nothing depends on the rule
 * records shipped in source.
 */
@IsTest
private class LeadScoringServiceTest {
  private static final String EQUALS = 'Equals';
  private static final String NOT_BLANK = 'Not Blank';
  private static final String GREATER_THAN = 'Greater Than';

  private static Lead_Scoring_Rule__mdt rule(
    String name,
    String leadField,
    String operator,
    String value,
    Integer points
  ) {
    return new Lead_Scoring_Rule__mdt(
      DeveloperName = name,
      MasterLabel = name,
      Lead_Field__c = leadField,
      Operator__c = operator,
      Value__c = value,
      Points__c = points,
      Active__c = true
    );
  }

  private static List<Lead_Scoring_Rule__mdt> sampleRules() {
    return new List<Lead_Scoring_Rule__mdt>{
      rule('Email_Not_Blank', 'Email', NOT_BLANK, null, 10),
      rule('Phone_Not_Blank', 'Phone', NOT_BLANK, null, 10),
      rule('Industry_Equals_Technology', 'Industry', EQUALS, 'Technology', 20),
      rule(
        'Employees_Greater_Than_100',
        'NumberOfEmployees',
        GREATER_THAN,
        '100',
        25
      ),
      rule(
        'Revenue_Greater_Than_1000000',
        'AnnualRevenue',
        GREATER_THAN,
        '1000000',
        25
      )
    };
  }

  private static void useRules(List<Lead_Scoring_Rule__mdt> rules) {
    LeadScoringService.setRulesForTest(rules);
  }

  private static void useRule(Lead_Scoring_Rule__mdt oneRule) {
    useRules(new List<Lead_Scoring_Rule__mdt>{ oneRule });
  }

  private static Lead newLead() {
    return new Lead(LastName = 'Scored', Company = 'Acme');
  }

  private static Integer totalFor(Lead record) {
    return LeadScoringService.score(record).total;
  }

  @IsTest
  static void notBlankMatchesWhenFieldHasValue() {
    useRule(rule('Email_Rule', 'Email', NOT_BLANK, 'ignored value', 10));
    Lead record = newLead();
    record.Email = 'a@example.com';

    Assert.areEqual(
      10,
      totalFor(record),
      'A filled field matches Not Blank, whatever the rule Value says'
    );
  }

  @IsTest
  static void notBlankDoesNotMatchEmptyField() {
    useRule(rule('Title_Rule', 'Title', NOT_BLANK, null, 10));
    Lead nullField = newLead();
    Lead spacesOnly = newLead();
    spacesOnly.Title = '   ';

    Assert.areEqual(
      0,
      totalFor(nullField),
      'A null field does not match Not Blank'
    );
    Assert.areEqual(
      0,
      totalFor(spacesOnly),
      'A spaces-only field does not match Not Blank'
    );
  }

  @IsTest
  static void equalsIgnoresCaseAndSpaces() {
    useRule(rule('Industry_Rule', 'Industry', EQUALS, ' technology ', 20));
    Lead record = newLead();
    record.Industry = 'Technology';

    Assert.areEqual(
      20,
      totalFor(record),
      'Equals ignores case and surrounding spaces'
    );
  }

  @IsTest
  static void equalsDoesNotMatchDifferentOrBlankField() {
    useRule(rule('Industry_Rule', 'Industry', EQUALS, 'Technology', 20));
    Lead other = newLead();
    other.Industry = 'Banking';
    Lead blank = newLead();

    Assert.areEqual(0, totalFor(other), 'Another value does not match Equals');
    Assert.areEqual(0, totalFor(blank), 'A blank field does not match Equals');
  }

  @IsTest
  static void equalsComparesNumbersAsNumbers() {
    useRules(
      new List<Lead_Scoring_Rule__mdt>{
        rule('Revenue_Rule', 'AnnualRevenue', EQUALS, '1000000', 20),
        rule('Employees_Rule', 'NumberOfEmployees', EQUALS, '100.0', 5)
      }
    );
    Lead record = newLead();
    record.AnnualRevenue = 1000000.00;
    record.NumberOfEmployees = 100;
    Lead different = newLead();
    different.AnnualRevenue = 1000000.01;
    different.NumberOfEmployees = 101;

    Assert.areEqual(
      25,
      totalFor(record),
      '1000000.00 equals 1000000 and 100 equals 100.0'
    );
    Assert.areEqual(
      0,
      totalFor(different),
      'Different numbers do not match Equals'
    );
  }

  @IsTest
  static void greaterThanMatchesOnlyWhenLarger() {
    useRule(
      rule('Employees_Rule', 'NumberOfEmployees', GREATER_THAN, '100', 25)
    );
    Lead larger = newLead();
    larger.NumberOfEmployees = 101;
    Lead same = newLead();
    same.NumberOfEmployees = 100;
    Lead smaller = newLead();
    smaller.NumberOfEmployees = 99;

    Assert.areEqual(25, totalFor(larger), '101 is greater than 100');
    Assert.areEqual(0, totalFor(same), '100 is not greater than 100');
    Assert.areEqual(0, totalFor(smaller), '99 is not greater than 100');
  }

  @IsTest
  static void greaterThanNeverMatchesBlankOrTextField() {
    useRules(
      new List<Lead_Scoring_Rule__mdt>{
        rule('Employees_Rule', 'NumberOfEmployees', GREATER_THAN, '100', 25),
        rule('Company_Rule', 'Company', GREATER_THAN, '100', 25)
      }
    );
    Lead record = newLead();
    record.Company = '500';

    Assert.areEqual(
      0,
      totalFor(record),
      'A null number field and a text field never match Greater Than'
    );
    Assert.isTrue(
      LeadScoringService.skippedRules.isEmpty(),
      'Greater Than on a text field is a valid rule that never matches, not a skipped one'
    );
  }

  @IsTest
  static void sampleRulesScoreFortyThenSixtyFive() {
    useRules(sampleRules());
    Lead record = newLead();
    record.Email = 'a@example.com';
    record.Phone = '555-0100';
    record.Industry = 'Technology';

    Assert.areEqual(
      40,
      totalFor(record),
      'Email, Phone and Industry = Technology score 40'
    );

    record.NumberOfEmployees = 500;

    Assert.areEqual(65, totalFor(record), 'Adding 500 employees scores 65');
  }

  @IsTest
  static void noMatchingRuleScoresZero() {
    useRules(sampleRules());

    LeadScoringService.ScoreResult result = LeadScoringService.score(newLead());

    Assert.areEqual(0, result.total, 'No matching rule scores 0');
    Assert.isNotNull(result.matches, 'The match list is never null');
    Assert.areEqual(
      0,
      result.matches.size(),
      'No matching rule gives an empty match list'
    );
  }

  @IsTest
  static void totalIsCappedAtOneHundred() {
    useRules(
      new List<Lead_Scoring_Rule__mdt>{
        rule('A_Email_Rule', 'Email', NOT_BLANK, null, 70),
        rule('B_Phone_Rule', 'Phone', NOT_BLANK, null, 60)
      }
    );
    Lead record = newLead();
    record.Email = 'a@example.com';
    record.Phone = '555-0100';

    LeadScoringService.ScoreResult result = LeadScoringService.score(record);

    Assert.areEqual(100, result.total, '130 matching points are capped at 100');
    Assert.areEqual(2, result.matches.size(), 'Both rules are still listed');
    Assert.areEqual(
      70,
      result.matches[0].points,
      'The first match keeps its own points'
    );
    Assert.areEqual(
      60,
      result.matches[1].points,
      'The second match keeps its own points'
    );
  }

  @IsTest
  static void totalIsNeverBelowZero() {
    useRule(rule('Email_Rule', 'Email', NOT_BLANK, null, -30));
    Lead record = newLead();
    record.Email = 'a@example.com';

    LeadScoringService.ScoreResult result = LeadScoringService.score(record);

    Assert.areEqual(0, result.total, '-30 matching points are raised to 0');
    Assert.areEqual(
      -30,
      result.matches[0].points,
      'The match keeps its own negative points'
    );
  }

  @IsTest
  static void negativePointsSubtract() {
    useRules(
      new List<Lead_Scoring_Rule__mdt>{
        rule('Email_Rule', 'Email', NOT_BLANK, null, 20),
        rule('Phone_Rule', 'Phone', NOT_BLANK, null, -5)
      }
    );
    Lead record = newLead();
    record.Email = 'a@example.com';
    record.Phone = '555-0100';

    Assert.areEqual(15, totalFor(record), '+20 and -5 give 15');
  }

  @IsTest
  static void inactiveRuleIsIgnored() {
    Lead_Scoring_Rule__mdt inactive = rule(
      'Email_Rule',
      'Email',
      NOT_BLANK,
      null,
      10
    );
    inactive.Active__c = false;
    useRule(inactive);
    Lead record = newLead();
    record.Email = 'a@example.com';

    LeadScoringService.ScoreResult result = LeadScoringService.score(record);

    Assert.areEqual(0, result.total, 'An inactive rule adds nothing');
    Assert.areEqual(
      0,
      result.matches.size(),
      'An inactive rule is not in the match list'
    );
    Assert.isTrue(
      LeadScoringService.skippedRules.isEmpty(),
      'An inactive rule is not a skipped rule'
    );
  }

  @IsTest
  static void unknownFieldRuleIsSkipped() {
    useRules(
      new List<Lead_Scoring_Rule__mdt>{
        rule('Unknown_Field_Rule', 'Not_A_Field__c', NOT_BLANK, null, 50),
        rule('Email_Rule', 'Email', NOT_BLANK, null, 10)
      }
    );
    Lead record = newLead();
    record.Email = 'a@example.com';

    Assert.areEqual(10, totalFor(record), 'The good rule still counts');
    String reason = LeadScoringService.skippedRules.get('Unknown_Field_Rule');
    Assert.isNotNull(reason, 'The unknown-field rule is recorded as skipped');
    Assert.isTrue(
      reason.contains('Not_A_Field__c'),
      'The reason names the field: ' + reason
    );
    Assert.areEqual(
      1,
      LeadScoringService.skippedRules.size(),
      'Only the bad rule is skipped'
    );
  }

  @IsTest
  static void blankFieldNameRuleIsSkipped() {
    useRules(
      new List<Lead_Scoring_Rule__mdt>{
        rule('Null_Field_Rule', null, NOT_BLANK, null, 50),
        rule('Spaces_Field_Rule', '  ', NOT_BLANK, null, 50)
      }
    );

    Assert.areEqual(
      0,
      totalFor(newLead()),
      'Rules with no Lead Field add nothing'
    );
    Assert.areEqual(
      'Lead Field is empty',
      LeadScoringService.skippedRules.get('Null_Field_Rule')
    );
    Assert.areEqual(
      'Lead Field is empty',
      LeadScoringService.skippedRules.get('Spaces_Field_Rule')
    );
  }

  @IsTest
  static void nonNumericGreaterThanValueIsSkipped() {
    useRules(
      new List<Lead_Scoring_Rule__mdt>{
        rule('Bad_Number_Rule', 'NumberOfEmployees', GREATER_THAN, 'abc', 50),
        rule('Email_Rule', 'Email', NOT_BLANK, null, 10)
      }
    );
    Lead record = newLead();
    record.Email = 'a@example.com';
    record.NumberOfEmployees = 500;

    Assert.areEqual(10, totalFor(record), 'The good rule still counts');
    Assert.areEqual(
      'Value "abc" is not a number',
      LeadScoringService.skippedRules.get('Bad_Number_Rule')
    );
  }

  @IsTest
  static void blankOrUnknownOperatorIsSkipped() {
    useRules(
      new List<Lead_Scoring_Rule__mdt>{
        rule('No_Operator_Rule', 'Email', null, null, 50),
        rule('Odd_Operator_Rule', 'Email', 'Contains', 'example', 50)
      }
    );
    Lead record = newLead();
    record.Email = 'a@example.com';

    Assert.areEqual(
      0,
      totalFor(record),
      'Rules without a supported operator add nothing'
    );
    Assert.areEqual(
      'Operator is empty',
      LeadScoringService.skippedRules.get('No_Operator_Rule')
    );
    Assert.areEqual(
      'Operator "Contains" is not supported',
      LeadScoringService.skippedRules.get('Odd_Operator_Rule')
    );
  }

  @IsTest
  static void blankPointsRuleIsSkipped() {
    useRule(rule('No_Points_Rule', 'Email', NOT_BLANK, null, null));
    Lead record = newLead();
    record.Email = 'a@example.com';

    Assert.areEqual(0, totalFor(record), 'A rule with no Points adds nothing');
    Assert.areEqual(
      'Points is empty',
      LeadScoringService.skippedRules.get('No_Points_Rule')
    );
  }

  @IsTest
  static void blankValueIsSkippedForEqualsAndGreaterThan() {
    useRules(
      new List<Lead_Scoring_Rule__mdt>{
        rule('Equals_No_Value_Rule', 'Industry', EQUALS, null, 50),
        rule(
          'Greater_No_Value_Rule',
          'NumberOfEmployees',
          GREATER_THAN,
          ' ',
          50
        ),
        rule('Not_Blank_No_Value_Rule', 'Email', NOT_BLANK, null, 10)
      }
    );
    Lead record = newLead();
    record.Email = 'a@example.com';
    record.Industry = 'Technology';
    record.NumberOfEmployees = 500;

    Assert.areEqual(10, totalFor(record), 'Only the Not Blank rule counts');
    Assert.areEqual(
      'Value is empty',
      LeadScoringService.skippedRules.get('Equals_No_Value_Rule')
    );
    Assert.areEqual(
      'Value is empty',
      LeadScoringService.skippedRules.get('Greater_No_Value_Rule')
    );
    Assert.isFalse(
      LeadScoringService.skippedRules.containsKey('Not_Blank_No_Value_Rule'),
      'Not Blank needs no Value'
    );
  }

  @IsTest
  static void allRulesBadScoresZero() {
    useRules(
      new List<Lead_Scoring_Rule__mdt>{
        rule('Unknown_Field_Rule', 'Not_A_Field__c', NOT_BLANK, null, 50),
        rule('Bad_Number_Rule', 'NumberOfEmployees', GREATER_THAN, 'abc', 50)
      }
    );
    Lead record = newLead();
    record.Email = 'a@example.com';
    record.NumberOfEmployees = 500;

    LeadScoringService.ScoreResult result = LeadScoringService.score(record);

    Assert.areEqual(
      0,
      result.total,
      'With every rule badly configured the score is 0'
    );
    Assert.areEqual(0, result.matches.size(), 'Nothing matched');
    Assert.areEqual(
      2,
      LeadScoringService.skippedRules.size(),
      'Both rules are recorded as skipped'
    );
  }

  @IsTest
  static void noRulesScoresZero() {
    useRules(new List<Lead_Scoring_Rule__mdt>());
    Lead record = newLead();
    record.Email = 'a@example.com';

    LeadScoringService.ScoreResult result = LeadScoringService.score(record);

    Assert.areEqual(0, result.total, 'With no rules the score is 0');
    Assert.areEqual(0, result.matches.size(), 'With no rules nothing matches');
  }

  @IsTest
  static void fieldNotLoadedOnRecordIsContained() {
    useRules(
      new List<Lead_Scoring_Rule__mdt>{
        rule('Email_Rule', 'Email', NOT_BLANK, null, 10),
        rule('Phone_Rule', 'Phone', NOT_BLANK, null, 20)
      }
    );
    Lead record = newLead();
    record.Email = 'a@example.com';
    record.Phone = '555-0100';
    insert record;
    Lead withoutEmail = [SELECT Id, Phone FROM Lead WHERE Id = :record.Id];

    LeadScoringService.ScoreResult result = LeadScoringService.score(
      withoutEmail
    );

    Assert.areEqual(
      20,
      result.total,
      'The rule whose field was not queried adds nothing; the other counts'
    );
    Assert.isTrue(
      LeadScoringService.skippedRules.containsKey('Email_Rule'),
      'The rule that could not be evaluated is recorded'
    );
    Assert.isFalse(
      LeadScoringService.skippedRules.containsKey('Phone_Rule'),
      'The other rule is not'
    );
  }

  @IsTest
  static void nullLeadScoresZero() {
    useRules(sampleRules());

    LeadScoringService.ScoreResult result = LeadScoringService.score(null);

    Assert.areEqual(0, result.total, 'A null Lead scores 0');
    Assert.isNotNull(result.matches, 'The match list is never null');
    Assert.areEqual(0, result.matches.size(), 'A null Lead matches nothing');
  }

  @IsTest
  static void matchesCarryNameLabelAndPoints() {
    Lead_Scoring_Rule__mdt second = rule(
      'A_Phone_Rule',
      'Phone',
      NOT_BLANK,
      null,
      5
    );
    second.MasterLabel = 'Beta phone';
    Lead_Scoring_Rule__mdt first = rule(
      'Z_Email_Rule',
      'Email',
      NOT_BLANK,
      null,
      10
    );
    first.MasterLabel = 'alpha email';
    useRules(new List<Lead_Scoring_Rule__mdt>{ second, first });
    Lead record = newLead();
    record.Email = 'a@example.com';
    record.Phone = '555-0100';

    LeadScoringService.ScoreResult result = LeadScoringService.score(record);

    Assert.areEqual(2, result.matches.size(), 'Both rules match');
    Assert.areEqual(
      'Z_Email_Rule',
      result.matches[0].ruleName,
      'Matches are in label order'
    );
    Assert.areEqual('alpha email', result.matches[0].label);
    Assert.areEqual(10, result.matches[0].points);
    Assert.areEqual('A_Phone_Rule', result.matches[1].ruleName);
    Assert.areEqual('Beta phone', result.matches[1].label);
    Assert.areEqual(5, result.matches[1].points);
  }

  @IsTest
  static void scoredFieldNamesListsOnlyUsableRules() {
    Lead_Scoring_Rule__mdt inactive = rule(
      'Phone_Rule',
      'Phone',
      NOT_BLANK,
      null,
      10
    );
    inactive.Active__c = false;
    useRules(
      new List<Lead_Scoring_Rule__mdt>{
        rule('Email_Rule', ' email ', NOT_BLANK, null, 10),
        rule('Industry_Rule', 'Industry', EQUALS, 'Technology', 20),
        inactive,
        rule('Unknown_Field_Rule', 'Not_A_Field__c', NOT_BLANK, null, 50),
        rule('Bad_Number_Rule', 'NumberOfEmployees', GREATER_THAN, 'abc', 50)
      }
    );

    Set<String> fieldNames = LeadScoringService.getScoredFieldNames();

    Assert.areEqual(
      new Set<String>{ 'Email', 'Industry' },
      fieldNames,
      'Only the fields of active, well-configured rules, by their API names'
    );
  }

  @IsTest
  static void rulesAreLoadedOncePerTransaction() {
    useRules(sampleRules());
    List<Lead> records = new List<Lead>();
    for (Integer i = 0; i < 200; i++) {
      Lead record = newLead();
      record.Email = 'lead' + i + '@example.com';
      record.NumberOfEmployees = Math.mod(i, 2) == 0 ? 500 : 50;
      records.add(record);
    }

    Integer evenTotal = 0;
    Integer oddTotal = 0;
    for (Integer i = 0; i < records.size(); i++) {
      Integer total = totalFor(records[i]);
      if (Math.mod(i, 2) == 0) {
        evenTotal += total;
      } else {
        oddTotal += total;
      }
    }

    Assert.areEqual(
      100 * 35,
      evenTotal,
      '100 Leads with Email and 500 employees score 35 each'
    );
    Assert.areEqual(
      100 * 10,
      oddTotal,
      '100 Leads with Email and 50 employees score 10 each'
    );
    Assert.areEqual(
      1,
      LeadScoringService.ruleLoadCount,
      'The rules are loaded once for 200 Leads'
    );
  }

  @IsTest
  static void orgRulesAreReadWithoutTheSeam() {
    Lead record = newLead();
    record.Email = 'a@example.com';
    record.Phone = '555-0100';
    record.Industry = 'Technology';
    record.NumberOfEmployees = 500;
    record.AnnualRevenue = 2000000;

    LeadScoringService.ScoreResult result = LeadScoringService.score(record);

    Assert.isTrue(
      result.total >= LeadScoringService.MIN_SCORE &&
        result.total <= LeadScoringService.MAX_SCORE,
      'Whatever rules the org holds, the total is between 0 and 100: ' +
      result.total
    );
    Assert.isNotNull(result.matches, 'The match list is never null');
    Assert.areEqual(
      1,
      LeadScoringService.ruleLoadCount,
      'The rules were loaded by the query path'
    );
  }
}
