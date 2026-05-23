"use client";

import { useChat } from "@ai-sdk/react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { ModelSelector } from "@/components/model-selector";
import {
  ArrowUpIcon,
  PlusIcon,
  SearchIcon,
  BookOpenIcon,
  FileTextIcon,
  GlobeIcon,
  CopyIcon,
  CheckIcon,
  ThumbsUpIcon,
  ThumbsDownIcon,
  GithubIcon,
  UserPlusIcon,
  Loader2Icon,
  XIcon,
  PencilIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { DEFAULT_MODEL, type SupportedModel } from "@/lib/constants";
import Image from "next/image";
import { useState, useEffect, useRef, useCallback } from "react";
import type { UIMessage } from "@ai-sdk/react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Streamdown } from "streamdown";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type PersonaSummary = {
  id: string;
  name: string;
  description: string;
  avatarUrl?: string;
  voicePrompt: string;
  documentLabel: string;
  examplePrompts: string[];
  documentCount: number;
  indexed: boolean;
};

type SourceDocumentDraft = {
  title?: string;
  content: string;
  url?: string;
};

const fallbackPersona: PersonaSummary = {
  id: "paul-graham",
  name: "Paul Graham",
  description: "Grounded in 220+ Paul Graham essays.",
  avatarUrl: "/pg.png",
  voicePrompt:
    "Direct and concise, like Paul Graham. Short sentences. Concrete examples. Avoid corporate speak, jargon, and hedging.",
  documentLabel: "essays",
  examplePrompts: [
    "What is Collison installation?",
    "Why did hackers avoid building Stripe?",
    "When to bootstrap vs take funding?",
    "How to calculate default alive?",
  ],
  documentCount: 0,
  indexed: true,
};

const neutralPrompts = [
  "What are this persona's core ideas?",
  "What would this persona say about making decisions?",
  "Summarize the strongest themes in the sources.",
  "What advice does this persona repeat most?",
];

const toolIcons: Record<string, React.ReactNode> = {
  multiSearchEssays: <SearchIcon className="h-3 w-3" />,
  searchEssays: <SearchIcon className="h-3 w-3" />,
  browseEssays: <BookOpenIcon className="h-3 w-3" />,
  listDirectory: <FileTextIcon className="h-3 w-3" />,
  readEssay: <FileTextIcon className="h-3 w-3" />,
  grepEssays: <SearchIcon className="h-3 w-3" />,
  webSearch: <GlobeIcon className="h-3 w-3" />,
};

const toolDisplayNames: Record<string, string> = {
  multiSearchEssays: "Searching sources (multi-query)",
  searchEssays: "Searching sources",
  browseEssays: "Browsing sources",
  listDirectory: "Listing directory",
  readEssay: "Reading source",
  grepEssays: "Pattern search",
  webSearch: "Web search",
};

function ToolInvocation({ toolType, toolName, state, input }: { 
  toolType: string;
  toolName?: string;
  state?: string;
  input?: unknown;
}) {
  // Extract tool name from type (e.g., "tool-searchEssays" -> "searchEssays")
  const resolvedToolName = toolName || toolType.replace("tool-", "");
  const displayName = toolDisplayNames[resolvedToolName] || resolvedToolName;
  const defaultIcon = <SearchIcon className="h-3 w-3" />;
  const icon: React.ReactNode = resolvedToolName in toolIcons ? toolIcons[resolvedToolName] : defaultIcon;
  
  // Get query/path from input for context
  const inputObj = input as Record<string, unknown> | undefined;
  const queries = inputObj?.queries;
  const rawContext =
    inputObj?.query ||
    inputObj?.path ||
    inputObj?.pattern ||
    (Array.isArray(queries) ? queries.join(" | ") : undefined);
  const inputContext = rawContext ? String(rawContext) : null;

  if (state === "output-available") {
    return (
      <div className="text-xs flex items-center gap-1.5 py-1.5 px-2 border border-border bg-muted/40 my-1">
        <span className="text-foreground">{icon}</span>
        <span className="font-medium text-foreground">{displayName}</span>
        {inputContext && <span className="text-muted-foreground/60 truncate max-w-[200px]">&ldquo;{inputContext}&rdquo;</span>}
        <span className="text-muted-foreground ml-auto">✓</span>
      </div>
    );
  }

  return (
    <div className="text-xs flex items-center gap-1.5 py-1.5 px-2 border border-border bg-muted/40 my-1 animate-pulse">
      <span className="text-foreground">{icon}</span>
      <span className="font-medium text-foreground">{displayName}</span>
      {inputContext && <span className="text-muted-foreground/60 truncate max-w-[200px]">&ldquo;{inputContext}&rdquo;</span>}
      <span className="ml-auto text-muted-foreground">...</span>
    </div>
  );
}

function MessageActions({ message, feedback, onFeedback }: { 
  message: UIMessage;
  feedback: "like" | "dislike" | null;
  onFeedback: (type: "like" | "dislike") => void;
}) {
  const [copied, setCopied] = useState(false);

  const getTextContent = () => {
    return message.parts
      .filter((part) => part.type === "text")
      .map((part) => (part as { type: "text"; text: string }).text)
      .join("\n");
  };

  const handleCopy = async () => {
    const text = getTextContent();
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
      <button
        onClick={handleCopy}
        className="p-1.5 text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-colors"
        title="Copy"
      >
        {copied ? <CheckIcon className="h-3.5 w-3.5 text-foreground" /> : <CopyIcon className="h-3.5 w-3.5" />}
      </button>
      <button
        onClick={() => onFeedback("like")}
        className={cn(
          "p-1.5 transition-colors",
          feedback === "like" 
            ? "text-foreground bg-muted" 
            : "text-muted-foreground/60 hover:text-foreground hover:bg-muted/50"
        )}
        title="Good response"
      >
        <ThumbsUpIcon className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => onFeedback("dislike")}
        className={cn(
          "p-1.5 transition-colors",
          feedback === "dislike" 
            ? "text-red-500 bg-red-500/10" 
            : "text-muted-foreground/60 hover:text-foreground hover:bg-muted/50"
        )}
        title="Bad response"
      >
        <ThumbsDownIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function PersonaAvatar({ persona, className }: { persona: PersonaSummary; className?: string }) {
  if (persona.avatarUrl?.startsWith("/")) {
    return (
      <Image
        src={persona.avatarUrl}
        alt={persona.name}
        width={128}
        height={128}
        className={cn("object-cover", className)}
        priority
        quality={100}
      />
    );
  }

  if (persona.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={persona.avatarUrl}
        alt={persona.name}
        className={cn("object-cover", className)}
      />
    );
  }

  return (
    <div className={cn("bg-muted flex items-center justify-center font-mono font-semibold", className)}>
      {persona.name
        .split(/\s+/)
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()}
    </div>
  );
}

function PersonaSelector({
  personas,
  selectedPersona,
  onPersonaChange,
  onEditPersona,
}: {
  personas: PersonaSummary[];
  selectedPersona: PersonaSummary;
  onPersonaChange: (personaId: string) => void;
  onEditPersona: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Select value={selectedPersona.id} onValueChange={onPersonaChange}>
        <SelectTrigger
          aria-label="Select persona"
          className="w-auto max-w-[180px] border-0 bg-transparent focus:ring-0 focus:ring-offset-0 shadow-none h-9 px-2 cursor-pointer shrink-0 uppercase tracking-[0.08em]"
        >
          <SelectValue>
            <div className="flex items-center gap-2">
              <PersonaAvatar persona={selectedPersona} className="h-5 w-5 text-[10px]" />
              <span className="text-sm font-medium hidden sm:inline truncate">
                {selectedPersona.name}
              </span>
            </div>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {personas.map((persona) => (
            <SelectItem key={persona.id} value={persona.id}>
              <div className="flex items-center gap-2">
                <PersonaAvatar persona={persona} className="h-5 w-5 text-[10px]" />
                <span>{persona.name}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selectedPersona.id !== "paul-graham" && (
        <button
          type="button"
          onClick={onEditPersona}
          className="p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Edit selected persona"
        >
          <PencilIcon className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function ComposerControls({
  personas,
  selectedPersona,
  selectedModel,
  onPersonaChange,
  onEditPersona,
  onModelChange,
}: {
  personas: PersonaSummary[];
  selectedPersona: PersonaSummary;
  selectedModel: SupportedModel;
  onPersonaChange: (personaId: string) => void;
  onEditPersona: () => void;
  onModelChange: (model: SupportedModel) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <PersonaSelector
        personas={personas}
        selectedPersona={selectedPersona}
        onPersonaChange={onPersonaChange}
        onEditPersona={onEditPersona}
      />
      <div className="h-5 w-px bg-border" />
      <ModelSelector selectedModel={selectedModel} onModelChange={onModelChange} />
    </div>
  );
}

function AddPersonaPanel({
  isOpen,
  mode,
  persona,
  isCreating,
  error,
  onClose,
  onSubmit,
  onDelete,
}: {
  isOpen: boolean;
  mode: "create" | "edit";
  persona?: PersonaSummary;
  isCreating: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: {
    name: string;
    description: string;
    avatarUrl: string;
    voicePrompt: string;
    linksText: string;
    documents: SourceDocumentDraft[];
  }) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [voicePrompt, setVoicePrompt] = useState("");
  const [linksText, setLinksText] = useState("");
  const [documentTitle, setDocumentTitle] = useState("");
  const [documentText, setDocumentText] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    setName(mode === "edit" ? persona?.name ?? "" : "");
    setDescription(mode === "edit" ? persona?.description ?? "" : "");
    setAvatarUrl(mode === "edit" ? persona?.avatarUrl ?? "" : "");
    setVoicePrompt(mode === "edit" ? persona?.voicePrompt ?? "" : "");
    setLinksText("");
    setDocumentTitle("");
    setDocumentText("");
    setFiles([]);
  }, [isOpen, mode, persona]);

  if (!isOpen) return null;

  const title = mode === "edit" ? "Edit Persona" : "Add Persona";
  const helpText =
    mode === "edit"
      ? "Update metadata or add more URL/document sources. New sources rebuild the local index."
      : "Paste URLs or add documents. Defuddle turns URLs into markdown, then the app builds embeddings.";
  const removeFile = (index: number) => {
    setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index));
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/90 flex items-center justify-center p-4">
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          const fileDocuments = await Promise.all(
            files.map(async (file) => ({
              title: file.name.replace(/\.[^.]+$/, ""),
              content: await file.text(),
              url: `file:${file.name}`,
            }))
          );
          const documents = [
            ...fileDocuments,
            ...(documentText.trim()
              ? [{ title: documentTitle.trim() || "Pasted document", content: documentText }]
              : []),
          ];
          await onSubmit({ name, description, avatarUrl, voicePrompt, linksText, documents });
        }}
        className="w-full max-w-2xl max-h-[90dvh] overflow-y-auto bg-background border border-border shadow-border-medium p-5 md:p-6 space-y-4"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {helpText}
            </p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} disabled={isCreating}>
            <XIcon className="h-4 w-4" />
          </Button>
        </div>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Naval Ravikant"
            className="w-full border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-[2px] focus-visible:ring-ring/50"
            required
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Description</span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Investor, founder, writer, and podcaster"
            className="w-full border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-[2px] focus-visible:ring-ring/50"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Avatar URL</span>
          <input
            value={avatarUrl}
            onChange={(event) => setAvatarUrl(event.target.value)}
            placeholder="Optional"
            className="w-full border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-[2px] focus-visible:ring-ring/50"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Source links</span>
          <textarea
            value={linksText}
            onChange={(event) => setLinksText(event.target.value)}
            placeholder={"https://nav.al/rich\nhttps://nav.al/specific-knowledge"}
            rows={5}
            className="w-full resize-y border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-[2px] focus-visible:ring-ring/50"
          />
        </label>

        <div className="space-y-2 border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">Document sources</p>
              <p className="text-xs text-muted-foreground">Paste text/markdown or upload local text files.</p>
            </div>
            <label className="inline-flex h-8 items-center justify-center gap-2 border bg-background px-3 text-sm font-medium uppercase tracking-[0.08em] transition-colors hover:bg-accent cursor-pointer">
              <UploadIcon className="h-4 w-4" />
              Upload
              <input
                type="file"
                multiple
                accept=".md,.txt,.markdown,text/markdown,text/plain"
                className="sr-only"
                onChange={(event) => {
                  const selected = Array.from(event.target.files ?? []);
                  setFiles((current) => [...current, ...selected]);
                  event.target.value = "";
                }}
              />
            </label>
          </div>
          {files.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {files.map((file, index) => (
                <div
                  key={`${file.name}-${file.lastModified}-${index}`}
                  className="inline-flex max-w-full items-center gap-2 border border-border bg-muted px-3 py-1.5 text-xs"
                >
                  <FileTextIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="max-w-[220px] truncate font-medium">{file.name}</span>
                  <span className="shrink-0 text-muted-foreground">{formatFileSize(file.size)}</span>
                  <button
                    type="button"
                    onClick={() => removeFile(index)}
                    className="ml-1 p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                    aria-label={`Remove ${file.name}`}
                    disabled={isCreating}
                  >
                    <XIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <input
            value={documentTitle}
            onChange={(event) => setDocumentTitle(event.target.value)}
            placeholder="Document title"
            className="w-full border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-[2px] focus-visible:ring-ring/50"
          />
          <textarea
            value={documentText}
            onChange={(event) => setDocumentText(event.target.value)}
            placeholder="Paste markdown or plain text here..."
            rows={4}
            className="w-full resize-y border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-[2px] focus-visible:ring-ring/50"
          />
        </div>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Voice prompt</span>
          <textarea
            value={voicePrompt}
            onChange={(event) => setVoicePrompt(event.target.value)}
            placeholder="Optional. Leave blank to generate a simple grounded persona prompt."
            rows={3}
            className="w-full resize-y border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-[2px] focus-visible:ring-ring/50"
          />
        </label>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex items-center justify-between gap-2">
          {mode === "edit" && onDelete ? (
            <Button type="button" variant="destructive" onClick={onDelete} disabled={isCreating}>
              <Trash2Icon className="h-4 w-4" />
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isCreating}>
              Cancel
            </Button>
            <Button type="submit" disabled={isCreating}>
              {isCreating && <Loader2Icon className="h-4 w-4 animate-spin" />}
              {isCreating ? "Building..." : mode === "edit" ? "Save Persona" : "Build Persona"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

export function Chat() {
  const [input, setInput] = useState("");
  const [selectedModel, setSelectedModel] = useState<SupportedModel>(DEFAULT_MODEL);
  const [feedbacks, setFeedbacks] = useState<Record<string, "like" | "dislike" | null>>({});
  const [personas, setPersonas] = useState<PersonaSummary[]>([fallbackPersona]);
  const [selectedPersonaId, setSelectedPersonaId] = useState(fallbackPersona.id);
  const [isAddPersonaOpen, setIsAddPersonaOpen] = useState(false);
  const [personaPanelMode, setPersonaPanelMode] = useState<"create" | "edit">("create");
  const [isCreatingPersona, setIsCreatingPersona] = useState(false);
  const [createPersonaError, setCreatePersonaError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { messages, error, sendMessage, regenerate, setMessages, stop, status } = useChat();
  const selectedPersona = personas.find((persona) => persona.id === selectedPersonaId) ?? personas[0] ?? fallbackPersona;

  const handleFeedback = (messageId: string, type: "like" | "dislike") => {
    setFeedbacks((prev) => ({
      ...prev,
      [messageId]: prev[messageId] === type ? null : type,
    }));
  };

  const hasMessages = messages.length > 0;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const loadPersonas = useCallback(async () => {
    const res = await fetch("/api/personas");
    if (!res.ok) return;
    const data = await res.json() as { personas: PersonaSummary[] };
    if (data.personas?.length) {
      setPersonas(data.personas);
      setSelectedPersonaId((current) =>
        data.personas.some((persona) => persona.id === current) ? current : data.personas[0].id
      );
    }
  }, []);

  useEffect(() => {
    void loadPersonas();
  }, [loadPersonas]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleNewChat = () => {
    stop();
    setMessages([]);
    setInput("");
  };

  const handlePersonaChange = (personaId: string) => {
    stop();
    setMessages([]);
    setInput("");
    setSelectedPersonaId(personaId);
  };

  const openCreatePersona = () => {
    setCreatePersonaError(null);
    setPersonaPanelMode("create");
    setIsAddPersonaOpen(true);
  };

  const openEditPersona = () => {
    setCreatePersonaError(null);
    setPersonaPanelMode("edit");
    setIsAddPersonaOpen(true);
  };

  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, []);

  useEffect(() => {
    adjustTextareaHeight();
  }, [input, adjustTextareaHeight]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    sendMessage({ text: input }, { body: { model: selectedModel, personaId: selectedPersona.id } });
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleCreatePersona = async ({
    name,
    description,
    avatarUrl,
    voicePrompt,
    linksText,
    documents,
  }: {
    name: string;
    description: string;
    avatarUrl: string;
    voicePrompt: string;
    linksText: string;
    documents: SourceDocumentDraft[];
  }) => {
    setCreatePersonaError(null);
    const links = linksText
      .split(/\r?\n/)
      .map((link) => link.trim())
      .filter(Boolean);

    if (!name.trim() || (links.length === 0 && documents.length === 0)) {
      setCreatePersonaError("Add a name and at least one source link or document.");
      return;
    }

    setIsCreatingPersona(true);
    try {
      const res = await fetch("/api/personas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          avatarUrl,
          voicePrompt,
          links,
          documents,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create persona.");
      }

      await loadPersonas();
      setSelectedPersonaId(data.persona.id);
      setMessages([]);
      setInput("");
      setIsAddPersonaOpen(false);
    } catch (error) {
      setCreatePersonaError(error instanceof Error ? error.message : "Failed to create persona.");
    } finally {
      setIsCreatingPersona(false);
    }
  };

  const handleUpdatePersona = async ({
    name,
    description,
    avatarUrl,
    voicePrompt,
    linksText,
    documents,
  }: {
    name: string;
    description: string;
    avatarUrl: string;
    voicePrompt: string;
    linksText: string;
    documents: SourceDocumentDraft[];
  }) => {
    setCreatePersonaError(null);
    if (selectedPersona.id === "paul-graham") return;

    const links = linksText
      .split(/\r?\n/)
      .map((link) => link.trim())
      .filter(Boolean);

    setIsCreatingPersona(true);
    try {
      const res = await fetch(`/api/personas/${selectedPersona.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, avatarUrl, voicePrompt, links, documents }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update persona.");
      }

      await loadPersonas();
      setSelectedPersonaId(data.persona.id);
      setMessages([]);
      setInput("");
      setIsAddPersonaOpen(false);
    } catch (error) {
      setCreatePersonaError(error instanceof Error ? error.message : "Failed to update persona.");
    } finally {
      setIsCreatingPersona(false);
    }
  };

  const handleDeletePersona = async () => {
    setCreatePersonaError(null);
    if (selectedPersona.id === "paul-graham") return;
    if (!window.confirm(`Delete ${selectedPersona.name}? This removes its local documents and index.`)) return;

    setIsCreatingPersona(true);
    try {
      const res = await fetch(`/api/personas/${selectedPersona.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to delete persona.");
      }

      await loadPersonas();
      setSelectedPersonaId("paul-graham");
      setMessages([]);
      setInput("");
      setIsAddPersonaOpen(false);
    } catch (error) {
      setCreatePersonaError(error instanceof Error ? error.message : "Failed to delete persona.");
    } finally {
      setIsCreatingPersona(false);
    }
  };

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden">
      <AddPersonaPanel
        isOpen={isAddPersonaOpen}
        mode={personaPanelMode}
        persona={personaPanelMode === "edit" ? selectedPersona : undefined}
        isCreating={isCreatingPersona}
        error={createPersonaError}
        onClose={() => {
          if (!isCreatingPersona) setIsAddPersonaOpen(false);
        }}
        onSubmit={personaPanelMode === "edit" ? handleUpdatePersona : handleCreatePersona}
        onDelete={personaPanelMode === "edit" ? handleDeletePersona : undefined}
      />
      <div className="absolute top-3 left-3 md:top-4 md:left-4 z-10 flex gap-2 animate-fade-in safe-area-top">
        <Button
          onClick={handleNewChat}
          variant="outline"
          size="icon"
          className="h-10 w-10 md:h-9 md:w-9 shadow-border-small hover:shadow-border-medium bg-background border-0 hover:bg-accent active:scale-95 transition-all duration-150 ease"
        >
          <PlusIcon className="h-4 w-4" />
        </Button>
        <Button
          onClick={openCreatePersona}
          variant="outline"
          size="icon"
          className="h-10 w-10 md:h-9 md:w-9 shadow-border-small hover:shadow-border-medium bg-background border-0 hover:bg-accent active:scale-95 transition-all duration-150 ease"
          aria-label="Add persona"
        >
          <UserPlusIcon className="h-4 w-4" />
        </Button>
        <Button
          asChild
          variant="outline"
          size="icon"
          className="h-10 w-10 md:h-9 md:w-9 shadow-border-small hover:shadow-border-medium bg-background border-0 hover:bg-accent active:scale-95 transition-all duration-150 ease"
        >
          <a
            href="https://github.com/Habibi-7/personas-ai"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub repository"
          >
            <GithubIcon className="h-4 w-4" />
          </a>
        </Button>
        <ThemeToggle />
      </div>
      {!hasMessages && (
        <div className="flex-1 flex flex-col items-center justify-center px-4 md:px-8 animate-fade-in safe-area-inset">
          <div className="w-full max-w-2xl text-center space-y-6 md:space-y-12">
            <div className="space-y-3 md:space-y-4">
              <p className="animate-slide-up text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                Persona Generator
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 animate-slide-up">
                <PersonaAvatar
                  persona={selectedPersona}
                  className="shadow-border-small w-14 h-14 md:w-16 md:h-16 text-xl"
                />
                <h1 className="pixel-title text-3xl sm:text-4xl md:text-6xl font-semibold tracking-[-0.08em] text-foreground">
                  <span>
                    {selectedPersona.name} Agent
                  </span>
                </h1>
              </div>
              <p className="text-muted-foreground text-sm md:text-base animate-slide-up px-2" style={{ animationDelay: '50ms' }}>
                {selectedPersona.description}
                {selectedPersona.documentCount > 0 && (
                  <span> Grounded in {selectedPersona.documentCount} local {selectedPersona.documentLabel}.</span>
                )}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={openCreatePersona}
                className="animate-slide-up"
                style={{ animationDelay: '75ms' }}
              >
                <UserPlusIcon className="h-4 w-4" />
                Add Persona
              </Button>
            </div>
            <div className="w-full animate-slide-up" style={{ animationDelay: '100ms' }}>
              <form onSubmit={handleSubmit}>
                <div className="relative bg-background border border-border shadow-border-small hover:shadow-border-medium focus-within:shadow-border-medium focus-within:border-foreground/30 transition-all duration-200">
                  <textarea
                    ref={textareaRef}
                    name="prompt"
                    placeholder="Ask a persona..."
                    onChange={(e) => setInput(e.target.value)}
                    value={input}
                    autoFocus
                    rows={1}
                    className="readable-text w-full resize-none bg-transparent px-4 pt-4 pb-14 text-[16px] md:text-base placeholder:text-muted-foreground/50 focus:outline-none min-h-[56px] max-h-[200px]"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSubmit(e);
                      }
                    }}
                  />
                  <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
                    <ComposerControls
                      personas={personas}
                      selectedPersona={selectedPersona}
                      selectedModel={selectedModel}
                      onPersonaChange={handlePersonaChange}
                      onEditPersona={openEditPersona}
                      onModelChange={setSelectedModel}
                    />
                    <Button
                      type="submit"
                      size="icon"
                      className={cn(
                        "h-8 w-8 transition-all duration-200",
                        input.trim()
                          ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-border-small"
                          : "bg-muted text-muted-foreground cursor-not-allowed"
                      )}
                      disabled={!input.trim()}
                    >
                      <ArrowUpIcon className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </form>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 md:gap-3 text-xs md:text-sm animate-slide-up" style={{ animationDelay: '150ms' }}>
              {neutralPrompts.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => {
                    setInput(prompt);
                  }}
                  className="readable-text p-3 border border-border text-left text-muted-foreground hover:text-foreground active:bg-muted/70 hover:bg-muted/50 transition-colors"
                >
                  &ldquo;{prompt}&rdquo;
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {hasMessages && (
        <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full animate-fade-in overflow-hidden">
          <div className="flex-1 overflow-y-auto px-4 md:px-8 py-4 hide-scrollbar">
            <div className="flex flex-col gap-4 md:gap-6 pb-4">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    "group readable-text",
                    m.role === "user" &&
                      "bg-primary text-primary-foreground p-3 md:p-4 ml-auto max-w-[90%] md:max-w-[75%] shadow-border-small font-medium text-sm md:text-base",
                    m.role === "assistant" && "max-w-[95%] md:max-w-[85%] text-foreground/90 leading-relaxed text-sm md:text-base"
                  )}
                >
                  {m.parts.map((part, i) => {
                    switch (part.type) {
                      case "text":
                        return m.role === "assistant" ? (
                          <Streamdown key={`${m.id}-${i}`} isAnimating={status === "streaming" && m.id === messages[messages.length - 1]?.id}>
                            {part.text}
                          </Streamdown>
                        ) : (
                          <div key={`${m.id}-${i}`}>{part.text}</div>
                        );
                      default:
                        // Handle tool invocations
                        if (part.type.startsWith("tool-")) {
                          const toolPart = part as { type: string; toolName?: string; state?: string; input?: unknown };
                          return (
                            <ToolInvocation 
                              key={`${m.id}-${i}`} 
                              toolType={toolPart.type}
                              toolName={toolPart.toolName}
                              state={toolPart.state}
                              input={toolPart.input}
                            />
                          );
                        }
                        return null;
                    }
                  })}
                  {m.role === "assistant" && status !== "streaming" && (
                    <>
                    <MessageActions 
                      message={m} 
                      feedback={feedbacks[m.id] || null}
                      onFeedback={(type) => handleFeedback(m.id, type)}
                    />
                    </>
                  )}
                </div>
              ))}

              <div ref={messagesEndRef} />
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="max-w-4xl mx-auto w-full px-4 md:px-8 pb-4 animate-slide-down">
          <Alert variant="destructive" className="flex flex-col items-end">
            <div className="flex flex-row gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <AlertDescription className="dark:text-red-400 text-red-600">
                {error.message || "An error occurred while generating the response."}
              </AlertDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto transition-all duration-150 ease-out hover:scale-105"
              onClick={() => regenerate()}
            >
              Retry
            </Button>
          </Alert>
        </div>
      )}

      {hasMessages && (
        <div className="w-full max-w-4xl mx-auto px-4 md:px-8 pb-4 md:pb-6 pt-2">
          <form onSubmit={handleSubmit}>
            <div className="relative bg-background border border-border shadow-border-small hover:shadow-border-medium focus-within:shadow-border-medium focus-within:border-foreground/30 transition-all duration-200">
              <textarea
                ref={textareaRef}
                name="prompt"
                placeholder="Ask a follow-up..."
                onChange={(e) => setInput(e.target.value)}
                value={input}
                rows={1}
                className="readable-text w-full resize-none bg-transparent px-4 pt-3 pb-12 text-[16px] md:text-base placeholder:text-muted-foreground/50 focus:outline-none min-h-[52px] max-h-[200px]"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
              />
              <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
                <ComposerControls
                  personas={personas}
                  selectedPersona={selectedPersona}
                  selectedModel={selectedModel}
                  onPersonaChange={handlePersonaChange}
                  onEditPersona={openEditPersona}
                  onModelChange={setSelectedModel}
                />
                <Button
                  type="submit"
                  size="icon"
                  className={cn(
                    "h-8 w-8 transition-all duration-200",
                    input.trim()
                      ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-border-small"
                      : "bg-muted text-muted-foreground cursor-not-allowed"
                  )}
                  disabled={!input.trim()}
                >
                  <ArrowUpIcon className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </form>
        </div>
      )}

      {!hasMessages && (
        <footer className="pb-8 text-center animate-fade-in" style={{ animationDelay: '200ms' }}>
          <p className="text-xs md:text-sm text-muted-foreground">
            Created by{" "}
            <a
              href="https://github.com/Habibi-7"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 transition-colors hover:text-foreground"
            >
              Habib
            </a>
          </p>
        </footer>
      )}
    </div>
  );
}
