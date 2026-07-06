import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { ContactMessage, MessageStatus } from '../../lib/types';
import AdminLayout from '../../components/admin/AdminLayout';

const STATUSES: MessageStatus[] = ['unread', 'read', 'replied'];

function MessageStatusBadge({ status }: { status: MessageStatus }) {
  const styles: Record<MessageStatus, string> = {
    unread: 'bg-amber/15 text-amber-800',
    read: 'bg-gray-100 text-gray-500',
    replied: 'bg-green-100 text-green-700',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${styles[status]}`}>
      {status}
    </span>
  );
}

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

export default function AdminMessageDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [msg, setMsg] = useState<ContactMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetch = async () => {
      if (!id) return;
      const { data } = await supabase
        .from('contact_messages')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (data) {
        setMsg(data);
        if (data.status === 'unread') {
          await supabase.from('contact_messages').update({ status: 'read' }).eq('id', id);
          setMsg({ ...data, status: 'read' });
        }
      }
      setLoading(false);
    };
    fetch();
  }, [id]);

  const handleStatusChange = async (newStatus: MessageStatus) => {
    if (!msg) return;
    setSaving(true);
    setMsg({ ...msg, status: newStatus });
    await supabase.from('contact_messages').update({ status: newStatus }).eq('id', msg.id);
    setSaving(false);
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

  if (!msg) {
    return (
      <AdminLayout>
        <div className="text-center py-24">
          <p className="text-dark/50">Message not found.</p>
          <button onClick={() => navigate('/admin/messages')} className="mt-4 text-forest hover:text-amber font-medium transition-colors">
            ← Back to Messages
          </button>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="mb-6 flex items-center gap-4">
        <button
          onClick={() => navigate('/admin/messages')}
          className="flex items-center gap-2 text-dark/50 hover:text-forest transition-colors text-sm"
        >
          <ArrowLeft size={16} />
          Back to Messages
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
        <div className="md:col-span-2 flex flex-col gap-4 md:gap-6">
          <div className="bg-white rounded-card shadow-card p-6">
            <div className="flex items-start justify-between mb-6">
              <div>
                <h1 className="font-serif text-2xl text-dark">{msg.name}</h1>
                <p className="text-dark/50 text-sm mt-1">{msg.email}</p>
              </div>
              <MessageStatusBadge status={msg.status} />
            </div>

            <div className="border-t border-sage-light pt-5">
              <div className="flex flex-col gap-4">
                {msg.phone && (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                    <span className="text-dark/40 text-sm min-w-28">Phone</span>
                    <span className="text-dark text-sm font-medium">{msg.phone}</span>
                  </div>
                )}
                <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                  <span className="text-dark/40 text-sm min-w-28">Subject</span>
                  <span className="text-dark text-sm font-medium">{msg.subject || '—'}</span>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                  <span className="text-dark/40 text-sm min-w-28">Received</span>
                  <span className="text-dark text-sm font-medium">{formatDateTime(msg.created_at)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-card shadow-card p-6">
            <h2 className="font-semibold text-dark mb-4">Message</h2>
            <p className="text-dark/75 text-sm leading-relaxed whitespace-pre-wrap">{msg.message}</p>
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="bg-white rounded-card shadow-card p-6">
            <h2 className="font-semibold text-dark mb-4">Update Status</h2>
            <div className="relative">
              <select
                value={msg.status}
                onChange={(e) => handleStatusChange(e.target.value as MessageStatus)}
                disabled={saving}
                className="w-full appearance-none border border-sage-light rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-forest transition-colors bg-white text-dark pr-10 disabled:opacity-60"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
              <ChevronDown size={15} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-dark/30 pointer-events-none" />
            </div>
          </div>

          <div className="bg-cream rounded-card p-5 border border-sage-light">
            <p className="text-xs text-dark/40 uppercase tracking-wider font-semibold mb-3">Quick Reply</p>
            <div className="flex flex-col gap-2">
              <a
                href={`mailto:${msg.email}?subject=Re: ${encodeURIComponent(msg.subject || 'Your message to Scoop Dogg')}`}
                onClick={() => handleStatusChange('replied')}
                className="flex items-center gap-2 px-4 py-2.5 bg-white rounded-xl text-sm font-medium text-dark hover:bg-sage-light transition-colors border border-sage-light"
              >
                Reply via Email
              </a>
              {msg.phone && (
                <a
                  href={`tel:${msg.phone}`}
                  className="flex items-center gap-2 px-4 py-2.5 bg-white rounded-xl text-sm font-medium text-dark hover:bg-sage-light transition-colors border border-sage-light"
                >
                  Call {msg.name.split(' ')[0]}
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
