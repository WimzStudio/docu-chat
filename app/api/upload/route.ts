import { NextResponse } from 'next/server';
import { extractText } from 'unpdf';
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

    const formData = await request.formData();
    const file = formData.get('file') as File;
    if (!file) return NextResponse.json({ error: "Pas de fichier" }, { status: 400 });

    const fileId = crypto.randomUUID();
    const fileName = file.name;
    const buffer = await file.arrayBuffer();

    let fullText = "";

    // --- 🔀 AIGUILLAGE : PDF vs IMAGE ---
    if (file.type === "application/pdf") {
      // Cas 1 : C'est un PDF, on utilise ta méthode classique (unpdf)
      const { text } = await extractText(new Uint8Array(buffer));
      fullText = Array.isArray(text) ? text.join(' ') : text;
      
    } else if (file.type.startsWith("image/")) {
      // Cas 2 : C'est une Image, on demande à Gemini Vision de la lire
      const visionModel = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite-preview" });
      const base64Data = Buffer.from(buffer).toString("base64");
      
      const prompt = "Décris cette image en détail. Si elle contient du texte (capture d'écran, document scanné, facture...), retranscris-le le plus fidèlement possible.";
      
      const result = await visionModel.generateContent([
        prompt,
        { inlineData: { data: base64Data, mimeType: file.type } }
      ]);
      fullText = result.response.text();
      
    } else {
      // Sécurité : On bloque les autres formats (Word, Excel, etc.)
      return NextResponse.json({ error: "Format non supporté (PDF ou Image uniquement)" }, { status: 400 });
    }

    // Sécurité : Si l'image ou le PDF est vide
    if (!fullText || fullText.trim().length === 0) {
      return NextResponse.json({ error: "Aucun texte n'a pu être extrait." }, { status: 400 });
    }

    // --- ✂️ DÉCOUPAGE ET MÉMORISATION ---
    const chunks = fullText.match(/[\s\S]{1,1000}/g) || [];
    const model = genAI.getGenerativeModel({ model: "gemini-embedding-2-preview" });

    for (const chunk of chunks) {
      if (!chunk.trim()) continue;

      const result = await model.embedContent({
        content: { parts: [{ text: chunk }], role: 'user' },
        taskType: TaskType.RETRIEVAL_DOCUMENT,
        outputDimensionality: 768,
      } as any);

      const embedding = normalize(result.embedding.values);

      const { error } = await supabase.from('documents').insert({
        content: chunk,
        embedding: embedding,
        user_id: user.id,
        file_id: fileId,
        file_name: fileName,
        metadata: { fileName }
      });

      if (error) throw error;
    }

    return NextResponse.json({ success: true, message: `Document "${fileName}" mémorisé.` });

  } catch (error) {
    console.error("Erreur Upload:", error);
    return NextResponse.json({ error: "Erreur d'upload" }, { status: 500 });
  }
}