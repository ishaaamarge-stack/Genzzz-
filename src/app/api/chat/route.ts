import { NextResponse } from "next/server";

type ChatMessage = {
  role: "assistant" | "user" | "system";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
};

function hasValidContent(content: ChatMessage["content"]) {
  if (typeof content === "string") {
    return content.trim().length > 0;
  }

  if (!Array.isArray(content) || content.length === 0) {
    return false;
  }

  return content.every((part) => {
    if (part.type === "text") {
      return typeof part.text === "string" && part.text.trim().length > 0;
    }

    return (
      part.type === "image_url" &&
      typeof part.image_url?.url === "string" &&
      part.image_url.url.startsWith("data:image/")
    );
  });
}

export async function POST(request: Request) {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;

  if (!endpoint || !apiKey) {
    return NextResponse.json(
      { error: "Azure OpenAI environment variables are not configured." },
      { status: 500 },
    );
  }

  const body = (await request.json()) as { messages?: ChatMessage[] };
  const messages = body.messages?.filter(
    (message) =>
      ["assistant", "user", "system"].includes(message.role) &&
      hasValidContent(message.content),
  );

  if (!messages || messages.length === 0) {
    return NextResponse.json(
      { error: "At least one chat message is required." },
      { status: 400 },
    );
  }

  const azureResponse = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      messages: [
        {
          role: "system",
          content:
            "You are Genzzz!!, a helpful AI assistant. Reply in compact Markdown only. Put the main answer first and make it bold. Use at most one short follow-up line or a tiny bullet list if absolutely needed. No extra explanation, no filler, no preamble.",
        },
        ...messages,
      ],
      temperature: 0.2,
      max_tokens: 350,
    }),
  });

  if (!azureResponse.ok) {
    const errorText = await azureResponse.text();

    return NextResponse.json(
      {
        error: "Azure OpenAI request failed.",
        details: errorText,
      },
      { status: azureResponse.status },
    );
  }

  const data = await azureResponse.json();
  const reply = data.choices?.[0]?.message?.content;

  if (!reply) {
    return NextResponse.json(
      { error: "Azure OpenAI did not return a message." },
      { status: 502 },
    );
  }

  return NextResponse.json({ reply });
}
