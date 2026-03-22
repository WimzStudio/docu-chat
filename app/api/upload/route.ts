import { NextResponse } from 'next/server';
import { extractText } from 'unpdf';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: "Aucun fichier reçu." }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(buffer);

    const { text } = await extractText(uint8Array);
    
    // Sécurité : on transforme en string si c'est un tableau
    const fullText = Array.isArray(text) ? text.join(' ') : text;

    console.log("--- 🎉 VICTOIRE TOTALE : NOUVEAU PDF REÇU ET LU 🎉 ---");
    console.log("Aperçu :", fullText.substring(0, 300), "...");
    console.log("------------------------------------------------------");

    return NextResponse.json({ 
      success: true, 
      message: "PDF lu avec succès par le serveur !" 
    });

  } catch (error) {
    console.error("Erreur fatale :", error);
    return NextResponse.json({ error: "Impossible de lire le document." }, { status: 500 });
  }
}