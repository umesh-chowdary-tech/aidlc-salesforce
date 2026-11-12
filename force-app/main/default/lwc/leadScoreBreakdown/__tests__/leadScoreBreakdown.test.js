import { createElement } from "lwc";
import LeadScoreBreakdown from "c/leadScoreBreakdown";
import { getRecord } from "lightning/uiRecordApi";
import { refreshApex } from "@salesforce/apex";
import getScoreBreakdown from "@salesforce/apex/LeadScoreController.getScoreBreakdown";

// The Apex method as a wire adapter the tests can emit data and errors on.
jest.mock(
  "@salesforce/apex/LeadScoreController.getScoreBreakdown",
  () => {
    const { createApexTestWireAdapter } = require("@salesforce/sfdx-lwc-jest");
    return { default: createApexTestWireAdapter(jest.fn()) };
  },
  { virtual: true }
);

// refreshApex as a mock, so the tests can count its calls.
jest.mock(
  "@salesforce/apex",
  () => ({ refreshApex: jest.fn(() => Promise.resolve()) }),
  { virtual: true }
);

const RECORD_ID = "00Q000000000001AAA";

const FORTY_POINTS = {
  total: 40,
  matches: [
    { ruleName: "Email_Not_Blank", label: "Email Not Blank", points: 10 },
    {
      ruleName: "Industry_Equals_Technology",
      label: "Industry Equals Technology",
      points: 20
    },
    { ruleName: "Phone_Not_Blank", label: "Phone Not Blank", points: 10 }
  ]
};

const NOTHING_MATCHED = { total: 0, matches: [] };

function recordModifiedAt(value) {
  return {
    apiName: "Lead",
    id: RECORD_ID,
    fields: { LastModifiedDate: { value, displayValue: null } }
  };
}

function createComponent() {
  const element = createElement("c-lead-score-breakdown", {
    is: LeadScoreBreakdown
  });
  element.recordId = RECORD_ID;
  document.body.appendChild(element);
  return element;
}

function find(element, dataId) {
  return element.shadowRoot.querySelector(`[data-id="${dataId}"]`);
}

function findAll(element, dataId) {
  return Array.from(
    element.shadowRoot.querySelectorAll(`[data-id="${dataId}"]`)
  );
}

function textOf(node) {
  return node.textContent.replace(/\s+/g, " ").trim();
}

describe("c-lead-score-breakdown", () => {
  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    jest.clearAllMocks();
  });

  it("shows a spinner while loading", async () => {
    const element = createComponent();
    await Promise.resolve();

    const spinner = element.shadowRoot.querySelector("lightning-spinner");
    expect(spinner).not.toBeNull();
    expect(spinner.alternativeText).toBe("Loading score");
    expect(find(element, "total")).toBeNull();
    expect(find(element, "empty")).toBeNull();
    expect(find(element, "error")).toBeNull();
  });

  it("shows the total and one line per matched rule", async () => {
    const element = createComponent();
    getScoreBreakdown.emit(FORTY_POINTS);
    await Promise.resolve();

    expect(element.shadowRoot.querySelector("lightning-spinner")).toBeNull();
    expect(textOf(find(element, "total"))).toBe("40");

    const lines = findAll(element, "rule");
    expect(lines).toHaveLength(3);
    expect(textOf(lines[0])).toContain("Email Not Blank");
    expect(textOf(lines[0])).toContain("+10");
    expect(textOf(lines[1])).toContain("Industry Equals Technology");
    expect(textOf(lines[1])).toContain("+20");
    expect(textOf(lines[2])).toContain("Phone Not Blank");
    expect(textOf(lines[2])).toContain("+10");

    expect(find(element, "empty")).toBeNull();
    expect(find(element, "error")).toBeNull();
  });

  it("shows a minus sign for negative points", async () => {
    const element = createComponent();
    getScoreBreakdown.emit({
      total: 5,
      matches: [
        { ruleName: "Email_Rule", label: "Has email", points: 10 },
        { ruleName: "Free_Mail_Rule", label: "Free mail", points: -5 }
      ]
    });
    await Promise.resolve();

    const lines = findAll(element, "rule");
    expect(lines).toHaveLength(2);
    expect(textOf(lines[0])).toContain("+10");
    expect(textOf(lines[1])).toContain("Free mail");
    expect(textOf(lines[1])).toContain("-5");
    expect(textOf(lines[1])).not.toContain("+");
  });

  it("shows a message when no rules matched", async () => {
    const element = createComponent();
    getScoreBreakdown.emit(NOTHING_MATCHED);
    await Promise.resolve();

    expect(textOf(find(element, "total"))).toBe("0");
    expect(textOf(find(element, "empty"))).toBe(
      "No scoring rules matched this Lead."
    );
    expect(findAll(element, "rule")).toHaveLength(0);
    expect(element.shadowRoot.querySelector("ul")).toBeNull();
    expect(find(element, "error")).toBeNull();
  });

  it("shows a readable error with the server message", async () => {
    const element = createComponent();
    getScoreBreakdown.error({
      message:
        "This Lead is not available. It may have been deleted, or you may not have access to it."
    });
    await Promise.resolve();

    expect(textOf(find(element, "error"))).toBe(
      "The score breakdown could not be loaded."
    );
    expect(textOf(find(element, "error-detail"))).toBe(
      "This Lead is not available. It may have been deleted, or you may not have access to it."
    );
    expect(find(element, "total")).toBeNull();
    expect(findAll(element, "rule")).toHaveLength(0);
    expect(find(element, "empty")).toBeNull();
    expect(element.shadowRoot.querySelector("lightning-spinner")).toBeNull();
  });

  it("shows only the fixed error text when the error has no message", async () => {
    const element = createComponent();
    getScoreBreakdown.error({});
    await Promise.resolve();

    expect(textOf(find(element, "error"))).toBe(
      "The score breakdown could not be loaded."
    );
    expect(find(element, "error-detail")).toBeNull();
    expect(find(element, "total")).toBeNull();
  });

  it("passes the record id to Apex", async () => {
    createComponent();
    await Promise.resolve();

    expect(getScoreBreakdown.getLastConfig()).toEqual({
      leadId: RECORD_ID
    });
  });

  it("refreshes when the record is saved", async () => {
    const element = createComponent();
    getScoreBreakdown.emit(FORTY_POINTS);
    getRecord.emit(recordModifiedAt("2026-11-12T03:00:00.000Z"));
    await Promise.resolve();

    // The first value only sets the baseline.
    expect(refreshApex).not.toHaveBeenCalled();

    // The same value again (a cache re-emit) is not a save.
    getRecord.emit(recordModifiedAt("2026-11-12T03:00:00.000Z"));
    await Promise.resolve();
    expect(refreshApex).not.toHaveBeenCalled();

    getRecord.emit(recordModifiedAt("2026-11-12T03:05:00.000Z"));
    await Promise.resolve();
    expect(refreshApex).toHaveBeenCalledTimes(1);

    // A failing record wire is ignored: what is shown stays.
    getRecord.error();
    await Promise.resolve();
    expect(refreshApex).toHaveBeenCalledTimes(1);
    expect(textOf(find(element, "total"))).toBe("40");
    expect(find(element, "error")).toBeNull();
  });
});
