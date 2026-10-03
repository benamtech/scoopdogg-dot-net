/**
 * The team: who can sign in to this admin, and the one tap that stops them.
 *
 * Until this screen, adding a person meant asking AMTECH to run SQL, and so did removing one.
 * `gates/writers-outside-gates.mjs` found it by the shape — `team_members` had readers on every
 * request and no writer outside a migration and a gate. server/lib/team.ts is the writer and it
 * holds the rules; this screen only asks for things and prints what the server said.
 *
 * NOBODY IS DELETED, only switched off (migration 001: visits they completed must keep naming
 * them). Switching off takes effect on their next click and ends their open sessions too.
 *
 * Crew see today's stops and nothing else. That is enforced by the server's allowlist, not here —
 * this screen just says so, so an owner adding somebody knows what they are giving them.
 */
import { useEffect, useState } from 'react';
import { adminApi, type TeamMember } from '../../lib/adminApi';
import AdminLayout from '../../components/admin/AdminLayout';

const ROLE: Record<TeamMember['role'], string> = {
  superadmin: 'Owner (AMTECH)',
  admin: 'Owner',
  crew: 'Crew — today’s stops only',
};

export default function AdminTeamPage() {
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [me, setMe] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [form, setForm] = useState({ name: '', email: '', phone: '', role: 'crew' as 'crew' | 'admin' });

  const load = async () => {
    try { const r = await adminApi.team(); setTeam(r.team); setMe(r.me); }
    catch (e) { setError((e as Error).message); }
  };
  useEffect(() => { load(); }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('add'); setError(''); setNote('');
    try {
      const { member } = await adminApi.addTeamMember(form);
      setNote(`${member.name} can now sign in at /admin with ${member.email}.`);
      setForm({ name: '', email: '', phone: '', role: 'crew' });
      await load();
    } catch (err) { setError((err as Error).message); } finally { setBusy(''); }
  };

  const toggle = async (m: TeamMember) => {
    const off = m.status === 'active';
    if (off && !confirm(`Switch off ${m.name}? They are signed out straight away and can be switched back on later.`)) return;
    setBusy(m.id); setError(''); setNote('');
    try {
      await adminApi.setTeamStatus(m.id, off ? 'inactive' : 'active');
      setNote(off ? `${m.name} is switched off.` : `${m.name} can sign in again.`);
      await load();
    } catch (err) { setError((err as Error).message); } finally { setBusy(''); }
  };

  return (
    <AdminLayout>
      <div className="max-w-3xl">
        <h1 className="font-serif text-h2 text-forest-900">Team</h1>
        <p className="mt-2 text-base text-ink-500">Everyone who can sign in here. Crew see today&rsquo;s stops and nothing else.</p>
        {error && <p role="alert" className="mt-4 rounded-md bg-danger-100 px-4 py-3 text-danger">{error}</p>}
        {note && <p className="mt-4 rounded-md bg-success-100 px-4 py-3 text-success">{note}</p>}

        {!team ? <div className="mt-8 h-40 animate-pulse rounded-lg bg-line/50" /> : (
          <ul className="mt-8 divide-y divide-line rounded-lg border border-line bg-paper">
            {team.map((m) => (
              <li key={m.id} className={`flex flex-wrap items-center justify-between gap-3 px-5 py-4 ${m.status === 'active' ? '' : 'text-ink-400'}`}>
                <div className="min-w-0">
                  <p className="text-base font-semibold text-forest-900">{m.name}{m.id === me && <span className="ml-2 text-sm font-normal text-ink-500">(you)</span>}</p>
                  <p className="text-sm text-ink-500">{m.email ?? 'no email — cannot sign in'} · {ROLE[m.role]}</p>
                  <p className="text-sm text-ink-400">
                    {m.status === 'active'
                      ? (m.last_login_at ? `Last signed in ${new Date(m.last_login_at).toLocaleDateString()}` : 'Has not signed in yet')
                      : `Switched off${m.ended_at ? ` ${m.ended_at}` : ''}`}
                  </p>
                </div>
                {/* Nobody changes their own access, and the server refuses it too. */}
                {m.id !== me && m.role !== 'superadmin' && (
                  <button type="button" className={`btn-sm ${m.status === 'active' ? 'btn-ghost text-danger' : 'btn-secondary'}`}
                          disabled={!!busy} onClick={() => toggle(m)}>
                    {busy === m.id ? 'Saving…' : m.status === 'active' ? 'Switch off' : 'Switch back on'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <h2 className="mt-12 text-lg font-semibold text-forest-900">Add somebody</h2>
        <form onSubmit={add} className="mt-4 grid gap-4 rounded-lg border border-line bg-paper p-5 sm:grid-cols-2">
          <label className="grid gap-1 text-sm text-ink-700">Name
            <input required className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="grid gap-1 text-sm text-ink-700">Email — it is how they sign in
            <input required type="email" className="field" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label className="grid gap-1 text-sm text-ink-700">Phone (optional)
            <input type="tel" className="field" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </label>
          <label className="grid gap-1 text-sm text-ink-700">What they can see
            <select className="field" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as 'crew' | 'admin' })}>
              <option value="crew">Crew — today&rsquo;s stops only</option>
              <option value="admin">Owner — everything</option>
            </select>
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className="btn-primary btn-sm" disabled={!!busy}>{busy === 'add' ? 'Adding…' : 'Add to the team'}</button>
          </div>
        </form>
      </div>
    </AdminLayout>
  );
}
