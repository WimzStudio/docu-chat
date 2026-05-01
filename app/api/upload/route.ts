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

function chunkText(text: string, maxChunkSize = 1000, overlap = 200): string[] {
  const paragraphs = text.split(/\n\s*\n/);
  const chunks: string[] = [];
  let currentChunk = "";

  for (const para of paragraphs) {
    if (currentChunk.length + para.length > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      const overlapText = currentChunk.slice(-overlap);
      const overlapStart = overlapText.indexOf(' ');
      currentChunk = overlapStart !== -1 ? overlapText.slice(overlapStart) : overlapText;
      currentChunk += "\n\n" + para;
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + para;
    }
  }
  
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks.flatMap(chunk => {
    if (chunk.length <= maxChunkSize) return [chunk];
    const sentences = chunk.match(/[^.!?]+[.!?]+/g) || [chunk];
    const subChunks: string[] = [];
    let temp = "";
    for(const sent of sentences) {
        if(temp.length + sent.length > maxChunkSize && temp.length > 0) {
            subChunks.push(temp.trim());
            temp = sent;
        } else {
            temp += (temp ? " " : "") + sent;
        }
    }
    if(temp.trim()) subChunks.push(temp.trim());
    return subChunks;
  });
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
          setAll(payload: any[]) { payload.forEach((c: any) => cookieStore.set(c.name, c.value, c.options)) },
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
    
    // CORRECTION : On récupère le buffer et on en fait immédiatement une version Buffer Node.js
    // Cela évite que la mémoire soit "détachée" lors de l'utilisation par unpdf ou mammoth.
    const arrayBuffer = await file.arrayBuffer();
    const safeBuffer = Buffer.from(arrayBuffer);
    
    const extension = fileName.split('.').pop()?.toLowerCase() || '';
    const mimeType = file.type;
    
    let fullText = "";

    // --- 🔀 AIGUILLAGE UNIVERSEL ---
    try {
      if (mimeType === "application/pdf" || extension === "pdf") {
        // On utilise une copie (slice) pour ne pas corrompre le buffer original
        const { text } = await extractText(new Uint8Array(safeBuffer.slice()));
        fullText = Array.isArray(text) ? text.join(' ') : text;

      } else if (extension === "docx") {
        const result = await mammoth.extractRawText({ buffer: safeBuffer });
        fullText = result.value;

      } else if (extension === "xlsx" || extension === "csv" || mimeType.includes("spreadsheet")) {
        const workbook = xlsx.read(safeBuffer, { type: 'buffer' });
        const sheetNames = workbook.SheetNames;
        for (const sheetName of sheetNames) {
          const sheet = workbook.Sheets[sheetName];
          fullText += xlsx.utils.sheet_to_csv(sheet) + "\n";
        }
      } else {
        fullText = safeBuffer.toString("utf-8");
      }
    } catch (e) {
      console.log("[Extraction] Erreur classique, le fallback IA prendra le relais.");
    }

    // --- 🛡️ FILET DE SÉCURITÉ OCR (Gemini 3.1 Flash Lite) ---
    if (!fullText || fullText.trim().length < 20) {
      console.log(`[OCR] Activation pour ${fileName}`);
      const fallbackModel = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite-preview" });
      
      // On utilise le safeBuffer qui est garanti intact ici
      const base64Data = safeBuffer.toString("base64");
      
      const result = await fallbackModel.generateContent([
        "Analyse ce document (OCR) et extrais tout son contenu textuel au format Markdown structuré (utilise # pour les titres, - pour les listes, etc.). Conserve l'intégralité du texte et sois très précis sur les chiffres et les tableaux.",
        { inlineData: { data: base64Data, mimeType: mimeType || "application/pdf" } }
      ]);
      fullText = result.response.text();
    }

    if (!fullText || fullText.trim().length === 0) {
      return NextResponse.json({ error: "Contenu illisible." }, { status: 400 });
    }

    // Nettoyage du texte pour enlever les caractères nuls (erreur PostgreSQL 22P05)
    fullText = fullText.replace(/\0/g, '');

    // --- ✂️ DÉCOUPAGE ET MÉMORISATION ---
    const chunks = chunkText(fullText, 1000, 200);
    const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-2-preview" });

    for (const chunk of chunks) {
      if (!chunk.trim()) continue;

      const embResult = await embeddingModel.embedContent({
        content: { parts: [{ text: chunk }], role: 'user' },
        taskType: TaskType.RETRIEVAL_DOCUMENT,
        outputDimensionality: 768,
      } as any);

      const embedding = normalize(embResult.embedding.values);

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

  } catch (error: any) {
    console.error("Erreur Upload:", error);
    return NextResponse.json({ error: "Erreur technique d'upload" }, { status: 500 });
  }
}