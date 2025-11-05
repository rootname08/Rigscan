'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

type AnyRow = Record<string, any>;

export default function TestPage() {
  const [rows, setRows] = useState<AnyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from('products')
          .select('*')
          .limit(5);

        if (error) setErr(error.message);
        else setRows(data ?? []);
      } catch (e: any) {
        setErr(e?.message || 'Error desconocido');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Test de conexión Supabase</h1>
      {loading && <p>Cargando…</p>}
      {!loading && err && <p className="text-red-600">Error: {err}</p>}
      {!loading && !err && rows.length === 0 && <p>Sin datos en la tabla.</p>}
      {!loading && !err && rows.length > 0 && (
        <ul className="list-disc pl-6">
          {rows.map((r: any) => (
            <li key={r.id ?? JSON.stringify(r)}>
              {r.name ?? r.title ?? JSON.stringify(r)}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
