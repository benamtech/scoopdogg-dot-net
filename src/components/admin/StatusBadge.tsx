import type { LeadStatus } from '../../lib/types';

const config: Record<LeadStatus, { label: string; className: string }> = {
  new: { label: 'New', className: 'bg-amber/15 text-amber-hover border border-amber/30' },
  contacted: { label: 'Contacted', className: 'bg-blue-50 text-blue-600 border border-blue-200' },
  quoted: { label: 'Quoted', className: 'bg-sky-50 text-sky-700 border border-sky-200' },
  active: { label: 'Active', className: 'bg-green-50 text-green-700 border border-green-200' },
  declined: { label: 'Declined', className: 'bg-gray-100 text-gray-500 border border-gray-200' },
};

export default function StatusBadge({ status }: { status: string }) {
  const s = status as LeadStatus;
  const c = config[s] || config.new;
  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${c.className}`}>
      {c.label}
    </span>
  );
}
