@IsTest
private class LeadScoreControllerTest {
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
      )
    };
  }

  private static User makeRep(Boolean withPermissionSet) {
    Profile standardUser = [
      SELECT Id
      FROM Profile
      WHERE Name = 'Standard User'
      LIMIT 1
    ];
    String unique = String.valueOf(Math.abs(Crypto.getRandomInteger()));
    User rep = new User(
      Alias = 'lsrep',
      Email = 'lead.scoring.rep@example.com',
      EmailEncodingKey = 'UTF-8',
      LastName = 'Rep',
      LanguageLocaleKey = 'en_US',
      LocaleSidKey = 'en_US',
      ProfileId = standardUser.Id,
      TimeZoneSidKey = 'America/Los_Angeles',
      Username = 'lead.scoring.rep.' + unique + '@example.com.test'
    );
    // Setup objects go in their own runAs block to avoid mixed DML errors.
    System.runAs(new User(Id = UserInfo.getUserId())) {
      insert rep;
      if (withPermissionSet) {
        PermissionSet ps = [
          SELECT Id
          FROM PermissionSet
          WHERE Name = 'Lead_Scoring_User'
        ];
        insert new PermissionSetAssignment(
          AssigneeId = rep.Id,
          PermissionSetId = ps.Id
        );
      }
    }
    return rep;
  }

  private static Lead techLead(Id ownerId) {
    Lead lead = new Lead(
      LastName = 'Test',
      Company = 'Acme',
      Email = 'test@example.com',
      Phone = '555-0100',
      Industry = 'Technology'
    );
    if (ownerId != null) {
      lead.OwnerId = ownerId;
    }
    insert lead;
    return lead;
  }

  private static String errorFor(Id leadId) {
    try {
      LeadScoreController.getBreakdown(leadId);
    } catch (AuraHandledException e) {
      return e.getMessage();
    }
    return null;
  }

  @IsTest
  static void returnsStoredTotalAndMatchedRules() {
    LeadScoringService.rulesOverride = sampleRules();
    User rep = makeRep(true);
    Lead lead = techLead(rep.Id);

    LeadScoreController.Breakdown result;
    System.runAs(rep) {
      result = LeadScoreController.getBreakdown(lead.Id);
    }

    Assert.areEqual(40, result.total);
    Assert.isFalse(result.outOfDate);
    Assert.areEqual(3, result.rules.size());
    Assert.areEqual('Email Not Blank', result.rules[0].label);
    Assert.areEqual(10, result.rules[0].points);
    Assert.areEqual('Industry Equals Technology', result.rules[1].label);
    Assert.areEqual(20, result.rules[1].points);
    Assert.areEqual('Phone Not Blank', result.rules[2].label);
  }

  @IsTest
  static void noMatchReturnsZeroAndNoLines() {
    LeadScoringService.rulesOverride = sampleRules();
    User rep = makeRep(true);
    Lead lead = new Lead(LastName = 'Test', Company = 'Acme', OwnerId = rep.Id);
    insert lead;

    LeadScoreController.Breakdown result;
    System.runAs(rep) {
      result = LeadScoreController.getBreakdown(lead.Id);
    }

    Assert.areEqual(0, result.total);
    Assert.isTrue(result.rules.isEmpty());
    Assert.isFalse(result.outOfDate);
  }

  @IsTest
  static void badRuleIsNotListed() {
    List<Lead_Scoring_Rule__mdt> rules = sampleRules();
    rules.add(rule('Bad_Field', 'Nope__c', 'Not Blank', null, 30));
    rules.add(
      rule('Bad_Value', 'NumberOfEmployees', 'Greater Than', 'lots', 30)
    );
    LeadScoringService.rulesOverride = rules;
    User rep = makeRep(true);
    Lead lead = techLead(rep.Id);

    LeadScoreController.Breakdown result;
    System.runAs(rep) {
      result = LeadScoreController.getBreakdown(lead.Id);
    }

    Assert.areEqual(40, result.total);
    Assert.areEqual(3, result.rules.size());
    for (LeadScoringService.RuleResult line : result.rules) {
      Assert.isFalse(
        line.ruleName.startsWith('Bad_'),
        'Bad rule listed: ' + line.ruleName
      );
    }
  }

  @IsTest
  static void outOfDateWhenRulesChangedAfterSave() {
    List<Lead_Scoring_Rule__mdt> rules = sampleRules();
    LeadScoringService.rulesOverride = rules;
    User rep = makeRep(true);
    Lead lead = techLead(rep.Id);
    rules[0].Points__c = 30;

    LeadScoreController.Breakdown result;
    System.runAs(rep) {
      result = LeadScoreController.getBreakdown(lead.Id);
    }

    Assert.areEqual(40, result.total, 'The total is the stored score');
    Assert.areEqual(30, result.rules[0].points, 'Lines use the current rules');
    Assert.isTrue(result.outOfDate);
  }

  @IsTest
  static void nullIdIsRefused() {
    Assert.areEqual(LeadScoreController.NOT_FOUND, errorFor(null));
  }

  @IsTest
  static void nonLeadIdIsRefused() {
    Id accountId = Id.valueOf('001000000000000AAA');
    Assert.areEqual(LeadScoreController.NOT_FOUND, errorFor(accountId));
  }

  @IsTest
  static void deletedLeadIsRefused() {
    LeadScoringService.rulesOverride = sampleRules();
    User rep = makeRep(true);
    Lead lead = techLead(rep.Id);
    delete lead;

    String message;
    System.runAs(rep) {
      message = errorFor(lead.Id);
    }
    Assert.areEqual(LeadScoreController.NOT_FOUND, message);
  }

  @IsTest
  static void leadTheRepCannotReadReturnsNothing() {
    LeadScoringService.rulesOverride = sampleRules();
    User rep = makeRep(true);
    // Owned by the running user, not the rep.
    Lead lead = techLead(null);
    Boolean repCanRead = [
      SELECT RecordId, HasReadAccess
      FROM UserRecordAccess
      WHERE UserId = :rep.Id AND RecordId = :lead.Id
    ]
    .HasReadAccess;

    String message;
    LeadScoreController.Breakdown result;
    System.runAs(rep) {
      message = errorFor(lead.Id);
      if (message == null) {
        result = LeadScoreController.getBreakdown(lead.Id);
      }
    }

    if (repCanRead) {
      // The org's Lead sharing lets every user read this Lead.
      Assert.isNull(message, 'A Lead the rep can read must load');
      Assert.areEqual(40, result.total);
    } else {
      Assert.areEqual(LeadScoreController.NOT_FOUND, message);
    }
  }

  @IsTest
  static void repWithoutPermissionSetCannotReadScore() {
    LeadScoringService.rulesOverride = sampleRules();
    User rep = makeRep(false);
    Lead lead = techLead(rep.Id);

    Boolean canReadScore;
    String message;
    System.runAs(rep) {
      canReadScore = Schema.SObjectType.Lead.fields.Score__c.isAccessible();
      message = errorFor(lead.Id);
    }

    if (canReadScore) {
      // This org grants read on Score__c some other way.
      Assert.isNull(message);
    } else {
      Assert.areEqual(LeadScoreController.NO_SCORE_ACCESS, message);
    }
  }
}
