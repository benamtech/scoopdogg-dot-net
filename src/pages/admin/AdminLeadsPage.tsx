import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { Lead } from '../../lib/types';
import StatusBadge from '../../components/admin/StatusBadge';
import AdminLayout from '../../components/admin/AdminLayout';
import { CITIES } from '../../lib/cities';

type SortField = 'name' | 'city' | 'service_type' | 'status' | 'created_at';
type SortDir = 'asc' | 'desc';

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

const STATUSES = ['new', 'contacted', 'quoted', 'active', 'declined'];

export default function AdminLeadsPage() {
  const navigate = useNavigate();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  useEffect(() => {
    const fetchLeads = async () => {
      const { data } = await supabase
        .from('leads')
        .select('*')
        .order('created_at', { ascending: false });
      setLeads(data || []);
      setLoading(false);
    };
    fetchLeads();
  }, []);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const filtered = useMemo(() => {
    let result = [...leads];
    if (statusFilter) result = result.filter((l) => l.status === statusFilter);
    if (cityFilter) result = result.filter((l) => l.city === cityFilter);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          l.email.toLowerCase().includes(q) ||
          l.phone.includes(q)
      );
    }
    result.sort((a, b) => {
      const va = a[sortField] ?? '';
      const vb = b[sortField] ?? '';
      const cmp = String(va).localeCompare(String(vb));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return result;
  }, [leads, statusFilter, cityFilter, search, sortField, sortDir]);

  const SortIcon = ({ field }: { field: SortField }) => (
    <span className={`ml-1 text-dark/30 ${sortField === field ? 'text-forest' : ''}`}>
      {sortField === field ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  );

  return (
    <AdminLayout>
      <div className="mb-6 md:mb-8">
        <h1 className="font-serif text-2xl md:text-3xl text-dark">All Leads</h1>
        <p className="text-dark/50 text-sm mt-1">{filtered.length} leads found</p>
      </div>

      <div className="bg-white rounded-card shadow-card mb-6 p-3 md:p-4 flex flex-col sm:flex-row flex-wrap gap-2 md:gap-3">
        <div className="relative flex-1 min-w-0">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark/30" />
          <input
            type="text"
            placeholder="Search name, email, phone..."
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
        <select
          value={cityFilter}
          onChange={(e) => setCityFilter(e.target.value)}
          className="px-3 md:px-4 py-2 md:py-2.5 border border-sage-light rounded-lg md:rounded-xl text-sm focus:outline-none focus:border-forest transition-colors bg-white text-dark"
        >
          <option value="">All Cities</option>
          {CITIES.map((c) => (
            <option key={c.slug} value={c.name}>{c.name}</option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-card shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sage-light bg-cream/50">
                {[
                  { label: 'Name', field: 'name' as SortField, hide: '' },
                  { label: 'Phone', field: null, hide: 'hidden sm:table-cell' },
                  { label: 'City', field: 'city' as SortField, hide: 'hidden sm:table-cell' },
                  { label: 'Service', field: 'service_type' as SortField, hide: 'hidden md:table-cell' },
                  { label: 'Status', field: 'status' as SortField, hide: '' },
                  { label: 'Date', field: 'created_at' as SortField, hide: 'hidden md:table-cell' },
                ].map(({ label, field, hide }) => (
                  <th
                    key={label}
                    className={`text-left px-4 md:px-6 py-2.5 md:py-3 text-xs font-semibold text-dark/40 uppercase tracking-wider ${field ? 'cursor-pointer hover:text-dark/70 select-none' : ''} ${hide}`}
                    onClick={() => field && toggleSort(field)}
                  >
                    {label}
                    {field && <SortIcon field={field} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 md:px-6 py-10 text-center text-dark/40 text-sm">Loading...</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 md:px-6 py-10 text-center text-dark/40 text-sm">No leads found</td>
                </tr>
              ) : (
                filtered.map((lead) => (
                  <tr
                    key={lead.id}
                    onClick={() => navigate(`/admin/leads/${lead.id}`)}
                    className="border-b border-sage-light/50 hover:bg-sage-light/30 cursor-pointer transition-colors last:border-0"
                  >
                    <td className="px-4 md:px-6 py-3 md:py-4">
                      <p className="font-medium text-dark text-xs md:text-sm">{lead.name}</p>
                      <p className="text-dark/40 text-xs truncate max-w-[130px] md:max-w-none">{lead.email}</p>
                    </td>
                    <td className="px-4 md:px-6 py-3 md:py-4 text-dark/70 text-xs md:text-sm hidden sm:table-cell">{lead.phone}</td>
                    <td className="px-4 md:px-6 py-3 md:py-4 text-dark/70 text-xs md:text-sm hidden sm:table-cell">{lead.city}</td>
                    <td className="px-4 md:px-6 py-3 md:py-4 text-dark/70 text-xs md:text-sm hidden md:table-cell">{serviceLabel(lead.service_type)}</td>
                    <td className="px-4 md:px-6 py-3 md:py-4"><StatusBadge status={lead.status} /></td>
                    <td className="px-4 md:px-6 py-3 md:py-4 text-dark/50 text-xs md:text-sm hidden md:table-cell">{formatDate(lead.created_at)}</td>
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
