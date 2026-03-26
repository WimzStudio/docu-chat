"use client";

import { useState, useRef, useEffect } from "react";
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
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
  Sparkles,
  Pencil,
  Check,
  Download,
  Folder // NOUVEAU: icône pour les espaces
} from 'lucide-react';

interface FileHistory {
  file_id: string;
  file_name: string;
}

// NOUVEAU : Interface pour les espaces
interface Space {
  id: string;
  name: string;
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
  
  // NOUVEAU : États pour les Espaces (Workspaces)
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);
  const [isCreatingSpace, setIsCreatingSpace] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState("");

  // États d'édition
  const [editingFileId, setEditingFileId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "ai"; text: string }[]>([]);
  const [input, setInput] = useState("");
  const [isLoadingChat, setIsLoadingChat] = useState(false);
  
  // État pour le chargement du PDF
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) router.push('/login');
      else {
        setUser(session.user);
        fetchSpaces(); // NOUVEAU : On charge d'abord les espaces
      }
    };
    checkSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.push('/login');
      else setUser(session.user);
    });

    return () => subscription.unsubscribe();
  }, [router, supabase]);

  // NOUVEAU : Fonction pour récupérer les espaces
  const fetchSpaces = async () => {
    const { data } = await supabase.from('spaces').select('*').order('created_at', { ascending: false });
    if (data) {
      setSpaces(data);
      // Sélectionner le premier espace par défaut s'il existe
      if (data.length > 0 && !selectedSpaceId) {
        setSelectedSpaceId(data[0].id);
      }
    }
  };

  // NOUVEAU : Dès que l'espace change, on recharge les documents associés
  useEffect(() => {
    if (user) {
      setSelectedFileId(null); // On désélectionne le fichier actif
      fetchHistory();
    }
  }, [selectedSpaceId, user]);

  // NOUVEAU : Création d'un espace
  const handleCreateSpace = async () => {
    if (!newSpaceName.trim()) return;
    const { data, error } = await supabase.from('spaces').insert({ name: newSpaceName, user_id: user.id }).select();
    if (!error && data) {
      setSpaces([data[0], ...spaces]);
      setSelectedSpaceId(data[0].id);
      setNewSpaceName("");
      setIsCreatingSpace(false);
    }
  };

  // MODIFIÉ : Filtre les documents en fonction de l'espace sélectionné
  const fetchHistory = async () => {
    let query = supabase.from('documents').select('file_id, file_name, space_id').order('id', { ascending: false });
    
    if (selectedSpaceId) {
      query = query.eq('space_id', selectedSpaceId);
    } else {
      query = query.is('space_id', null);
    }

    const { data } = await query;
    if (data) {
      const uniqueFiles = data.filter((v, i, a) => a.findIndex(t => t.file_id === v.file_id) === i);
      setFiles(uniqueFiles);
    }
  };

  const deleteFile = async (fileId: string) => {
    if (!confirm("Effacer ce document ?")) return;
    const { error } = await supabase.from('documents').delete().eq('file_id', fileId);
    if (!error) {
      if (selectedFileId === fileId) setSelectedFileId(null);
      fetchHistory();
    }
  };

  const handleRename = async (fileId: string) => {
    if (!editName.trim()) {
      setEditingFileId(null);
      return;
    }
    
    const { error } = await supabase
      .from('documents')
      .update({ file_name: editName })
      .eq('file_id', fileId);

    if (!error) {
      setFiles(files.map(f => f.file_id === fileId ? { ...f, file_name: editName } : f));
    } else {
      console.error("Erreur lors du renommage :", error);
    }
    setEditingFileId(null);
  };

  const startEditing = (f: FileHistory, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditName(f.file_name);
    setEditingFileId(f.file_id);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  // MODIFIÉ : Gestion stricte des erreurs d'upload pour le débogage
  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || []);
    if (selectedFiles.length === 0) return;

    setIsUploading(true);
    setUploadMessage(`Synchronisation Cloud en cours...`);

    try {
      for (const file of selectedFiles) {
        // 1. On force la synchronisation via FileReader (plus robuste pour OneDrive)
        const content = await new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.onerror = reject;
          reader.readAsArrayBuffer(file);
        });

        if (content.byteLength === 0) {
          throw new Error(`Le fichier "${file.name}" est encore en ligne. Ouvrez-le une fois pour le synchroniser.`);
        }

        // 2. Micro-pause (300ms) pour laisser l'OS gérer le flux de données
        await new Promise(resolve => setTimeout(resolve, 300));

        const formData = new FormData();
        // On envoie le Blob créé à partir du contenu synchronisé
        const blob = new Blob([content], { type: file.type });
        formData.append("file", blob, file.name);
        
        if (selectedSpaceId) {
          formData.append("spaceId", selectedSpaceId);
        }
        
        const response = await fetch("/api/upload", { 
          method: "POST", 
          body: formData 
        });
        
        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error || "Erreur serveur");
        }
      }
      
      setUploadMessage("✅ Tout est synchronisé !");
      fetchHistory(); 
    } catch (e: any) {
      setUploadMessage(`❌ ${e.message}`);
      console.error("Détail upload:", e);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleExportPDF = async () => {
    if (messages.length === 0 || isExporting) return;
    setIsExporting(true);

    try {
      const res = await fetch("/api/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      });
      const { summary } = await res.json();

      const doc = new jsPDF();
      const fileName = selectedFileId ? files.find(f => f.file_id === selectedFileId)?.file_name : "Vue globale";

      doc.setFontSize(18);
      doc.setTextColor(40);
      doc.text("Compte-rendu DocuChat", 14, 22);
      
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.text(`Document : ${fileName}`, 14, 30);
      doc.text(`Date : ${new Date().toLocaleDateString()}`, 14, 35);

      doc.setFontSize(14);
      doc.setTextColor(0, 102, 204);
      doc.text("RÉSUMÉ DÉCISIONNEL (IA)", 14, 50);
      
      doc.setFontSize(10);
      doc.setTextColor(50);
      const splitSummary = doc.splitTextToSize(summary || "Synthèse indisponible.", 180);
      doc.text(splitSummary, 14, 60);

      const startY = 60 + (splitSummary.length * 5) + 10;
      doc.setFontSize(14);
      doc.setTextColor(0, 102, 204);
      doc.text("DÉTAIL DES ÉCHANGES", 14, startY);

      const tableData = messages.map(m => [
        m.role === 'user' ? 'UTILISATEUR' : 'DOCUCHAT AI',
        m.text
      ]);

      autoTable(doc, {
        startY: startY + 5,
        head: [['Intervenant', 'Message']],
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: [0, 102, 204] },
        styles: { fontSize: 9, cellPadding: 4 },
        columnStyles: { 0: { cellWidth: 35 }, 1: { cellWidth: 'auto' } }
      });

      doc.save(`DocuChat_Export_${new Date().getTime()}.pdf`);
    } catch (error) {
      console.error("Erreur Export:", error);
      alert("Erreur lors de la génération du PDF.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleSendMessage = async () => {
    if (!input.trim() || isLoadingChat) return;

    const userMsg = input;
    setInput("");
    
    const currentHistory = [...messages];
    
    setMessages((prev) => [...prev, { role: "user", text: userMsg }]);
    setIsLoadingChat(true);

    setMessages((prev) => [...prev, { role: "ai", text: "" }]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // MODIFIÉ : On injecte l'espace actif pour le filtre RAG
        body: JSON.stringify({ 
          message: userMsg, 
          fileId: selectedFileId,
          spaceId: selectedSpaceId,
          history: currentHistory 
        }),
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
      
      <aside className="w-80 border-r border-neutral-800 bg-neutral-900/40 flex flex-col p-6">
        <div className="mb-8">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent flex items-center gap-2">
            <MessageSquare className="text-blue-500 w-6 h-6" /> DocuChat
          </h1>
          <p className="text-[10px] text-neutral-500 uppercase tracking-widest mt-1 font-bold">Vibe Coder Edition</p>
        </div>

        {/* NOUVEAU : GESTION DES ESPACES */}
        <div className="mb-6 bg-neutral-900/60 p-3 rounded-2xl border border-neutral-800/50">
          <div className="flex items-center justify-between mb-3 px-1">
            <p className="text-[11px] text-neutral-400 font-bold uppercase tracking-tighter flex items-center gap-2">
              <Folder className="w-3.5 h-3.5" /> Workspaces
            </p>
            <button 
              onClick={() => setIsCreatingSpace(!isCreatingSpace)} 
              className="text-blue-400 hover:text-blue-300 transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          
          {isCreatingSpace && (
            <div className="flex items-center gap-2 mb-3">
              <input 
                type="text" 
                value={newSpaceName} 
                onChange={e => setNewSpaceName(e.target.value)} 
                onKeyDown={e => e.key === 'Enter' && handleCreateSpace()} 
                placeholder="Nom du dossier..." 
                className="flex-1 bg-neutral-950 text-xs px-3 py-2 rounded-xl border border-neutral-700 outline-none text-white focus:border-blue-500 transition-all" 
                autoFocus 
              />
              <button 
                onClick={handleCreateSpace} 
                className="text-emerald-400 hover:bg-emerald-400/10 p-2 rounded-lg transition-colors"
              >
                <Check className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="relative">
            <select 
              value={selectedSpaceId || ""} 
              onChange={(e) => setSelectedSpaceId(e.target.value || null)}
              className="w-full bg-neutral-950 text-neutral-300 text-xs font-medium rounded-xl px-3 py-2.5 outline-none border border-neutral-800 focus:border-blue-500/50 appearance-none cursor-pointer"
            >
              <option value="">Général (Sans espace)</option>
              {spaces.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        </div>

        <button 
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="w-full mb-6 py-3 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-800 rounded-2xl text-sm font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-900/20"
        >
          {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {isUploading ? "Analyse..." : "Ajouter au Workspace"}
        </button>
        <input type="file" multiple className="hidden" ref={fileInputRef} onChange={handleFileChange} />

        <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar">
          <p className="text-[11px] text-neutral-600 font-bold px-2 mb-4">DOCUMENTS DU WORKSPACE</p>
          
          <button 
            onClick={() => setSelectedFileId(null)}
            className={`w-full text-left px-4 py-3 rounded-xl text-sm transition-all flex items-center gap-3 ${!selectedFileId ? 'bg-blue-600/10 text-blue-400 border border-blue-900/30' : 'hover:bg-neutral-800/50 text-neutral-400'}`}
          >
            <Globe className="w-4 h-4" /> Discuter avec tout
          </button>

          {files.map((f) => (
            <div key={f.file_id} className="group relative flex items-center w-full">
              {editingFileId === f.file_id ? (
                <div className="flex w-full items-center gap-2 px-2 py-2 bg-neutral-800/80 rounded-xl border border-blue-500/50">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleRename(f.file_id)}
                    className="flex-1 bg-transparent text-xs text-white outline-none"
                    autoFocus
                  />
                  <button onClick={() => handleRename(f.file_id)} className="text-emerald-400 hover:text-emerald-300">
                    <Check className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <>
                  <button 
                    onClick={() => setSelectedFileId(f.file_id)}
                    className={`flex-1 text-left px-4 py-3 rounded-xl text-xs truncate transition-all flex items-center gap-3 ${selectedFileId === f.file_id ? 'bg-emerald-600/10 text-emerald-400 border border-emerald-900/30' : 'hover:bg-neutral-800/50 text-neutral-400'}`}
                  >
                    <FileText className="w-4 h-4 shrink-0" /> 
                    <span className="truncate pr-16">{f.file_name}</span>
                  </button>
                  
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all bg-neutral-900/80 backdrop-blur-sm p-1 rounded-lg">
                    <button 
                      onClick={(e) => startEditing(f, e)}
                      className="p-1.5 text-blue-400 hover:text-blue-300 hover:bg-blue-400/10 rounded-md transition-colors"
                      title="Renommer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button 
                      onClick={(e) => { e.stopPropagation(); deleteFile(f.file_id); }}
                      className="p-1.5 text-red-400 hover:text-red-300 hover:bg-red-400/10 rounded-md transition-colors"
                      title="Supprimer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </>
              )}
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

      <section className="flex-1 flex flex-col h-screen bg-neutral-950">
        
        <header className="px-8 py-6 border-b border-neutral-900 flex justify-between items-center bg-neutral-950/80 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <Sparkles className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-neutral-200">
                {selectedFileId ? files.find(f => f.file_id === selectedFileId)?.file_name : (selectedSpaceId ? spaces.find(s => s.id === selectedSpaceId)?.name : "Intelligence Artificielle")}
              </h2>
              <p className="text-[10px] text-neutral-500 font-medium">Modèle Gemini 3.1 Flash Lite</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {messages.length > 0 && (
              <button 
                onClick={handleExportPDF}
                disabled={isExporting}
                className="flex items-center gap-2 px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-bold rounded-xl border border-neutral-700 transition-all disabled:opacity-50 shadow-lg"
              >
                {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                {isExporting ? "Génération PDF..." : "Exporter Synthèse"}
              </button>
            )}
            {uploadMessage && <span className="text-[11px] font-bold text-blue-400 px-3 py-1 bg-blue-400/10 rounded-full animate-pulse border border-blue-400/20">{uploadMessage}</span>}
          </div>
        </header>

        <div ref={chatContainerRef} className="flex-1 p-8 overflow-y-auto space-y-6">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center opacity-30">
              <div className="w-20 h-20 bg-neutral-900 rounded-3xl flex items-center justify-center text-4xl mb-6 shadow-inner">📂</div>
              <h3 className="text-lg font-bold">Workspace prêt</h3>
              <p className="text-sm max-w-xs mt-2">Posez une question sur les documents de cet espace ou choisissez un fichier précis.</p>
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
              placeholder={selectedFileId ? "Interroger ce document..." : "Interroger le Workspace..."}
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