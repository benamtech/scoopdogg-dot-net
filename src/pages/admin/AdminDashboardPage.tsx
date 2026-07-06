import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, AlertCircle, CheckCircle, TrendingUp, MessageSquare } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { Lead } from '../../lib/types';
import StatusBadge from '../../components/admin/StatusBadge';
import AdminLayout from '../../components/admin/AdminLayout';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function serviceLabel(s: string) {
  if (s === 'weekly') return 'Weekly';
  if (s === 'one-time') return 'Turf Deep Clean';
  if (s === 'yard-deep-clean') return 'Yard Deep Clean';
  if (s === 'turf') return 'Turf';
  return s || '—';
}

export default function AdminDashboardPage() {
  const navigate = useNavigate();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      const [leadsRes, messagesRes] = await Promise.all([
        supabase.from('leads').select('*').order('created_at', { ascending: false }),
        supabase.from('contact_messages').select('id', { count: 'exact' }).eq('status', 'unread'),
      ]);
      setLeads(leadsRes.data || []);
      setUnreadMessages(messagesRes.count ?? 0);
      setLoading(false);
    };
    fetchData();
  }, []);

  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const total = leads.length;
  const newLeads = leads.filter((l) => l.status === 'new').length;
  const active = leads.filter((l) => l.status === 'active').length;
  const thisMonth = leads.filter((l) => l.created_at >= thisMonthStart).length;

  const stats = [
    { label: 'Total Leads', value: total, icon: Users, color: 'text-forest', bg: 'bg-sage-light', onClick: () => navigate('/admin/leads') },
    { label: 'New Leads', value: newLeads, icon: AlertCircle, color: 'text-amber-hover', bg: 'bg-amber/10', badge: true, onClick: () => navigate('/admin/leads') },
    { label: 'Active Customers', value: active, icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-50', onClick: () => navigate('/admin/leads') },
    { label: "This Month's Leads", value: thisMonth, icon: TrendingUp, color: 'text-blue-600', bg: 'bg-blue-50', onClick: () => navigate('/admin/leads') },
    { label: 'Unread Messages', value: unreadMessages, icon: MessageSquare, color: 'text-amber-hover', bg: 'bg-amber/10', badge: true, onClick: () => navigate('/admin/messages') },
  ];

  const recent = leads.slice(0, 10);

  return (
    <AdminLayout>
      <div className="mb-6 md:mb-8">
        <h1 className="font-serif text-2xl md:text-3xl text-dark">Dashboard</h1>
        <p className="text-dark/50 text-sm mt-1">Overview of your Scoop Dogg leads</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 md:gap-4 mb-6 md:mb-8">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.label}
              onClick={s.onClick}
              className="bg-white rounded-card p-4 md:p-6 shadow-card cursor-pointer hover:shadow-card-hover transition-shadow"
            >
              <div className={`w-9 h-9 md:w-10 md:h-10 rounded-xl ${s.bg} flex items-center justify-center mb-3 md:mb-4`}>
                <Icon size={17} className={s.color} />
              </div>
              <div className="flex items-start justify-between gap-1">
                <div className="min-w-0">
                  <p className="text-dark/50 text-xs mb-1 leading-tight">{s.label}</p>
                  <p className="font-serif text-2xl md:text-3xl text-dark">{loading ? '—' : s.value}</p>
                </div>
                {s.badge && !loading && s.value > 0 && (
                  <span className="bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full flex-shrink-0">
                    {s.value}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-white rounded-card shadow-card overflow-hidden">
        <div className="px-4 md:px-6 py-3 md:py-4 border-b border-sage-light flex items-center justify-between">
          <h2 className="font-semibold text-dark text-sm md:text-base">Recent Leads</h2>
          <button
            onClick={() => navigate('/admin/leads')}
            className="text-forest hover:text-amber text-xs md:text-sm font-medium transition-colors whitespace-nowrap"
          >
            View all →
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sage-light bg-cream/50">
                <th className="text-left px-4 md:px-6 py-2.5 md:py-3 text-xs font-semibold text-dark/40 uppercase tracking-wider">Name</th>
                <th className="text-left px-4 md:px-6 py-2.5 md:py-3 text-xs font-semibold text-dark/40 uppercase tracking-wider hidden sm:table-cell">City</th>
                <th className="text-left px-4 md:px-6 py-2.5 md:py-3 text-xs font-semibold text-dark/40 uppercase tracking-wider hidden md:table-cell">Service</th>
                <th className="text-left px-4 md:px-6 py-2.5 md:py-3 text-xs font-semibold text-dark/40 uppercase tracking-wider">Status</th>
                <th className="text-left px-4 md:px-6 py-2.5 md:py-3 text-xs font-semibold text-dark/40 uppercase tracking-wider hidden sm:table-cell">Date</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 md:px-6 py-10 text-center text-dark/40 text-sm">Loading...</td>
                </tr>
              ) : recent.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 md:px-6 py-10 text-center text-dark/40 text-sm">No leads yet</td>
                </tr>
              ) : (
                recent.map((lead) => (
                  <tr
                    key={lead.id}
                    onClick={() => navigate(`/admin/leads/${lead.id}`)}
                    className="border-b border-sage-light/50 hover:bg-sage-light/30 cursor-pointer transition-colors last:border-0"
                  >
                    <td className="px-4 md:px-6 py-3 md:py-4">
                      <p className="font-medium text-dark text-xs md:text-sm">{lead.name}</p>
                      <p className="text-dark/40 text-xs truncate max-w-[140px] md:max-w-none">{lead.email}</p>
                    </td>
                    <td className="px-4 md:px-6 py-3 md:py-4 text-dark/70 text-xs md:text-sm hidden sm:table-cell">{lead.city}</td>
                    <td className="px-4 md:px-6 py-3 md:py-4 text-dark/70 text-xs md:text-sm hidden md:table-cell">{serviceLabel(lead.service_type)}</td>
                    <td className="px-4 md:px-6 py-3 md:py-4"><StatusBadge status={lead.status} /></td>
                    <td className="px-4 md:px-6 py-3 md:py-4 text-dark/50 text-xs md:text-sm hidden sm:table-cell">{formatDate(lead.created_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AdminLayout>
  );
}
