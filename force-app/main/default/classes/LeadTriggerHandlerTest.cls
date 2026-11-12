/**
 * Tests for LeadTriggerHandler through LeadTrigger: these insert and update
 * real Leads. Rules come from the LeadScoringService.setRulesForTest seam,
 * never from the rule records shipped in source.
 */
@IsTest
private class LeadTriggerHandlerTest {
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

  /** A Lead with Email, Phone and Industry = Technology: 40 with the sample rules. */
  private static Lead fortyPointLead(Integer index) {
    return new Lead(
      LastName = 'Scored' + index,
      Company = 'Acme ' + index,
      Email = 'scored' + index + '@example.com',
      Phone = '555-0100',
      Industry = 'Technology'
    );
  }

  /** A Lead with Email only: 10 with the sample rules. */
  private static Lead tenPointLead(Integer index) {
    return new Lead(
      LastName = 'Scored' + index,
      Company = 'Acme ' + index,
      Email = 'scored' + index + '@example.com'
    );
  }

  /** The stored score as an Integer, or null when the field is empty. */
  private static Integer storedScore(Id leadId) {
    Decimal stored = [SELECT Score__c FROM Lead WHERE Id = :leadId].Score__c;
    return stored == null ? null : stored.intValue();
  }

  @IsTest
  static void insertSetsScore() {
    LeadScoringService.setRulesForTest(sampleRules());
    Lead record = fortyPointLead(0);

    Test.startTest();
    insert record;
    Test.stopTest();

    Assert.areEqual(
      40,
      storedScore(record.Id),
      'Email, Phone and Industry = Technology store 40'
    );
  }

  @IsTest
  static void updateRecalculatesScore() {
    LeadScoringService.setRulesForTest(sampleRules());
    Lead record = fortyPointLead(0);
    insert record;

    Test.startTest();
    record.NumberOfEmployees = 500;
    update record;
    Test.stopTest();

    Assert.areEqual(
      65,
      storedScore(record.Id),
      'Adding 500 employees stores 65'
    );
  }

  @IsTest
  static void updateUsesChangedRules() {
    LeadScoringService.setRulesForTest(
      new List<Lead_Scoring_Rule__mdt>{
        rule('Email_Rule', 'Email', NOT_BLANK, null, 10)
      }
    );
    Lead record = tenPointLead(0);
    insert record;
    Assert.areEqual(
      10,
      storedScore(record.Id),
      'The first save uses the first points'
    );

    LeadScoringService.setRulesForTest(
      new List<Lead_Scoring_Rule__mdt>{
        rule('Email_Rule', 'Email', NOT_BLANK, null, 30)
      }
    );
    Test.startTest();
    update record;
    Test.stopTest();

    Assert.areEqual(
      30,
      storedScore(record.Id),
      'The next save uses the changed points'
    );
  }

  @IsTest
  static void typedScoreIsOverwrittenOnInsertAndUpdate() {
    LeadScoringService.setRulesForTest(sampleRules());
    Lead record = fortyPointLead(0);
    record.Score__c = 99;
    insert record;

    Assert.areEqual(
      40,
      storedScore(record.Id),
      'A Score supplied on insert is replaced'
    );

    Test.startTest();
    record.Score__c = 99;
    update record;
    Test.stopTest();

    Assert.areEqual(
      40,
      storedScore(record.Id),
      'A Score supplied on update is replaced'
    );
  }

  @IsTest
  static void noMatchStoresZero() {
    LeadScoringService.setRulesForTest(sampleRules());
    Lead record = new Lead(LastName = 'Unscored', Company = 'Acme');

    Test.startTest();
    insert record;
    Test.stopTest();

    Assert.areEqual(
      0,
      storedScore(record.Id),
      'A Lead matching no rule is saved with 0, not empty'
    );
  }

  @IsTest
  static void badRuleDoesNotBlockSave() {
    LeadScoringService.setRulesForTest(
      new List<Lead_Scoring_Rule__mdt>{
        rule('Unknown_Field_Rule', 'Not_A_Field__c', NOT_BLANK, null, 50),
        rule('Email_Rule', 'Email', NOT_BLANK, null, 10)
      }
    );
    Lead record = tenPointLead(0);

    Test.startTest();
    Database.SaveResult saved = Database.insert(record, false);
    Test.stopTest();

    Assert.isTrue(
      saved.isSuccess(),
      'A badly configured rule does not block the save: ' + saved.getErrors()
    );
    Assert.areEqual(
      10,
      storedScore(record.Id),
      'The score is the good rule\'s points'
    );
    Assert.isTrue(
      LeadScoringService.skippedRules.containsKey('Unknown_Field_Rule'),
      'The bad rule is recorded as skipped'
    );
  }

  @IsTest
  static void noRulesDoesNotBlockSave() {
    LeadScoringService.setRulesForTest(new List<Lead_Scoring_Rule__mdt>());
    Lead record = fortyPointLead(0);

    Test.startTest();
    Database.SaveResult saved = Database.insert(record, false);
    Test.stopTest();

    Assert.isTrue(
      saved.isSuccess(),
      'Having no rules does not block the save: ' + saved.getErrors()
    );
    Assert.areEqual(0, storedScore(record.Id), 'With no rules the score is 0');
  }

  @IsTest
  static void bulkInsertScoresTwoHundredLeads() {
    LeadScoringService.setRulesForTest(sampleRules());
    List<Lead> records = new List<Lead>();
    for (Integer i = 0; i < 200; i++) {
      records.add(Math.mod(i, 2) == 0 ? fortyPointLead(i) : tenPointLead(i));
    }

    Test.startTest();
    insert records;
    Test.stopTest();

    Integer forty = 0;
    Integer ten = 0;
    for (Lead saved : [
      SELECT Industry, Score__c
      FROM Lead
      WHERE Id IN :records
    ]) {
      Integer expected = saved.Industry == 'Technology' ? 40 : 10;
      Assert.areEqual(
        expected,
        saved.Score__c == null ? null : saved.Score__c.intValue(),
        'Each Lead in the batch gets its own score'
      );
      if (expected == 40) {
        forty++;
      } else {
        ten++;
      }
    }
    Assert.areEqual(100, forty, '100 Leads scored 40');
    Assert.areEqual(100, ten, '100 Leads scored 10');
    Assert.areEqual(
      1,
      LeadScoringService.ruleLoadCount,
      'The rules are loaded once for the 200-record batch'
    );
  }

  @IsTest
  static void bulkUpdateScoresTwoHundredLeads() {
    LeadScoringService.setRulesForTest(sampleRules());
    List<Lead> records = new List<Lead>();
    for (Integer i = 0; i < 200; i++) {
      records.add(tenPointLead(i));
    }
    insert records;
    for (Lead record : records) {
      record.NumberOfEmployees = 500;
    }

    Test.startTest();
    update records;
    Test.stopTest();

    List<Lead> savedLeads = [SELECT Score__c FROM Lead WHERE Id IN :records];
    Assert.areEqual(200, savedLeads.size(), 'All 200 Leads were saved');
    for (Lead saved : savedLeads) {
      Assert.areEqual(
        35,
        saved.Score__c == null ? null : saved.Score__c.intValue(),
        'Each updated Lead is re-scored: Email 10 plus Employees 25'
      );
    }
  }

  @IsTest
  static void beforeSaveAcceptsNullAndEmptyList() {
    LeadScoringService.setRulesForTest(sampleRules());

    LeadTriggerHandler.beforeSave(null);
    LeadTriggerHandler.beforeSave(new List<Lead>());

    Assert.areEqual(
      0,
      LeadScoringService.ruleLoadCount,
      'Nothing to score, so the rules are never loaded'
    );
  }
}
