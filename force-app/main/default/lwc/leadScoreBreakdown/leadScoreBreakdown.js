import { LightningElement, api, wire } from "lwc";
import { getRecord, getFieldValue } from "lightning/uiRecordApi";
import { refreshApex } from "@salesforce/apex";
import getScoreBreakdown from "@salesforce/apex/LeadScoreController.getScoreBreakdown";
import LASTMODIFIED_FIELD from "@salesforce/schema/Lead.LastModifiedDate";

/**
 * Shows a Lead's score and the scoring rules it matches, on the Lead record
 * page. The breakdown is fetched again each time the Lead is saved.
 */
export default class LeadScoreBreakdown extends LightningElement {
  @api recordId;

  // The whole wired value is kept: refreshApex needs it.
  breakdown;
  lastModified;

  @wire(getScoreBreakdown, { leadId: "$recordId" })
  wiredBreakdown(result) {
    this.breakdown = result;
  }

  // Used only to notice a save. An error here is ignored: the breakdown
  // already shown stays.
  @wire(getRecord, { recordId: "$recordId", fields: [LASTMODIFIED_FIELD] })
  wiredRecord({ data }) {
    if (!data) {
      return;
    }
    const modified = getFieldValue(data, LASTMODIFIED_FIELD);
    const previous = this.lastModified;
    this.lastModified = modified;
    // The first value only sets the baseline, so the page load does not
    // call Apex twice.
    if (previous !== undefined && modified !== previous && this.breakdown) {
      // A failed refresh arrives through the breakdown wire as an error.
      refreshApex(this.breakdown).catch(() => {});
    }
  }

  get data() {
    return this.breakdown ? this.breakdown.data : undefined;
  }

  get error() {
    return this.breakdown ? this.breakdown.error : undefined;
  }

  get isLoading() {
    return !this.data && !this.error;
  }

  get hasError() {
    return Boolean(this.error);
  }

  get errorDetail() {
    const body = this.error ? this.error.body : undefined;
    if (Array.isArray(body)) {
      return body.length > 0 && body[0] ? body[0].message : undefined;
    }
    return body && typeof body.message === "string" ? body.message : undefined;
  }

  get total() {
    return this.data ? this.data.total : undefined;
  }

  get lines() {
    const matches = this.data && this.data.matches ? this.data.matches : [];
    return matches.map((match) => ({
      key: match.ruleName,
      label: match.label,
      points: match.points < 0 ? `${match.points}` : `+${match.points}`
    }));
  }

  get hasLines() {
    return this.lines.length > 0;
  }
}
