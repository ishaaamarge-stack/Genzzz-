import { NextResponse } from "next/server";

type AzureImageItem = {
  url?: string;
  b64_json?: string;
  revised_prompt?: string;
};

function getImageUrl(item: AzureImageItem) {
  if (item.url) {
    return item.url;
  }

  if (item.b64_json) {
    return `data:image/png;base64,${item.b64_json}`;
  }

  return "";
}

export async function POST(request: Request) {
  const endpoint = process.env.AZURE_OPENAI_IMAGE_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_IMAGE_API_KEY;

  if (!endpoint || !apiKey) {
    return NextResponse.json(
      { error: "Azure OpenAI image environment variables are not configured." },
      { status: 503 },
    );
  }

  let body: { prompt?: string };

  try {
    body = (await request.json()) as { prompt?: string };
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const prompt = body.prompt?.trim();

  if (!prompt) {
    return NextResponse.json(
      { error: "An image prompt is required." },
      { status: 400 },
    );
  }

  let azureResponse: Response;

  try {
    azureResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        prompt,
        n: 1,
        size: "1024x1024",
      }),
    });
  } catch {
    return NextResponse.json(
      { error: "Could not reach Azure OpenAI image generation." },
      { status: 502 },
    );
  }

  if (!azureResponse.ok) {
    const errorText = await azureResponse.text();

    return NextResponse.json(
      {
        error: "Azure OpenAI image request failed.",
        details: errorText,
      },
      { status: azureResponse.status },
    );
  }

  const data = await azureResponse.json();
  const image = data.data?.[0] as AzureImageItem | undefined;
  const imageUrl = image ? getImageUrl(image) : "";

  if (!imageUrl) {
    return NextResponse.json(
      { error: "Azure OpenAI did not return an image." },
      { status: 502 },
    );
  }

  return NextResponse.json({
    imageUrl,
    revisedPrompt: image?.revised_prompt || "",
  });
}
