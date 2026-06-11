"use client";

import {
  ChangeEvent,
  FormEvent,
  RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase";

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
  kind: "video" | "file" | "document";
  name: string;
  size: number;
  content?: string;
};

type Attachment = PhotoAttachment | FileAttachment;

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

const uploadLabels: Record<FileAttachment["kind"], string> = {
  video: "Video",
  file: "File",
  document: "Document",
};

const chats = ["New chat", "Design ideas", "Study notes", "Weekend plans"];

const backgroundVideos = ["/bg2.mp4"];

const authSlides = [
  {
    title: "Chat in motion",
    text: "A focused space for quick ideas, notes, files, photos, and answers.",
  },
  {
    title: "Bring context",
    text: "Attach what matters and keep the conversation moving without switching tools.",
  },
  {
    title: "Stay in flow",
    text: "Start fast, return to recent chats, and keep the workspace clean.",
  },
];

const starterMessages: Message[] = [
  {
    id: 1,
    role: "assistant",
    text: "Hi, I am Genzzz!! Ask me anything, upload a photo, video, file, or document.",
  },
];

function BackgroundVideo({ activeIndex = 0 }: { activeIndex?: number }) {
  return (
    <>
      {backgroundVideos.map((src, index) => (
        <video
          className={`background-video ${activeIndex === index ? "active" : ""}`}
          autoPlay
          loop
          muted
          playsInline
          aria-hidden="true"
          key={src}
        >
          <source src={src} type="video/mp4" />
        </video>
      ))}
    </>
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
      switch (attachment.kind) {
        case "photo":
          return `Photo: ${attachment.name}`;
        case "file":
        case "video":
        case "document":
          return `${uploadLabels[attachment.kind]}: ${attachment.name} (${formatFileSize(attachment.size)})`;
      }
    })
    .join("\n");
}

function attachmentDisplayLabel(attachment: Attachment) {
  switch (attachment.kind) {
    case "photo":
      return `Photo: ${attachment.name}`;
    case "file":
    case "video":
    case "document":
      return `${uploadLabels[attachment.kind]}: ${attachment.name}`;
  }
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
      switch (attachment.kind) {
        case "photo":
          parts.push({ type: "image_url", image_url: { url: attachment.dataUrl } });
          return `The user attached an image named ${attachment.name}.`;
        case "file":
        case "video":
        case "document": {
          const label = uploadLabels[attachment.kind];

          return [
            `The user attached a ${label.toLowerCase()} named ${attachment.name}.`,
            attachment.content
              ? `File text preview:\n${attachment.content}`
            : "No readable text preview was available for this file.",
          ].join("\n");
        }
      }
    })
    .join("\n\n");
  const messageText = [text || "Please review the attached item.", details]
    .filter(Boolean)
    .join("\n\n");

  parts.unshift({ type: "text", text: messageText });

  return parts.length === 1 && attachments.length === 0 ? messageText : parts;
}

function getAuthErrorMessage(error: unknown) {
  if (typeof error === "object" && error && "code" in error) {
    const code = String(error.code);

    if (code === "auth/invalid-credential") {
      return "Email or password is incorrect.";
    }

    if (code === "auth/email-already-in-use") {
      return "An account already exists for this email.";
    }

    if (code === "auth/weak-password") {
      return "Password must be at least 6 characters.";
    }
  }

  return "Could not sign in right now.";
}

export default function Home() {
  const nextMessageId = useRef(2);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [isAuthed, setIsAuthed] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [authError, setAuthError] = useState("");
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [messages, setMessages] = useState<Message[]>(starterMessages);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isImageGenerating, setIsImageGenerating] = useState(false);
  const [isVideoGenerating, setIsVideoGenerating] = useState(false);
  const [generatedImageUrl, setGeneratedImageUrl] = useState("");
  const [generatedImagePrompt, setGeneratedImagePrompt] = useState("");
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState("");
  const [generatedVideoPrompt, setGeneratedVideoPrompt] = useState("");
  const [imageError, setImageError] = useState("");
  const [videoError, setVideoError] = useState("");
  const [isAttachMenuOpen, setIsAttachMenuOpen] = useState(false);
  const [activeSlide, setActiveSlide] = useState(0);

  const currentChats = useMemo(() => {
    const latestUserMessages = messages
      .filter((message) => message.role === "user")
      .slice(-3)
      .map((message) => message.text.split("\n")[0]);

    return latestUserMessages.length > 0 ? ["New chat", ...latestUserMessages] : chats;
  }, [messages]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
      setIsAuthed(Boolean(user));
      setDisplayName(user?.displayName || user?.email?.split("@")[0] || "");
      setIsAuthLoading(false);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (isAuthed) {
      return;
    }

    const slideTimer = window.setInterval(() => {
      setActiveSlide((current) => (current + 1) % authSlides.length);
    }, 4200);

    return () => window.clearInterval(slideTimer);
  }, [isAuthed]);

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError("");
    setIsAuthSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");
    const name =
      String(formData.get("name") || "").trim() ||
      email.split("@")[0] ||
      "User";

    try {
      if (authMode === "signup") {
        const credential = await createUserWithEmailAndPassword(
          firebaseAuth,
          email,
          password,
        );
        await updateProfile(credential.user, { displayName: name });
        setDisplayName(name);
        return;
      }

      await signInWithEmailAndPassword(firebaseAuth, email, password);
    } catch (error) {
      setAuthError(getAuthErrorMessage(error));
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  async function handleLogout() {
    await signOut(firebaseAuth);
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

  async function handleFileChange(
    event: ChangeEvent<HTMLInputElement>,
    kind: FileAttachment["kind"],
  ) {
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
      ...current.filter((attachment) => attachment.kind !== kind),
      { kind, name: file.name, size: file.size, content },
    ]);
    event.target.value = "";
  }

  function openUploadPicker(inputRef: RefObject<HTMLInputElement | null>) {
    setIsAttachMenuOpen(false);
    inputRef.current?.click();
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

  async function generateImage() {
    const prompt = input.trim();

    if (!prompt || isImageGenerating) {
      return;
    }

    setImageError("");
    setGeneratedImageUrl("");
    setGeneratedImagePrompt(prompt);
    setIsImageGenerating(true);

    try {
      const response = await fetch("/api/image", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Genzzz could not generate an image right now.");
      }

      setGeneratedImageUrl(data.imageUrl);
      setGeneratedImagePrompt(data.revisedPrompt || prompt);
    } catch (error) {
      setImageError(
        error instanceof Error
          ? error.message
          : "Genzzz could not generate an image right now.",
      );
    } finally {
      setIsImageGenerating(false);
    }
  }

  async function generateVideo() {
    const prompt = input.trim();

    if (!prompt || isVideoGenerating) {
      return;
    }

    setVideoError("");
    setGeneratedVideoUrl("");
    setGeneratedVideoPrompt(prompt);
    setIsVideoGenerating(true);

    try {
      const response = await fetch("/api/video", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Genzzz could not generate a video right now.");
      }

      setGeneratedVideoUrl(data.videoUrl);
      setGeneratedVideoPrompt(data.prompt || prompt);
    } catch (error) {
      setVideoError(
        error instanceof Error
          ? error.message
          : "Genzzz could not generate a video right now.",
      );
    } finally {
      setIsVideoGenerating(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sendMessage(input);
  }

  if (isAuthLoading) {
    return (
      <main className="auth-shell">
        <BackgroundVideo />
        <section className="auth-panel" aria-label="Loading account">
          <div className="auth-brand">
            <span className="brand-mark">G</span>
            <div>
              <p className="eyebrow">Welcome to</p>
              <h1>Genzzz!!</h1>
            </div>
          </div>
          <p className="auth-message">Checking your account...</p>
        </section>
      </main>
    );
  }

  if (!isAuthed) {
    return (
      <main className="auth-shell">
        <BackgroundVideo activeIndex={activeSlide % backgroundVideos.length} />
        <div className="auth-layout">
          <section className="auth-slide" aria-label="Genzzz highlights">
            <div className="slide-track">
              {authSlides.map((slide, index) => (
                <article
                  className={`slide ${activeSlide === index ? "active" : ""}`}
                  key={slide.title}
                  aria-hidden={activeSlide !== index}
                >
                  <p className="eyebrow">Genzzz!!</p>
                  <h2>{slide.title}</h2>
                  <p>{slide.text}</p>
                </article>
              ))}
            </div>

            <div className="slide-dots" aria-label="Choose slide">
              {authSlides.map((slide, index) => (
                <button
                  type="button"
                  className={activeSlide === index ? "active" : ""}
                  key={slide.title}
                  aria-label={`Show ${slide.title}`}
                  onClick={() => setActiveSlide(index)}
                />
              ))}
            </div>
          </section>

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
                onClick={() => {
                  setAuthMode("login");
                  setAuthError("");
                }}
              >
                Login
              </button>
              <button
                type="button"
                className={authMode === "signup" ? "active" : ""}
                onClick={() => {
                  setAuthMode("signup");
                  setAuthError("");
                }}
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
                  minLength={6}
                  type="password"
                />
              </label>
              {authError ? <p className="auth-error">{authError}</p> : null}
              <button type="submit" disabled={isAuthSubmitting}>
                {isAuthSubmitting
                  ? "Please wait"
                  : authMode === "login"
                    ? "Login"
                    : "Create account"}
              </button>
            </form>
          </section>
        </div>
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
            setImageError("");
            setVideoError("");
            setGeneratedImageUrl("");
            setGeneratedImagePrompt("");
            setGeneratedVideoUrl("");
            setGeneratedVideoPrompt("");
          }}
        >
          + New chat
        </button>

        <nav className="chat-list" aria-label="Recent chats">
          {currentChats.map((chat, index) => (
            <a href="#" key={`${index}-${chat}`}>
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
            onClick={handleLogout}
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
            onChange={(event) => handleFileChange(event, "file")}
          />
          <input
            ref={videoInputRef}
            className="hidden-input"
            accept="video/*"
            aria-label="Upload video"
            type="file"
            onChange={(event) => handleFileChange(event, "video")}
          />
          <input
            ref={documentInputRef}
            className="hidden-input"
            accept=".txt,.md,.csv,.json,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            aria-label="Upload document"
            type="file"
            onChange={(event) => handleFileChange(event, "document")}
          />

          <div className="composer-tools" aria-label="Chat tools">
            <div className="attach-menu">
              <button
                className="plus-button"
                type="button"
                aria-label="Add attachment"
                aria-expanded={isAttachMenuOpen}
                aria-haspopup="menu"
                onClick={() => setIsAttachMenuOpen((current) => !current)}
                disabled={isSending}
              >
                +
              </button>
              {isAttachMenuOpen ? (
                <div className="attach-dropdown" role="menu" aria-label="Attachment options">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => openUploadPicker(photoInputRef)}
                  >
                    Photos
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => openUploadPicker(videoInputRef)}
                  >
                    Videos
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => openUploadPicker(fileInputRef)}
                  >
                    Files
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => openUploadPicker(documentInputRef)}
                  >
                    Documents
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          {attachments.length > 0 ? (
            <div className="attachment-tray" aria-label="Attached items">
              {attachments.map((attachment) => (
                <span
                  className="attachment-pill"
                  key={`${attachment.kind}-${attachment.name}`}
                >
                  {attachmentDisplayLabel(attachment)}
                </span>
              ))}
            </div>
          ) : null}

          {imageError ? <p className="generation-error">{imageError}</p> : null}
          {videoError ? <p className="generation-error">{videoError}</p> : null}

          <div className="message-row">
            <input
              aria-label="Message Genzzz"
              placeholder="Message Genzzz!!"
              type="text"
              value={input}
              onChange={(event) => setInput(event.target.value)}
            />
            <button
              className="image-generate-button"
              type="button"
              onClick={generateImage}
              disabled={isImageGenerating || !input.trim()}
            >
              {isImageGenerating ? "Making" : "Image"}
            </button>
            <button
              className="video-generate-button"
              type="button"
              onClick={generateVideo}
              disabled={isVideoGenerating || !input.trim()}
            >
              {isVideoGenerating ? "Making" : "Video"}
            </button>
            <button type="submit" disabled={isSending}>
              {isSending ? "Sending" : "Send"}
            </button>
          </div>
        </form>
      </section>

      {generatedImageUrl ? (
        <div className="image-modal-backdrop" role="presentation">
          <section
            className="image-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Generated image"
          >
            <div className="image-modal-header">
              <div>
                <p className="eyebrow">Generated image</p>
                <h2>Preview</h2>
              </div>
              <button
                type="button"
                aria-label="Close image preview"
                onClick={() => setGeneratedImageUrl("")}
              >
                x
              </button>
            </div>
            <div
              className="image-preview"
              role="img"
              aria-label={generatedImagePrompt}
              style={{ backgroundImage: `url(${JSON.stringify(generatedImageUrl)})` }}
            />
            <p>{generatedImagePrompt}</p>
          </section>
        </div>
      ) : null}

      {generatedVideoUrl ? (
        <div className="image-modal-backdrop" role="presentation">
          <section
            className="image-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Generated video"
          >
            <div className="image-modal-header">
              <div>
                <p className="eyebrow">Generated video</p>
                <h2>Preview</h2>
              </div>
              <button
                type="button"
                aria-label="Close video preview"
                onClick={() => setGeneratedVideoUrl("")}
              >
                x
              </button>
            </div>
            <video className="video-preview" controls src={generatedVideoUrl} />
            <p>{generatedVideoPrompt}</p>
          </section>
        </div>
      ) : null}
    </main>
  );
}
