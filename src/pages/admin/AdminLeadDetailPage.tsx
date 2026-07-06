import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { Lead, LeadStatus } from '../../lib/types';
import StatusBadge from '../../components/admin/StatusBadge';
import AdminLayout from '../../components/admin/AdminLayout';

const STATUSES: LeadStatus[] = ['new', 'contacted', 'quoted', 'active', 'declined'];

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function serviceLabel(s: string) {
  if (s === 'weekly') return 'Weekly';
  if (s === 'one-time') return 'Turf Deep Clean';
  if (s === 'yard-deep-clean') return 'Yard Deep Clean';
  if (s === 'turf') return 'Turf';
  return s || '—';
}

function InfoRow({ label, value }: { label: string; value?: string | number | null }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 py-3 border-b border-sage-light last:border-0">
      <span className="text-dark/40 text-sm min-w-36">{label}</span>
      <span className="text-dark text-sm font-medium">{value}</span>
    </div>
  );
}

export default function AdminLeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);

  useEffect(() => {
    const fetchLead = async () => {
      if (!id) return;
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (data) {
        setLead(data);
        setNotes(data.notes || '');
      }
      setLoading(false);
    };
    fetchLead();
  }, [id]);

  const handleStatusChange = async (newStatus: LeadStatus) => {
    if (!lead) return;
    setLead({ ...lead, status: newStatus });
    await supabase.from('leads').update({ status: newStatus }).eq('id', lead.id);
  };

  const handleSaveNotes = async () => {
    if (!lead) return;
    setSavingNotes(true);
    await supabase.from('leads').update({ notes }).eq('id', lead.id);
    setLead({ ...lead, notes });
    setSavingNotes(false);
    setNotesSaved(true);
    setTimeout(() => setNotesSaved(false), 2000);
  };

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center py-24">
          <div className="w-8 h-8 border-4 border-sage border-t-forest rounded-full animate-spin" />
        </div>
      </AdminLayout>
    );
  }

  if (!lead) {
    return (
      <AdminLayout>
        <div className="text-center py-24">
          <p className="text-dark/50">Lead not found.</p>
          <button onClick={() => navigate('/admin/leads')} className="mt-4 text-forest hover:text-amber font-medium transition-colors">
            ← Back to Leads
          </button>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="mb-6 flex items-center gap-4">
        <button
          onClick={() => navigate('/admin/leads')}
          className="flex items-center gap-2 text-dark/50 hover:text-forest transition-colors text-sm"
        >
          <ArrowLeft size={16} />
          Back to Leads
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
        <div className="md:col-span-2 flex flex-col gap-4 md:gap-6">
          <div className="bg-white rounded-card shadow-card p-6">
            <div className="flex items-start justify-between mb-6">
              <div>
                <h1 className="font-serif text-2xl text-dark">{lead.name}</h1>
                <p className="text-dark/50 text-sm mt-1">{lead.city}, CA</p>
              </div>
              <StatusBadge status={lead.status} />
            </div>

            <InfoRow label="Email" value={lead.email} />
            <InfoRow label="Phone" value={lead.phone} />
            <InfoRow label="Address" value={lead.address} />
            <InfoRow label="City" value={lead.city} />
            <InfoRow label="Service" value={serviceLabel(lead.service_type)} />
            <InfoRow label="Yard Size" value={lead.yard_size ? lead.yard_size.charAt(0).toUpperCase() + lead.yard_size.slice(1) : undefined} />
            <InfoRow label="Number of Dogs" value={lead.num_dogs} />
            <InfoRow label="Frequency" value={lead.frequency ? lead.frequency.charAt(0).toUpperCase() + lead.frequency.slice(1) : undefined} />
            <InfoRow label="Source Page" value={lead.source_page} />
            <InfoRow label="Submitted" value={formatDateTime(lead.created_at)} />
            <InfoRow label="Last Updated" value={formatDateTime(lead.updated_at)} />
          </div>

          <div className="bg-white rounded-card shadow-card p-6">
            <h2 className="font-semibold text-dark mb-3">Notes</h2>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Add notes about this lead..."
              className="w-full border border-sage-light rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-forest transition-colors resize-none"
            />
            <div className="flex items-center gap-3 mt-3">
              <button
                onClick={handleSaveNotes}
                disabled={savingNotes}
                className="flex items-center gap-2 bg-forest hover:bg-forest-dark text-white text-sm font-semibold px-5 py-2.5 rounded-full transition-all hover:shadow-md disabled:opacity-60"
              >
                <Save size={14} />
                {savingNotes ? 'Saving...' : 'Save Notes'}
              </button>
              {notesSaved && (
                <span className="text-green-600 text-sm font-medium">Saved!</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="bg-white rounded-card shadow-card p-6">
            <h2 className="font-semibold text-dark mb-4">Update Status</h2>
            <div className="flex flex-col gap-2">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  onClick={() => handleStatusChange(s)}
                  className={`w-full text-left px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                    lead.status === s
                      ? 'bg-forest text-white'
                      : 'bg-cream text-dark hover:bg-sage-light'
                  }`}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-cream rounded-card p-5 border border-sage-light">
            <p className="text-xs text-dark/40 uppercase tracking-wider font-semibold mb-3">Quick Actions</p>
            <div className="flex flex-col gap-2">
              <a
                href={`tel:${lead.phone}`}
                className="flex items-center gap-2 px-4 py-2.5 bg-white rounded-xl text-sm font-medium text-dark hover:bg-sage-light transition-colors border border-sage-light"
              >
                📞 Call {lead.name.split(' ')[0]}
              </a>
              <a
                href={`mailto:${lead.email}`}
                className="flex items-center gap-2 px-4 py-2.5 bg-white rounded-xl text-sm font-medium text-dark hover:bg-sage-light transition-colors border border-sage-light"
              >
                ✉️ Email {lead.name.split(' ')[0]}
              </a>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
