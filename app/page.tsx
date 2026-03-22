"use client"; // Indispensable pour utiliser l'interactivité (useState, onClick) dans Next.js

import { useState, useRef } from "react";

export default function Home() {
  // La "mémoire" de notre page
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  
  // Une référence pour déclencher le clic sur l'input caché
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fonction déclenchée quand l'utilisateur choisit un fichier
  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadMessage("Lecture du PDF en cours par le serveur...");

    // 1. On emballe le fichier dans un "formulaire virtuel" (colis)
    const formData = new FormData();
    formData.append("file", file);

    try {
      // 2. On expédie le colis à notre route API (/api/upload)
      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      // 3. On met à jour l'interface selon la réponse du serveur
      if (response.ok) {
        setUploadMessage("✅ " + data.message);
      } else {
        setUploadMessage("❌ Erreur : " + data.error);
      }
    } catch (error) {
      setUploadMessage("❌ Impossible de joindre le serveur.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50 p-8 flex flex-col items-center font-sans">
      
      <header className="w-full max-w-5xl mb-12 text-center">
        <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
          DocuChat
        </h1>
        <p className="mt-3 text-neutral-400">
          Discutez intelligemment avec vos documents.
        </p>
      </header>

      <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-8">
        
        {/* Colonne de Gauche : Zone de Dépôt Interactive */}
        <div 
          onClick={() => fileInputRef.current?.click()} // Déclenche le clic sur l'input caché
          className={`border-2 border-dashed border-neutral-800 rounded-2xl p-8 flex flex-col items-center justify-center text-center transition-all cursor-pointer h-[500px]
            ${isUploading ? 'bg-neutral-800/50' : 'bg-neutral-900/30 hover:bg-neutral-900/80'}
          `}
        >
          {/* L'input natif HTML pour les fichiers, caché visuellement */}
          <input 
            type="file" 
            accept="application/pdf" 
            className="hidden" 
            ref={fileInputRef}
            onChange={handleFileChange}
          />

          <div className="text-5xl mb-4">{isUploading ? '⏳' : '📄'}</div>
          <h2 className="text-xl font-semibold mb-2">
            {isUploading ? 'Chargement...' : 'Cliquez pour ajouter un PDF'}
          </h2>
          <p className="text-sm text-neutral-500">
            {uploadMessage || "Format accepté : .pdf"}
          </p>
        </div>

        {/* Colonne de Droite : Zone de Chat */}
        <div className="border border-neutral-800 rounded-2xl bg-neutral-900/50 flex flex-col h-[500px] overflow-hidden">
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="bg-neutral-800 rounded-xl rounded-tl-none p-4 inline-block max-w-[85%] mb-4 text-sm text-neutral-200">
              Bonjour ! 👋 Chargez un document PDF à gauche pour commencer à me poser des questions.
            </div>
          </div>
          
          <div className="p-4 border-t border-neutral-800 bg-neutral-950/50 flex gap-3">
            <input 
              type="text" 
              placeholder="Posez une question sur le document..." 
              className="flex-1 bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
            />
            <button className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-xl text-sm font-semibold transition-colors">
              Envoyer
            </button>
          </div>
        </div>

      </div>
    </main>
  );
}