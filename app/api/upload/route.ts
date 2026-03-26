import { NextResponse } from 'next/server';
import { extractText } from 'unpdf';
import mammoth from 'mammoth';
import * as xlsx from 'xlsx';
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
    const spaceId = formData.get('spaceId') as string | null; 

    if (!file) return NextResponse.json({ error: "Pas de fichier" }, { status: 400 });

    const fileId = crypto.randomUUID();
    const fileName = file.name;
    const buffer = await file.arrayBuffer();
    
    const extension = fileName.split('.').pop()?.toLowerCase() || '';
    const mimeType = file.type;
    
    let fullText = "";

    // --- 🔀 AIGUILLAGE UNIVERSEL ---
    if (mimeType === "application/pdf" || extension === "pdf") {
      const { text } = await extractText(new Uint8Array(buffer));
      fullText = Array.isArray(text) ? text.join(' ') : text;

    } else if (mimeType.startsWith("image/")) {
      const visionModel = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite-preview" });
      const base64Data = Buffer.from(buffer).toString("base64");
      const result = await visionModel.generateContent([
        "Extrais tout le texte visible dans cette image. Sois exhaustif.",
        { inlineData: { data: base64Data, mimeType: file.type } }
      ]);
      fullText = result.response.text();

    } else if (extension === "docx") {
      const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
      fullText = result.value;

    } else if (extension === "xlsx" || extension === "csv" || mimeType.includes("spreadsheet")) {
      const workbook = xlsx.read(buffer, { type: 'buffer' });
      const sheetNames = workbook.SheetNames;
      for (const sheetName of sheetNames) {
        const sheet = workbook.Sheets[sheetName];
        fullText += xlsx.utils.sheet_to_csv(sheet) + "\n";
      }
    } else {
      fullText = Buffer.from(buffer).toString("utf-8");
    }

    // --- 🛡️ FILET DE SÉCURITÉ OCR (Même modèle que toi) ---
    // Si l'extraction classique échoue (PDF scanné), on utilise ton modèle fétiche
    if (!fullText || fullText.trim().length < 20) {
      const fallbackModel = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite-preview" });
      const base64Data = Buffer.from(buffer).toString("base64");
      
      const result = await fallbackModel.generateContent([
        "Analyse ce document (OCR) et retranscris tout son contenu textuel proprement. Sois précis sur les chiffres.",
        { inlineData: { data: base64Data, mimeType: mimeType || "application/pdf" } }
      ]);
      fullText = result.response.text();
    }

    if (!fullText || fullText.trim().length === 0) {
      return NextResponse.json({ error: "Contenu illisible." }, { status: 400 });
    }

    // --- ✂️ DÉCOUPAGE ET MÉMORISATION ---
    const chunks = fullText.match(/[\s\S]{1,1000}/g) || [];
    const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-2-preview" });

    for (const chunk of chunks) {
      if (!chunk.trim()) continue;

      const result = await embeddingModel.embedContent({
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
        space_id: spaceId || null,
        metadata: { fileName }
      });

      if (error) throw error;
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error("Erreur Upload:", error);
    return NextResponse.json({ error: "Erreur d'upload" }, { status: 500 });
  }
}