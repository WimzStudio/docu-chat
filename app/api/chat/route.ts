import { NextResponse } from 'next/server';
import { GoogleGenerativeAI, TaskType } from "@google/generative-ai";
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY!);

// Fonction pour normaliser les vecteurs (essentiel pour la recherche Supabase)
function normalize(vector: number[]) {
  const magnitude = Math.sqrt(vector.reduce((acc, val) => acc + val * val, 0));
  return vector.map(val => val / magnitude);
}

export async function POST(request: Request) {
  try {
    const { message, fileId } = await request.json();

    // 1. Authentification Supabase via les cookies
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll(payload) { payload.forEach((c) => cookieStore.set(c.name, c.value, c.options)) },
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response("Non autorisé", { status: 401 });

    // 2. Création de l'embedding pour la question de l'utilisateur
    const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-2-preview" });
    
    const embeddingResult = await embeddingModel.embedContent({
      content: { parts: [{ text: message }], role: 'user' },
      taskType: TaskType.RETRIEVAL_QUERY,
      outputDimensionality: 768,
    } as any);
    
    const queryEmbedding = normalize(embeddingResult.embedding.values);

    // 3. Recherche des documents les plus pertinents dans la base de données
    const { data: documents, error } = await supabase.rpc('match_documents', {
      query_embedding: queryEmbedding,
      match_threshold: 0.3,
      match_count: 5,
      filter_user_id: user.id,
      filter_file_id: fileId
    });

    if (error) throw error;

    const contextText = documents?.length 
      ? documents.map((doc: any) => doc.content).join("\n---\n") 
      : "Aucun contexte trouvé.";

    // 4. Préparation du modèle Gemini 3.1 Flash Lite
    const chatModel = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite-preview" });
    
    const prompt = `
      Tu es DocuChat. Réponds à la QUESTION en utilisant le CONTEXTE suivant.
      Le contexte provient des documents personnels de l'utilisateur.
      
      CONTEXTE :
      ${contextText}

      QUESTION :
      ${message}
    `;

    // 5. GÉNÉRATION EN STREAMING
    // On utilise generateContentStream au lieu de generateContent
    const result = await chatModel.generateContentStream(prompt);

    // On crée un flux de données (ReadableStream) pour envoyer les mots au fur et à mesure
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          for await (const chunk of result.stream) {
            const chunkText = chunk.text();
            // On envoie chaque petit morceau de texte au navigateur
            controller.enqueue(encoder.encode(chunkText));
          }
        } catch (err) {
          controller.error(err);
        } finally {
          controller.close();
        }
      },
    });

    // On renvoie le flux avec le bon type de contenu
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
      },
    });

  } catch (error) {
    console.error("Erreur Chat:", error);
    return new Response("Erreur lors de la génération du chat", { status: 500 });
  }
}