import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { orderService, projectService } from '../services/api';

const STRATEGIES = ['Specific Dates', 'Recurring', 'Milestone Based'];
const FREQUENCIES = ['Weekly', 'Monthly', 'Quarterly', 'Yearly'];

const roundMoney = (v) => Math.round((Number(v) || 0) * 100) / 100;
const todayISO = () => new Date().toISOString().slice(0, 10);
const addFrequency = (d, f) => {
  const n = new Date(d.getTime());
  if (f === 'Weekly') n.setUTCDate(n.getUTCDate() + 7);
  if (f === 'Monthly') n.setUTCMonth(n.getUTCMonth() + 1);
  if (f === 'Quarterly') n.setUTCMonth(n.getUTCMonth() + 3);
  if (f === 'Yearly') n.setUTCFullYear(n.getUTCFullYear() + 1);
  return n;
};

// Calculate milestone amounts based on type (percentage or fixed)
const calculateMilestoneAmounts = (milestones, orderValue) => {
  return milestones.map(m => {
    if (m.type === 'percentage') {
      const amount = roundMoney((orderValue * m.value) / 100);
      return { ...m, calculatedAmount: amount };
    }
    return { ...m, calculatedAmount: m.value ? roundMoney(m.value) : 0 };
  });
};

const emptySubproject = () => ({
  subprojectName: '',
  collectionStrategy: 'Specific Dates',
  specificDates: [{ paymentDate: '', amount: '' }],
  recurring: { frequency: 'Monthly', startDate: '', endDate: '', cycles: '', amountPerCycle: '' },
  milestones: [{ milestoneName: '', type: 'fixed', value: '', calculatedAmount: 0 }]
});

export default function InvoiceTracker() {
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);
  const [projects, setProjects] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [editingOrderId, setEditingOrderId] = useState('');

  const [projectId, setProjectId] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
  const [orderValue, setOrderValue] = useState('');
  const [subprojects, setSubprojects] = useState([emptySubproject()]);

  const resetForm = () => {
    setEditingOrderId('');
    setProjectId('');
    setOrderNumber('');
    setOrderValue('');
    setSubprojects([emptySubproject()]);
  };

  const recurringPreview = (sp) => {
    const rows = [];
    const r = sp.recurring || {};
    if (!r.startDate || !r.frequency) return rows;
    let cur = new Date(r.startDate);
    if (Number.isNaN(cur.getTime())) return rows;
    const end = r.endDate ? new Date(r.endDate) : null;
    const cycles = r.cycles ? Number(r.cycles) : null;
    const maxRows = 400;
    while (rows.length < maxRows) {
      if (end && cur > end) break;
      if (cycles && rows.length >= cycles) break;
      rows.push({ paymentDate: cur.toISOString().slice(0, 10), amount: roundMoney(r.amountPerCycle) });
      cur = addFrequency(cur, r.frequency);
    }
    return rows;
  };

  const subprojectTotal = (sp) => {
    if (sp.collectionStrategy === 'Specific Dates') {
      return roundMoney((sp.specificDates || []).reduce((s, r) => s + roundMoney(r.amount), 0));
    }
    if (sp.collectionStrategy === 'Recurring') {
      return roundMoney(recurringPreview(sp).reduce((s, r) => s + roundMoney(r.amount), 0));
    }
    if (sp.collectionStrategy === 'Milestone Based') {
      const calculated = calculateMilestoneAmounts(sp.milestones || [], roundMoney(orderValue));
      return roundMoney(calculated.reduce((s, m) => s + roundMoney(m.calculatedAmount), 0));
    }
    return 0;
  };

  const loadProjects = async () => {
    try {
      const res = await projectService.getProjects({ limit: 500 });
      setProjects(res.data?.projects || []);
    } catch (_) {
      setProjects([]);
    }
  };

  const loadOrders = async (q = search) => {
    try {
      setLoading(true);
      const res = await orderService.getOrders({ q: q || undefined });
      setOrders(res.data?.orders || []);
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProjects();
    loadOrders('');
  }, []);

  const validate = () => {
    if (!projectId) return 'Project is required';
    if (!orderNumber.trim()) return 'Order Number is required';
    if (!(roundMoney(orderValue) > 0)) return 'Order Value must be greater than 0';
    if (!Array.isArray(subprojects) || subprojects.length < 1) return 'At least one subproject is required';

    let allocated = 0;
    for (let i = 0; i < subprojects.length; i += 1) {
      const sp = subprojects[i];
      const spValue = subprojectTotal(sp);
      allocated += spValue;
      if (!sp.subprojectName.trim()) return `Subproject ${i + 1}: name is required`;
      if (!(spValue > 0)) return `Subproject ${i + 1}: total must be > 0`;

      if (sp.collectionStrategy === 'Specific Dates') {
        const seen = new Set();
        for (let j = 0; j < sp.specificDates.length; j += 1) {
          const row = sp.specificDates[j];
          if (!row.paymentDate) return `Subproject ${i + 1}, row ${j + 1}: payment date required`;
          if (row.paymentDate <= todayISO()) return `Subproject ${i + 1}, row ${j + 1}: payment date must be future`;
          if (seen.has(row.paymentDate)) return `Subproject ${i + 1}, row ${j + 1}: duplicate payment date`;
          seen.add(row.paymentDate);
          if (!(roundMoney(row.amount) > 0)) return `Subproject ${i + 1}, row ${j + 1}: amount must be > 0`;
        }
      }

      if (sp.collectionStrategy === 'Recurring') {
        const r = sp.recurring;
        if (!r.frequency || !r.startDate) return `Subproject ${i + 1}: recurring frequency/start date required`;
        if (!r.endDate && !(Number(r.cycles) > 0)) return `Subproject ${i + 1}: recurring end date or cycles required`;
        if (!(roundMoney(r.amountPerCycle) > 0)) return `Subproject ${i + 1}: recurring amount must be > 0`;
        const preview = recurringPreview(sp);
        if (preview.length < 1) return `Subproject ${i + 1}: recurring generated zero rows`;
      }

      if (sp.collectionStrategy === 'Milestone Based') {
        for (let j = 0; j < sp.milestones.length; j += 1) {
          const m = sp.milestones[j];
          if (!m.milestoneName.trim()) return `Subproject ${i + 1}, milestone ${j + 1}: name required`;
          if (!m.type || !['fixed', 'percentage'].includes(m.type)) return `Subproject ${i + 1}, milestone ${j + 1}: type required`;
          if (!(roundMoney(m.value) > 0)) return `Subproject ${i + 1}, milestone ${j + 1}: value must be > 0`;
        }
      }
    }

    if (roundMoney(allocated) !== roundMoney(orderValue)) {
      return `Allocated to subprojects (${roundMoney(allocated)}) must equal order value (${roundMoney(orderValue)})`;
    }
    return '';
  };

  const buildPayload = () => ({
    projectId,
    orderNumber: orderNumber.trim(),
    orderValue: roundMoney(orderValue),
    subprojects: subprojects.map((sp) => ({
      subprojectName: sp.subprojectName.trim(),
      collectionStrategy: sp.collectionStrategy,
      specificDates: sp.collectionStrategy === 'Specific Dates'
        ? sp.specificDates.map((r) => ({ paymentDate: r.paymentDate, amount: roundMoney(r.amount) }))
        : [],
      recurring: sp.collectionStrategy === 'Recurring'
        ? {
            frequency: sp.recurring.frequency,
            startDate: sp.recurring.startDate,
            endDate: sp.recurring.endDate || null,
            cycles: sp.recurring.cycles ? Number(sp.recurring.cycles) : null,
            amountPerCycle: roundMoney(sp.recurring.amountPerCycle)
          }
        : null,
      milestones: sp.collectionStrategy === 'Milestone Based'
        ? calculateMilestoneAmounts(sp.milestones, roundMoney(orderValue)).map((m) => ({
            milestoneName: m.milestoneName.trim(),
            type: m.type,
            value: roundMoney(m.value),
            calculatedAmount: roundMoney(m.calculatedAmount)
          }))
        : []
    }))
  });

  const submitOrder = async () => {
    const issue = validate();
    if (issue) {
      setError(issue);
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const payload = buildPayload();
      if (editingOrderId) {
        await orderService.updateOrder(editingOrderId, payload);
        setMessage('Invoice updated successfully');
      } else {
        await orderService.createOrder(payload);
        setMessage('Invoice created successfully');
      }
      resetForm();
      await loadOrders(search);
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to save invoice');
    } finally {
      setSaving(false);
    }
  };

  const beginEdit = (order) => {
    setError('');
    setMessage('');
    setEditingOrderId(order.id);
    setProjectId(order.project_id || '');
    setOrderNumber(order.order_number || '');
    setOrderValue(order.order_value || '');

    const sub = Array.isArray(order.subprojects) ? order.subprojects : [];
    const orderLevelSchedules = Array.isArray(order.order_level_schedules) ? order.order_level_schedules : [];
    if (sub.length > 0) {
      setSubprojects(sub.map((sp) => {
        const schedulesForSubproject = (sp.schedules && sp.schedules.length > 0) ? sp.schedules : orderLevelSchedules;
        return {
          subprojectName: sp.subproject_name || '',
          collectionStrategy: sp.collection_strategy || 'Specific Dates',
          specificDates: (sp.collection_strategy === 'Specific Dates'
            ? (schedulesForSubproject || []).map((s) => ({ paymentDate: (s.payment_date || '').slice(0, 10), amount: s.amount }))
            : [{ paymentDate: '', amount: '' }]),
          recurring: {
            frequency: sp.recurring_frequency || 'Monthly',
            startDate: (sp.recurring_start_date || '').slice(0, 10),
            endDate: (sp.recurring_end_date || '').slice(0, 10),
            cycles: sp.recurring_cycles || '',
            amountPerCycle: sp.recurring_amount_per_cycle || ''
          },
          milestones: (sp.collection_strategy === 'Milestone Based'
            ? (schedulesForSubproject || []).map((s) => ({
                milestoneName: s.milestone_name || '',
                type: s.milestone_type || 'fixed',
                value: s.milestone_value || s.amount,
                calculatedAmount: s.amount
              }))
            : [{ milestoneName: '', type: 'fixed', value: '', calculatedAmount: 0 }])
        };
      }));
      return;
    }

    // Fallback for legacy single-structure invoices
    const legacyStrategy = order.collection_strategy || 'Specific Dates';
    const schedules = Array.isArray(order.schedules) ? order.schedules : [];
    setSubprojects([{
      ...emptySubproject(),
      subprojectName: 'Default Subproject',
      collectionStrategy: legacyStrategy,
      specificDates: legacyStrategy === 'Specific Dates'
        ? (schedules.map((s) => ({ paymentDate: (s.payment_date || '').slice(0, 10), amount: s.amount })) || [{ paymentDate: '', amount: '' }])
        : [{ paymentDate: '', amount: '' }],
      recurring: legacyStrategy === 'Recurring'
        ? {
            frequency: order.recurring_frequency || 'Monthly',
            startDate: (order.recurring_start_date || '').slice(0, 10),
            endDate: (order.recurring_end_date || '').slice(0, 10),
            cycles: order.recurring_cycles || '',
            amountPerCycle: order.recurring_amount_per_cycle || ''
          }
        : emptySubproject().recurring,
      milestones: legacyStrategy === 'Milestone Based'
        ? (schedules.map((s) => ({
            milestoneName: s.milestone_name || '',
            type: s.milestone_type || 'fixed',
            value: s.milestone_value || s.amount,
            calculatedAmount: s.amount
          })) || [{ milestoneName: '', type: 'fixed', value: '', calculatedAmount: 0 }])
        : [{ milestoneName: '', type: 'fixed', value: '', calculatedAmount: 0 }]
    }]);
  };

  const completeMilestone = async (orderId, scheduleId) => {
    try {
      await orderService.markMilestoneCompleted(orderId, scheduleId);
      await loadOrders(search);
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to complete milestone');
    }
  };

  const deleteInvoice = async (orderId) => {
    if (user?.role !== 'admin') return;
    if (!window.confirm('Delete this invoice? This action cannot be undone.')) return;
    try {
      await orderService.deleteOrder(orderId);
      await loadOrders(search);
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to delete invoice');
    }
  };

  const allocated = roundMoney(subprojects.reduce((s, sp) => s + subprojectTotal(sp), 0));
  const orderTotal = roundMoney(orderValue);
  const remaining = roundMoney(orderTotal - allocated);
  const canManageFinance = ['finance', 'admin'].includes(user?.role);

  const getStatusBadgeColor = (status) => {
    if (status === 'Draft') return 'bg-gray-100 text-gray-800 border-gray-300';
    if (status === 'Submitted') return 'bg-blue-100 text-blue-800 border-blue-300';
    if (status === 'Paid') return 'bg-green-100 text-green-800 border-green-300';
    return 'bg-gray-100 text-gray-800 border-gray-300';
  };

  const canEditInvoice = (order) => {
    if (user?.role === 'admin') return true;
    return order.status === 'Draft' && order.created_by === user?.id;
  };

  const canDeleteInvoice = (order) => {
    return user?.role === 'admin';
  };

  const getSchedulesForDisplay = (order, subproject) => {
    const subprojectSchedules = Array.isArray(subproject?.schedules) ? subproject.schedules : [];
    if (subprojectSchedules.length > 0) return subprojectSchedules;
    return Array.isArray(order?.order_level_schedules) ? order.order_level_schedules : [];
  };

  const getSubprojectValueForDisplay = (order, subproject) => {
    const rows = getSchedulesForDisplay(order, subproject);
    if (rows.length > 0) {
      return roundMoney(rows.reduce((sum, row) => sum + roundMoney(row.amount), 0));
    }
    return subproject?.subproject_value;
  };

  if (!canManageFinance) return <div className="p-6">Access denied</div>;

  return (
    <div className="py-6">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8 space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Invoice Tracker</h1>
        {error && <div className="rounded bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
        {message && <div className="rounded bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-700">{message}</div>}

        <div className="bg-white rounded-xl border p-5 space-y-4">
          <h2 className="font-semibold text-lg">{editingOrderId ? 'Edit Invoice' : 'Create Invoice'}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm mb-1">Project *</label>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-full border rounded px-3 py-2 text-sm">
                <option value="">Select Project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{(p.project_number || 'Project')} - {(p.company_name || p.client_name || 'Unknown')}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm mb-1">Order Number *</label>
              <input value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} className="w-full border rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm mb-1">Order Value *</label>
              <input type="number" min="0" step="0.01" value={orderValue} onChange={(e) => setOrderValue(e.target.value)} className="w-full border rounded px-3 py-2 text-sm" />
            </div>
          </div>

          <div className="mt-2">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-sm">Subprojects</h3>
              <button onClick={() => setSubprojects((prev) => [...prev, emptySubproject()])} className="rounded bg-slate-100 px-3 py-1.5 text-sm">+ Add Subproject</button>
            </div>

            <div className="mt-3 space-y-4">
              {subprojects.map((sp, idx) => {
                const specificTotal = roundMoney((sp.specificDates || []).reduce((s, r) => s + roundMoney(r.amount), 0));
                const milestoneTotal = roundMoney((sp.milestones || []).reduce((s, r) => s + roundMoney(r.amount), 0));
                const recurringRows = recurringPreview(sp);
                const recurringTotal = roundMoney(recurringRows.reduce((s, r) => s + roundMoney(r.amount), 0));
                return (
                  <div key={idx} className="rounded border border-gray-200 p-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm mb-1">Subproject Name</label>
                        <input value={sp.subprojectName} onChange={(e) => setSubprojects((prev) => { const next = [...prev]; next[idx].subprojectName = e.target.value; return next; })} className="w-full border rounded px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="block text-sm mb-1">Collection Strategy</label>
                        <select value={sp.collectionStrategy} onChange={(e) => setSubprojects((prev) => { const next = [...prev]; next[idx].collectionStrategy = e.target.value; return next; })} className="w-full border rounded px-3 py-2 text-sm">
                          {STRATEGIES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                    </div>

                    {sp.collectionStrategy === 'Specific Dates' && (
                      <div className="mt-3 space-y-2">
                        <div className="overflow-x-auto border rounded">
                          <table className="min-w-full text-sm">
                            <thead className="bg-gray-50"><tr><th className="px-3 py-2 text-left">Payment Date</th><th className="px-3 py-2 text-left">Amount</th><th className="px-3 py-2 text-left">Action</th></tr></thead>
                            <tbody>
                              {(sp.specificDates || []).map((r, rIdx) => (
                                <tr key={rIdx} className="border-t">
                                  <td className="px-3 py-2"><input type="date" min={todayISO()} value={r.paymentDate} onChange={(e) => setSubprojects((prev) => { const next = [...prev]; next[idx].specificDates[rIdx].paymentDate = e.target.value; return next; })} className="border rounded px-2 py-1" /></td>
                                  <td className="px-3 py-2"><input type="number" min="0" step="0.01" value={r.amount} onChange={(e) => setSubprojects((prev) => { const next = [...prev]; next[idx].specificDates[rIdx].amount = e.target.value; return next; })} className="border rounded px-2 py-1" /></td>
                                  <td className="px-3 py-2"><button disabled={sp.specificDates.length <= 1} onClick={() => setSubprojects((prev) => { const next = [...prev]; next[idx].specificDates = next[idx].specificDates.filter((_, i2) => i2 !== rIdx); return next; })} className="text-red-600 disabled:text-gray-300">Delete</button></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <button onClick={() => setSubprojects((prev) => { const next = [...prev]; next[idx].specificDates.push({ paymentDate: '', amount: '' }); return next; })} className="rounded bg-slate-100 px-3 py-1.5 text-sm">+ Add Payment Date</button>
                        <p className="text-xs text-gray-600">Subproject Total: {specificTotal} (Auto-calculated)</p>
                      </div>
                    )}

                    {sp.collectionStrategy === 'Recurring' && (
                      <div className="mt-3 space-y-2">
                        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                          <div><label className="block text-sm mb-1">Frequency</label><select value={sp.recurring.frequency} onChange={(e) => setSubprojects((prev) => { const next = [...prev]; next[idx].recurring.frequency = e.target.value; return next; })} className="w-full border rounded px-3 py-2 text-sm">{FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}</select></div>
                          <div><label className="block text-sm mb-1">Start Date</label><input type="date" value={sp.recurring.startDate} onChange={(e) => setSubprojects((prev) => { const next = [...prev]; next[idx].recurring.startDate = e.target.value; return next; })} className="w-full border rounded px-3 py-2 text-sm" /></div>
                          <div><label className="block text-sm mb-1">End Date</label><input type="date" value={sp.recurring.endDate} onChange={(e) => setSubprojects((prev) => { const next = [...prev]; next[idx].recurring.endDate = e.target.value; return next; })} className="w-full border rounded px-3 py-2 text-sm" /></div>
                          <div><label className="block text-sm mb-1">Cycles</label><input type="number" min="1" value={sp.recurring.cycles} onChange={(e) => setSubprojects((prev) => { const next = [...prev]; next[idx].recurring.cycles = e.target.value; return next; })} className="w-full border rounded px-3 py-2 text-sm" /></div>
                          <div><label className="block text-sm mb-1">Amount per cycle</label><input type="number" min="0" step="0.01" value={sp.recurring.amountPerCycle} onChange={(e) => setSubprojects((prev) => { const next = [...prev]; next[idx].recurring.amountPerCycle = e.target.value; return next; })} className="w-full border rounded px-3 py-2 text-sm" /></div>
                        </div>
                        <p className="text-xs text-gray-600">Generated rows: {recurringRows.length} | Subproject Total: {recurringTotal} (Auto-calculated)</p>
                      </div>
                    )}

                    {sp.collectionStrategy === 'Milestone Based' && (
                      <div className="mt-3 space-y-2">
                        <div className="overflow-x-auto border rounded">
                          <table className="min-w-full text-sm">
                            <thead className="bg-gray-50"><tr><th className="px-3 py-2 text-left">Milestone Name</th><th className="px-3 py-2 text-left">Type</th><th className="px-3 py-2 text-left">Value</th><th className="px-3 py-2 text-left">Calculated Amount</th><th className="px-3 py-2 text-left">Action</th></tr></thead>
                            <tbody>
                              {(sp.milestones || []).map((m, mIdx) => {
                                const calculated = calculateMilestoneAmounts([m], roundMoney(orderValue))[0];
                                return (
                                  <tr key={mIdx} className="border-t">
                                    <td className="px-3 py-2"><input value={m.milestoneName} onChange={(e) => setSubprojects((prev) => { const next = [...prev]; next[idx].milestones[mIdx].milestoneName = e.target.value; return next; })} className="w-full border rounded px-2 py-1" /></td>
                                    <td className="px-3 py-2"><select value={m.type} onChange={(e) => setSubprojects((prev) => { const next = [...prev]; next[idx].milestones[mIdx].type = e.target.value; return next; })} className="border rounded px-2 py-1"><option value="fixed">Fixed</option><option value="percentage">Percentage</option></select></td>
                                    <td className="px-3 py-2"><input type="number" min="0" step="0.01" value={m.value} onChange={(e) => setSubprojects((prev) => { const next = [...prev]; next[idx].milestones[mIdx].value = e.target.value; return next; })} className="border rounded px-2 py-1" /></td>
                                    <td className="px-3 py-2 font-semibold">{roundMoney(calculated.calculatedAmount)}</td>
                                    <td className="px-3 py-2"><button disabled={sp.milestones.length <= 1} onClick={() => setSubprojects((prev) => { const next = [...prev]; next[idx].milestones = next[idx].milestones.filter((_, i2) => i2 !== mIdx); return next; })} className="text-red-600 disabled:text-gray-300">Delete</button></td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        <button onClick={() => setSubprojects((prev) => { const next = [...prev]; next[idx].milestones.push({ milestoneName: '', type: 'fixed', value: '', calculatedAmount: 0 }); return next; })} className="rounded bg-slate-100 px-3 py-1.5 text-sm">+ Add Milestone</button>
                        <p className="text-xs text-gray-600">Subproject Total: {milestoneTotal} (Auto-calculated)</p>
                      </div>
                    )}

                    <div className="mt-2 flex justify-end">
                      <button disabled={subprojects.length <= 1} onClick={() => setSubprojects((prev) => prev.filter((_, i2) => i2 !== idx))} className="text-sm text-red-600 disabled:text-gray-300">Remove Subproject</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded border bg-slate-50 p-3 text-sm">
            <p><span className="font-semibold">Order Value:</span> {orderTotal}</p>
            <p><span className="font-semibold">Allocated to Subprojects:</span> {allocated}</p>
            <p><span className="font-semibold">Remaining:</span> {remaining}</p>
          </div>

          <div className="flex gap-2">
            <button onClick={submitOrder} disabled={saving} className="rounded bg-blue-600 text-white px-4 py-2 text-sm hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving...' : editingOrderId ? 'Update Invoice' : 'Create Invoice'}
            </button>
            {editingOrderId && <button onClick={resetForm} className="rounded bg-slate-200 px-4 py-2 text-sm">Cancel Edit</button>}
          </div>
        </div>

        <div className="bg-white rounded-xl border p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 className="font-semibold text-lg">Invoices</h2>
            <div className="flex gap-2">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by client name / order / project" className="border rounded px-3 py-2 text-sm" />
              <button onClick={() => loadOrders(search)} className="rounded bg-slate-800 text-white px-3 py-2 text-sm">Search</button>
            </div>
          </div>
          {loading ? (
            <p className="text-sm text-gray-500">Loading...</p>
          ) : orders.length === 0 ? (
            <p className="text-sm text-gray-500">No invoices found</p>
          ) : (
            <div className="space-y-4">
              {orders.map((o) => (
                <div key={o.id} className="border rounded-lg p-3">
                  <div className="flex flex-col gap-2 mb-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">{o.order_number}</p>
                        <span className={`inline-block px-3 py-1 text-xs font-semibold border rounded-full ${getStatusBadgeColor(o.status || 'Draft')}`}>
                          {o.status || 'Draft'}
                        </span>
                      </div>
                      <div className="text-sm text-gray-600">
                        Created by: <span className="font-medium">{o.created_by_name || 'Unknown'}</span>
                        {o.created_at && <span> on {new Date(o.created_at).toLocaleDateString()}</span>}
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-gray-700">
                        {o.project_number} • {o.company_name || 'Unknown Company'} • <span className="font-semibold">Value: {o.order_value}</span>
                      </p>
                      <div className="flex items-center gap-2">
                        {canEditInvoice(o) && (
                          <button 
                            onClick={() => beginEdit(o)} 
                            className="text-sm px-3 py-1 rounded bg-blue-100 text-blue-700 hover:bg-blue-200"
                          >
                            Edit
                          </button>
                        )}
                        {canDeleteInvoice(o) && (
                          <button 
                            onClick={() => deleteInvoice(o.id)} 
                            className="text-sm px-3 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {(o.subprojects || []).map((sp) => {
                    const displaySchedules = getSchedulesForDisplay(o, sp);
                    const displayValue = getSubprojectValueForDisplay(o, sp);
                    return (
                    <div key={sp.id} className="mt-2 rounded border border-slate-200 p-2">
                      <p className="text-sm font-medium">{sp.subproject_name} • {sp.collection_strategy} • {displayValue}</p>
                      <div className="mt-1 overflow-auto">
                        <table className="min-w-full text-sm">
                          <thead className="bg-gray-50"><tr><th className="px-3 py-1 text-left">Date</th><th className="px-3 py-1 text-left">Milestone</th><th className="px-3 py-1 text-left">Amount</th><th className="px-3 py-1 text-left">Status</th><th className="px-3 py-1 text-left">Action</th></tr></thead>
                          <tbody>
                            {(displaySchedules || []).map((s) => (
                              <tr key={s.id} className="border-t">
                                <td className="px-3 py-1">{s.payment_date || s.expected_completion_date || '-'}</td>
                                <td className="px-3 py-1">{s.milestone_name || '-'}</td>
                                <td className="px-3 py-1">{s.amount}</td>
                                <td className="px-3 py-1">{s.schedule_type === 'milestone' ? (s.is_milestone_completed ? 'Completed' : 'Pending') : 'Scheduled'}</td>
                                <td className="px-3 py-1">
                                  {s.schedule_type === 'milestone' && !s.is_milestone_completed && (user.role === 'admin' || o.created_by === user.id)
                                    ? <button onClick={() => completeMilestone(o.id, s.id)} className="text-blue-600 hover:underline">Mark Completed</button>
                                    : <span className="text-gray-400">-</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )})}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
