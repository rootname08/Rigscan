'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function ProductsPage() {
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('prices_mv').select('*').order('last_update', { ascending: false });
      setRows(data ?? []);
    })();
  }, []);

  return (
    <main className="max-w-5xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Productos</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
        {rows.map((p: any) => (
          <a key={p.product_id} href={p.url} target="_blank" className="border rounded-xl p-4 bg-white shadow-sm">
            <img src={p.image_url || '/placeholder.png'} className="w-full h-48 object-contain mb-3" />
            <h2 className="font-semibold">{p.name}</h2>
            <p className="text-sm text-gray-500">{p.merchant}</p>
            <p className="text-xl font-bold">{Number(p.last_price).toFixed(2).replace('.', ',')} €</p>
          </a>
        ))}
      </div>
    </main>
  );
}
