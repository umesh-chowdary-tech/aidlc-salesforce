# User stories

## US-1: Configure scoring rules without a deployment

As a Salesforce admin
I want scoring rules to be custom metadata records
So that I can add, change or switch off a rule in Setup without a deployment

Acceptance criteria:

- Given the package is deployed, when I open Setup > Custom Metadata Types, then a "Lead Scoring Rule" type exists with the fields Lead Field, Operator, Value, Points and Active.
- Given I edit a rule, when I open the Operator field, then the only choices are Equals, Not Blank and Greater Than.
- Given the package is deployed, when I list the Lead Scoring Rule records, then five sample rules exist and all are active: Email not blank (+10), Phone not blank (+10), Industry equals Technology (+20), NumberOfEmployees greater than 100 (+25), AnnualRevenue greater than 1000000 (+25).
- Given the package is deployed, when I open the Lead object, then a number field Score (`Score__c`) exists.

## US-2: Score a Lead when it is saved

As a sales rep
I want every Lead to get a score from 0 to 100 when it is saved
So that I can tell which Leads to work first

Acceptance criteria:

- Given the five sample rules, when I create a Lead with Email, Phone and Industry = Technology and no other scored field, then its Score is 40.
- Given a Lead with Score 40, when I set NumberOfEmployees to 500 and save, then its Score is 65.
- Given a Lead that matches no active rule, when I save it, then its Score is 0.
- Given active rules whose matching points add up to more than 100, when I save a Lead that matches them all, then its Score is 100.
- Given active rules whose matching points add up to less than 0, when I save a Lead that matches them, then its Score is 0.
- Given a rule with Active unchecked, when I save a Lead that matches it, then that rule adds nothing to the Score.
- Given an admin changes a rule's points, when I next save a matching Lead, then the Score uses the new points, with no deployment in between.
- Given 200 Leads are inserted in one operation (for example by Data Loader), when the insert finishes, then all 200 have the correct Score and no governor limit error occurs.
- Given I type a value into Score through any means, when the Lead is saved, then the Score is the calculated value, not what I typed.

## US-3: A badly configured rule never blocks a save

As a sales rep
I want to be able to save Leads even when a scoring rule is set up wrongly
So that an admin's mistake does not stop my work

Acceptance criteria:

- Given an active rule whose Lead Field is not a field on Lead, when I save a Lead, then the save succeeds and the Score is the sum of the other matching rules.
- Given an active Greater Than rule whose Value is not a number, when I save a Lead, then the save succeeds and that rule adds nothing.
- Given an active rule with an empty Operator or empty Points, when I save a Lead, then the save succeeds and that rule adds nothing.
- Given an active Equals or Greater Than rule with an empty Value, when I save a Lead, then the save succeeds and that rule adds nothing.
- Given every active rule is badly configured, when I save a Lead, then the save succeeds and the Score is 0.
- Given no rule records exist at all, when I save a Lead, then the save succeeds and the Score is 0.
- Given a badly configured rule was skipped, when an admin reads the debug log for that save, then it names the rule and the reason it was skipped.

## US-4: See why a Lead has its score

As a sales rep
I want the Lead page to show the total score and which rules contributed
So that I understand the score and trust it

Acceptance criteria:

- Given the component is on the Lead record page and I have the permission set, when I open a Lead with Score 40 from Email, Phone and Industry, then I see the total 40 and three lines, each with the rule's label and its points (+10, +10, +20).
- Given a Lead that matches no active rule, when I open it, then I see the total 0 and a message that no rules matched, not an empty box.
- Given a Lead is open, when I change a scored field and save, then the total and the lines update without a manual page refresh.
- Given a badly configured active rule, when I open a Lead, then the component still loads and that rule is not listed.
- Given the data call fails (for example I do not have the permission set), when I open a Lead, then the component shows a readable error message instead of a blank area or a stack trace.
- Given I do not have read access to a Lead, when the component asks for its breakdown, then no data about that Lead is returned.

## US-5: Give reps access with one permission set

As a Salesforce admin
I want a single permission set that grants everything a rep needs for lead scoring
So that I can turn the feature on for a user in one step and never edit profiles

Acceptance criteria:

- Given the package is deployed, when I list permission sets, then exactly one new permission set for lead scoring exists.
- Given a standard sales user without the permission set, when they open a Lead, then the Score field is not visible to them.
- Given I assign the permission set to that user, when they open a Lead, then they can see Score and the breakdown component loads.
- Given a user with the permission set, when they edit a Lead, then Score is read-only for them.
- Given the deployed source, when I search it for profile metadata, then there is none.
- Given the README, when I read the setup section, then it lists the manual steps: assign the permission set, and add the component to the Lead record page in Lightning App Builder.
