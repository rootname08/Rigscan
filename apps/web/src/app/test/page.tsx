'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function TestPage() {
  const [data, setData] = useState<any[]>([])

  useEffect(() => {
    async function fetchData() {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .limit(5)
      if (error) console.error('❌ Error:', error.message)
      else setData(data || [])
    }
    fetchData()
  }, [])

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold mb-4">📡 Test de conexión Supabase</h1>
      {data.length > 0 ? (
        <ul className="list-disc pl-4">
          {data.map((item) => (
            <li key={item.id}>{item.name || JSON.stringify(item)}</li>
          ))}
        </ul>
      ) : (
        <p>No se encontraron datos o la tabla está vacía.</p>
      )}
    </main>
  )
}
