import { createClient } from '@supabase/supabase-js';

// On récupère les clés qu'on a cachées dans le fichier .env.local
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// On crée et on exporte le "client" (le pont) qu'on utilisera dans toute l'application
export const supabase = createClient(supabaseUrl, supabaseKey);