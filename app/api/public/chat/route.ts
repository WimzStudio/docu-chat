import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI, TaskType } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY!);

// Client Supabase admin (service_role) pour bypasser RLS sur la validation de clé
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function normalize(vector: number[]) {
  const magnitude = Math.sqrt(vector.reduce((acc, val) => acc + val * val, 0));
  return vector.map(val => val / magnitude);
}

export async function POST(request: Request) {
  try {
    // 1. AUTHENTIFICATION PAR CLÉ API
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Clé API manquante' }, { status: 401 });
    }
    const apiKey = authHeader.replace('Bearer ', '').trim();

    const { data: keyRecord, error: keyError } = await supabaseAdmin
      .from('workspace_api_keys')
      .select('space_id, user_id')
      .eq('api_key', apiKey)
      .single();

    if (keyError || !keyRecord) {
      return NextResponse.json({ error: 'Clé API invalide' }, { status: 401 });
    }

    const { space_id, user_id } = keyRecord;

    // 2. LECTURE DU MESSAGE
    const { message, history = [] } = await request.json();
    if (!message) {
      return NextResponse.json({ error: 'Message manquant' }, { status: 400 });
    }

    // 3. EMBEDDING + RECHERCHE VECTORIELLE RAG
    const embeddingModel = genAI.getGenerativeModel({ model: 'gemini-embedding-2-preview' });
    const embRes = await embeddingModel.embedContent({
      content: { parts: [{ text: message }], role: 'user' },
      taskType: TaskType.RETRIEVAL_QUERY,
      outputDimensionality: 768,
    } as any);

    const queryEmbedding = normalize(embRes.embedding.values);

    const { data: documents, error: rpcError } = await supabaseAdmin.rpc('match_documents', {
      query_embedding: queryEmbedding,
      match_threshold: 0.25,
      match_count: 20,
      filter_user_id: user_id,
      filter_space_ids: [space_id],
    });

    if (rpcError) console.error('Erreur RPC match_documents:', rpcError);

    const contextText = documents?.length
      ? documents.map((doc: any) => doc.content).join('\n---\n')
      : "Aucun document trouvé dans ce workspace.";

    // 4. CHAT GEMINI AVEC STREAMING
    const formattedHistory = history.map((msg: any) => ({
      role: msg.role === 'ai' ? 'model' : 'user',
      parts: [{ text: msg.content || msg.text }],
    }));

    const chatModel = genAI.getGenerativeModel({
      model: 'gemini-3.1-flash-lite-preview',
      systemInstruction: `Tu es GlowBot, un assistant intelligent intégré au CRM GlowDesk Prospector.
Tu réponds UNIQUEMENT à partir du [CONTEXTE] fourni, qui provient d'un workspace documentaire DocuChat.
Si l'information n'est pas dans le contexte, dis-le clairement sans inventer.
Sois concis, direct et professionnel. Réponds en français.`,
    });

    const chatSession = chatModel.startChat({ history: formattedHistory });
    const prompt = `[CONTEXTE] :\n${contextText}\n\n[QUESTION] : ${message}`;
    const result = await chatSession.sendMessageStream(prompt);

    // 5. STREAMING DE LA RÉPONSE
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          for await (const chunk of result.stream) {
            controller.enqueue(encoder.encode(chunk.text()));
          }
        } catch (err) {
          controller.error(err);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
    });

  } catch (error) {
    console.error('Erreur GlowBot API:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    },
  });
}
