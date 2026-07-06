import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { ContactMessage, MessageStatus } from '../../lib/types';
import AdminLayout from '../../components/admin/AdminLayout';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

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

const STATUSES: MessageStatus[] = ['unread', 'read', 'replied'];

export default function AdminMessagesPage() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    const fetchMessages = async () => {
      const { data } = await supabase
        .from('contact_messages')
        .select('*')
        .order('created_at', { ascending: false });
      setMessages(data || []);
      setLoading(false);
    };
    fetchMessages();
  }, []);

  const filtered = useMemo(() => {
    let result = [...messages];
    if (statusFilter) result = result.filter((m) => m.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q) ||
          m.subject.toLowerCase().includes(q)
      );
    }
    return result;
  }, [messages, statusFilter, search]);

  return (
    <AdminLayout>
      <div className="mb-6 md:mb-8">
        <h1 className="font-serif text-2xl md:text-3xl text-dark">Messages</h1>
        <p className="text-dark/50 text-sm mt-1">{filtered.length} messages found</p>
      </div>

      <div className="bg-white rounded-card shadow-card mb-6 p-3 md:p-4 flex flex-col sm:flex-row flex-wrap gap-2 md:gap-3">
        <div className="relative flex-1 min-w-0">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark/30" />
          <input
            type="text"
            placeholder="Search name, email, subject..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 md:py-2.5 border border-sage-light rounded-lg md:rounded-xl text-sm focus:outline-none focus:border-forest transition-colors"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 md:px-4 py-2 md:py-2.5 border border-sage-light rounded-lg md:rounded-xl text-sm focus:outline-none focus:border-forest transition-colors bg-white text-dark"
        >
          <option value="">All Statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-card shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sage-light bg-cream/50">
                <th className="text-left px-4 md:px-6 py-2.5 md:py-3 text-xs font-semibold text-dark/40 uppercase tracking-wider">Name</th>
                <th className="text-left px-4 md:px-6 py-2.5 md:py-3 text-xs font-semibold text-dark/40 uppercase tracking-wider hidden sm:table-cell">Email</th>
                <th className="text-left px-4 md:px-6 py-2.5 md:py-3 text-xs font-semibold text-dark/40 uppercase tracking-wider hidden md:table-cell">Subject</th>
                <th className="text-left px-4 md:px-6 py-2.5 md:py-3 text-xs font-semibold text-dark/40 uppercase tracking-wider">Status</th>
                <th className="text-left px-4 md:px-6 py-2.5 md:py-3 text-xs font-semibold text-dark/40 uppercase tracking-wider hidden sm:table-cell">Date</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 md:px-6 py-10 text-center text-dark/40 text-sm">Loading...</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 md:px-6 py-10 text-center text-dark/40 text-sm">No messages found</td>
                </tr>
              ) : (
                filtered.map((msg) => (
                  <tr
                    key={msg.id}
                    onClick={() => navigate(`/admin/messages/${msg.id}`)}
                    className="border-b border-sage-light/50 hover:bg-sage-light/30 cursor-pointer transition-colors last:border-0"
                  >
                    <td className="px-4 md:px-6 py-3 md:py-4">
                      <p className={`text-xs md:text-sm ${msg.status === 'unread' ? 'font-semibold text-dark' : 'font-medium text-dark'}`}>
                        {msg.name}
                      </p>
                      <p className="text-dark/40 text-xs sm:hidden truncate max-w-[130px]">{msg.email}</p>
                    </td>
                    <td className="px-4 md:px-6 py-3 md:py-4 text-dark/70 text-xs md:text-sm hidden sm:table-cell">{msg.email}</td>
                    <td className="px-4 md:px-6 py-3 md:py-4 text-dark/70 text-xs md:text-sm hidden md:table-cell">{msg.subject || '—'}</td>
                    <td className="px-4 md:px-6 py-3 md:py-4">
                      <MessageStatusBadge status={msg.status} />
                    </td>
                    <td className="px-4 md:px-6 py-3 md:py-4 text-dark/50 text-xs md:text-sm hidden sm:table-cell">{formatDate(msg.created_at)}</td>
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
