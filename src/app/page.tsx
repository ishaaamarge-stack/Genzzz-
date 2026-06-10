"use client";

import { ChangeEvent, FormEvent, useMemo, useRef, useState } from "react";

type Message = {
  id: number;
  role: "assistant" | "user";
  text: string;
};

type AuthMode = "login" | "signup";

type PhotoAttachment = {
  kind: "photo";
  name: string;
  dataUrl: string;
};

type FileAttachment = {
  kind: "file";
  name: string;
  size: number;
  content?: string;
};

type LocationAttachment = {
  kind: "location";
  latitude: number;
  longitude: number;
};

type Attachment = PhotoAttachment | FileAttachment | LocationAttachment;

type ChatContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

type ChatPayloadMessage = {
  role: "assistant" | "user";
  content: ChatContent;
};

const prompts = [
  "Plan my week",
  "Rewrite this caption",
  "Explain this photo",
  "Summarize this file",
];

const chats = ["New chat", "Design ideas", "Study notes", "Weekend plans"];

const starterMessages: Message[] = [
  {
    id: 1,
    role: "assistant",
    text: "Hi, I am Genzzz!! Ask me anything, upload a photo or file, or share your location.",
  },
];

function BackgroundVideo() {
  return (
    <video
      className="background-video"
      autoPlay
      loop
      muted
      playsInline
      aria-hidden="true"
    >
      <source src="/bg.mp4" type="video/mp4" />
    </video>
  );
}

function formatFileSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read photo."));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file: File) {
  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).slice(0, 12000));
    reader.onerror = () => resolve("");
    reader.readAsText(file);
  });
}

function attachmentSummary(attachments: Attachment[]) {
  return attachments
    .map((attachment) => {
      if (attachment.kind === "photo") {
        return `Photo: ${attachment.name}`;
      }

      if (attachment.kind === "file") {
        return `File: ${attachment.name} (${formatFileSize(attachment.size)})`;
      }

      return `Location: ${attachment.latitude.toFixed(5)}, ${attachment.longitude.toFixed(5)}`;
    })
    .join("\n");
}

function renderFormattedText(text: string) {
  return text.split("\n").map((line, lineIndex) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g);

    return (
      <span key={`${lineIndex}-${line}`}>
        {parts.map((part, partIndex) => {
          if (part.startsWith("**") && part.endsWith("**")) {
            return <strong key={partIndex}>{part.slice(2, -2)}</strong>;
          }

          return <span key={partIndex}>{part}</span>;
        })}
        {lineIndex < text.split("\n").length - 1 ? <br /> : null}
      </span>
    );
  });
}

function buildUserContent(text: string, attachments: Attachment[]): ChatContent {
  const parts: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [];
  const details = attachments
    .map((attachment) => {
      if (attachment.kind === "photo") {
        parts.push({ type: "image_url", image_url: { url: attachment.dataUrl } });
        return `The user attached an image named ${attachment.name}.`;
      }

      if (attachment.kind === "file") {
        return [
          `The user attached a file named ${attachment.name}.`,
          attachment.content
            ? `File text preview:\n${attachment.content}`
            : "No readable text preview was available for this file.",
        ].join("\n");
      }

      return `The user shared this location: latitude ${attachment.latitude}, longitude ${attachment.longitude}.`;
    })
    .join("\n\n");
  const messageText = [text || "Please review the attached item.", details]
    .filter(Boolean)
    .join("\n\n");

  parts.unshift({ type: "text", text: messageText });

  return parts.length === 1 && attachments.length === 0 ? messageText : parts;
}

export default function Home() {
  const nextMessageId = useRef(2);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [isAuthed, setIsAuthed] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [messages, setMessages] = useState<Message[]>(starterMessages);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [locationStatus, setLocationStatus] = useState("");

  const currentChats = useMemo(() => {
    const latestUserMessages = messages
      .filter((message) => message.role === "user")
      .slice(-3)
      .map((message) => message.text.split("\n")[0]);

    return latestUserMessages.length > 0 ? ["New chat", ...latestUserMessages] : chats;
  }, [messages]);

  function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name =
      String(formData.get("name") || "").trim() ||
      String(formData.get("email") || "User").split("@")[0] ||
      "User";

    setDisplayName(name);
    setIsAuthed(true);
  }

  async function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const dataUrl = await readFileAsDataUrl(file);
    setAttachments((current) => [
      ...current.filter((attachment) => attachment.kind !== "photo"),
      { kind: "photo", name: file.name, dataUrl },
    ]);
    event.target.value = "";
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const isReadable =
      file.type.startsWith("text/") ||
      file.name.endsWith(".txt") ||
      file.name.endsWith(".md") ||
      file.name.endsWith(".csv") ||
      file.name.endsWith(".json");
    const content = isReadable ? await readFileAsText(file) : undefined;

    setAttachments((current) => [
      ...current.filter((attachment) => attachment.kind !== "file"),
      { kind: "file", name: file.name, size: file.size, content },
    ]);
    event.target.value = "";
  }

  function handleLocation() {
    if (!navigator.geolocation) {
      setLocationStatus("Location is not supported in this browser.");
      return;
    }

    setLocationStatus("Getting location...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setAttachments((current) => [
          ...current.filter((attachment) => attachment.kind !== "location"),
          {
            kind: "location",
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          },
        ]);
        setLocationStatus("Location attached.");
      },
      () => setLocationStatus("Location permission was denied."),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function sendMessage(text: string) {
    const query = text.trim();

    if ((!query && attachments.length === 0) || isSending) {
      return;
    }

    const summary = attachmentSummary(attachments);
    const displayText = [query || "Review my attachment.", summary]
      .filter(Boolean)
      .join("\n");
    const payloadContent = buildUserContent(query, attachments);
    const userMessage: Message = {
      id: nextMessageId.current,
      role: "user",
      text: displayText,
    };
    nextMessageId.current += 1;

    const thinkingMessage: Message = {
      id: nextMessageId.current,
      role: "assistant",
      text: "Thinking...",
    };
    nextMessageId.current += 1;

    const nextMessages = [...messages, userMessage];

    setMessages([...nextMessages, thinkingMessage]);
    setInput("");
    setAttachments([]);
    setLocationStatus("");
    setIsSending(true);

    try {
      const history: ChatPayloadMessage[] = messages
        .filter((message) => message.role === "assistant" || message.role === "user")
        .map((message) => ({
          role: message.role,
          content: message.text,
        }));

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [...history, { role: "user", content: payloadContent }],
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Genzzz could not answer right now.");
      }

      setMessages([
        ...nextMessages,
        {
          id: thinkingMessage.id,
          role: "assistant",
          text: data.reply,
        },
      ]);
    } catch (error) {
      setMessages([
        ...nextMessages,
        {
          id: thinkingMessage.id,
          role: "assistant",
          text:
            error instanceof Error
              ? error.message
              : "Genzzz could not answer right now.",
        },
      ]);
    } finally {
      setIsSending(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sendMessage(input);
  }

  if (!isAuthed) {
    return (
      <main className="auth-shell">
        <BackgroundVideo />
        <section className="auth-panel" aria-label="Account access">
          <div className="auth-brand">
            <span className="brand-mark">G</span>
            <div>
              <p className="eyebrow">Welcome to</p>
              <h1>Genzzz!!</h1>
            </div>
          </div>

          <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
            <button
              type="button"
              className={authMode === "login" ? "active" : ""}
              onClick={() => setAuthMode("login")}
            >
              Login
            </button>
            <button
              type="button"
              className={authMode === "signup" ? "active" : ""}
              onClick={() => setAuthMode("signup")}
            >
              Signup
            </button>
          </div>

          <form className="auth-form" onSubmit={handleAuth}>
            {authMode === "signup" ? (
              <label>
                Name
                <input name="name" placeholder="Your name" type="text" />
              </label>
            ) : null}
            <label>
              Email
              <input name="email" placeholder="you@example.com" required type="email" />
            </label>
            <label>
              Password
              <input
                name="password"
                placeholder="Enter password"
                required
                type="password"
              />
            </label>
            <button type="submit">
              {authMode === "login" ? "Login" : "Create account"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <BackgroundVideo />
      <aside className="sidebar" aria-label="Chat history">
        <div className="brand">
          <span className="brand-mark">G</span>
          <span>Genzzz!!</span>
        </div>

        <button
          className="new-chat"
          type="button"
          onClick={() => {
            nextMessageId.current = 2;
            setMessages(starterMessages);
            setInput("");
            setAttachments([]);
            setIsSending(false);
          }}
        >
          + New chat
        </button>

        <nav className="chat-list" aria-label="Recent chats">
          {currentChats.map((chat) => (
            <a href="#" key={chat}>
              {chat}
            </a>
          ))}
        </nav>
      </aside>

      <section className="chat-panel" aria-label="Genzzz chat">
        <header className="topbar">
          <div>
            <p className="eyebrow">AI assistant</p>
            <h1>Genzzz!!</h1>
          </div>
          <button
            className="mode-button"
            type="button"
            onClick={() => setIsAuthed(false)}
          >
            {displayName || "Account"}
          </button>
        </header>

        <div className="conversation" aria-live="polite">
          <div className="message-list">
            {messages.map((message) => (
              <article className={`message ${message.role}`} key={message.id}>
                <div className="avatar">{message.role === "assistant" ? "G" : "U"}</div>
                <div className={`bubble ${message.role}`}>
                  <p>{renderFormattedText(message.text)}</p>
                </div>
              </article>
            ))}
          </div>

          <div className="prompt-grid" aria-label="Suggested prompts">
            {prompts.map((prompt) => (
              <button
                type="button"
                key={prompt}
                onClick={() => sendMessage(prompt)}
                disabled={isSending}
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>

        <form className="composer" onSubmit={handleSubmit}>
          <input
            ref={photoInputRef}
            className="hidden-input"
            accept="image/*"
            aria-label="Upload photo"
            type="file"
            onChange={handlePhotoChange}
          />
          <input
            ref={fileInputRef}
            className="hidden-input"
            aria-label="Upload file"
            type="file"
            onChange={handleFileChange}
          />

          <div className="composer-tools" aria-label="Chat tools">
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              disabled={isSending}
            >
              Photo
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isSending}
            >
              File
            </button>
            <button type="button" onClick={handleLocation} disabled={isSending}>
              Location
            </button>
          </div>

          {attachments.length > 0 || locationStatus ? (
            <div className="attachment-tray" aria-label="Attached items">
              {attachments.map((attachment) => (
                <span
                  className="attachment-pill"
                  key={
                    attachment.kind === "location"
                      ? "location"
                      : `${attachment.kind}-${attachment.name}`
                  }
                >
                  {attachment.kind === "photo"
                    ? `Photo: ${attachment.name}`
                    : attachment.kind === "file"
                      ? `File: ${attachment.name}`
                      : `Location: ${attachment.latitude.toFixed(3)}, ${attachment.longitude.toFixed(3)}`}
                </span>
              ))}
              {locationStatus ? <span className="status-text">{locationStatus}</span> : null}
            </div>
          ) : null}

          <div className="message-row">
            <input
              aria-label="Message Genzzz"
              placeholder="Message Genzzz!!"
              type="text"
              value={input}
              onChange={(event) => setInput(event.target.value)}
            />
            <button type="submit" disabled={isSending}>
              {isSending ? "Sending" : "Send"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
