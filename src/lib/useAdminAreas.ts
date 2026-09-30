/**
 * The service areas, for an admin screen. From the admin API (the rows), never from a file baked
 * into the admin's JavaScript at build: that copy went stale the moment an area was edited, and
 * after 2026-09-29 there is no build-time catalog to bake.
 */
import { useEffect, useState } from 'react';
import { adminApi, type AdminArea } from './adminApi';

export function useAdminAreas(): AdminArea[] {
  const [areas, setAreas] = useState<AdminArea[]>([]);
  useEffect(() => { adminApi.areas().then((r) => setAreas(r.areas)).catch(() => setAreas([])); }, []);
  return areas;
}
