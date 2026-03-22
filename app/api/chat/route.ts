import { NextResponse } from 'next/server';
import { GoogleGenerativeAI, TaskType } from "@google/generative-ai";
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY!);

function normalize(vector: number[]) {
  const magnitude = Math.sqrt(vector.reduce((acc, val) => acc + val * val, 0));
  return vector.map(val => val / magnitude);
}

export async function POST(request: Request) {
  try {
    const { message, fileId } = await request.json();

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
    if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

    const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-2-preview" });
    
    const embeddingResult = await embeddingModel.embedContent({
      content: { parts: [{ text: message }], role: 'user' },
      taskType: TaskType.RETRIEVAL_QUERY,
      outputDimensionality: 768,
    } as any);
    
    const queryEmbedding = normalize(embeddingResult.embedding.values);

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

    // BIEN UTILISER getGenerativeModel ici
    const chatModel = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite-preview" });
    
    const prompt = `
      Tu es DocuChat. Réponds à la QUESTION en utilisant le CONTEXTE suivant.
      
      CONTEXTE :
      ${contextText}

      QUESTION :
      ${message}
    `;

    const result = await chatModel.generateContent(prompt);
    return NextResponse.json({ text: result.response.text() });

  } catch (error) {
    console.error("Erreur Chat:", error);
    return NextResponse.json({ error: "Erreur chat" }, { status: 500 });
  }
}