import { LightningElement, api, wire } from "lwc";
import { getRecord } from "lightning/uiRecordApi";
import { refreshApex } from "@salesforce/apex";
import getBreakdown from "@salesforce/apex/LeadScoreController.getBreakdown";
import LAST_MODIFIED_FIELD from "@salesforce/schema/Lead.LastModifiedDate";

const GENERIC_ERROR = "The lead score could not be loaded.";

function errorMessage(error) {
  const body = error && error.body;
  if (Array.isArray(body)) {
    const messages = body.map((e) => e && e.message).filter(Boolean);
    if (messages.length) {
      return messages.join(", ");
    }
  } else if (body && typeof body.message === "string" && body.message) {
    return body.message;
  }
  if (error && typeof error.message === "string" && error.message) {
    return error.message;
  }
  return GENERIC_ERROR;
}

function formatPoints(points) {
  return points > 0 ? `+${points}` : String(points);
}

/**
 * Shows a Lead's stored score and the scoring rules it matches.
 */
export default class LeadScoreBreakdown extends LightningElement {
  @api recordId;

  breakdown;
  error;
  wiredBreakdownResult;
  lastModified;

  @wire(getRecord, { recordId: "$recordId", fields: [LAST_MODIFIED_FIELD] })
  wiredRecord({ data }) {
    if (!data) {
      return;
    }
    const modified = data.fields.LastModifiedDate.value;
    if (
      this.lastModified &&
      modified !== this.lastModified &&
      this.wiredBreakdownResult
    ) {
      refreshApex(this.wiredBreakdownResult);
    }
    this.lastModified = modified;
  }

  @wire(getBreakdown, { leadId: "$recordId" })
  wiredBreakdown(result) {
    this.wiredBreakdownResult = result;
    if (result.data) {
      this.breakdown = result.data;
      this.error = undefined;
    } else if (result.error) {
      this.error = result.error;
      this.breakdown = undefined;
    }
  }

  get isLoading() {
    return !this.breakdown && !this.error;
  }

  get errorText() {
    return errorMessage(this.error);
  }

  get totalText() {
    const total = this.breakdown && this.breakdown.total;
    return total === null || total === undefined ? "Not scored" : String(total);
  }

  get rows() {
    const rules = (this.breakdown && this.breakdown.rules) || [];
    return rules.map((rule) => ({
      key: rule.ruleName,
      label: rule.label,
      pointsText: formatPoints(rule.points)
    }));
  }

  get hasRows() {
    return this.rows.length > 0;
  }

  get isOutOfDate() {
    return Boolean(this.breakdown && this.breakdown.outOfDate);
  }
}
