@IsTest
private class LeadTriggerHandlerTest {
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

  private static Lead techLead(Integer i) {
    return new Lead(
      LastName = 'Test ' + i,
      Company = 'Acme',
      Email = 'test' + i + '@example.com',
      Phone = '555-0100',
      Industry = 'Technology'
    );
  }

  private static Integer storedScore(Id leadId) {
    return [SELECT Score__c FROM Lead WHERE Id = :leadId].Score__c.intValue();
  }

  @IsTest
  static void insertSetsScore() {
    LeadScoringService.rulesOverride = sampleRules();
    Lead lead = techLead(1);
    insert lead;
    Assert.areEqual(40, storedScore(lead.Id));
  }

  @IsTest
  static void updateRescoresLead() {
    LeadScoringService.rulesOverride = sampleRules();
    Lead lead = techLead(1);
    insert lead;
    lead.NumberOfEmployees = 500;
    update lead;
    Assert.areEqual(65, storedScore(lead.Id));
  }

  @IsTest
  static void typedScoreIsReplaced() {
    LeadScoringService.rulesOverride = sampleRules();
    Lead lead = new Lead(LastName = 'Test', Company = 'Acme', Score__c = 99);
    insert lead;
    Assert.areEqual(0, storedScore(lead.Id));
    lead.Score__c = 77;
    update lead;
    Assert.areEqual(0, storedScore(lead.Id));
  }

  @IsTest
  static void changedRuleAppliesOnNextSave() {
    List<Lead_Scoring_Rule__mdt> rules = sampleRules();
    LeadScoringService.rulesOverride = rules;
    Lead lead = techLead(1);
    insert lead;
    Assert.areEqual(40, storedScore(lead.Id));

    rules[0].Points__c = 30;
    update lead;
    Assert.areEqual(60, storedScore(lead.Id));
  }

  @IsTest
  static void badRulesNeverBlockSave() {
    List<Lead_Scoring_Rule__mdt> rules = sampleRules();
    rules.add(rule('Bad_Field', 'Nope__c', 'Not Blank', null, 10));
    rules.add(
      rule('Bad_Value', 'NumberOfEmployees', 'Greater Than', 'lots', 10)
    );
    rules.add(rule('Bad_Points', 'Email', 'Not Blank', null, null));
    LeadScoringService.rulesOverride = rules;
    Lead lead = techLead(1);
    Database.SaveResult result = Database.insert(lead, false);
    Assert.isTrue(
      result.isSuccess(),
      'Save must succeed: ' + result.getErrors()
    );
    Assert.areEqual(40, storedScore(lead.Id));
  }

  @IsTest
  static void bulkInsertAndUpdateScore200Leads() {
    LeadScoringService.rulesOverride = sampleRules();
    List<Lead> leads = new List<Lead>();
    for (Integer i = 0; i < 200; i++) {
      leads.add(techLead(i));
    }

    Test.startTest();
    insert leads;
    for (Lead lead : leads) {
      lead.NumberOfEmployees = 500;
    }
    update leads;
    Test.stopTest();

    List<Lead> saved = [SELECT Score__c FROM Lead WHERE Id IN :leads];
    Assert.areEqual(200, saved.size());
    for (Lead lead : saved) {
      Assert.areEqual(65, lead.Score__c.intValue());
    }
  }
}
