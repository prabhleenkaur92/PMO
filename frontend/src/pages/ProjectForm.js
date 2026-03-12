import React, { useState, useEffect } from 'react';
import { projectService, roleService, orderService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

const ORGANIZATION_CATEGORIES = [
  'Central Ministry/ Department',
  'Organization under Government Department',
  'Private Sector',
  'Public sector organisations',
  'State Government Department'
];
const AUDIT_REASONS = [
  'Certificate of compliance like ISO 27001',
  'Certificate of safe hosting',
  'Change in process or infrastructure',
  'Government directions',
  'Incident/ Breach in Organization',
  'Incident/ Breach in Sector',
  'New application/ Infrastructure',
  'Not Known',
  'Periodic Audit as per  Policy of organization',
  'Regulatory directions',
  'Third Party Initiated'
];
const ORGANIZATION_SECTORS = [
  'Agriculture',
  'Defense',
  'Education',
  'Energy',
  'Finance',
  'Healthcare',
  'Information_and_Broadcasting',
  'Information_and_communication_technology',
  'Law_Enforcement_and_security',
  'Public_Essential_Services_and_Utilities',
  'Space',
  'Transportation'
];
const AUDIT_TYPES = [
  'Website',
  'API',
  'Cloud security',
  'Compliance to Standard/Framework/Policies Related Audit',
  'Digital Forensic Readiness Assessment',
  'Industrial Control Systems (ICS) / SCADA Audit',
  'IoT Security Assessment',
  'Mobile Application Audit',
  'Network Infrastructure Audit',
  'Process Audit',
  'Red Team Assessment',
  'Source Code Review',
  'Application Audit',
  'Wireless security audit',
  'Any other'
];
const STRATEGIES = ['Specific Dates', 'Recurring', 'Milestone Based'];
const RECURRING_FREQUENCIES = ['Monthly', 'Quarterly', 'Yearly'];

const roundMoney = (v) => Math.round((Number(v) || 0) * 100) / 100;
const roundPercent = (v) => Math.round((Number(v) || 0) * 100) / 100;
const todayISO = () => new Date().toISOString().slice(0, 10);
const emptySubproject = () => ({ subprojectName: '' });

// Strategy-specific empty row creators
const emptySpecificDatesRow = () => ({ paymentDate: '', amount: '' });
const emptyMilestoneRow = () => ({ milestoneName: '', type: 'fixed', value: '' });
const emptyRecurringConfig = () => ({
  frequency: 'Monthly',
  startDate: '',
  useEndDate: true,
  endDate: '',
  numCycles: 1,
  type: 'fixed',
  amountPerCycle: ''
});

// Helper functions for strategy-specific calculations
const calculateMilestoneAmounts = (milestones, orderValue) => {
  return milestones.map(m => {
    if (m.type === 'percentage') {
      const amount = roundMoney((orderValue * m.value) / 100);
      return { ...m, calculatedAmount: amount };
    }
    return { ...m, calculatedAmount: m.value ? roundMoney(m.value) : 0 };
  });
};

const calculateRecurringSchedule = (config, orderValue) => {
  if (!config.startDate) return { cycles: 0, total: 0, amountPerCycle: 0, schedule: [] };

  let numCycles = config.numCycles || 1;
  
  if (config.useEndDate && config.endDate) {
    const start = new Date(config.startDate);
    const end = new Date(config.endDate);
    let count = 0;
    let current = new Date(start);
    
    while (current <= end) {
      count++;
      if (config.frequency === 'Monthly') current.setMonth(current.getMonth() + 1);
      else if (config.frequency === 'Quarterly') current.setMonth(current.getMonth() + 3);
      else if (config.frequency === 'Yearly') current.setFullYear(current.getFullYear() + 1);
    }
    numCycles = Math.max(1, count);
  }

  let amountPerCycle = 0;
  if (config.type === 'percentage') {
    amountPerCycle = roundMoney((orderValue * config.amountPerCycle) / 100);
  } else {
    amountPerCycle = roundMoney(config.amountPerCycle || 0);
  }

  const totalAmount = roundMoney(amountPerCycle * numCycles);
  const schedule = [];
  let currentDate = new Date(config.startDate);
  
  for (let i = 0; i < numCycles; i++) {
    schedule.push({
      cycleNumber: i + 1,
      date: currentDate.toISOString().slice(0, 10),
      amount: amountPerCycle
    });
    
    if (config.frequency === 'Monthly') currentDate.setMonth(currentDate.getMonth() + 1);
    else if (config.frequency === 'Quarterly') currentDate.setMonth(currentDate.getMonth() + 3);
    else if (config.frequency === 'Yearly') currentDate.setFullYear(currentDate.getFullYear() + 1);
  }

  return { cycles: numCycles, total: totalAmount, amountPerCycle, schedule };
};

export default function ProjectForm() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [visibilityMap, setVisibilityMap] = useState({});
  const [formData, setFormData] = useState({
    companyName: '',
    companyAddress: '',
    spocName: '',
    spocEmail: '',
    spocPhone: '',
    spocDesignation: '',
    testingType: 'Blackbox',
    scopeDescription: '',
    startDate: '',
    expectedEndDate: '',
    workorderNumber: '',
    orderNumber: '',
    orderValue: '',
    collectionStrategy: 'Specific Dates',
    organizationCategory: '',
    reasonToConductAudit: '',
    sectorOfOrganization: '',
    typeOfAudit: '',
    typeOfAuditOther: ''
  });
  // Strategy-specific payment states
  const [specificDatesRows, setSpecificDatesRows] = useState([emptySpecificDatesRow()]);
  const [milestoneRows, setMilestoneRows] = useState([emptyMilestoneRow()]);
  const [recurringConfig, setRecurringConfig] = useState(emptyRecurringConfig());
  const [subprojects, setSubprojects] = useState([emptySubproject()]);

  const canShowField = (key) => visibilityMap[key] !== false;

  React.useEffect(() => {
    const load = async () => {
      try {
        const [visRes, woRes] = await Promise.all([
          roleService.getMyFieldVisibility('project_form'),
          projectService.getNextWorkorderNumber()
        ]);
        const nextMap = {};
        (visRes.data?.fields || []).forEach((f) => { nextMap[f.key] = f.isVisible; });
        setVisibilityMap(nextMap);
        setFormData((prev) => ({ ...prev, workorderNumber: woRes.data?.workorderNumber || prev.workorderNumber }));
      } catch (_) {
        setVisibilityMap({});
      }
    };
    load();
  }, []);

  // Handle collection strategy changes - clear previous payment data
  useEffect(() => {
    if (formData.collectionStrategy === 'Specific Dates') {
      setSpecificDatesRows([emptySpecificDatesRow()]);
    } else if (formData.collectionStrategy === 'Milestone Based') {
      setMilestoneRows([emptyMilestoneRow()]);
    } else if (formData.collectionStrategy === 'Recurring') {
      setRecurringConfig(emptyRecurringConfig());
    }
    setError('');
  }, [formData.collectionStrategy]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === 'typeOfAudit' && value !== 'Any other') {
      setFormData((prev) => ({ ...prev, typeOfAudit: value, typeOfAuditOther: '' }));
      return;
    }
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const validateForm = () => {
    if (
      (canShowField('companyName') && !formData.companyName) ||
      (canShowField('companyAddress') && !formData.companyAddress) ||
      (canShowField('spocName') && !formData.spocName) ||
      (canShowField('spocEmail') && !formData.spocEmail) ||
      (canShowField('spocPhone') && !formData.spocPhone) ||
      (canShowField('scopeDescription') && !formData.scopeDescription) ||
      (canShowField('startDate') && !formData.startDate) ||
      (canShowField('organizationCategory') && !formData.organizationCategory) ||
      (canShowField('reasonToConductAudit') && !formData.reasonToConductAudit) ||
      (canShowField('sectorOfOrganization') && !formData.sectorOfOrganization) ||
      (canShowField('typeOfAudit') && !formData.typeOfAudit)
    ) return 'Please fill in all required project fields';

    if (!formData.orderNumber.trim()) return 'Order Number is required';
    if (!(roundMoney(formData.orderValue) > 0)) return 'Order Value must be greater than 0';
    if (!STRATEGIES.includes(formData.collectionStrategy)) return 'Collection Strategy is required';

    for (let i = 0; i < subprojects.length; i += 1) {
      if (!subprojects[i].subprojectName.trim()) return `Subproject ${i + 1}: name is required`;
    }

    const orderValue = roundMoney(formData.orderValue);

    // Strategy-specific validation
    if (formData.collectionStrategy === 'Specific Dates') {
      const seenDates = new Set();
      let paymentTotal = 0;
      for (let i = 0; i < specificDatesRows.length; i += 1) {
        const row = specificDatesRows[i];
        if (!row.paymentDate) return `Payment row ${i + 1}: date required`;
        if (row.paymentDate <= todayISO()) return `Payment row ${i + 1}: date must be future`;
        if (seenDates.has(row.paymentDate)) return `Payment row ${i + 1}: duplicate date`;
        seenDates.add(row.paymentDate);
        if (!(roundMoney(row.amount) > 0)) return `Payment row ${i + 1}: amount must be > 0`;
        paymentTotal += roundMoney(row.amount);
      }
      if (roundMoney(paymentTotal) !== orderValue) return `Specific Dates total (${roundMoney(paymentTotal)}) must equal Order Value (${orderValue})`;
    }

    if (formData.collectionStrategy === 'Milestone Based') {
      for (let i = 0; i < milestoneRows.length; i += 1) {
        const m = milestoneRows[i];
        if (!m.milestoneName.trim()) return `Milestone ${i + 1}: name is required`;
        if (!(roundMoney(m.value) > 0)) return `Milestone ${i + 1}: ${m.type} must be > 0`;
      }

      const calculatedMilestones = calculateMilestoneAmounts(milestoneRows, orderValue);
      const totalAmount = roundMoney(calculatedMilestones.reduce((s, m) => s + m.calculatedAmount, 0));
      const totalPercentage = milestoneRows.some(m => m.type === 'percentage')
        ? roundPercent(milestoneRows.filter(m => m.type === 'percentage').reduce((s, m) => s + roundPercent(m.value), 0))
        : null;

      if (milestoneRows.some(m => m.type === 'percentage')) {
        if (totalPercentage !== 100) return `Milestone percentages total (${totalPercentage}%) must equal 100%`;
      } else {
        if (roundMoney(totalAmount) !== orderValue) return `Milestone total (${roundMoney(totalAmount)}) must equal Order Value (${orderValue})`;
      }
    }

    if (formData.collectionStrategy === 'Recurring') {
      if (!recurringConfig.startDate) return 'Recurring: Start Date is required';
      if (recurringConfig.useEndDate && !recurringConfig.endDate) return 'Recurring: End Date is required (or switch to cycle mode)';
      if (!recurringConfig.useEndDate && !(recurringConfig.numCycles > 0)) return 'Recurring: Number of Cycles must be > 0';
      if (!(roundMoney(recurringConfig.amountPerCycle) > 0)) return `Recurring: Amount per cycle must be > 0`;

      const { total, schedule } = calculateRecurringSchedule(recurringConfig, orderValue);
      if (roundMoney(total) !== orderValue) return `Recurring total (${roundMoney(total)}) must equal Order Value (${orderValue})`;
      if (schedule.length === 0) return 'Recurring: Schedule generation failed - check dates';
    }

    if (formData.typeOfAudit === 'Any other' && canShowField('typeOfAuditOther') && !formData.typeOfAuditOther) return 'Please specify "Any other" audit type';
    return '';
  };

  const buildInvoicePayload = (projectId) => {
    const orderValue = roundMoney(formData.orderValue);
    let specificDates = null;
    let milestones = null;
    let recurring = null;

    if (formData.collectionStrategy === 'Specific Dates') {
      specificDates = specificDatesRows.map((r) => ({
        paymentDate: r.paymentDate,
        amount: roundMoney(r.amount)
      }));
    }

    if (formData.collectionStrategy === 'Milestone Based') {
      const calculatedMilestones = calculateMilestoneAmounts(milestoneRows, orderValue);
      milestones = calculatedMilestones.map((m) => ({
        milestoneName: m.milestoneName.trim(),
        type: m.type,
        value: roundMoney(m.value),
        calculatedAmount: roundMoney(m.calculatedAmount)
      }));
    }

    if (formData.collectionStrategy === 'Recurring') {
      const { schedule } = calculateRecurringSchedule(recurringConfig, orderValue);
      recurring = {
        frequency: recurringConfig.frequency,
        startDate: recurringConfig.startDate,
        endDate: recurringConfig.useEndDate ? recurringConfig.endDate : null,
        numCycles: recurringConfig.useEndDate ? null : recurringConfig.numCycles,
        type: recurringConfig.type,
        amountPerCycle: roundMoney(recurringConfig.amountPerCycle),
        schedule: schedule
      };
    }

    return {
      projectId,
      orderNumber: formData.orderNumber.trim(),
      orderValue: orderValue,
      collectionStrategy: formData.collectionStrategy,
      specificDates,
      recurring,
      milestones,
      subprojects: subprojects.map((sp) => ({ subprojectName: sp.subprojectName.trim() }))
    };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // PHASE 1: Validate project fields
    const projectValidationError = validateForm();
    if (projectValidationError) {
      setError(projectValidationError);
      return;
    }

    // PHASE 2: Validate invoice payload before creating project
    const invoicePayload = buildInvoicePayload('temp-project-id'); // Use placeholder for validation
    
    // Check if total payment matches order value
    const orderValue = roundMoney(formData.orderValue);
    let paymentTotal = 0;

    if (formData.collectionStrategy === 'Specific Dates') {
      paymentTotal = roundMoney(specificDatesRows.reduce((s, r) => s + roundMoney(r.amount), 0));
      if (roundMoney(paymentTotal) !== orderValue) {
        setError(`Specific Dates total (${paymentTotal}) must equal Order Value (${orderValue})`);
        return;
      }
    } else if (formData.collectionStrategy === 'Milestone Based') {
      const calculatedMilestones = calculateMilestoneAmounts(milestoneRows, orderValue);
      paymentTotal = roundMoney(calculatedMilestones.reduce((s, m) => s + m.calculatedAmount, 0));
      const totalPercentage = milestoneRows.some(m => m.type === 'percentage')
        ? roundPercent(milestoneRows.filter(m => m.type === 'percentage').reduce((s, m) => s + roundPercent(m.value), 0))
        : null;

      if (milestoneRows.some(m => m.type === 'percentage')) {
        if (totalPercentage !== 100) {
          setError(`Milestone percentages total (${totalPercentage}%) must equal 100%`);
          return;
        }
      } else {
        if (roundMoney(paymentTotal) !== orderValue) {
          setError(`Milestone total (${paymentTotal}) must equal Order Value (${orderValue})`);
          return;
        }
      }
    } else if (formData.collectionStrategy === 'Recurring') {
      const { total, schedule } = calculateRecurringSchedule(recurringConfig, orderValue);
      paymentTotal = roundMoney(total);
      if (roundMoney(paymentTotal) !== orderValue) {
        setError(`Recurring total (${paymentTotal}) must equal Order Value (${orderValue})`);
        return;
      }
      if (schedule.length === 0) {
        setError('Recurring schedule generation failed. Check dates and parameters.');
        return;
      }
    }

    // PHASE 3: Create project first
    try {
      setLoading(true);
      const projectPayload = {
        companyName: formData.companyName,
        companyAddress: formData.companyAddress,
        workorderNumber: formData.workorderNumber,
        poc1Name: formData.spocName,
        poc1Email: formData.spocEmail,
        poc1Phone: formData.spocPhone,
        poc1Designation: formData.spocDesignation,
        testingType: formData.testingType,
        scopeDescription: formData.scopeDescription,
        startDate: formData.startDate,
        expectedEndDate: formData.expectedEndDate,
        organizationCategory: formData.organizationCategory,
        reasonToConductAudit: formData.reasonToConductAudit,
        sectorOfOrganization: formData.sectorOfOrganization,
        typeOfAudit: formData.typeOfAudit,
        typeOfAuditOther: formData.typeOfAudit === 'Any other' ? formData.typeOfAuditOther : ''
      };

      const createRes = await projectService.createProject(projectPayload);
      const project = createRes.data?.project;

      // PHASE 4: Create invoice with validated project ID
      const finalInvoicePayload = buildInvoicePayload(project.id);
      
      try {
        await orderService.createOrder(finalInvoicePayload);
      } catch (invoiceError) {
        // Invoice creation failed - display the structured errors from backend
        const errorData = invoiceError.response?.data;
        if (errorData?.errors && Array.isArray(errorData.errors)) {
          // Backend returned structured validation errors
          const errorList = errorData.errors.map((err, idx) => `${idx + 1}. ${err}`).join('\n');
          setError(`Invoice validation failed:\n\n${errorList}`);
        } else if (errorData?.error) {
          setError(`Invoice creation failed: ${errorData.error}`);
        } else {
          setError(`Failed to create invoice: ${invoiceError.message}`);
        }
        // Note: Project was created but invoice failed - this requires manual intervention
        console.warn('Project created but invoice creation failed. Project ID:', project.id);
        return;
      }

      // PHASE 5: Success - reset form and redirect
      const woRes = await projectService.getNextWorkorderNumber();
      setFormData({
        companyName: '',
        companyAddress: '',
        spocName: '',
        spocEmail: '',
        spocPhone: '',
        spocDesignation: '',
        testingType: 'Blackbox',
        scopeDescription: '',
        startDate: '',
        expectedEndDate: '',
        workorderNumber: woRes.data?.workorderNumber || '',
        orderNumber: '',
        orderValue: '',
        collectionStrategy: 'Specific Dates',
        organizationCategory: '',
        reasonToConductAudit: '',
        sectorOfOrganization: '',
        typeOfAudit: '',
        typeOfAuditOther: ''
      });
      setSpecificDatesRows([emptySpecificDatesRow()]);
      setMilestoneRows([emptyMilestoneRow()]);
      setRecurringConfig(emptyRecurringConfig());
      setSubprojects([emptySubproject()]);
      setSuccess('Project and Invoice created successfully');
      setTimeout(() => navigate('/dashboard'), 1800);
    } catch (err) {
      const errorData = err.response?.data;
      if (errorData?.message) {
        setError(errorData.message);
      } else {
        setError(`Failed to create project: ${err.response?.data?.error || err.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const orderValue = roundMoney(formData.orderValue);
  
  // Calculate totals based on strategy
  let paymentTotal = 0;
  let percentageTotal = 0;

  if (formData.collectionStrategy === 'Specific Dates') {
    paymentTotal = roundMoney(specificDatesRows.reduce((s, r) => s + roundMoney(r.amount), 0));
  } else if (formData.collectionStrategy === 'Milestone Based') {
    const calculatedMilestones = calculateMilestoneAmounts(milestoneRows, orderValue);
    paymentTotal = roundMoney(calculatedMilestones.reduce((s, m) => s + m.calculatedAmount, 0));
    if (milestoneRows.some(m => m.type === 'percentage')) {
      percentageTotal = roundPercent(milestoneRows.filter(m => m.type === 'percentage').reduce((s, m) => s + roundPercent(m.value), 0));
    }
  } else if (formData.collectionStrategy === 'Recurring') {
    const { total } = calculateRecurringSchedule(recurringConfig, orderValue);
    paymentTotal = roundMoney(total);
  }

  const remaining = roundMoney(orderValue - paymentTotal);
  const isPaymentValid = roundMoney(paymentTotal) === orderValue;

  const sectionCard = 'mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4';
  const labelClass = 'block text-sm font-medium text-gray-900';
  const inputClass = 'mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500';

  if (user?.role !== 'finance') {
    return <div className="py-6"><div className="max-w-3xl mx-auto px-4 sm:px-6 md:px-8"><div className="rounded-md bg-red-50 p-4 text-red-700">Only Finance can create new projects.</div></div></div>;
  }

  return (
    <div className="py-6">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 md:px-8">
        <h1 className="text-2xl font-bold text-gray-900">Create New Project</h1>
        <p className="text-gray-600 mt-2">Fill in project and finance details</p>
        {error && (
          <div className="mt-4 rounded-md bg-red-50 p-4">
            <p className="text-sm font-semibold text-red-900 mb-2">⚠️ Validation Error</p>
            {error.includes('\n') ? (
              <ul className="text-sm text-red-700 space-y-1 list-disc list-inside">
                {error.split('\n').filter(line => line.trim()).map((line, idx) => (
                  <li key={idx}>{line.replace(/^\d+\.\s*/, '')}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-red-700">{error}</p>
            )}
          </div>
        )}
        {success && <div className="mt-4 rounded-md bg-green-50 p-4"><p className="text-sm text-green-700">{success}</p></div>}

        <form onSubmit={handleSubmit} className="mt-8 bg-white shadow rounded-lg p-6">
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {canShowField('companyName') && <div><label className={labelClass}>Company Name <span className="text-red-500">*</span></label><input name="companyName" value={formData.companyName} onChange={handleChange} className={inputClass} /></div>}
              {canShowField('companyAddress') && <div><label className={labelClass}>Company Address <span className="text-red-500">*</span></label><input name="companyAddress" value={formData.companyAddress} onChange={handleChange} className={inputClass} /></div>}
            </div>

            <div className={sectionCard}>
              <h4 className="text-sm font-semibold text-gray-900">Client / SPOC Details</h4>
              <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
                {canShowField('spocName') && <div><label className={labelClass}>SPOC Name <span className="text-red-500">*</span></label><input name="spocName" value={formData.spocName} onChange={handleChange} className={inputClass} /></div>}
                {canShowField('spocEmail') && <div><label className={labelClass}>SPOC Email <span className="text-red-500">*</span></label><input name="spocEmail" value={formData.spocEmail} onChange={handleChange} className={inputClass} /></div>}
                {canShowField('spocPhone') && <div><label className={labelClass}>SPOC Contact Number <span className="text-red-500">*</span></label><input name="spocPhone" value={formData.spocPhone} onChange={handleChange} className={inputClass} /></div>}
                {canShowField('spocDesignation') && <div><label className={labelClass}>SPOC Designation</label><input name="spocDesignation" value={formData.spocDesignation} onChange={handleChange} className={inputClass} /></div>}
              </div>
            </div>

            <div className={sectionCard}>
              <h4 className="text-sm font-semibold text-gray-900">Finance Information</h4>
              <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
                <div><label className={labelClass}>Workorder Number (Auto)</label><input value={formData.workorderNumber} readOnly className={`${inputClass} bg-gray-100`} /></div>
                <div><label className={labelClass}>Order Number <span className="text-red-500">*</span></label><input name="orderNumber" value={formData.orderNumber} onChange={handleChange} className={inputClass} /></div>
                <div><label className={labelClass}>Order Value <span className="text-red-500">*</span></label><input type="number" min="0" step="0.01" name="orderValue" value={formData.orderValue} onChange={handleChange} className={inputClass} /></div>
              </div>

              <div className="mt-5 rounded border border-gray-200 bg-white p-3">
                <h5 className="text-sm font-semibold text-gray-900">Project Payment Details</h5>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div><label className={labelClass}>Collection Strategy</label><select name="collectionStrategy" value={formData.collectionStrategy} onChange={handleChange} className={inputClass}>{STRATEGIES.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
                </div>

                {/* STRATEGY 1: SPECIFIC DATES */}
                {formData.collectionStrategy === 'Specific Dates' && (
                  <div className="mt-4">
                    <div className="overflow-x-auto border rounded">
                      <table className="min-w-full text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left">Payment Date</th>
                            <th className="px-3 py-2 text-left">Amount</th>
                            <th className="px-3 py-2 text-left">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {specificDatesRows.map((r, idx) => (
                            <tr key={idx} className="border-t">
                              <td className="px-3 py-2">
                                <input
                                  type="date"
                                  min={todayISO()}
                                  value={r.paymentDate}
                                  onChange={(e) => setSpecificDatesRows((prev) => prev.map((row, i) => (i === idx ? { ...row, paymentDate: e.target.value } : row)))}
                                  className="border rounded px-2 py-1"
                                />
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={r.amount}
                                  onChange={(e) => setSpecificDatesRows((prev) => prev.map((row, i) => (i === idx ? { ...row, amount: e.target.value } : row)))}
                                  className="border rounded px-2 py-1"
                                />
                              </td>
                              <td className="px-3 py-2">
                                <button
                                  type="button"
                                  disabled={specificDatesRows.length <= 1}
                                  onClick={() => setSpecificDatesRows((prev) => prev.filter((_, i) => i !== idx))}
                                  className="text-red-600 disabled:text-gray-300"
                                >
                                  Delete
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSpecificDatesRows((prev) => [...prev, emptySpecificDatesRow()])}
                      className="mt-2 rounded bg-slate-100 px-3 py-1.5 text-sm"
                    >
                      + Add Payment Row
                    </button>
                  </div>
                )}

                {/* STRATEGY 2: MILESTONE BASED */}
                {formData.collectionStrategy === 'Milestone Based' && (
                  <div className="mt-4">
                    <div className="space-y-3">
                      {milestoneRows.map((m, idx) => {
                        const calculatedMilestones = calculateMilestoneAmounts(milestoneRows, orderValue);
                        const currentMilestone = calculatedMilestones[idx];
                        return (
                          <div key={idx} className="rounded border border-gray-200 bg-gray-50 p-3">
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                              <div>
                                <label className={labelClass}>Milestone Name</label>
                                <input
                                  type="text"
                                  value={m.milestoneName}
                                  onChange={(e) => setMilestoneRows((prev) => prev.map((row, i) => (i === idx ? { ...row, milestoneName: e.target.value } : row)))}
                                  placeholder={`Milestone ${idx + 1}`}
                                  className={`${inputClass} mt-1`}
                                />
                              </div>
                              <div>
                                <label className={labelClass}>Type</label>
                                <select
                                  value={m.type}
                                  onChange={(e) => setMilestoneRows((prev) => prev.map((row, i) => (i === idx ? { ...row, type: e.target.value } : row)))}
                                  className={`${inputClass} mt-1`}
                                >
                                  <option value="fixed">Fixed Amount</option>
                                  <option value="percentage">Percentage (%)</option>
                                </select>
                              </div>
                              <div>
                                <label className={labelClass}>{m.type === 'percentage' ? 'Percentage' : 'Amount'}</label>
                                <input
                                  type="number"
                                  min="0"
                                  step={m.type === 'percentage' ? '0.01' : '0.01'}
                                  value={m.value}
                                  onChange={(e) => setMilestoneRows((prev) => prev.map((row, i) => (i === idx ? { ...row, value: e.target.value } : row)))}
                                  className={`${inputClass} mt-1`}
                                />
                              </div>
                              <div>
                                <label className={labelClass}>Calculated Amount</label>
                                <div className="mt-1 bg-white border rounded px-3 py-2 text-sm font-semibold">
                                  {currentMilestone?.calculatedAmount || 0}
                                </div>
                              </div>
                            </div>
                            <div className="mt-2 flex justify-end">
                              <button
                                type="button"
                                disabled={milestoneRows.length <= 1}
                                onClick={() => setMilestoneRows((prev) => prev.filter((_, i) => i !== idx))}
                                className="text-red-600 text-sm disabled:text-gray-300"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={() => setMilestoneRows((prev) => [...prev, emptyMilestoneRow()])}
                      className="mt-3 rounded bg-slate-100 px-3 py-1.5 text-sm"
                    >
                      + Add Milestone
                    </button>
                  </div>
                )}

                {/* STRATEGY 3: RECURRING */}
                {formData.collectionStrategy === 'Recurring' && (
                  <div className="mt-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className={labelClass}>Recurring Frequency</label>
                        <select
                          value={recurringConfig.frequency}
                          onChange={(e) => setRecurringConfig((prev) => ({ ...prev, frequency: e.target.value }))}
                          className={`${inputClass} mt-1`}
                        >
                          {RECURRING_FREQUENCIES.map((f) => (
                            <option key={f} value={f}>{f}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className={labelClass}>Start Date</label>
                        <input
                          type="date"
                          value={recurringConfig.startDate}
                          onChange={(e) => setRecurringConfig((prev) => ({ ...prev, startDate: e.target.value }))}
                          className={`${inputClass} mt-1`}
                        />
                      </div>
                    </div>

                    <div className="mt-3 flex items-center gap-4">
                      <label className="flex items-center">
                        <input
                          type="radio"
                          checked={recurringConfig.useEndDate}
                          onChange={() => setRecurringConfig((prev) => ({ ...prev, useEndDate: true }))}
                          className="mr-2"
                        />
                        <span className="text-sm">Use End Date</span>
                      </label>
                      <label className="flex items-center">
                        <input
                          type="radio"
                          checked={!recurringConfig.useEndDate}
                          onChange={() => setRecurringConfig((prev) => ({ ...prev, useEndDate: false }))}
                          className="mr-2"
                        />
                        <span className="text-sm">Use Number of Cycles</span>
                      </label>
                    </div>

                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                      {recurringConfig.useEndDate && (
                        <div>
                          <label className={labelClass}>End Date</label>
                          <input
                            type="date"
                            value={recurringConfig.endDate}
                            onChange={(e) => setRecurringConfig((prev) => ({ ...prev, endDate: e.target.value }))}
                            className={`${inputClass} mt-1`}
                          />
                        </div>
                      )}
                      {!recurringConfig.useEndDate && (
                        <div>
                          <label className={labelClass}>Number of Cycles</label>
                          <input
                            type="number"
                            min="1"
                            value={recurringConfig.numCycles}
                            onChange={(e) => setRecurringConfig((prev) => ({ ...prev, numCycles: Math.max(1, parseInt(e.target.value) || 1) }))}
                            className={`${inputClass} mt-1`}
                          />
                        </div>
                      )}
                      <div>
                        <label className={labelClass}>Type</label>
                        <select
                          value={recurringConfig.type}
                          onChange={(e) => setRecurringConfig((prev) => ({ ...prev, type: e.target.value }))}
                          className={`${inputClass} mt-1`}
                        >
                          <option value="fixed">Fixed Amount</option>
                          <option value="percentage">Percentage (%)</option>
                        </select>
                      </div>
                    </div>

                    <div className="mt-3">
                      <label className={labelClass}>
                        {recurringConfig.type === 'percentage' ? 'Percentage per Cycle' : 'Amount per Cycle'}
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={recurringConfig.amountPerCycle}
                        onChange={(e) => setRecurringConfig((prev) => ({ ...prev, amountPerCycle: e.target.value }))}
                        className={`${inputClass} mt-1`}
                      />
                    </div>

                    {/* Schedule Preview */}
                    {recurringConfig.startDate && (
                      <div className="mt-4 rounded border border-gray-200 bg-gray-50 p-3">
                        <h6 className="text-sm font-semibold text-gray-900 mb-3">Payment Schedule Preview</h6>
                        {(() => {
                          const { cycles, amountPerCycle, schedule } = calculateRecurringSchedule(recurringConfig, orderValue);
                          return (
                            <>
                              <div className="mb-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                                <div>
                                  <span className="font-semibold">Cycles:</span> {cycles}
                                </div>
                                <div>
                                  <span className="font-semibold">Amount/Cycle:</span> {amountPerCycle}
                                </div>
                                <div>
                                  <span className="font-semibold">Total:</span> {roundMoney(amountPerCycle * cycles)}
                                </div>
                              </div>
                              {schedule.length > 0 && (
                                <div className="overflow-x-auto">
                                  <table className="min-w-full text-xs">
                                    <thead className="bg-white">
                                      <tr>
                                        <th className="px-2 py-1 text-left">Cycle</th>
                                        <th className="px-2 py-1 text-left">Date</th>
                                        <th className="px-2 py-1 text-left">Amount</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {schedule.slice(0, 5).map((s, i) => (
                                        <tr key={i} className="border-t">
                                          <td className="px-2 py-1">{s.cycleNumber}</td>
                                          <td className="px-2 py-1">{s.date}</td>
                                          <td className="px-2 py-1">{s.amount}</td>
                                        </tr>
                                      ))}
                                      {schedule.length > 5 && (
                                        <tr>
                                          <td colSpan="3" className="px-2 py-1 text-center text-gray-500">
                                            ... and {schedule.length - 5} more
                                          </td>
                                        </tr>
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                )}

                {/* Payment Summary */}
                <div className={`mt-4 rounded border border-slate-200 bg-slate-50 p-3 text-sm ${isPaymentValid ? 'border-green-300 bg-green-50' : 'border-red-300 bg-red-50'}`}>
                  <p>
                    <span className="font-semibold">Order Value:</span> {orderValue}
                  </p>
                  {formData.collectionStrategy === 'Milestone Based' && (
                    <p>
                      <span className="font-semibold">Total Percentage:</span> {percentageTotal}%
                    </p>
                  )}
                  <p>
                    <span className="font-semibold">Total Payment:</span> {paymentTotal}
                  </p>
                  <p>
                    <span className="font-semibold">Remaining:</span> {remaining}
                  </p>
                  {isPaymentValid && (
                    <p className="text-green-700 font-semibold">✓ Payment total matches Order Value</p>
                  )}
                  {!isPaymentValid && (
                    <p className="text-red-700 font-semibold">✗ Payment total does not match Order Value</p>
                  )}
                </div>
              </div>

              <div className="mt-5">
                <div className="flex items-center justify-between">
                  <h5 className="text-sm font-semibold text-gray-900">Subprojects</h5>
                  <button type="button" onClick={() => setSubprojects((prev) => [...prev, emptySubproject()])} className="rounded bg-slate-100 px-3 py-1.5 text-sm">+ Add Subproject</button>
                </div>
                <div className="mt-3 space-y-3">
                  {subprojects.map((sp, idx) => (
                    <div key={idx} className="rounded border border-gray-200 bg-white p-3">
                      <div className="flex gap-2">
                        <input value={sp.subprojectName} onChange={(e) => setSubprojects((prev) => prev.map((row, i) => (i === idx ? { ...row, subprojectName: e.target.value } : row)))} placeholder={`Subproject ${idx + 1} name`} className={`${inputClass} mt-0`} />
                        <button type="button" disabled={subprojects.length <= 1} onClick={() => setSubprojects((prev) => prev.filter((_, i) => i !== idx))} className="text-sm text-red-600 disabled:text-gray-300">Remove</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className={sectionCard}>
              <h4 className="text-sm font-semibold text-gray-900">Project Related Information</h4>
              <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
                {canShowField('organizationCategory') && <div><label className={labelClass}>Category of Organization <span className="text-red-500">*</span></label><select name="organizationCategory" value={formData.organizationCategory} onChange={handleChange} className={inputClass}><option value="">Select</option>{ORGANIZATION_CATEGORIES.map((v) => <option key={v} value={v}>{v}</option>)}</select></div>}
                {canShowField('reasonToConductAudit') && <div><label className={labelClass}>Reason to conduct audit <span className="text-red-500">*</span></label><select name="reasonToConductAudit" value={formData.reasonToConductAudit} onChange={handleChange} className={inputClass}><option value="">Select</option>{AUDIT_REASONS.map((v) => <option key={v} value={v}>{v}</option>)}</select></div>}
                {canShowField('sectorOfOrganization') && <div><label className={labelClass}>Sector of organization <span className="text-red-500">*</span></label><select name="sectorOfOrganization" value={formData.sectorOfOrganization} onChange={handleChange} className={inputClass}><option value="">Select</option>{ORGANIZATION_SECTORS.map((v) => <option key={v} value={v}>{v}</option>)}</select></div>}
                {canShowField('typeOfAudit') && <div><label className={labelClass}>Type of Audit <span className="text-red-500">*</span></label><select name="typeOfAudit" value={formData.typeOfAudit} onChange={handleChange} className={inputClass}><option value="">Select</option>{AUDIT_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}</select></div>}
                {canShowField('typeOfAuditOther') && formData.typeOfAudit === 'Any other' && <div className="md:col-span-2"><label className={labelClass}>Any other</label><input name="typeOfAuditOther" value={formData.typeOfAuditOther} onChange={handleChange} className={inputClass} /></div>}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {canShowField('testingType') && <div><label className={labelClass}>Testing Type <span className="text-red-500">*</span></label><select name="testingType" value={formData.testingType} onChange={handleChange} className={inputClass}><option value="Blackbox">Blackbox</option><option value="Whitebox">Whitebox</option><option value="Graybox">Graybox</option></select></div>}
              {canShowField('startDate') && <div><label className={labelClass}>Start Date <span className="text-red-500">*</span></label><input type="date" name="startDate" value={formData.startDate} onChange={handleChange} className={inputClass} /></div>}
              {canShowField('scopeDescription') && <div className="md:col-span-2"><label className={labelClass}>Scope Description <span className="text-red-500">*</span></label><textarea name="scopeDescription" value={formData.scopeDescription} onChange={handleChange} rows="4" className={inputClass} /></div>}
              {canShowField('expectedEndDate') && <div><label className={labelClass}>Expected End Date</label><input type="date" name="expectedEndDate" value={formData.expectedEndDate} onChange={handleChange} className={inputClass} /></div>}
            </div>
          </div>

          <div className="mt-8 flex gap-4">
            <button type="submit" disabled={loading} className="flex-1 bg-blue-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50">
              {loading ? 'Creating...' : 'Create Project + Invoice'}
            </button>
            <button type="button" onClick={() => navigate('/dashboard')} className="flex-1 bg-gray-200 text-gray-900 px-6 py-2 rounded-lg font-medium hover:bg-gray-300">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
