/**
 * Tests for LeadScoreController. Rules come from the
 * LeadScoringService.setRulesForTest seam, never from the rule records
 * shipped in source, and every test creates its own Leads.
 *
 * The controller reads the Lead in user mode, so each test calls it as a
 * Standard User created here: with the Lead_Scoring_User permission set, or
 * without it for the test that proves field-level security is enforced.
 */
@IsTest
private class LeadScoreControllerTest {
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

  /**
   * A new Standard User, with or without the Lead_Scoring_User permission
   * set. Created inside runAs so that the user and assignment (setup objects)
   * can be followed by Lead inserts in the same test.
   */
  private static User newRep(Boolean withPermissionSet) {
    User rep;
    System.runAs(new User(Id = UserInfo.getUserId())) {
      String unique =
        UserInfo.getOrganizationId() +
        String.valueOf(Crypto.getRandomInteger()).replace('-', 'n');
      rep = new User(
        ProfileId = [SELECT Id FROM Profile WHERE Name = 'Standard User']
        .Id,
        Username = 'rep' + unique + '@leadscore.example.com',
        Email = 'rep@leadscore.example.com',
        LastName = 'Rep',
        Alias = 'lsrep',
        TimeZoneSidKey = 'GMT',
        LocaleSidKey = 'en_US',
        EmailEncodingKey = 'UTF-8',
        LanguageLocaleKey = 'en_US'
      );
      insert rep;
      if (withPermissionSet) {
        insert new PermissionSetAssignment(
          AssigneeId = rep.Id,
          PermissionSetId = [
            SELECT Id
            FROM PermissionSet
            WHERE Name = 'Lead_Scoring_User'
          ]
          .Id
        );
      }
    }
    return rep;
  }

  /** The message of the AuraHandledException the call throws, or null when it does not throw. */
  private static String errorMessageFor(Id leadId) {
    try {
      LeadScoreController.getScoreBreakdown(leadId);
      return null;
    } catch (AuraHandledException e) {
      return e.getMessage();
    }
  }

  @IsTest
  static void returnsStoredTotalAndMatchedRules() {
    LeadScoringService.setRulesForTest(sampleRules());
    LeadScoringService.ScoreResult result;

    System.runAs(newRep(true)) {
      Lead record = fortyPointLead(0);
      insert record;

      Test.startTest();
      result = LeadScoreController.getScoreBreakdown(record.Id);
      Test.stopTest();
    }

    Assert.areEqual(40, result.total, 'The stored Score is the total');
    Assert.areEqual(3, result.matches.size(), 'Three rules match');
    Assert.areEqual(
      'Email_Not_Blank',
      result.matches[0].ruleName,
      'Matches are in label order'
    );
    Assert.areEqual('Email_Not_Blank', result.matches[0].label);
    Assert.areEqual(10, result.matches[0].points);
    Assert.areEqual(
      'Industry_Equals_Technology',
      result.matches[1].ruleName,
      'Industry sorts between Email and Phone'
    );
    Assert.areEqual('Industry_Equals_Technology', result.matches[1].label);
    Assert.areEqual(20, result.matches[1].points);
    Assert.areEqual('Phone_Not_Blank', result.matches[2].ruleName);
    Assert.areEqual('Phone_Not_Blank', result.matches[2].label);
    Assert.areEqual(10, result.matches[2].points);
  }

  @IsTest
  static void returnsZeroAndNoMatchesWhenNothingMatches() {
    LeadScoringService.setRulesForTest(sampleRules());
    LeadScoringService.ScoreResult result;

    System.runAs(newRep(true)) {
      Lead record = new Lead(LastName = 'Unscored', Company = 'Acme');
      insert record;

      Test.startTest();
      result = LeadScoreController.getScoreBreakdown(record.Id);
      Test.stopTest();
    }

    Assert.areEqual(0, result.total, 'No matching rule gives total 0');
    Assert.isNotNull(result.matches, 'The match list is never null');
    Assert.areEqual(0, result.matches.size(), 'The match list is empty');
  }

  @IsTest
  static void listsNegativePointsAndKeepsTotalInRange() {
    LeadScoringService.setRulesForTest(
      new List<Lead_Scoring_Rule__mdt>{
        rule('A_Email_Rule', 'Email', NOT_BLANK, null, -30),
        rule('B_Phone_Rule', 'Phone', NOT_BLANK, null, 10)
      }
    );
    LeadScoringService.ScoreResult result;

    System.runAs(newRep(true)) {
      Lead record = fortyPointLead(0);
      insert record;

      Test.startTest();
      result = LeadScoreController.getScoreBreakdown(record.Id);
      Test.stopTest();
    }

    Assert.areEqual(
      0,
      result.total,
      '-30 and +10 are stored as 0, and the stored value is the total'
    );
    Assert.areEqual(2, result.matches.size(), 'Both rules are listed');
    Assert.areEqual(
      -30,
      result.matches[0].points,
      'The first match keeps its negative points'
    );
    Assert.areEqual(
      10,
      result.matches[1].points,
      'The second match keeps its points'
    );
  }

  @IsTest
  static void badlyConfiguredRuleIsNotListed() {
    LeadScoringService.setRulesForTest(
      new List<Lead_Scoring_Rule__mdt>{
        rule('Unknown_Field_Rule', 'Not_A_Field__c', NOT_BLANK, null, 50),
        rule('Bad_Number_Rule', 'NumberOfEmployees', GREATER_THAN, 'abc', 50),
        rule('Email_Rule', 'Email', NOT_BLANK, null, 10)
      }
    );
    LeadScoringService.ScoreResult result;

    System.runAs(newRep(true)) {
      Lead record = fortyPointLead(0);
      record.NumberOfEmployees = 500;
      insert record;

      Test.startTest();
      result = LeadScoreController.getScoreBreakdown(record.Id);
      Test.stopTest();
    }

    Assert.areEqual(10, result.total, 'Only the good rule counted');
    Assert.areEqual(1, result.matches.size(), 'Only the good rule is listed');
    Assert.areEqual('Email_Rule', result.matches[0].ruleName);
  }

  @IsTest
  static void totalIsStoredScoreWhenRulesChangedAfterSave() {
    LeadScoringService.setRulesForTest(sampleRules());
    LeadScoringService.ScoreResult result;

    System.runAs(newRep(true)) {
      Lead record = fortyPointLead(0);
      insert record;

      // An admin changes the rules after the Lead was last saved.
      LeadScoringService.setRulesForTest(
        new List<Lead_Scoring_Rule__mdt>{
          rule('Company_Rule', 'Company', NOT_BLANK, null, 7)
        }
      );

      Test.startTest();
      result = LeadScoreController.getScoreBreakdown(record.Id);
      Test.stopTest();
    }

    Assert.areEqual(
      40,
      result.total,
      'The total is still the Score stored at the last save'
    );
    Assert.areEqual(
      1,
      result.matches.size(),
      'The lines follow the current rules'
    );
    Assert.areEqual('Company_Rule', result.matches[0].ruleName);
    Assert.areEqual(7, result.matches[0].points);
  }

  @IsTest
  static void toResultUsesCalculatedTotalWhenStoredScoreIsEmpty() {
    LeadScoringService.setRulesForTest(sampleRules());
    Lead neverSaved = fortyPointLead(0);
    Lead saved = fortyPointLead(1);
    saved.Score__c = 15;

    LeadScoringService.ScoreResult calculated = LeadScoreController.toResult(
      neverSaved
    );
    LeadScoringService.ScoreResult stored = LeadScoreController.toResult(saved);

    Assert.areEqual(
      40,
      calculated.total,
      'With no stored Score the total is calculated from the current rules'
    );
    Assert.areEqual(3, calculated.matches.size(), 'The lines are listed');
    Assert.areEqual(
      15,
      stored.total,
      'A stored Score is used even when the rules now give another total'
    );
    Assert.areEqual(3, stored.matches.size(), 'The lines are still listed');
  }

  @IsTest
  static void ruleOnScoreFieldDoesNotBreakTheQuery() {
    LeadScoringService.setRulesForTest(
      new List<Lead_Scoring_Rule__mdt>{
        rule('A_Email_Rule', 'Email', NOT_BLANK, null, 10),
        rule('B_Score_Rule', 'score__c', NOT_BLANK, null, 5),
        rule('C_Id_Rule', 'id', NOT_BLANK, null, 1)
      }
    );
    LeadScoringService.ScoreResult result;

    System.runAs(newRep(true)) {
      Lead record = fortyPointLead(0);
      insert record;

      Test.startTest();
      result = LeadScoreController.getScoreBreakdown(record.Id);
      Test.stopTest();
    }

    // Score and Id are both empty while the insert is scored, so 10 is stored.
    Assert.areEqual(10, result.total, 'The stored Score is the total');
    Assert.areEqual(
      3,
      result.matches.size(),
      'The query ran with Score__c and Id selected once each, and all three rules match the saved Lead'
    );
  }

  @IsTest
  static void deletedLeadThrowsReadableError() {
    LeadScoringService.setRulesForTest(sampleRules());
    String message;

    System.runAs(newRep(true)) {
      Lead record = fortyPointLead(0);
      insert record;
      Id leadId = record.Id;
      delete record;

      Test.startTest();
      message = errorMessageFor(leadId);
      Test.stopTest();
    }

    Assert.areEqual(
      LeadScoreController.NOT_AVAILABLE_MESSAGE,
      message,
      'A deleted Lead gives the "not available" error and no data'
    );
  }

  @IsTest
  static void nullIdThrowsReadableError() {
    LeadScoringService.setRulesForTest(sampleRules());
    Integer queriesBefore = Limits.getQueries();

    String message = errorMessageFor(null);

    Assert.areEqual(
      LeadScoreController.NOT_AVAILABLE_MESSAGE,
      message,
      'An empty id gives the "not available" error'
    );
    Assert.areEqual(
      0,
      Limits.getQueries() - queriesBefore,
      'No query is run for an empty id'
    );
  }

  @IsTest
  static void userWithoutPermissionSetGetsReadableError() {
    LeadScoringService.setRulesForTest(sampleRules());
    String message;

    System.runAs(newRep(false)) {
      Lead record = fortyPointLead(0);
      insert record;

      Test.startTest();
      message = errorMessageFor(record.Id);
      Test.stopTest();
    }

    Assert.areEqual(
      LeadScoreController.NOT_READABLE_MESSAGE,
      message,
      'Without the permission set the user-mode query is refused'
    );
  }

  @IsTest
  static void userWithPermissionSetGetsBreakdown() {
    LeadScoringService.setRulesForTest(sampleRules());
    LeadScoringService.ScoreResult result;
    String message;

    System.runAs(newRep(true)) {
      Lead record = fortyPointLead(0);
      record.NumberOfEmployees = 500;
      insert record;

      Test.startTest();
      try {
        result = LeadScoreController.getScoreBreakdown(record.Id);
      } catch (AuraHandledException e) {
        message = e.getMessage();
      }
      Test.stopTest();
    }

    Assert.isNull(message, 'No error for a rep with the permission set');
    Assert.areEqual(65, result.total, 'The rep sees the stored Score');
    Assert.areEqual(4, result.matches.size(), 'The rep sees the four lines');
  }

  @IsTest
  static void breakdownAfterBulkInsertUsesOneQuery() {
    LeadScoringService.setRulesForTest(sampleRules());
    LeadScoringService.ScoreResult result;
    Integer queriesUsed;

    System.runAs(newRep(true)) {
      List<Lead> records = new List<Lead>();
      for (Integer i = 0; i < 200; i++) {
        Lead record = fortyPointLead(i);
        if (i == 199) {
          record.NumberOfEmployees = 500;
        }
        records.add(record);
      }
      insert records;

      Test.startTest();
      Integer queriesBefore = Limits.getQueries();
      result = LeadScoreController.getScoreBreakdown(records[199].Id);
      queriesUsed = Limits.getQueries() - queriesBefore;
      Test.stopTest();
    }

    Assert.areEqual(1, queriesUsed, 'One call uses exactly one SOQL query');
    Assert.areEqual(
      65,
      result.total,
      'The breakdown is for the Lead asked for, not another of the 200'
    );
    Assert.areEqual(4, result.matches.size(), 'Four rules match that Lead');
    Assert.areEqual(
      'Employees_Greater_Than_100',
      result.matches[1].ruleName,
      'The Employees rule, which only that Lead matches, is listed'
    );
  }
}
