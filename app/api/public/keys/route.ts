import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { randomBytes } from 'crypto';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET — Liste les clés d'un workspace
export async function GET(request: Request) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll() { return cookieStore.getAll() }, setAll(p) { p.forEach(c => cookieStore.set(c.name, c.value, c.options)) } } }
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

    const url = new URL(request.url);
    const spaceId = url.searchParams.get('spaceId');

    const query = supabaseAdmin
      .from('workspace_api_keys')
      .select('id, label, api_key, created_at, space_id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (spaceId) query.eq('space_id', spaceId);

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST — Génère une nouvelle clé pour un workspace
export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll() { return cookieStore.getAll() }, setAll(p) { p.forEach(c => cookieStore.set(c.name, c.value, c.options)) } } }
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

    const { spaceId, label } = await request.json();
    if (!spaceId) return NextResponse.json({ error: 'spaceId requis' }, { status: 400 });

    // Générer une clé unique préfixée dc_
    const apiKey = 'dc_' + randomBytes(24).toString('hex');

    const { data, error } = await supabaseAdmin
      .from('workspace_api_keys')
      .insert({ space_id: spaceId, user_id: user.id, api_key: apiKey, label: label || 'Clé API' })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// DELETE — Révoque une clé
export async function DELETE(request: Request) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll() { return cookieStore.getAll() }, setAll(p) { p.forEach(c => cookieStore.set(c.name, c.value, c.options)) } } }
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

    const { keyId } = await request.json();
    const { error } = await supabaseAdmin
      .from('workspace_api_keys')
      .delete()
      .eq('id', keyId)
      .eq('user_id', user.id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
