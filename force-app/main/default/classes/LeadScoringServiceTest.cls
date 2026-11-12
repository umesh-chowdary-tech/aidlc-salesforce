@IsTest
private class LeadScoringServiceTest {
  private static Lead_Scoring_Rule__mdt rule(
    String name,
    String field,
    String operator,
    String value,
    Decimal points
  ) {
    return new Lead_Scoring_Rule__mdt(
      DeveloperName = name,
      MasterLabel = name.replace('_', ' '),
      Lead_Field__c = field,
      Operator__c = operator,
      Value__c = value,
      Points__c = points,
      Active__c = true
    );
  }

  private static List<Lead_Scoring_Rule__mdt> sampleRules() {
    return new List<Lead_Scoring_Rule__mdt>{
      rule('Email_Not_Blank', 'Email', 'Not Blank', null, 10),
      rule('Phone_Not_Blank', 'Phone', 'Not Blank', null, 10),
      rule(
        'Industry_Equals_Technology',
        'Industry',
        'Equals',
        'Technology',
        20
      ),
      rule(
        'Employees_Greater_Than_100',
        'NumberOfEmployees',
        'Greater Than',
        '100',
        25
      ),
      rule(
        'Revenue_Greater_Than_1000000',
        'AnnualRevenue',
        'Greater Than',
        '1000000',
        25
      )
    };
  }

  private static Integer scoreOf(Lead lead) {
    LeadScoringService.score(new List<Lead>{ lead });
    return lead.Score__c == null ? null : lead.Score__c.intValue();
  }

  private static Lead techLead() {
    return new Lead(
      LastName = 'Test',
      Company = 'Acme',
      Email = 'test@example.com',
      Phone = '555-0100',
      Industry = 'Technology'
    );
  }

  @IsTest
  static void sampleRulesScoreEmailPhoneAndTechnologyAs40() {
    LeadScoringService.rulesOverride = sampleRules();
    Assert.areEqual(40, scoreOf(techLead()));
  }

  @IsTest
  static void addingEmployeesRaisesScoreTo65() {
    LeadScoringService.rulesOverride = sampleRules();
    Lead lead = techLead();
    lead.NumberOfEmployees = 500;
    Assert.areEqual(65, scoreOf(lead));
  }

  @IsTest
  static void noMatchingRuleScoresZero() {
    LeadScoringService.rulesOverride = sampleRules();
    Assert.areEqual(0, scoreOf(new Lead(LastName = 'Test', Company = 'Acme')));
  }

  @IsTest
  static void scoreIsCappedAt100() {
    LeadScoringService.rulesOverride = new List<Lead_Scoring_Rule__mdt>{
      rule('A', 'Email', 'Not Blank', null, 50),
      rule('B', 'Phone', 'Not Blank', null, 50),
      rule('C', 'Industry', 'Equals', 'Technology', 50)
    };
    Assert.areEqual(100, scoreOf(techLead()));
  }

  @IsTest
  static void scoreNeverGoesBelowZero() {
    LeadScoringService.rulesOverride = new List<Lead_Scoring_Rule__mdt>{
      rule('A', 'Email', 'Not Blank', null, -40)
    };
    Assert.areEqual(0, scoreOf(techLead()));
  }

  @IsTest
  static void negativePointsSubtract() {
    List<Lead_Scoring_Rule__mdt> rules = sampleRules();
    rules.add(rule('Minus', 'Company', 'Not Blank', null, -15));
    LeadScoringService.rulesOverride = rules;
    Assert.areEqual(25, scoreOf(techLead()));
  }

  @IsTest
  static void inactiveRuleAddsNothing() {
    Lead_Scoring_Rule__mdt inactive = rule(
      'Email_Not_Blank',
      'Email',
      'Not Blank',
      null,
      10
    );
    inactive.Active__c = false;
    LeadScoringService.rulesOverride = new List<Lead_Scoring_Rule__mdt>{
      inactive
    };
    Lead lead = techLead();
    LeadScoringService.ScoreResult result = LeadScoringService.evaluate(lead);
    Assert.areEqual(0, result.total);
    Assert.isTrue(
      result.matchedRules.isEmpty(),
      'An inactive rule must not be listed'
    );
    Assert.areEqual(0, scoreOf(lead));
  }

  @IsTest
  static void equalsIgnoresCaseAndSpaces() {
    LeadScoringService.rulesOverride = new List<Lead_Scoring_Rule__mdt>{
      rule('Tech', 'Industry', 'Equals', ' Technology ', 20)
    };
    Lead lead = new Lead(
      LastName = 'Test',
      Company = 'Acme',
      Industry = 'technology'
    );
    Assert.areEqual(20, scoreOf(lead));
  }

  @IsTest
  static void equalsNeverMatchesBlankField() {
    LeadScoringService.rulesOverride = new List<Lead_Scoring_Rule__mdt>{
      rule('Tech', 'Industry', 'Equals', 'Technology', 20)
    };
    Assert.areEqual(0, scoreOf(new Lead(LastName = 'Test', Company = 'Acme')));
  }

  @IsTest
  static void notBlankIgnoresWhitespaceOnlyValues() {
    LeadScoringService.rulesOverride = new List<Lead_Scoring_Rule__mdt>{
      rule('Title', 'Title', 'Not Blank', null, 10)
    };
    Assert.areEqual(
      0,
      scoreOf(new Lead(LastName = 'Test', Company = 'Acme', Title = '   '))
    );
    Assert.areEqual(
      10,
      scoreOf(new Lead(LastName = 'Test', Company = 'Acme', Title = 'CTO'))
    );
  }

  @IsTest
  static void greaterThanIsStrict() {
    LeadScoringService.rulesOverride = new List<Lead_Scoring_Rule__mdt>{
      rule('Big', 'NumberOfEmployees', 'Greater Than', '100', 25)
    };
    Assert.areEqual(
      0,
      scoreOf(new Lead(LastName = 'T', Company = 'A', NumberOfEmployees = 100))
    );
    Assert.areEqual(
      25,
      scoreOf(new Lead(LastName = 'T', Company = 'A', NumberOfEmployees = 101))
    );
    Assert.areEqual(0, scoreOf(new Lead(LastName = 'T', Company = 'A')));
  }

  @IsTest
  static void greaterThanWorksOnCurrencyField() {
    LeadScoringService.rulesOverride = new List<Lead_Scoring_Rule__mdt>{
      rule('Rich', 'AnnualRevenue', 'Greater Than', '1000000', 25)
    };
    Assert.areEqual(
      25,
      scoreOf(new Lead(LastName = 'T', Company = 'A', AnnualRevenue = 2000000))
    );
    Assert.areEqual(
      0,
      scoreOf(new Lead(LastName = 'T', Company = 'A', AnnualRevenue = 1000000))
    );
  }

  @IsTest
  static void greaterThanNeverMatchesTextField() {
    LeadScoringService.rulesOverride = new List<Lead_Scoring_Rule__mdt>{
      rule('Text_Number', 'Title', 'Greater Than', '5', 25)
    };
    Assert.areEqual(
      0,
      scoreOf(new Lead(LastName = 'T', Company = 'A', Title = '500'))
    );
    Assert.isFalse(
      LeadScoringService.skippedRules.containsKey('Text_Number'),
      'A valid rule that simply does not match must not be reported as skipped'
    );
  }

  @IsTest
  static void fieldNameIsCaseInsensitive() {
    LeadScoringService.rulesOverride = new List<Lead_Scoring_Rule__mdt>{
      rule('Tech', 'industry', 'Equals', 'Technology', 20)
    };
    Assert.areEqual(20, scoreOf(techLead()));
    Assert.areEqual(
      new Set<String>{ 'Industry' },
      LeadScoringService.getRuleFieldNames()
    );
  }

  @IsTest
  static void unknownFieldIsSkippedAndLogged() {
    List<Lead_Scoring_Rule__mdt> rules = sampleRules();
    rules.add(rule('Bad_Field', 'Nope__c', 'Not Blank', null, 30));
    LeadScoringService.rulesOverride = rules;
    Assert.areEqual(40, scoreOf(techLead()));
    Assert.isTrue(
      LeadScoringService.skippedRules.get('Bad_Field')
        .contains('is not a field on Lead'),
      'The skip reason must name the problem: ' +
      LeadScoringService.skippedRules
    );
  }

  @IsTest
  static void emptyLeadFieldIsSkipped() {
    assertSkipped(
      rule('No_Field', null, 'Not Blank', null, 30),
      'Lead Field is empty'
    );
  }

  @IsTest
  static void emptyOperatorIsSkipped() {
    assertSkipped(
      rule('No_Operator', 'Email', null, null, 30),
      'Operator is empty'
    );
  }

  @IsTest
  static void unsupportedOperatorIsSkipped() {
    assertSkipped(
      rule('Contains', 'Email', 'Contains', 'example', 30),
      'is not one of'
    );
  }

  @IsTest
  static void emptyPointsIsSkipped() {
    assertSkipped(
      rule('No_Points', 'Email', 'Not Blank', null, null),
      'Points is empty'
    );
  }

  @IsTest
  static void emptyValueIsSkippedForEqualsAndGreaterThan() {
    assertSkipped(
      rule('No_Value_Equals', 'Industry', 'Equals', '  ', 30),
      'Value is empty'
    );
    assertSkipped(
      rule('No_Value_Greater', 'NumberOfEmployees', 'Greater Than', null, 30),
      'Value is empty'
    );
  }

  @IsTest
  static void nonNumericGreaterThanValueIsSkipped() {
    assertSkipped(
      rule('Not_A_Number', 'NumberOfEmployees', 'Greater Than', 'abc', 30),
      'is not a number'
    );
  }

  private static void assertSkipped(
    Lead_Scoring_Rule__mdt bad,
    String expectedReason
  ) {
    LeadScoringService.rulesOverride = new List<Lead_Scoring_Rule__mdt>{
      rule('Good', 'Email', 'Not Blank', null, 10),
      bad
    };
    Lead lead = techLead();
    lead.NumberOfEmployees = 500;
    Assert.areEqual(10, scoreOf(lead), 'Only the good rule may count');
    String reason = LeadScoringService.skippedRules.get(bad.DeveloperName);
    Assert.isNotNull(
      reason,
      bad.DeveloperName + ' must be reported as skipped'
    );
    Assert.isTrue(
      reason.contains(expectedReason),
      'Unexpected reason: ' + reason
    );
  }

  @IsTest
  static void everyRuleBadScoresZero() {
    LeadScoringService.rulesOverride = new List<Lead_Scoring_Rule__mdt>{
      rule('Bad_1', 'Nope__c', 'Not Blank', null, 10),
      rule('Bad_2', 'Email', null, null, 10),
      rule('Bad_3', 'NumberOfEmployees', 'Greater Than', 'many', 10)
    };
    Assert.areEqual(0, scoreOf(techLead()));
    Assert.areEqual(3, LeadScoringService.skippedRules.size());
  }

  @IsTest
  static void noRulesScoresZero() {
    LeadScoringService.rulesOverride = new List<Lead_Scoring_Rule__mdt>();
    Assert.areEqual(0, scoreOf(techLead()));
    Assert.isTrue(LeadScoringService.getRuleFieldNames().isEmpty());
  }

  @IsTest
  static void evaluateReturnsMatchedRulesSortedByLabel() {
    LeadScoringService.rulesOverride = sampleRules();
    LeadScoringService.ScoreResult result = LeadScoringService.evaluate(
      techLead()
    );
    Assert.areEqual(40, result.total);
    Assert.areEqual(3, result.matchedRules.size());
    Assert.areEqual('Email Not Blank', result.matchedRules[0].label);
    Assert.areEqual('Email_Not_Blank', result.matchedRules[0].ruleName);
    Assert.areEqual(10, result.matchedRules[0].points);
    Assert.areEqual('Industry Equals Technology', result.matchedRules[1].label);
    Assert.areEqual(20, result.matchedRules[1].points);
    Assert.areEqual('Phone Not Blank', result.matchedRules[2].label);
  }

  @IsTest
  static void evaluateWithFieldSubsetUsesOnlyThoseFields() {
    LeadScoringService.rulesOverride = sampleRules();
    LeadScoringService.ScoreResult result = LeadScoringService.evaluate(
      techLead(),
      new Set<String>{ 'Email' }
    );
    Assert.areEqual(10, result.total);
    Assert.areEqual(1, result.matchedRules.size());
    Assert.areEqual(
      new Set<String>{
        'Email',
        'Phone',
        'Industry',
        'NumberOfEmployees',
        'AnnualRevenue'
      },
      LeadScoringService.getRuleFieldNames()
    );
  }

  @IsTest
  static void errorWhileMatchingIsContained() {
    LeadScoringService.rulesOverride = new List<Lead_Scoring_Rule__mdt>();
    Lead inserted = new Lead(
      LastName = 'Test',
      Company = 'Acme',
      Email = 'a@example.com'
    );
    insert inserted;
    // Queried without Email: reading Email throws an SObjectException.
    Lead partial = [SELECT Id, Company FROM Lead WHERE Id = :inserted.Id];
    LeadScoringService.rulesOverride = new List<Lead_Scoring_Rule__mdt>{
      rule('Email_Rule', 'Email', 'Not Blank', null, 10),
      rule('Company_Rule', 'Company', 'Not Blank', null, 5)
    };
    LeadScoringService.ScoreResult result = LeadScoringService.evaluate(
      partial
    );
    Assert.areEqual(5, result.total);
    Assert.isTrue(
      LeadScoringService.skippedRules.get('Email_Rule')
        .startsWith('could not be evaluated'),
      'Unexpected reason: ' + LeadScoringService.skippedRules
    );
  }

  @IsTest
  static void scoringUsesNoQueries() {
    LeadScoringService.rulesOverride = sampleRules();
    List<Lead> leads = new List<Lead>();
    for (Integer i = 0; i < 200; i++) {
      leads.add(techLead());
    }
    Test.startTest();
    LeadScoringService.score(leads);
    Integer queries = Limits.getQueries();
    Test.stopTest();
    Assert.areEqual(0, queries, 'Scoring must not run any SOQL');
    for (Lead lead : leads) {
      Assert.areEqual(40, lead.Score__c.intValue());
    }
  }

  @IsTest
  static void realRulesKeepScoreInRange() {
    LeadScoringService.rulesOverride = null;
    Integer score = scoreOf(techLead());
    Assert.isTrue(score >= 0 && score <= 100, 'Score out of range: ' + score);
  }
}
