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
  documentLabel: string;
  examplePrompts: string[];
  documentCount: number;
  indexed: boolean;
};

const fallbackPersona: PersonaSummary = {
  id: "paul-graham",
  name: "Paul Graham",
  description: "Grounded in 220+ Paul Graham essays.",
  avatarUrl: "/pg.png",
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
      <div className="text-xs flex items-center gap-1.5 py-1.5 px-2 rounded-lg my-1">
        <span className="text-[#0A4EAA]">{icon}</span>
        <span className="font-medium text-[#0A4EAA]">{displayName}</span>
        {inputContext && <span className="text-muted-foreground/60 truncate max-w-[200px]">&ldquo;{inputContext}&rdquo;</span>}
        <span className="text-green-500 ml-auto">✓</span>
      </div>
    );
  }

  return (
    <div className="text-xs flex items-center gap-1.5 py-1.5 px-2 rounded-lg my-1 animate-pulse">
      <span className="text-[#0A4EAA]">{icon}</span>
      <span className="font-medium text-[#0A4EAA]">{displayName}</span>
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
        className="p-1.5 rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-colors"
        title="Copy"
      >
        {copied ? <CheckIcon className="h-3.5 w-3.5 text-green-500" /> : <CopyIcon className="h-3.5 w-3.5" />}
      </button>
      <button
        onClick={() => onFeedback("like")}
        className={cn(
          "p-1.5 rounded-md transition-colors",
          feedback === "like" 
            ? "text-green-500 bg-green-500/10" 
            : "text-muted-foreground/60 hover:text-foreground hover:bg-muted/50"
        )}
        title="Good response"
      >
        <ThumbsUpIcon className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => onFeedback("dislike")}
        className={cn(
          "p-1.5 rounded-md transition-colors",
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
        className={cn("rounded-full object-cover", className)}
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
        className={cn("rounded-full object-cover", className)}
      />
    );
  }

  return (
    <div className={cn("rounded-full bg-muted flex items-center justify-center font-serif font-semibold", className)}>
      {persona.name
        .split(/\s+/)
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()}
    </div>
  );
}

function AddPersonaPanel({
  isOpen,
  isCreating,
  error,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  isCreating: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: {
    name: string;
    description: string;
    avatarUrl: string;
    voicePrompt: string;
    linksText: string;
  }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [voicePrompt, setVoicePrompt] = useState("");
  const [linksText, setLinksText] = useState("");

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          await onSubmit({ name, description, avatarUrl, voicePrompt, linksText });
        }}
        className="w-full max-w-2xl rounded-2xl bg-background border border-border shadow-xl p-5 md:p-6 space-y-4"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Add Persona</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Paste source links. Defuddle turns them into local markdown, then the app builds embeddings.
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
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            required
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Description</span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Investor, founder, writer, and podcaster"
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Avatar URL</span>
          <input
            value={avatarUrl}
            onChange={(event) => setAvatarUrl(event.target.value)}
            placeholder="Optional"
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Source links</span>
          <textarea
            value={linksText}
            onChange={(event) => setLinksText(event.target.value)}
            placeholder={"https://nav.al/rich\nhttps://nav.al/specific-knowledge"}
            rows={5}
            className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            required
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Voice prompt</span>
          <textarea
            value={voicePrompt}
            onChange={(event) => setVoicePrompt(event.target.value)}
            placeholder="Optional. Leave blank to generate a simple grounded persona prompt."
            rows={3}
            className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </label>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={isCreating}>
            Cancel
          </Button>
          <Button type="submit" disabled={isCreating}>
            {isCreating && <Loader2Icon className="h-4 w-4 animate-spin" />}
            {isCreating ? "Building..." : "Build Persona"}
          </Button>
        </div>
      </form>
    </div>
  );
}

export function Chat() {
  const [input, setInput] = useState("");
  const [selectedModel, setSelectedModel] = useState<SupportedModel>(DEFAULT_MODEL);
  const [feedbacks, setFeedbacks] = useState<Record<string, "like" | "dislike" | null>>({});
  const [personas, setPersonas] = useState<PersonaSummary[]>([fallbackPersona]);
  const [selectedPersonaId, setSelectedPersonaId] = useState(fallbackPersona.id);
  const [isAddPersonaOpen, setIsAddPersonaOpen] = useState(false);
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
  }: {
    name: string;
    description: string;
    avatarUrl: string;
    voicePrompt: string;
    linksText: string;
  }) => {
    setCreatePersonaError(null);
    const links = linksText
      .split(/\r?\n/)
      .map((link) => link.trim())
      .filter(Boolean);

    if (!name.trim() || links.length === 0) {
      setCreatePersonaError("Add a name and at least one source link.");
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

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden">
      <AddPersonaPanel
        isOpen={isAddPersonaOpen}
        isCreating={isCreatingPersona}
        error={createPersonaError}
        onClose={() => {
          if (!isCreatingPersona) setIsAddPersonaOpen(false);
        }}
        onSubmit={handleCreatePersona}
      />
      <div className="absolute top-3 left-3 md:top-4 md:left-4 z-10 flex gap-2 animate-fade-in safe-area-top">
        <Button
          onClick={handleNewChat}
          variant="outline"
          size="icon"
          className="h-10 w-10 md:h-9 md:w-9 shadow-border-small hover:shadow-border-medium bg-background/80 backdrop-blur-sm border-0 hover:bg-background active:scale-95 md:hover:scale-[1.02] transition-all duration-150 ease"
        >
          <PlusIcon className="h-4 w-4" />
        </Button>
        <Select value={selectedPersona.id} onValueChange={handlePersonaChange}>
          <SelectTrigger
            aria-label="Select persona"
            size="sm"
            className="h-10 md:h-9 max-w-[180px] shadow-border-small hover:shadow-border-medium bg-background/80 backdrop-blur-sm border-0 hover:bg-background"
          >
            <SelectValue placeholder="Persona" />
          </SelectTrigger>
          <SelectContent>
            {personas.map((persona) => (
              <SelectItem key={persona.id} value={persona.id}>
                {persona.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          onClick={() => {
            setCreatePersonaError(null);
            setIsAddPersonaOpen(true);
          }}
          variant="outline"
          size="icon"
          className="h-10 w-10 md:h-9 md:w-9 shadow-border-small hover:shadow-border-medium bg-background/80 backdrop-blur-sm border-0 hover:bg-background active:scale-95 md:hover:scale-[1.02] transition-all duration-150 ease"
          aria-label="Add persona"
        >
          <UserPlusIcon className="h-4 w-4" />
        </Button>
        <Button
          asChild
          variant="outline"
          size="icon"
          className="h-10 w-10 md:h-9 md:w-9 shadow-border-small hover:shadow-border-medium bg-background/80 backdrop-blur-sm border-0 hover:bg-background active:scale-95 md:hover:scale-[1.02] transition-all duration-150 ease"
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
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 animate-slide-up">
                <PersonaAvatar
                  persona={selectedPersona}
                  className="shadow-lg w-14 h-14 md:w-16 md:h-16 text-xl"
                />
                <h1 className="text-2xl sm:text-3xl md:text-5xl font-light tracking-tight text-foreground">
                  <span className="font-serif font-semibold tracking-tight">
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
                onClick={() => {
                  setCreatePersonaError(null);
                  setIsAddPersonaOpen(true);
                }}
                className="animate-slide-up"
                style={{ animationDelay: '75ms' }}
              >
                <UserPlusIcon className="h-4 w-4" />
                Add Persona
              </Button>
            </div>
            <div className="w-full animate-slide-up" style={{ animationDelay: '100ms' }}>
              <form onSubmit={handleSubmit}>
                <div className="relative rounded-2xl bg-muted/50 dark:bg-muted/30 border border-border/50 shadow-sm hover:shadow-md focus-within:shadow-md focus-within:border-border transition-all duration-200">
                  <textarea
                    ref={textareaRef}
                    name="prompt"
                    placeholder={`Ask ${selectedPersona.name}...`}
                    onChange={(e) => setInput(e.target.value)}
                    value={input}
                    autoFocus
                    rows={1}
                    className="w-full resize-none bg-transparent px-4 pt-4 pb-14 text-[16px] md:text-base placeholder:text-muted-foreground/50 focus:outline-none min-h-[56px] max-h-[200px]"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSubmit(e);
                      }
                    }}
                  />
                  <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
                    <ModelSelector selectedModel={selectedModel} onModelChange={setSelectedModel} />
                    <Button
                      type="submit"
                      size="icon"
                      className={cn(
                        "h-8 w-8 rounded-lg transition-all duration-200",
                        input.trim()
                          ? "bg-[#0A4EAA] text-white hover:bg-[#0A4EAA]/90 shadow-sm"
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
              {selectedPersona.examplePrompts.slice(0, 4).map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => {
                    setInput(prompt);
                  }}
                  className="p-3 rounded-xl text-left text-muted-foreground hover:text-foreground active:bg-muted/70 hover:bg-muted/50 transition-colors"
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
                    "group",
                    m.role === "user" &&
                      "bg-[#0A4EAA] text-white rounded-2xl p-3 md:p-4 ml-auto max-w-[90%] md:max-w-[75%] shadow-border-small font-medium text-sm md:text-base",
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
            <div className="relative rounded-2xl bg-muted/50 dark:bg-muted/30 border border-border/50 shadow-sm hover:shadow-md focus-within:shadow-md focus-within:border-border transition-all duration-200">
              <textarea
                ref={textareaRef}
                name="prompt"
                placeholder={`Ask ${selectedPersona.name} a follow-up...`}
                onChange={(e) => setInput(e.target.value)}
                value={input}
                rows={1}
                className="w-full resize-none bg-transparent px-4 pt-3 pb-12 text-[16px] md:text-base placeholder:text-muted-foreground/50 focus:outline-none min-h-[52px] max-h-[200px]"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
              />
              <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
                <ModelSelector selectedModel={selectedModel} onModelChange={setSelectedModel} />
                <Button
                  type="submit"
                  size="icon"
                  className={cn(
                    "h-8 w-8 rounded-lg transition-all duration-200",
                    input.trim()
                      ? "bg-[#0A4EAA] text-white hover:bg-[#0A4EAA]/90 shadow-sm"
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
              className="underline underline-offset-4 transition-colors hover:text-[#0A4EAA]"
            >
              Habib
            </a>
          </p>
        </footer>
      )}
    </div>
  );
}
