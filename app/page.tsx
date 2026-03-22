"use client";

import { useState, useRef, useEffect } from "react";
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
// Étape 1 : Import des icônes Lucide
import { 
  Plus, 
  Send, 
  Trash2, 
  FileText, 
  Globe, 
  LogOut, 
  Loader2,
  User,
  MessageSquare,
  Sparkles
} from 'lucide-react';

interface FileHistory {
  file_id: string;
  file_name: string;
}

export default function Home() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const [user, setUser] = useState<any>(null);
  const [files, setFiles] = useState<FileHistory[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null); 
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "ai"; text: string }[]>([]);
  const [input, setInput] = useState("");
  const [isLoadingChat, setIsLoadingChat] = useState(false);

  // 1. Auth & Session
  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/login');
      } else {
        setUser(session.user);
        fetchHistory();
      }
    };
    checkSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.push('/login');
      else setUser(session.user);
    });

    return () => subscription.unsubscribe();
  }, [router, supabase]);

  // 2. Historique
  const fetchHistory = async () => {
    const { data, error } = await supabase
      .from('documents')
      .select('file_id, file_name')
      .order('id', { ascending: false });

    if (data) {
      const uniqueFiles = data.filter((v, i, a) => 
        a.findIndex(t => t.file_id === v.file_id) === i
      );
      setFiles(uniqueFiles);
    }
  };

  // 3. Suppression
  const deleteFile = async (fileId: string) => {
    if (!confirm("Effacer ce document ?")) return;
    const { error } = await supabase.from('documents').delete().eq('file_id', fileId);
    if (!error) {
      if (selectedFileId === fileId) setSelectedFileId(null);
      fetchHistory();
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  // 4. Upload (Accepte PDF + Images)
  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadMessage("Analyse...");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api/upload", { method: "POST", body: formData });
      if (response.ok) {
        setUploadMessage("✅ Mémorisé !");
        fetchHistory(); 
      } else {
        setUploadMessage("❌ Erreur");
      }
    } catch (e) {
      setUploadMessage("❌ Erreur serveur");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // 5. CHAT AVEC STREAMING (La grande nouveauté)
  const handleSendMessage = async () => {
    if (!input.trim() || isLoadingChat) return;

    const userMsg = input;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text: userMsg }]);
    setIsLoadingChat(true);

    // On ajoute un message vide pour l'IA qu'on va remplir
    setMessages((prev) => [...prev, { role: "ai", text: "" }]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg, fileId: selectedFileId }),
      });

      if (!response.body) return;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        accumulatedText += chunk;
        
        // Mise à jour temps réel du dernier message
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1].text = accumulatedText;
          return updated;
        });
      }
    } catch (error) {
      setMessages((prev) => [...prev, { role: "ai", text: "Erreur de connexion." }]);
    } finally {
      setIsLoadingChat(false);
    }
  };

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages, isLoadingChat]);

  if (!user) return <div className="min-h-screen bg-neutral-950 flex items-center justify-center text-neutral-500">Authentification...</div>;

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50 flex font-sans">
      
      {/* --- SIDEBAR --- */}
      <aside className="w-72 border-r border-neutral-800 bg-neutral-900/40 flex flex-col p-6">
        <div className="mb-10">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent flex items-center gap-2">
            <MessageSquare className="text-blue-500 w-6 h-6" /> DocuChat
          </h1>
          <p className="text-[10px] text-neutral-500 uppercase tracking-widest mt-1 font-bold">Vibe Coder Edition</p>
        </div>

        <button 
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="w-full mb-8 py-3 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-800 rounded-2xl text-sm font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-900/20"
        >
          {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {isUploading ? "Analyse..." : "Nouveau PDF / Image"}
        </button>
        <input type="file" accept=".pdf,image/*" className="hidden" ref={fileInputRef} onChange={handleFileChange} />

        <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar">
          <p className="text-[11px] text-neutral-600 font-bold px-2 mb-4">BIBLIOTHÈQUE</p>
          
          <button 
            onClick={() => setSelectedFileId(null)}
            className={`w-full text-left px-4 py-3 rounded-xl text-sm transition-all flex items-center gap-3 ${!selectedFileId ? 'bg-blue-600/10 text-blue-400 border border-blue-900/30' : 'hover:bg-neutral-800/50 text-neutral-400'}`}
          >
            <Globe className="w-4 h-4" /> Vue globale
          </button>

          {files.map((f) => (
            <div key={f.file_id} className="group relative">
              <button 
                onClick={() => setSelectedFileId(f.file_id)}
                className={`w-full text-left px-4 py-3 rounded-xl text-xs truncate pr-10 transition-all flex items-center gap-3 ${selectedFileId === f.file_id ? 'bg-emerald-600/10 text-emerald-400 border border-emerald-900/30' : 'hover:bg-neutral-800/50 text-neutral-400'}`}
              >
                <FileText className="w-4 h-4" /> {f.file_name}
              </button>
              <button 
                onClick={(e) => { e.stopPropagation(); deleteFile(f.file_id); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 transition-all"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="pt-6 border-t border-neutral-800">
          <div className="flex items-center gap-3 mb-4 px-2">
            <div className="w-8 h-8 rounded-full bg-neutral-800 flex items-center justify-center border border-neutral-700">
              <User className="w-4 h-4 text-neutral-400" />
            </div>
            <p className="text-[10px] text-neutral-400 truncate font-medium flex-1">{user.email}</p>
          </div>
          <button onClick={handleLogout} className="w-full text-left px-2 text-xs text-red-500/80 hover:text-red-400 transition-colors flex items-center gap-2 font-bold">
            <LogOut className="w-4 h-4" /> Se déconnecter
          </button>
        </div>
      </aside>

      {/* --- CHAT AREA --- */}
      <section className="flex-1 flex flex-col h-screen bg-neutral-950">
        
        <header className="px-8 py-6 border-b border-neutral-900 flex justify-between items-center bg-neutral-950/80 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <Sparkles className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-neutral-200">
                {selectedFileId ? files.find(f => f.file_id === selectedFileId)?.file_name : "Intelligence Artificielle"}
              </h2>
              <p className="text-[10px] text-neutral-500 font-medium">Modèle Gemini 3.1 Flash Lite</p>
            </div>
          </div>
          {uploadMessage && <span className="text-[11px] font-bold text-blue-400 px-3 py-1 bg-blue-400/10 rounded-full animate-pulse border border-blue-400/20">{uploadMessage}</span>}
        </header>

        <div ref={chatContainerRef} className="flex-1 p-8 overflow-y-auto space-y-6">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center opacity-30">
              <div className="w-20 h-20 bg-neutral-900 rounded-3xl flex items-center justify-center text-4xl mb-6 shadow-inner">📂</div>
              <h3 className="text-lg font-bold">Prêt pour l'analyse</h3>
              <p className="text-sm max-w-xs mt-2">Choisissez un document ou posez une question globale sur votre savoir.</p>
            </div>
          )}

          {messages.map((msg, index) => (
            <div key={index} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`p-5 rounded-2xl text-sm max-w-[75%] leading-relaxed shadow-xl ${
                msg.role === "user" 
                ? "bg-blue-600 text-white rounded-tr-none" 
                : "bg-neutral-900 border border-neutral-800 text-neutral-200 rounded-tl-none"
              }`}>
                {msg.role === "user" ? (
                  msg.text
                ) : (
                  <div className="space-y-3">
                    <ReactMarkdown 
                      components={{
                        p: ({node, ...props}) => <p {...props} />,
                        ul: ({node, ...props}) => <ul className="list-disc ml-5 space-y-2 text-neutral-300" {...props} />,
                        ol: ({node, ...props}) => <ol className="list-decimal ml-5 space-y-2 text-neutral-300" {...props} />,
                        li: ({node, ...props}) => <li {...props} />,
                        strong: ({node, ...props}) => <strong className="font-bold text-emerald-400" {...props} />,
                      }}
                    >
                      {msg.text}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            </div>
          ))}

          {isLoadingChat && !messages[messages.length - 1]?.text && (
            <div className="flex justify-start">
              <div className="bg-neutral-900 border border-neutral-800 text-neutral-500 p-5 rounded-2xl rounded-tl-none text-xs flex items-center gap-3">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Réflexion...</span>
              </div>
            </div>
          )}
        </div>

        <div className="p-8 bg-gradient-to-t from-neutral-950 via-neutral-950 to-transparent">
          <div className="max-w-4xl mx-auto flex gap-4 bg-neutral-900 border border-neutral-800 rounded-2xl p-2 pr-4 shadow-2xl focus-within:border-blue-500 transition-all">
            <input 
              type="text" 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
              placeholder={selectedFileId ? "Interroger ce document..." : "Interroger ma bibliothèque..."}
              className="flex-1 bg-transparent border-none px-6 py-4 text-sm focus:outline-none placeholder:text-neutral-600"
            />
            <button 
              onClick={handleSendMessage}
              disabled={isLoadingChat || !input.trim()}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-30 text-white p-3 rounded-xl transition-all shadow-lg active:scale-95 flex items-center justify-center"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
          <p className="text-[9px] text-center text-neutral-700 mt-6 font-bold uppercase tracking-widest">
            Flux de données chiffré • Moteur RAG v3.1
          </p>
        </div>
      </section>

    </main>
  );
}