"use client";

import {
  ArrowRight,
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  FileText,
  FolderClosed,
  Globe2,
  Library,
  LoaderCircle,
  LogOut,
  Menu,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";

type User = { id: string; email: string };
type DocumentItem = { id: string; name: string; chunks: number; created_at: string };
type Conversation = { id: string; title: string; created_at: string };
type Citation = { document: string; page: number; text: string };
type Message = { role: "user" | "assistant"; content: string; sources?: Citation[] };

const suggestions = [
  { icon: BookOpen, title: "Give me the overview", detail: "Summarize my documents in a few key points." },
  { icon: Search, title: "Find the details", detail: "What should I know about a specific topic?" },
  { icon: Sparkles, title: "Connect the dots", detail: "Find themes and insights across my files." },
];

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeConversation, setActiveConversation] = useState("");
  const [prompt, setPrompt] = useState("");
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("register");
  const [authError, setAuthError] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [chatError, setChatError] = useState("");
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [activeTab, setActiveTab] = useState<"documents" | "sources">("documents");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  async function loadWorkspace() {
    const response = await fetch("/api/auth/me");
    if (!response.ok) return;
    const data = await response.json();
    if (!data.user) return;
    setUser(data.user);
    const [docs, chats] = await Promise.all([
      fetch("/api/documents").then((r) => r.ok ? r.json() : { documents: [] }),
      fetch("/api/conversations").then((r) => r.ok ? r.json() : { conversations: [] }),
    ]);
    setDocuments(docs.documents);
    setConversations(chats.conversations);
  }

  useEffect(() => { void loadWorkspace(); }, []);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function openConversation(conversation: Conversation) {
    setActiveConversation(conversation.id);
    setMessages([]);
    setChatError("");
    try {
      const response = await fetch(`/api/conversations/${conversation.id}/messages`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Couldn't open this conversation.");
      setMessages(data.messages);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Couldn't open this conversation.");
    }
  }

  function newConversation() {
    setActiveConversation("");
    setMessages([]);
    setChatError("");
    setMobileMenu(false);
  }

  async function uploadFiles(event: ChangeEvent<HTMLInputElement>) {
    if (!user) {
      setAuthOpen(true);
      setAuthError("");
      return;
    }
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    setUploading(true);
    setChatError("");
    try {
      for (const file of files) {
        const form = new FormData();
        form.append("file", file);
        const response = await fetch("/api/documents", { method: "POST", body: form });
        const result = await response.json();
        if (!response.ok) {
          setChatError(result.error || `Couldn't upload ${file.name}.`);
          break;
        }
        setDocuments((current) => [result.document, ...current]);
      }
    } catch {
      setChatError("The upload couldn't be completed. Check your connection and try again.");
    } finally {
      setUploading(false);
    }
  }

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const question = prompt.trim();
    if (!question || loading) return;
    if (!user) {
      setAuthMode("register");
      setAuthError("");
      setAuthOpen(true);
      return;
    }
    if (!documents.length) {
      setChatError("Upload a PDF to your library before asking a question.");
      fileRef.current?.click();
      return;
    }

    setPrompt("");
    setChatError("");
    setLoading(true);
    setMessages((current) => [...current, { role: "user", content: question }, { role: "assistant", content: "" }]);
    let conversationId = activeConversation;
    try {
      if (!conversationId) {
        const created = await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: question.slice(0, 72) }),
        });
        if (!created.ok) throw new Error((await created.json()).error || "Couldn't create a conversation.");
        const data = await created.json();
        conversationId = data.conversation.id;
        setActiveConversation(conversationId);
        setConversations((current) => [data.conversation, ...current]);
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, question }),
      });
      if (!response.ok || !response.body) {
        const data = await response.json();
        throw new Error(data.error || "Couldn't get an answer.");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = "";
      let sources: Citation[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const event of events) {
          const line = event.split("\n").find((part) => part.startsWith("data: "));
          if (!line) continue;
          const payload = JSON.parse(line.slice(6));
          if (payload.type === "delta") {
            answer += payload.text;
            setMessages((current) => current.map((message, index) =>
              index === current.length - 1 ? { ...message, content: answer, sources } : message));
          } else if (payload.type === "sources") {
            sources = payload.sources;
            setMessages((current) => current.map((message, index) =>
              index === current.length - 1 ? { ...message, sources } : message));
          } else if (payload.type === "error") {
            throw new Error(payload.message);
          }
        }
      }
      await loadWorkspace();
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Something went wrong.");
      setMessages((current) => current[current.length - 1]?.content
        ? current
        : current.slice(0, -1));
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError("");
    const form = new FormData(event.currentTarget);
    const endpoint = authMode === "register" ? "/api/auth/register" : "/api/auth/login";
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      const data = await response.json();
      if (!response.ok) {
        setAuthError(data.error || "Couldn't sign you in.");
        return;
      }
      setAuthOpen(false);
      await loadWorkspace();
    } catch {
      setAuthError("Couldn't reach the server. Check your connection and try again.");
    }
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    setDocuments([]);
    setConversations([]);
    setMessages([]);
    setActiveConversation("");
  }

  async function deleteDocument(id: string) {
    try {
      const response = await fetch(`/api/documents?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json();
        setChatError(data.error || "Couldn't remove this document.");
        return;
      }
      setDocuments((current) => current.filter((doc) => doc.id !== id));
    } catch {
      setChatError("Couldn't remove this document. Check your connection and try again.");
    }
  }

  const hasMessages = messages.length > 0;

  return (
    <main className={`app-shell ${mobileMenu ? "menu-open" : ""}`}>
      <aside className="sidebar">
        <div className="brand-row">
          <a className="brand" href="#" onClick={(event) => { event.preventDefault(); newConversation(); }}>
            <span className="brand-mark"><span /><span /><span /><span /></span>
            <span>quill<span className="brand-period">.</span></span>
          </a>
          <button className="icon-button sidebar-collapse" aria-label="Close menu" onClick={() => setMobileMenu(false)}><ChevronLeft size={18} /></button>
        </div>

        <button className="new-chat-button" onClick={newConversation}><Plus size={17} strokeWidth={2.2} /><span>New conversation</span><kbd>⌘ K</kbd></button>

        <div className="sidebar-section">
          <p className="section-label">WORKSPACE</p>
          <button className="nav-item active-nav"><MessageSquare size={16} /><span>Ask your documents</span></button>
          <button className="nav-item" onClick={() => setActiveTab("documents")}><Library size={16} /><span>All documents</span><span className="nav-count">{documents.length || ""}</span></button>
        </div>

        <div className="sidebar-section history-section">
          <button className="section-toggle" onClick={() => setHistoryOpen(!historyOpen)}><span className="section-label">RECENT</span><ChevronDown size={14} className={historyOpen ? "" : "rotated"} /></button>
          {historyOpen && (conversations.length ? conversations.slice(0, 8).map((chat) => (
            <button key={chat.id} className={`history-item ${activeConversation === chat.id ? "history-active" : ""}`} onClick={() => void openConversation(chat)}>
              <MessageSquare size={14} /><span>{chat.title}</span>
            </button>
          )) : <p className="empty-history">Your conversations will show up here.</p>)}
        </div>

        <div className="sidebar-bottom">
          <div className="privacy-card"><ShieldCheck size={16} /><div><strong>Your space, your data.</strong><span>Your documents are private to your account.</span></div></div>
          <button className="profile-row" onClick={() => user ? void signOut() : (setAuthMode("login"), setAuthOpen(true))}>
            <span className="avatar">{user ? user.email[0].toUpperCase() : <Globe2 size={16} />}</span>
            <span className="profile-copy"><strong>{user ? user.email.split("@")[0] : "Welcome to Quill"}</strong><span>{user ? user.email : "Sign in or create an account"}</span></span>
            {user ? <LogOut size={16} className="profile-action" /> : <ArrowRight size={16} className="profile-action" />}
          </button>
        </div>
      </aside>

      <section className="main-column">
        <header className="topbar">
          <button className="icon-button mobile-menu-button" aria-label="Open menu" onClick={() => setMobileMenu(true)}><Menu size={20} /></button>
          <div className="breadcrumb"><span>Workspace</span><span className="breadcrumb-slash">/</span><strong>{hasMessages ? "Conversation" : "Ask"}</strong></div>
          <div className="topbar-actions">
            {user ? <span className="secure-indicator"><span className="secure-dot" />Private workspace</span> : <button className="signin-link" onClick={() => { setAuthMode("login"); setAuthOpen(true); }}>Sign in <ArrowRight size={14} /></button>}
          </div>
        </header>

        <div className={`chat-area ${hasMessages ? "chat-area-active" : ""}`}>
          {!hasMessages ? (
            <div className="welcome">
              <div className="eyebrow"><span className="eyebrow-line" />YOUR THINKING, AMPLIFIED<span className="eyebrow-line" /></div>
              <h1>Good questions.<br /><span>Thoughtful answers.</span></h1>
              <p className="welcome-subtitle">Your documents have a lot to say. Ask anything, and find the answers hiding in your files.</p>
              <div className="suggestion-grid">
                {suggestions.map(({ icon: Icon, title, detail }) => (
                  <button className="suggestion-card" key={title} onClick={() => { setPrompt(detail); inputRef.current?.focus(); }}>
                    <span className="suggestion-icon"><Icon size={17} strokeWidth={1.8} /></span>
                    <span className="suggestion-title">{title}</span><span className="suggestion-detail">{detail}</span>
                    <ArrowRight size={15} className="suggestion-arrow" />
                  </button>
                ))}
              </div>
              {!user && <button className="welcome-note" onClick={() => { setAuthMode("register"); setAuthOpen(true); }}><Sparkles size={14} />Create a free account to get started <ArrowRight size={13} /></button>}
            </div>
          ) : (
            <div className="message-list">
              {messages.map((message, index) => (
                <article className={`message message-${message.role}`} key={`${index}-${message.role}`}>
                  {message.role === "assistant" ? <div className="assistant-avatar"><span className="brand-mark small-mark"><span /><span /><span /><span /></span></div> : <span className="user-avatar">{user?.email[0].toUpperCase() ?? "Y"}</span>}
                  <div className="message-content"><span className="message-author">{message.role === "assistant" ? "Quill" : "You"}</span>
                    <p>{message.content || (loading ? <span className="thinking"><span /><span /><span /></span> : "")}</p>
                    {message.sources?.length ? <div className="citation-list"><span className="citation-label">SOURCES</span>{message.sources.map((source, i) => <button key={`${source.document}-${source.page}-${i}`} className="citation-chip" onClick={() => setActiveTab("sources")}><FileText size={13} />{source.document}<span>p. {source.page}</span></button>)}</div> : null}
                    {message.role === "assistant" && message.content && !loading && <div className="answer-actions"><button onClick={() => void navigator.clipboard?.writeText(message.content)}><Check size={13} /> Copy answer</button><span>Grounded in your library</span></div>}
                  </div>
                </article>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
          <div className="composer-wrap">
            {chatError && <div className="chat-error"><span>{chatError}</span><button onClick={() => setChatError("")} aria-label="Dismiss"><X size={14} /></button></div>}
            <form className="composer" onSubmit={(event) => void sendMessage(event)}>
              <textarea ref={inputRef} rows={1} value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder="Ask anything about your documents..." aria-label="Ask a question" />
              <div className="composer-footer"><span className="composer-hint"><Sparkles size={13} />Answers cite your sources</span><div className="composer-controls">
                <button type="button" className="attach-button" onClick={() => user ? fileRef.current?.click() : setAuthOpen(true)} aria-label="Attach a PDF"><Plus size={16} /></button>
                <button type="submit" className="send-button" aria-label="Send message" disabled={loading || !prompt.trim()}>{loading ? <LoaderCircle size={16} className="spin" /> : <ArrowUp size={17} strokeWidth={2.4} />}</button>
              </div></div>
            </form>
            <p className="disclaimer">Quill can make mistakes. Check important details against the original document.</p>
          </div>
        </div>
      </section>

      <aside className="library-panel">
        <div className="panel-heading"><div><span className="panel-kicker">YOUR KNOWLEDGE BASE</span><h2>Library</h2></div><button className="icon-button panel-menu" aria-label="Library options" onClick={() => setLibraryOpen(!libraryOpen)}><MoreHorizontal size={18} /></button></div>
        <div className="panel-tabs"><button className={activeTab === "documents" ? "tab-active" : ""} onClick={() => setActiveTab("documents")}>Documents <span>{documents.length}</span></button><button className={activeTab === "sources" ? "tab-active" : ""} onClick={() => setActiveTab("sources")}>Sources {hasMessages && <span>{messages[messages.length - 1]?.sources?.length ?? 0}</span>}</button></div>
        {libraryOpen && <>
          {activeTab === "documents" ? <>
            <div className="library-intro"><span className="folder-icon"><FolderClosed size={17} /></span><div><strong>My documents</strong><span>{documents.length} {documents.length === 1 ? "file" : "files"} in your library</span></div><ChevronDown size={14} className="library-chevron" /></div>
            {documents.length ? <div className="document-list">{documents.map((doc) => <div className="document-row" key={doc.id}>
              <span className="pdf-icon"><FileText size={17} /></span><span className="document-info"><strong title={doc.name}>{doc.name}</strong><span>{doc.chunks} chunks · PDF</span></span><button className="document-delete" aria-label={`Remove ${doc.name}`} title="Remove document" onClick={() => void deleteDocument(doc.id)}><X size={14} /></button>
            </div>)}</div> : <div className="empty-library"><div className="empty-illustration"><span className="paper paper-back" /><span className="paper paper-front"><FileText size={20} /></span><span className="empty-sparkle"><Sparkles size={13} /></span></div><strong>A little light reading?</strong><p>Add your first PDF to give Quill something to think about.</p></div>}
            <button className="upload-button" disabled={uploading} onClick={() => user ? fileRef.current?.click() : setAuthOpen(true)}>{uploading ? <LoaderCircle size={16} className="spin" /> : <Upload size={16} />}<span>{uploading ? "Reading your files..." : "Upload a PDF"}</span><Plus size={16} className="upload-plus" /></button>
            <p className="upload-footnote">PDF files up to 20 MB</p>
          </> : <div className="source-panel">{hasMessages && messages[messages.length - 1]?.sources?.length ? messages[messages.length - 1].sources?.map((source, index) => <div className="source-card" key={`${source.document}-${index}`}><span className="source-number">{String(index + 1).padStart(2, "0")}</span><div><strong>{source.document}</strong><span>Page {source.page}</span><p>{source.text}</p></div></div>) : <div className="source-empty"><Search size={20} /><strong>No sources just yet</strong><span>Relevant passages will appear here when you ask a question.</span></div>}</div>}
          </>
        }
        <div className="panel-bottom"><div className="storage-heading"><span>LIBRARY STATUS</span><span>{documents.length ? "Indexed" : "Waiting for files"}</span></div><div className="storage-bar"><span style={{ width: documents.length ? "100%" : "0%" }} /></div><p><ShieldCheck size={13} /> Your documents are only visible to you.</p></div>
      </aside>

      <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(event) => void uploadFiles(event)} />
      {authOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setAuthOpen(false); }}>
        <div className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title"><button className="modal-close icon-button" onClick={() => setAuthOpen(false)} aria-label="Close"><X size={18} /></button>
          <span className="auth-mark"><span className="brand-mark"><span /><span /><span /><span /></span></span>
          <h2 id="auth-title">{authMode === "register" ? "A clearer way to think." : "Welcome back."}</h2>
          <p>{authMode === "register" ? "Create your private workspace and start asking better questions." : "Sign in to pick up where you left off."}</p>
          <form onSubmit={(event) => void submitAuth(event)}><label htmlFor="email">Email address</label><input id="email" type="email" name="email" placeholder="you@example.com" required autoComplete="email" /><label htmlFor="password">Password</label><input id="password" type="password" name="password" placeholder="At least 8 characters" required minLength={8} autoComplete={authMode === "register" ? "new-password" : "current-password"} />
            {authError && <div className="auth-error">{authError}</div>}<button className="auth-submit" type="submit">{authMode === "register" ? "Create your account" : "Sign in"}<ArrowRight size={16} /></button></form>
          <div className="auth-switch">{authMode === "register" ? "Already have an account?" : "New to Quill?"}<button onClick={() => { setAuthMode(authMode === "register" ? "login" : "register"); setAuthError(""); }}>{authMode === "register" ? "Sign in" : "Create an account"}</button></div>
          <div className="auth-privacy"><ShieldCheck size={14} />Only your account can access your library.</div>
        </div>
      </div>}
    </main>
  );
}
