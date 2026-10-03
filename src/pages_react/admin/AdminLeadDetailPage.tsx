import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import { adminApi, type CustomLead, type RequestPhoto, type QuoteSummary } from '../../lib/adminApi';
import { jobKindLabel } from '../../shared/quote-contract';
import { money } from '../../shared/quote-math';
import { serviceLabel } from '../../lib/serviceLabel';
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
  const [lead, setLead] = useState<(Lead & CustomLead) | null>(null);
  const [photos, setPhotos] = useState<RequestPhoto[]>([]);
  const [quotes, setQuotes] = useState<QuoteSummary[]>([]);
  const [building, setBuilding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);

  useEffect(() => {
    const fetchLead = async () => {
      if (!id) return;
      try {
        const { lead: data, photos: ph, quotes: qs } = await adminApi.lead(id);
        setLead(data as never);
        setPhotos(ph ?? []);
        setQuotes(qs ?? []);
        setNotes(data.notes || '');
      } catch { /* handled by ProtectedRoute */ }
      setLoading(false);
    };
    fetchLead();
  }, [id]);

  const handleStatusChange = async (newStatus: LeadStatus) => {
    if (!lead) return;
    setLead({ ...lead, status: newStatus });
    await adminApi.updateLead(lead.id, { status: newStatus });
  };

  const handleSaveNotes = async () => {
    if (!lead) return;
    setSavingNotes(true);
    await adminApi.updateLead(lead.id, { notes });
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
            <InfoRow label="Service" value={serviceLabel(lead.service_slug)} />
            <InfoRow label="Yard Size" value={lead.yard_size ? lead.yard_size.charAt(0).toUpperCase() + lead.yard_size.slice(1) : undefined} />
            <InfoRow label="Number of Dogs" value={lead.num_dogs} />
            <InfoRow label="Frequency" value={lead.frequency ? lead.frequency.charAt(0).toUpperCase() + lead.frequency.slice(1) : undefined} />
            <InfoRow label="Source Page" value={lead.source_page} />
            <InfoRow label="Submitted" value={formatDateTime(lead.created_at)} />
            <InfoRow label="Last Updated" value={formatDateTime(lead.updated_at)} />
          </div>

          {(lead.kind === 'custom' || photos.length > 0 || (lead.job_kinds?.length ?? 0) > 0) && (
            <div className="bg-white rounded-card shadow-card p-6" data-custom-request>
              <h2 className="font-semibold text-dark">The job they described</h2>
              {(lead.job_kinds?.length ?? 0) > 0 && <p className="mt-2 text-sm text-dark/70">{lead.job_kinds!.map(jobKindLabel).join(' · ')}</p>}
              {lead.notes && <p className="mt-3 whitespace-pre-wrap text-dark">{lead.notes}</p>}
              <p className="mt-2 text-sm text-dark/60">
                {lead.timing === 'asap' ? 'As soon as possible' : lead.timing === 'month' ? 'Within a month' : lead.timing === 'flexible' ? 'Timing is flexible' : ''}
                {lead.contact_pref ? ` · prefers ${lead.contact_pref === 'text' ? 'a text' : lead.contact_pref === 'call' ? 'a call' : 'email'}` : ''}
              </p>
              {photos.length > 0 && (
                <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {photos.map((p) => <a key={p.id} href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt="Customer photo" className="aspect-square w-full rounded-lg object-cover" /></a>)}
                </div>
              )}
            </div>
          )}

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

          <div className="bg-white rounded-card shadow-card p-6" data-lead-quotes>
            <h2 className="font-semibold text-dark">Quote</h2>
            {quotes.length > 0 && (
              <ul className="mt-3 flex flex-col gap-2">
                {quotes.map((q) => (
                  <li key={q.id}><a className="flex justify-between rounded-xl bg-cream px-4 py-3 text-sm hover:bg-sage-light" href={`/admin/quotes/${q.id}`}>
                    <span>#{q.number} · {q.state}{q.view_count ? ` · opened ${q.view_count}×` : ''}</span>
                    <span className="font-semibold">{q.total_cents != null ? money(q.total_cents) : ''}</span>
                  </a></li>
                ))}
              </ul>
            )}
            <button
              className="mt-3 w-full rounded-full bg-forest px-5 py-3 text-sm font-semibold text-white hover:bg-forest-dark disabled:opacity-60"
              disabled={building}
              data-build-quote
              onClick={async () => {
                setBuilding(true);
                try { const v = await adminApi.quoteNew(lead.id); navigate(`/admin/quotes/${v.quote.id}`); }
                catch (e) { alert((e as Error).message); setBuilding(false); }
              }}
            >{quotes.some((q) => q.state === 'draft') ? 'Open the draft quote' : 'Build a quote'}</button>
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
                href={`sms:${lead.phone}`}
                className="flex items-center gap-2 px-4 py-2.5 bg-white rounded-xl text-sm font-medium text-dark hover:bg-sage-light transition-colors border border-sage-light"
              >
                💬 Text {lead.name.split(' ')[0]}
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
