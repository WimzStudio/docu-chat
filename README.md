# 🚀 DocuChat - Assistant PDF Intelligent & Agentique (RAG)

**DocuChat** est une plateforme SaaS de pointe utilisant l'architecture **RAG** (Retrieval-Augmented Generation) optimisée pour la gamme **Gemini 3**. Elle permet d'indexer, de rechercher et de raisonner sur vos documents PDF avec une précision inédite.

## 🌐 Version Live

Testez la démo ici : [https://docu-chat-alpha.vercel.app/login](https://docu-chat-alpha.vercel.app/login)

## ⚠️ Confidentialité & Sécurité

> [\!CAUTION]
> **API Free Tier** : Les données traitées via le palier gratuit de Google AI Studio peuvent être utilisées pour l'entraînement des modèles.
> **Données Sensibles** : Pour une confidentialité totale, utilisez un compte **Google Cloud Vertex AI** ou un plan **Pay-as-you-go** avec les modèles Gemini 3.1. Ne téléversez jamais de documents hautement confidentiels sur la version de test.

## ✨ Intelligence & Modèles (Gamme 2026)

L'application est conçue pour être modulaire et supporte les dernières avancées de l'IA :

### 🔹 Modèles de la Démo (Tiers Gratuit)

  - **Raisonnement** : `gemini-3.1-flash-lite` (Le meilleur rapport vitesse/performance pour le chat fluide).
  - **Indexation** : `gemini-embedding-2 (preview)` (Premier modèle multimodal capable de mapper texte et PDF dans un espace unifié).

### 🔹 Options pour Utilisateurs Pro (Tiers Payant)

Les utilisateurs possédant une clé API Premium peuvent configurer l'application pour utiliser :

  - **`gemini-3.1-pro`** : Pour l'analyse de documents complexes, le codage agentique et les raisonnements de haut niveau.
  - **`gemini-deep-research`** : Pour générer des rapports complets basés sur des centaines de sources documentaires.
  - **`gemini-3-flash`** : Pour des traitements massifs de documents à ultra-faible latence.

## 🛠️ Stack Technique

  - **Framework** : Next.js 16 (App Router + Turbopack).
  - **Base de données** : Supabase (PostgreSQL + `pgvector`).
  - **Authentification** : Supabase Auth (Magic Link & Session persistante).
  - **SDK IA** : Google Generative AI SDK (Optimisé pour Gemini 3.1).

-----

## 🚀 Guide de Déploiement Rapide

### 1\. Préparation Supabase

Exécutez le script suivant dans votre **SQL Editor** :

```sql
-- Activation de l'IA Vectorielle
create extension if not exists vector;

-- Table des documents optimisée
create table if not exists documents (
  id bigint primary key generated always as identity,
  content text,
  metadata jsonb,
  embedding vector(768), -- Dimension pour Gemini Embedding 2
  user_id uuid references auth.users(id),
  file_id uuid,
  file_name text
);

-- RLS (Row Level Security)
alter table documents enable row level security;
create policy "User isolation" on documents for all using (auth.uid() = user_id);

-- Fonction de recherche sémantique
create or replace function match_documents (
  query_embedding vector(768),
  match_threshold float,
  match_count int,
  filter_user_id uuid,
  filter_file_id uuid default null
)
returns table (id bigint, content text, metadata jsonb, similarity float)
language plpgsql as $$
begin
  return query
  select d.id, d.content, d.metadata, 1 - (d.embedding <=> query_embedding) as similarity
  from documents d
  where 1 - (d.embedding <=> query_embedding) > match_threshold
  and d.user_id = filter_user_id
  and (filter_file_id is null or d.file_id = filter_file_id)
  order by similarity desc limit match_count;
end; $$;
```

### 2\. Variables d'Environnement (`.env.local`)

```env
NEXT_PUBLIC_SUPABASE_URL=https://votre-projet.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=votre_cle_publique
GOOGLE_GENERATIVE_AI_API_KEY=votre_cle_gemini_3
```

### 3\. Installation

```bash
npm install
npm run dev
```

-----

## 📄 Licence

Projet distribué sous licence MIT. Libre à vous de l'adapter pour des usages professionnels ou de recherche.