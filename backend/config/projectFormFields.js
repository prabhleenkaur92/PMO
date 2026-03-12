const PROJECT_FORM_FIELDS = [
  { key: 'companyName', label: 'Company Name' },
  { key: 'companyAddress', label: 'Company Address' },
  { key: 'workorderNumber', label: 'Workorder Number' },
  { key: 'poNumber', label: 'PO Number' },
  { key: 'financeProjectType', label: 'Finance Project Type' },
  { key: 'billingCycle', label: 'Billing Cycle' },
  { key: 'billingStartDate', label: 'Billing Start Date' },
  { key: 'billingEndDate', label: 'Billing End Date' },
  { key: 'organizationCategory', label: 'Category of Organization' },
  { key: 'reasonToConductAudit', label: 'Reason to Conduct Audit' },
  { key: 'sectorOfOrganization', label: 'Sector of Organization' },
  { key: 'typeOfAudit', label: 'Type of Audit' },
  { key: 'typeOfAuditOther', label: 'Any Other Audit Type' },
  { key: 'spocName', label: 'SPOC Name' },
  { key: 'spocEmail', label: 'SPOC Email' },
  { key: 'spocPhone', label: 'SPOC Contact Number' },
  { key: 'spocDesignation', label: 'SPOC Designation' },
  { key: 'testingType', label: 'Testing Type' },
  { key: 'scopeDescription', label: 'Scope Description' },
  { key: 'startDate', label: 'Start Date' },
  { key: 'expectedEndDate', label: 'Expected End Date' }
];

const ROLE_VALUES = ['admin', 'finance', 'pmo', 'manager', 'auditor'];

module.exports = { PROJECT_FORM_FIELDS, ROLE_VALUES };
