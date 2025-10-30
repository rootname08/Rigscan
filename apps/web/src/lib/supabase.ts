// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js'

// Leemos las variables del archivo .env.local
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Creamos el cliente de Supabase
export const supabase = createClient(supabaseUrl, supabaseKey)
