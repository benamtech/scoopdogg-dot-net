/**
 * Today's route — the one screen a crew session can reach (P18 §4 item 1), and now the one
 * place a visit is marked done.
 *
 * IT STILL DOES NOT CLAIM A PROOF IT CANNOT WRITE. `visit.require_completion_photo` is true in
 * settings and there is no photo storage on this project, so the Mark-done action is OFFERED
 * ONLY WHEN THE SERVER SAYS IT CAN BE — `completion.ready` — and otherwise the screen prints the
 * reason and what to change. A disabled button with an explanation is a true statement about the
 * system; a button that always errors is not. `server/lib/visits.ts` holds the same rule on the
 * server, so a screen that got this wrong could still not complete a visit without a photo.
 *
 * WHY MARKING DONE MATTERS BEYOND THE ROW. `visits.completed_at` was read in three places and
 * written in none. The review request after the third visit (P16 §7, loop 3) and the visit-
 * complete message both hang off it, so until this button existed they were readers with no
 * writer.
 *
 * The gate code is here because the person standing at the gate needs it, and it is nowhere else:
 * `visit.gate_code_visible_to` is 'assigned_crew_only'.
 */
import { useEffect, useState } from 'react';
import { adminApi, type Stop, type CompletionReadiness } from '../../lib/adminApi';
import AdminLayout from '../../components/admin/AdminLayout';

type TodayData = { date: string; stops: Stop[]; completion: CompletionReadiness };

export default function AdminTodayPage() {
  const [data, setData] = useState<TodayData | null>(null);
  const [error, setError] = useState('');
  /** Per-stop: 'busy' while the request is in flight, or the sentence to show after it. */
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [said, setSaid] = useState<Record<string, string>>({});

  const load = async () => {
    try { setData(await adminApi.today()); } catch (e) { setError((e as Error).message); }
  };
  useEffect(() => { load(); }, []);

  const markDone = async (s: Stop) => {
    setBusy((b) => ({ ...b, [s.id]: true }));
    try {
      const r = await adminApi.completeVisit(s.id);
      // What happened to the customer message is reported, not hidden. `sms` is the configured
      // channel and there is no SMS transport, so the usual answer is "queued for you to send".
      setSaid((m) => ({
        ...m,
        [s.id]: r.told.sent
          ? 'Marked done, and the customer has been told.'
          : r.told.channel === 'sms'
            ? 'Marked done. Text them from your phone — it is on your list.'
            : `Marked done. The customer was not told: ${r.told.reason ?? 'unknown'}`,
      }));
      await load();
    } catch (e) {
      setSaid((m) => ({ ...m, [s.id]: (e as Error).message }));
    } finally {
      setBusy((b) => ({ ...b, [s.id]: false }));
    }
  };

  return (
    <AdminLayout>
      <div className="max-w-3xl">
        <h1 className="font-serif text-h2 text-forest-900">Today</h1>
        <p className="mt-2 text-base text-ink-500">
          {data ? new Date(`${data.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }) : 'Loading…'}
        </p>
        {error && <p role="alert" className="mt-4 rounded-md bg-danger-100 px-4 py-3 text-danger">{error}</p>}

        {data && !data.completion.ready && (
          <p className="mt-6 rounded-lg border-2 border-amber-600 bg-amber-100 px-4 py-3 text-base text-amber-700">
            <strong>Stops cannot be marked done yet.</strong> {data.completion.reason}
          </p>
        )}

        {data && data.stops.length === 0 && (
          <p className="mt-8 rounded-lg border border-line bg-paper p-6 text-base text-ink-700">No stops scheduled today.</p>
        )}
        <ul className="mt-8 space-y-3">
          {data?.stops.map((s, i) => (
            <li key={s.id} className="rounded-lg border border-line bg-paper p-5">
              <div className="flex items-start gap-4">
                <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${s.state === 'completed' ? 'bg-forest-400' : 'bg-forest-600'}`}>{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-semibold text-forest-900">{s.address}</p>
                  <p className="text-base text-ink-700">{s.city} · {s.customer_name}</p>
                  {s.gate_code && <p className="mt-2 text-base text-forest-800">Gate code: <strong className="font-semibold">{s.gate_code}</strong></p>}
                  {s.access_notes && <p className="mt-1 text-base text-ink-700">{s.access_notes}</p>}
                  <a href={`tel:${String(s.phone ?? '').replace(/\D/g, '')}`} className="link mt-2 inline-block text-base">{s.phone}</a>

                  <div className="mt-4">
                    {s.state === 'completed' ? (
                      <p className="text-base font-semibold text-forest-700">Done</p>
                    ) : (
                      <button
                        type="button"
                        onClick={() => markDone(s)}
                        disabled={!data.completion.ready || busy[s.id]}
                        title={data.completion.ready ? undefined : data.completion.reason ?? undefined}
                        className="btn-primary btn-sm disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busy[s.id] ? 'Saving…' : 'Mark done'}
                      </button>
                    )}
                    {said[s.id] && <p className="mt-2 text-base text-ink-700">{said[s.id]}</p>}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </AdminLayout>
  );
}
