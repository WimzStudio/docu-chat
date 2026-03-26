import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY!);

export async function POST(request: Request) {
  try {
    const { messages } = await request.json();

    if (!messages || messages.length === 0) {
      return NextResponse.json({ error: "Aucun message à résumer" }, { status: 400 });
    }

    const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite-preview" });

    // Formatage de l'historique pour l'IA
    const historyString = messages
      .map((m: any) => `${m.role === 'user' ? 'UTILISATEUR' : 'IA'}: ${m.text}`)
      .join('\n');

    const prompt = `
      Agis en tant qu'assistant de direction expert. 
      Voici le contenu d'une discussion technique entre un utilisateur et une IA concernant des documents.
      
      CONSIGNE :
      Rédige une synthèse professionnelle et concise de cet échange. 
      La synthèse doit impérativement comporter :
      1. L'objectif principal de la recherche de l'utilisateur.
      2. Les 3 points clés ou informations importantes extraites des documents.
      3. Une conclusion brève ou une action suivante suggérée.

      DISCUSSION à RÉSUMER :
      ${historyString}
    `;

    const result = await model.generateContent(prompt);
    const summary = result.response.text();

    return NextResponse.json({ summary });

  } catch (error: any) {
    console.error("Erreur Synthèse:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}