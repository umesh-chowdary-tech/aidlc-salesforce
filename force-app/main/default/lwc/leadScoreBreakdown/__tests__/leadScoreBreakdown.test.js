import { createElement } from "@lwc/engine-dom";
import LeadScoreBreakdown from "c/leadScoreBreakdown";
import getBreakdown from "@salesforce/apex/LeadScoreController.getBreakdown";
import { getRecord } from "lightning/uiRecordApi";
import { refreshApex } from "@salesforce/apex";

jest.mock(
  "@salesforce/apex/LeadScoreController.getBreakdown",
  () => {
    const { createApexTestWireAdapter } = require("@salesforce/sfdx-lwc-jest");
    return { default: createApexTestWireAdapter(jest.fn()) };
  },
  { virtual: true }
);

jest.mock(
  "@salesforce/apex",
  () => ({ refreshApex: jest.fn(() => Promise.resolve()) }),
  { virtual: true }
);

const RECORD_ID = "00Q000000000001AAA";

const BREAKDOWN = {
  total: 40,
  outOfDate: false,
  rules: [
    { ruleName: "Email_Not_Blank", label: "Email not blank", points: 10 },
    {
      ruleName: "Industry_Equals_Technology",
      label: "Industry equals Technology",
      points: 20
    },
    { ruleName: "Phone_Not_Blank", label: "Phone not blank", points: 10 }
  ]
};

function createComponent() {
  const element = createElement("c-lead-score-breakdown", {
    is: LeadScoreBreakdown
  });
  element.recordId = RECORD_ID;
  document.body.appendChild(element);
  return element;
}

const flush = () => Promise.resolve();
const $ = (element, selector) => element.shadowRoot.querySelector(selector);
const $$ = (element, selector) => [
  ...element.shadowRoot.querySelectorAll(selector)
];

function recordWithModified(value) {
  return {
    apiName: "Lead",
    id: RECORD_ID,
    fields: { LastModifiedDate: { value, displayValue: null } }
  };
}

describe("c-lead-score-breakdown", () => {
  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    jest.clearAllMocks();
  });

  it("renders the total and one line per matched rule", async () => {
    const element = createComponent();
    getBreakdown.emit(BREAKDOWN);
    await flush();

    expect($(element, '[data-id="total"]').textContent).toBe("40");
    const rows = $$(element, 'li[data-id="rule"]');
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("Email not blank");
    expect(rows[0].textContent).toContain("+10");
    expect(rows[1].textContent).toContain("Industry equals Technology");
    expect(rows[1].textContent).toContain("+20");
    expect($(element, '[data-id="empty"]')).toBeNull();
    expect($(element, '[data-id="out-of-date"]')).toBeNull();
    expect($(element, '[data-id="error"]')).toBeNull();
  });

  it("formats negative and zero points", async () => {
    const element = createComponent();
    getBreakdown.emit({
      total: 0,
      outOfDate: false,
      rules: [
        { ruleName: "Minus", label: "Free email domain", points: -5 },
        { ruleName: "Zero", label: "Placeholder", points: 0 }
      ]
    });
    await flush();

    const points = $$(element, '[data-id="points"]').map((n) => n.textContent);
    expect(points).toEqual(["-5", "0"]);
  });

  it("shows a message when no rules matched", async () => {
    const element = createComponent();
    getBreakdown.emit({ total: 0, outOfDate: false, rules: [] });
    await flush();

    expect($(element, '[data-id="total"]').textContent).toBe("0");
    expect($$(element, 'li[data-id="rule"]')).toHaveLength(0);
    expect($(element, '[data-id="empty"]').textContent).toBe(
      "No scoring rules matched this Lead."
    );
  });

  it("shows Not scored and the out-of-date note for a Lead never scored", async () => {
    const element = createComponent();
    getBreakdown.emit({ total: null, outOfDate: true, rules: [] });
    await flush();

    expect($(element, '[data-id="total"]').textContent).toBe("Not scored");
    expect($(element, '[data-id="out-of-date"]')).not.toBeNull();
  });

  it("shows the out-of-date note when lines and total disagree", async () => {
    const element = createComponent();
    getBreakdown.emit({ ...BREAKDOWN, outOfDate: true });
    await flush();

    expect($(element, '[data-id="out-of-date"]').textContent).toContain(
      "Save the Lead to update its score."
    );
  });

  it("shows the server's error message", async () => {
    const element = createComponent();
    getBreakdown.error({
      message: "This Lead was not found, or you do not have access to it."
    });
    await flush();

    expect($(element, '[data-id="error"]').textContent).toBe(
      "This Lead was not found, or you do not have access to it."
    );
    expect($(element, '[data-id="total"]')).toBeNull();
  });

  it("joins messages from an array error body", async () => {
    const element = createComponent();
    getBreakdown.error([
      { message: "First problem" },
      { message: "Second problem" }
    ]);
    await flush();

    expect($(element, '[data-id="error"]').textContent).toBe(
      "First problem, Second problem"
    );
  });

  it("shows a generic message when the error has no message", async () => {
    const element = createComponent();
    getBreakdown.error({});
    await flush();

    expect($(element, '[data-id="error"]').textContent).toBe(
      "The lead score could not be loaded."
    );
  });

  it("shows a spinner while loading", async () => {
    const element = createComponent();
    await flush();

    expect($(element, "lightning-spinner")).not.toBeNull();
    expect($(element, '[data-id="total"]')).toBeNull();
  });

  it("refreshes the breakdown when the record is saved", async () => {
    createComponent();
    getBreakdown.emit(BREAKDOWN);
    getRecord.emit(recordWithModified("2026-11-12T10:00:00.000Z"));
    await flush();
    expect(refreshApex).not.toHaveBeenCalled();

    getRecord.emit(recordWithModified("2026-11-12T10:00:00.000Z"));
    await flush();
    expect(refreshApex).not.toHaveBeenCalled();

    getRecord.emit(recordWithModified("2026-11-12T10:05:00.000Z"));
    await flush();
    expect(refreshApex).toHaveBeenCalledTimes(1);
  });
});
