import React from 'react';

const StatCard = ({ label, value, color, filterValue }) => (
  <div className={`border-l-4 ${color} bg-white p-4 rounded shadow flex flex-col items-start`}>
    <div className="text-xs font-medium text-gray-500 mb-1">{label}</div>
    <div className="text-2xl font-bold text-gray-900">{value}</div>
  </div>
);

export default StatCard;
